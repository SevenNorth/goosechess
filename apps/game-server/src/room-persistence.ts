import { AuthorityCheckpointSchema } from '@goose-chess/game-protocol'
import { z } from 'zod'

export const ROOM_PERSISTENCE_VERSION = 1 as const

const PersistedRoomMemberSchema = z.object({
  playerId: z.string().trim().min(1).max(128),
  recoveryTokenHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  controller: z.enum(['remote', 'ai']),
  displayName: z.string().trim().min(1).max(48),
  skinId: z.string().trim().min(1).max(128),
  seatIndex: z.number().int().min(0).max(3),
  ready: z.boolean(),
}).strict()

export const PersistedRoomSchema = z.object({
  persistenceVersion: z.literal(ROOM_PERSISTENCE_VERSION),
  roomCode: z.string().regex(/^[A-Z0-9]{6}$/),
  gameId: z.string().trim().min(1).max(128),
  members: z.array(PersistedRoomMemberSchema).min(1).max(4),
  hostPlayerId: z.string().trim().min(1).max(128),
  mapId: z.string().trim().min(1).max(128),
  maxPlayers: z.number().int().min(2).max(4),
  authorityCheckpoint: AuthorityCheckpointSchema.nullable(),
  aiCommandSequence: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
}).strict()

export type PersistedRoom = z.infer<typeof PersistedRoomSchema>
export type PersistedRoomMember = z.infer<typeof PersistedRoomMemberSchema>

export interface RoomOwner {
  readonly ownerId: string
  readonly ownerUrl: string
}

export interface RoomLease extends RoomOwner {
  readonly fencingToken: number
  readonly expiresAt: number
}

export type RoomClaimResult =
  | { readonly status: 'acquired'; readonly room: PersistedRoom; readonly lease: RoomLease }
  | { readonly status: 'owned_elsewhere'; readonly ownerUrl: string; readonly leaseExpiresAt: number }
  | { readonly status: 'not_found' }

export type RoomCreateResult =
  | { readonly status: 'created'; readonly lease: RoomLease }
  | { readonly status: 'conflict' }

export interface RoomPersistence {
  readonly shared: boolean
  loadActive(now: number): Promise<readonly PersistedRoom[]>
  create(room: PersistedRoom, owner: RoomOwner, leaseExpiresAt: number): Promise<RoomCreateResult>
  claim(roomCode: string, owner: RoomOwner, now: number, leaseExpiresAt: number): Promise<RoomClaimResult>
  save(room: PersistedRoom, lease: RoomLease | null, now: number, leaseExpiresAt: number): Promise<RoomLease | null>
  renew(roomCode: string, lease: RoomLease, now: number, leaseExpiresAt: number): Promise<RoomLease | null>
  delete(roomCode: string, lease: RoomLease | null): Promise<void>
  deleteExpired(now: number): Promise<void>
  release(roomCode: string, lease: RoomLease, now: number): Promise<void>
  /** Read the current owner without attempting to acquire or renew its lease. */
  lookupOwner?(roomCode: string, now: number): Promise<RoomOwner | null>
  close(): Promise<void>
}

export function parsePersistedRoom(value: unknown) {
  return PersistedRoomSchema.parse(value)
}
