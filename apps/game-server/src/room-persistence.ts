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

export interface RoomPersistence {
  loadActive(now: number): readonly PersistedRoom[]
  save(room: PersistedRoom): void
  delete(roomCode: string): void
  deleteExpired(now: number): void
  close(): void
}

export function parsePersistedRoom(value: unknown) {
  return PersistedRoomSchema.parse(value)
}
