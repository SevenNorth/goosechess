import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  parsePersistedRoom,
  type PersistedRoom,
  type RoomClaimResult,
  type RoomCreateResult,
  type RoomLease,
  type RoomOwner,
  type RoomPersistence,
} from './room-persistence.js'

interface StoredRoomRow {
  readonly payload: string
}

export class SqliteRoomPersistence implements RoomPersistence {
  readonly shared = false
  private readonly database: DatabaseSync
  private readonly saveStatement
  private readonly createStatement
  private readonly loadStatement
  private readonly getStatement
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
    this.createStatement = this.database.prepare(`
      INSERT INTO rooms (room_code, payload, updated_at, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(room_code) DO NOTHING
    `)
    this.loadStatement = this.database.prepare('SELECT payload FROM rooms WHERE expires_at > ? ORDER BY updated_at')
    this.getStatement = this.database.prepare('SELECT payload FROM rooms WHERE room_code = ? AND expires_at > ?')
    this.deleteStatement = this.database.prepare('DELETE FROM rooms WHERE room_code = ?')
    this.deleteExpiredStatement = this.database.prepare('DELETE FROM rooms WHERE expires_at <= ?')
  }

  async loadActive(now: number) {
    this.ensureOpen()
    return (this.loadStatement.all(now) as unknown as StoredRoomRow[])
      .map((row) => parsePersistedRoom(JSON.parse(row.payload)))
  }

  async create(room: PersistedRoom, owner: RoomOwner, leaseExpiresAt: number): Promise<RoomCreateResult> {
    this.ensureOpen()
    const persisted = parsePersistedRoom(room)
    const result = this.createStatement.run(
      persisted.roomCode,
      JSON.stringify(persisted),
      persisted.updatedAt,
      persisted.expiresAt,
    ) as unknown as { changes: number }
    if (result.changes !== 1) return { status: 'conflict' }
    return {
      status: 'created',
      lease: { ...owner, fencingToken: 1, expiresAt: leaseExpiresAt },
    }
  }

  async claim(roomCode: string, owner: RoomOwner, now: number, leaseExpiresAt: number): Promise<RoomClaimResult> {
    this.ensureOpen()
    const row = this.getStatement.get(roomCode, now) as unknown as StoredRoomRow | undefined
    return row
      ? {
          status: 'acquired',
          room: parsePersistedRoom(JSON.parse(row.payload)),
          lease: { ...owner, fencingToken: 1, expiresAt: leaseExpiresAt },
        }
      : { status: 'not_found' }
  }

  async save(room: PersistedRoom, lease: RoomLease | null, _now: number, leaseExpiresAt: number) {
    this.ensureOpen()
    const persisted = parsePersistedRoom(room)
    this.saveStatement.run(persisted.roomCode, JSON.stringify(persisted), persisted.updatedAt, persisted.expiresAt)
    return lease ? { ...lease, expiresAt: leaseExpiresAt } : null
  }

  async renew(_roomCode: string, lease: RoomLease, _now: number, leaseExpiresAt: number) {
    this.ensureOpen()
    return { ...lease, expiresAt: leaseExpiresAt }
  }

  async delete(roomCode: string) {
    this.ensureOpen()
    this.deleteStatement.run(roomCode)
  }

  async deleteExpired(now: number) {
    this.ensureOpen()
    this.deleteExpiredStatement.run(now)
  }

  async release() {
    this.ensureOpen()
  }

  async close() {
    if (this.closed) return
    this.closed = true
    this.database.close()
  }

  private ensureOpen() {
    if (this.closed) throw new Error('Room persistence is closed.')
  }
}
