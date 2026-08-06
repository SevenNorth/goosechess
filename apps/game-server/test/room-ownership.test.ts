import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { PROTOCOL_SCHEMA_VERSION, ServerRoomMessageSchema } from '@goose-chess/game-protocol'
import type {
  PersistedRoom,
  RoomClaimResult,
  RoomCreateResult,
  RoomLease,
  RoomOwner,
  RoomPersistence,
} from '../src/room-persistence.js'
import { RoomStore } from '../src/room-store.js'
import { createGameServer } from '../src/server.js'

interface SharedRoomRecord {
  room: PersistedRoom
  owner: RoomOwner
  leaseExpiresAt: number
  fencingToken: number
}

interface SaveGate {
  readonly blocked: Promise<void>
  markBlocked(): void
  readonly released: Promise<void>
  release(): void
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((next) => { resolve = next })
  return { promise, resolve }
}

class SharedMemoryBackend {
  readonly rooms = new Map<string, SharedRoomRecord>()
  readonly claimCounts = new Map<string, number>()
  private nextSaveGate: SaveGate | null = null

  pauseNextSave() {
    const blocked = deferred()
    const released = deferred()
    const gate: SaveGate = {
      blocked: blocked.promise,
      markBlocked: blocked.resolve,
      released: released.promise,
      release: released.resolve,
    }
    this.nextSaveGate = gate
    return gate
  }

  async beforeSave() {
    const gate = this.nextSaveGate
    if (!gate) return
    this.nextSaveGate = null
    gate.markBlocked()
    await gate.released
  }
}

class SharedMemoryRoomPersistence implements RoomPersistence {
  readonly shared = true

  constructor(
    private readonly backend: SharedMemoryBackend,
    private readonly adapterId: string,
  ) {}

  async loadActive() {
    return []
  }

  async create(room: PersistedRoom, owner: RoomOwner, leaseExpiresAt: number): Promise<RoomCreateResult> {
    if (this.backend.rooms.has(room.roomCode)) return { status: 'conflict' }
    this.backend.rooms.set(room.roomCode, {
      room: structuredClone(room),
      owner: { ...owner },
      leaseExpiresAt,
      fencingToken: 1,
    })
    return {
      status: 'created',
      lease: { ...owner, expiresAt: leaseExpiresAt, fencingToken: 1 },
    }
  }

  async claim(roomCode: string, owner: RoomOwner, now: number, leaseExpiresAt: number): Promise<RoomClaimResult> {
    this.backend.claimCounts.set(this.adapterId, (this.backend.claimCounts.get(this.adapterId) ?? 0) + 1)
    const record = this.backend.rooms.get(roomCode)
    if (!record || record.room.expiresAt <= now) return { status: 'not_found' }
    if (record.owner.ownerId !== owner.ownerId && record.leaseExpiresAt > now) {
      return {
        status: 'owned_elsewhere',
        ownerUrl: record.owner.ownerUrl,
        leaseExpiresAt: record.leaseExpiresAt,
      }
    }
    record.fencingToken += 1
    record.owner = { ...owner }
    record.leaseExpiresAt = leaseExpiresAt
    return {
      status: 'acquired',
      room: structuredClone(record.room),
      lease: this.lease(record),
    }
  }

  async save(room: PersistedRoom, lease: RoomLease | null, now: number, leaseExpiresAt: number) {
    await this.backend.beforeSave()
    const record = this.backend.rooms.get(room.roomCode)
    if (!record || !lease || record.room.expiresAt <= now || record.leaseExpiresAt <= now) return null
    if (record.owner.ownerId !== lease.ownerId || record.fencingToken !== lease.fencingToken) return null
    record.room = structuredClone(room)
    record.leaseExpiresAt = leaseExpiresAt
    return this.lease(record)
  }

  async renew(roomCode: string, lease: RoomLease, now: number, leaseExpiresAt: number) {
    const record = this.backend.rooms.get(roomCode)
    if (!record || record.leaseExpiresAt <= now) return null
    if (record.owner.ownerId !== lease.ownerId || record.fencingToken !== lease.fencingToken) return null
    record.leaseExpiresAt = leaseExpiresAt
    return this.lease(record)
  }

