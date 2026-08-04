import { Pool, type PoolConfig, type QueryResultRow } from 'pg'
import {
  parsePersistedRoom,
  type PersistedRoom,
  type RoomClaimResult,
  type RoomCreateResult,
  type RoomLease,
  type RoomOwner,
  type RoomPersistence,
} from './room-persistence.js'

interface LeaseRow extends QueryResultRow {
  readonly payload: unknown
  readonly owner_id: string
  readonly owner_url: string
  readonly lease_expires_at: string | number
  readonly fencing_token: string | number
}

function toLease(row: LeaseRow): RoomLease {
  return {
    ownerId: row.owner_id,
    ownerUrl: row.owner_url,
    expiresAt: Number(row.lease_expires_at),
    fencingToken: Number(row.fencing_token),
  }
}

export class PostgresRoomPersistence implements RoomPersistence {
  readonly shared = true
  private readonly pool: Pool
  private readonly ready: Promise<void>

  constructor(config: string | PoolConfig | Pool) {
    this.pool = config instanceof Pool
      ? config
      : new Pool(typeof config === 'string' ? { connectionString: config } : config)
    this.ready = this.initialize()
  }

  async loadActive() {
    await this.ready
    return []
  }

  async create(room: PersistedRoom, owner: RoomOwner, leaseExpiresAt: number): Promise<RoomCreateResult> {
    await this.ready
    const persisted = parsePersistedRoom(room)
    const result = await this.pool.query<LeaseRow>(`
      INSERT INTO goose_chess_rooms (
        room_code, payload, updated_at, expires_at,
        owner_id, owner_url, lease_expires_at, fencing_token
      ) VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, 1)
      ON CONFLICT (room_code) DO NOTHING
      RETURNING payload, owner_id, owner_url, lease_expires_at, fencing_token
    `, [
      persisted.roomCode,
      JSON.stringify(persisted),
      persisted.updatedAt,
      persisted.expiresAt,
      owner.ownerId,
      owner.ownerUrl,
      leaseExpiresAt,
    ])
    const row = result.rows[0]
    return row ? { status: 'created', lease: toLease(row) } : { status: 'conflict' }
  }

  async claim(
    roomCode: string,
    owner: RoomOwner,
    now: number,
    leaseExpiresAt: number,
  ): Promise<RoomClaimResult> {
    await this.ready
    const acquired = await this.pool.query<LeaseRow>(`
      UPDATE goose_chess_rooms
      SET owner_id = $2,
          owner_url = $3,
          lease_expires_at = $5,
          fencing_token = fencing_token + 1
      WHERE room_code = $1
        AND expires_at > $4
        AND ((owner_id = $2 AND owner_url = $3) OR lease_expires_at <= $4)
      RETURNING payload, owner_id, owner_url, lease_expires_at, fencing_token
    `, [roomCode, owner.ownerId, owner.ownerUrl, now, leaseExpiresAt])
    const acquiredRow = acquired.rows[0]
    if (acquiredRow) {
      return {
        status: 'acquired',
        room: parsePersistedRoom(acquiredRow.payload),
        lease: toLease(acquiredRow),
      }
    }

    const existing = await this.pool.query<LeaseRow>(`
      SELECT payload, owner_id, owner_url, lease_expires_at, fencing_token
      FROM goose_chess_rooms
      WHERE room_code = $1 AND expires_at > $2
    `, [roomCode, now])
    const existingRow = existing.rows[0]
    return existingRow
      ? {
          status: 'owned_elsewhere',
          ownerUrl: existingRow.owner_url,
          leaseExpiresAt: Number(existingRow.lease_expires_at),
        }
      : { status: 'not_found' }
  }

  async save(
    room: PersistedRoom,
    lease: RoomLease | null,
    now: number,
    leaseExpiresAt: number,
  ): Promise<RoomLease | null> {
    await this.ready
    if (!lease) return null
    const persisted = parsePersistedRoom(room)
    const result = await this.pool.query<LeaseRow>(`
      UPDATE goose_chess_rooms
      SET payload = $2::jsonb,
          updated_at = $3,
          expires_at = $4,
          lease_expires_at = $8
      WHERE room_code = $1
        AND owner_id = $5
        AND owner_url = $6
        AND fencing_token = $7
        AND lease_expires_at > $3
      RETURNING payload, owner_id, owner_url, lease_expires_at, fencing_token
    `, [
      persisted.roomCode,
      JSON.stringify(persisted),
      now,
      persisted.expiresAt,
      lease.ownerId,
      lease.ownerUrl,
      lease.fencingToken,
      leaseExpiresAt,
    ])
    const row = result.rows[0]
    return row ? toLease(row) : null
  }

  async renew(roomCode: string, lease: RoomLease, now: number, leaseExpiresAt: number) {
    await this.ready
    const result = await this.pool.query<LeaseRow>(`
      UPDATE goose_chess_rooms
      SET lease_expires_at = $5
      WHERE room_code = $1
        AND owner_id = $2
        AND fencing_token = $3
        AND lease_expires_at > $4
      RETURNING payload, owner_id, owner_url, lease_expires_at, fencing_token
    `, [roomCode, lease.ownerId, lease.fencingToken, now, leaseExpiresAt])
    const row = result.rows[0]
    return row ? toLease(row) : null
  }

  async lookupOwner(roomCode: string, now: number): Promise<RoomOwner | null> {
    await this.ready
    const result = await this.pool.query<LeaseRow>(`
      SELECT owner_id, owner_url, lease_expires_at
      FROM goose_chess_rooms
      WHERE room_code = $1 AND expires_at > $2 AND lease_expires_at > $2
    `, [roomCode, now])
    const row = result.rows[0]
    return row ? { ownerId: row.owner_id, ownerUrl: row.owner_url } : null
  }

  async delete(roomCode: string, lease: RoomLease | null) {
    await this.ready
    if (!lease) return
    await this.pool.query(`
      DELETE FROM goose_chess_rooms
      WHERE room_code = $1 AND owner_id = $2 AND fencing_token = $3
    `, [roomCode, lease.ownerId, lease.fencingToken])
  }

  async deleteExpired(now: number) {
    await this.ready
    await this.pool.query('DELETE FROM goose_chess_rooms WHERE expires_at <= $1', [now])
  }

  async release(roomCode: string, lease: RoomLease, now: number) {
    await this.ready
    await this.pool.query(`
      UPDATE goose_chess_rooms
      SET lease_expires_at = $4
      WHERE room_code = $1 AND owner_id = $2 AND fencing_token = $3
    `, [roomCode, lease.ownerId, lease.fencingToken, now])
  }

  async close() {
    try {
      await this.ready
    } finally {
      await this.pool.end()
    }
  }

  private async initialize() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS goose_chess_rooms (
        room_code TEXT PRIMARY KEY,
        payload JSONB NOT NULL,
        updated_at BIGINT NOT NULL,
        expires_at BIGINT NOT NULL,
        owner_id TEXT NOT NULL,
        owner_url TEXT NOT NULL,
        lease_expires_at BIGINT NOT NULL,
        fencing_token BIGINT NOT NULL CHECK (fencing_token > 0)
      )
    `)
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS goose_chess_rooms_expires_at_idx
      ON goose_chess_rooms (expires_at)
    `)
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS goose_chess_rooms_lease_expires_at_idx
      ON goose_chess_rooms (lease_expires_at)
    `)
  }
}
