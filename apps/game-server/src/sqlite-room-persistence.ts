import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parsePersistedRoom, type PersistedRoom, type RoomPersistence } from './room-persistence.js'

interface StoredRoomRow {
  readonly payload: string
}

export class SqliteRoomPersistence implements RoomPersistence {
  private readonly database: DatabaseSync
  private readonly saveStatement
  private readonly loadStatement
  private readonly deleteStatement
  private readonly deleteExpiredStatement
  private closed = false

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') mkdirSync(dirname(resolve(databasePath)), { recursive: true })
    this.database = new DatabaseSync(databasePath)
    this.database.exec('PRAGMA journal_mode = WAL')
    this.database.exec('PRAGMA synchronous = FULL')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        room_code TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      ) STRICT
    `)
    this.saveStatement = this.database.prepare(`
      INSERT INTO rooms (room_code, payload, updated_at, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(room_code) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `)
    this.loadStatement = this.database.prepare('SELECT payload FROM rooms WHERE expires_at > ? ORDER BY updated_at')
    this.deleteStatement = this.database.prepare('DELETE FROM rooms WHERE room_code = ?')
    this.deleteExpiredStatement = this.database.prepare('DELETE FROM rooms WHERE expires_at <= ?')
  }

  loadActive(now: number) {
    this.ensureOpen()
    return (this.loadStatement.all(now) as unknown as StoredRoomRow[])
      .map((row) => parsePersistedRoom(JSON.parse(row.payload)))
  }

  save(room: PersistedRoom) {
    this.ensureOpen()
    const persisted = parsePersistedRoom(room)
    this.saveStatement.run(persisted.roomCode, JSON.stringify(persisted), persisted.updatedAt, persisted.expiresAt)
  }

  delete(roomCode: string) {
    this.ensureOpen()
    this.deleteStatement.run(roomCode)
  }

  deleteExpired(now: number) {
    this.ensureOpen()
    this.deleteExpiredStatement.run(now)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.database.close()
  }

  private ensureOpen() {
    if (this.closed) throw new Error('Room persistence is closed.')
  }
}