  async delete(roomCode: string, lease: RoomLease | null) {
    const record = this.backend.rooms.get(roomCode)
    if (record && lease && record.owner.ownerId === lease.ownerId && record.fencingToken === lease.fencingToken) {
      this.backend.rooms.delete(roomCode)
    }
  }

  async deleteExpired(now: number) {
    for (const [roomCode, record] of this.backend.rooms) {
      if (record.room.expiresAt <= now) this.backend.rooms.delete(roomCode)
    }
  }

  async release(roomCode: string, lease: RoomLease, now: number) {
    const record = this.backend.rooms.get(roomCode)
    if (record && record.owner.ownerId === lease.ownerId && record.fencingToken === lease.fencingToken) {
      record.leaseExpiresAt = now
    }
  }

  async lookupOwner(roomCode: string, now: number) {
    const record = this.backend.rooms.get(roomCode)
    return record && record.room.expiresAt > now && record.leaseExpiresAt > now ? { ...record.owner } : null
  }

  async close() {}

  private lease(record: SharedRoomRecord): RoomLease {
    return {
      ...record.owner,
      expiresAt: record.leaseExpiresAt,
      fencingToken: record.fencingToken,
    }
  }
}

function createSharedStore(backend: SharedMemoryBackend, id: string, ownerUrl: string, now: () => number) {
  return new RoomStore({
    persistence: new SharedMemoryRoomPersistence(backend, id),
    ownerId: id,
    ownerUrl,
    now,
    leaseDurationMs: 1_000,
    leaseRenewIntervalMs: 900,
    cleanupIntervalMs: 60_000,
  })
}

describe('multi-instance room ownership', () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    await Promise.allSettled(cleanups.splice(0).reverse().map((cleanup) => cleanup()))
  })

  it('returns the active owner URL from a non-owner HTTP instance', async () => {
    const backend = new SharedMemoryBackend()
    const now = 1_000
    const owner = createSharedStore(backend, 'instance-a', 'https://game-a.example.com', () => now)
    const joined = await owner.createRoom({ displayName: '房主', skinId: 'goose-white' })
    cleanups.push(() => owner.close())

    const nonOwner = createSharedStore(backend, 'instance-b', 'https://game-b.example.com', () => now)
    const server = createGameServer({ port: 0, store: nonOwner, now: () => now })
    const address = await server.listen()
    cleanups.push(() => server.close())
    const response = await fetch(`http://127.0.0.1:${address.port}/rooms/${joined.room.roomCode}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: '访客', skinId: 'goose-blue' }),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      code: 'room_owned_elsewhere',
      ownerUrl: 'https://game-a.example.com',
    })

    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/rooms/${joined.room.roomCode}/connect?token=${joined.recoveryToken}`)
    const ownerMessage = await new Promise<unknown>((resolve, reject) => {
      socket.once('message', (raw) => resolve(JSON.parse(raw.toString())))
      socket.once('error', reject)
    })
    expect(ServerRoomMessageSchema.parse(ownerMessage)).toMatchObject({
      type: 'room-error',
      code: 'room_owned_elsewhere',
      ownerUrl: 'https://game-a.example.com',
    })
    socket.terminate()

    const contentResponse = await fetch(`http://127.0.0.1:${address.port}/rooms/${joined.room.roomCode}/content`, {
      headers: { Authorization: `Bearer ${joined.recoveryToken}` },
    })
    expect(contentResponse.status).toBe(409)
    await expect(contentResponse.json()).resolves.toMatchObject({
      code: 'room_owned_elsewhere',
      ownerUrl: 'https://game-a.example.com',
    })
  })

  it('increments fencing and rejects stale-owner writes after lease takeover', async () => {
    const backend = new SharedMemoryBackend()
    let now = 1_000
    const first = createSharedStore(backend, 'instance-a', 'https://game-a.example.com', () => now)
    const second = createSharedStore(backend, 'instance-b', 'https://game-b.example.com', () => now)
    cleanups.push(() => first.close(), () => second.close())
    const joined = await first.createRoom({ displayName: '房主', skinId: 'goose-white' })

    await expect(second.joinRoom(joined.room.roomCode, {
      displayName: '房主',
      skinId: 'goose-white',
    }, joined.recoveryToken)).rejects.toMatchObject({
      code: 'room_owned_elsewhere',
      ownerUrl: 'https://game-a.example.com',
    })

    now = 2_001
    const recovered = await second.joinRoom(joined.room.roomCode, {
      displayName: '房主',
      skinId: 'goose-white',
    }, joined.recoveryToken)
    expect(recovered.serverUrl).toBe('https://game-b.example.com')
    expect(backend.rooms.get(joined.room.roomCode)?.fencingToken).toBe(2)

    await expect(second.submitLobby(joined.room.roomCode, joined.recoveryToken, {
      type: 'set-ready',
      ready: true,
    })).resolves.toEqual({ ok: true })
    await expect(first.submitLobby(joined.room.roomCode, joined.recoveryToken, {
      type: 'set-ready',
      ready: false,
    })).rejects.toMatchObject({
      code: 'room_lease_lost',
      ownerUrl: 'https://game-b.example.com',
    })
    expect(backend.rooms.get(joined.room.roomCode)?.room.members[0].ready).toBe(true)
    expect(first.getDiagnostics().totalRooms).toBe(0)
  })

  it('coalesces concurrent first claims on the same instance', async () => {
    const backend = new SharedMemoryBackend()
    const now = 1_000
    const first = createSharedStore(backend, 'instance-a', 'https://game-a.example.com', () => now)
    const joined = await first.createRoom({ displayName: '房主', skinId: 'goose-white' })
    await first.close()

    const second = createSharedStore(backend, 'instance-b', 'https://game-b.example.com', () => now)
    cleanups.push(() => second.close())
    const profile = { displayName: '房主', skinId: 'goose-white' }
    const [left, right] = await Promise.all([
      second.joinRoom(joined.room.roomCode, profile, joined.recoveryToken),
      second.joinRoom(joined.room.roomCode, profile, joined.recoveryToken),
    ])

    expect(left.playerId).toBe(joined.playerId)
    expect(right.playerId).toBe(joined.playerId)
    expect(backend.claimCounts.get('instance-b')).toBe(1)
    expect(backend.rooms.get(joined.room.roomCode)?.room.members).toHaveLength(1)
  })

  it('persists authority updates before broadcasting them', async () => {
    const backend = new SharedMemoryBackend()
    const now = 1_000
    const store = createSharedStore(backend, 'instance-a', 'https://game-a.example.com', () => now)
    cleanups.push(() => store.close())
    const joined = await store.createRoom({ displayName: '房主', skinId: 'goose-white' })
    const messages: Array<{ type: string }> = []
    const unsubscribe = await store.subscribe(joined.room.roomCode, joined.recoveryToken, (message) => messages.push(message))
    await store.submitLobby(joined.room.roomCode, joined.recoveryToken, { type: 'add-ai' })
    await store.submitLobby(joined.room.roomCode, joined.recoveryToken, { type: 'set-ready', ready: true })
    await store.submitLobby(joined.room.roomCode, joined.recoveryToken, { type: 'start-game' })
    messages.splice(0)

    const gate = backend.pauseNextSave()
    const submission = store.submit(joined.room.roomCode, joined.recoveryToken, {
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      gameId: joined.room.gameId,
      commandId: 'fenced-authority-command',
      playerId: joined.playerId,
      expectedRevision: 0,
      command: { type: 'request-order-roll' },
    })
    await gate.blocked
    const synchronization = store.sync(joined.room.roomCode, joined.recoveryToken)
    await Promise.resolve()
    expect(messages.some((message) => message.type === 'authority-update')).toBe(false)
    expect(messages.some((message) => message.type === 'room-state')).toBe(false)

    gate.release()
    await expect(submission).resolves.toMatchObject({ ok: true })
    await synchronization
    expect(messages.some((message) => message.type === 'authority-update')).toBe(true)
    expect(messages.some((message) => message.type === 'room-state')).toBe(true)
    unsubscribe()
  })
})
