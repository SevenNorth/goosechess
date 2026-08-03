import { z } from 'zod'

export const PROTOCOL_SCHEMA_VERSION = 6 as const

const IdSchema = z.string().trim().min(1).max(128)
const RevisionSchema = z.number().int().nonnegative()
const SpaceIdSchema = z.number().int().nonnegative()
const DicePairSchema = z.tuple([z.number().int().min(1).max(6), z.number().int().min(1).max(6)])
const DiceAdjustmentSchema = z.object({
  dieIndex: z.union([z.literal(0), z.literal(1)]),
  fromFace: z.number().int().min(1).max(6),
  toFace: z.number().int().min(1).max(6),
  reason: z.enum(['max-face', 'min-face', 'fixed-total']),
}).strict()

export const GameCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('select-skin'), skinId: IdSchema }).strict(),
  z.object({ type: z.literal('choose-starting-item'), itemId: IdSchema }).strict(),
  z.object({ type: z.literal('request-order-roll') }).strict(),
  z.object({ type: z.literal('use-item'), itemId: IdSchema, targetPlayerId: IdSchema.optional() }).strict(),
  z.object({ type: z.literal('request-roll') }).strict(),
  z.object({ type: z.literal('choose-event'), eventId: IdSchema }).strict(),
  z.object({ type: z.literal('choose-item'), itemId: IdSchema.nullable() }).strict(),
  z.object({ type: z.literal('continue') }).strict(),
])

export const CommandEnvelopeSchema = z.object({
  schemaVersion: z.literal(PROTOCOL_SCHEMA_VERSION),
  gameId: IdSchema,
  commandId: IdSchema,
  playerId: IdSchema,
  expectedRevision: RevisionSchema,
  command: GameCommandSchema,
}).strict()

export const PlayerSnapshotSchema = z.object({
  playerId: IdSchema,
  seatIndex: z.number().int().min(0).max(3),
  displayName: z.string().trim().min(1).max(48),
  controller: z.enum(['local', 'ai', 'remote']),
  colorId: IdSchema,
  skinId: IdSchema,
  spaceId: SpaceIdSchema,
  itemId: IdSchema.nullable(),
  skipTurns: z.number().int().nonnegative(),
  nextMoveBonus: z.number().int(),
  nextMaxDie: z.number().int().min(1).max(6).nullable(),
  nextFixedMoveTotal: z.number().int().positive().nullable(),
}).strict()

export const SerializableGameStateSchema = z.object({
  phase: z.enum([
    'determining-order',
    'choosing-starting-item',
    'awaiting-action',
    'awaiting-event-choice',
    'awaiting-item-choice',
    'game-over',
  ]),
  round: z.number().int().positive(),
  activePlayerId: IdSchema,
  players: z.array(PlayerSnapshotSchema).min(2).max(4),
  turnOrderGroups: z.array(z.array(IdSchema).min(1).max(4)).min(1).max(4),
  orderRollResults: z.array(z.object({ playerId: IdSchema, face: z.number().int().min(1).max(6) }).strict()).max(4),
  orderRollHistory: z.array(z.object({
    playerIds: z.array(IdSchema).min(2).max(4),
    results: z.array(z.object({ playerId: IdSchema, face: z.number().int().min(1).max(6) }).strict()).min(2).max(4),
  }).strict()),
  startingItemOfferIds: z.array(IdSchema).max(3),
  pendingEventIds: z.array(IdSchema).max(3),
  pendingItemId: IdSchema.nullable(),
  eventContinuation: z.enum(['end-turn', 'awaiting-action']).nullable(),
  recentEventIds: z.array(IdSchema).max(2),
  winnerPlayerId: IdSchema.nullable(),
  extraTurnQueued: z.boolean(),
  globalDieRule: z.object({
    maxFace: z.number().int().min(1).max(6),
    remainingRounds: z.number().int().positive(),
  }).strict().nullable(),
  lastDice: z.object({
    playerId: IdSchema,
    purpose: z.enum(['move', 'check']),
    faces: DicePairSchema,
    total: z.number().int().min(2).max(12),
  }).strict().nullable(),
}).strict()

export const GameSnapshotSchema = z.object({
  schemaVersion: z.literal(PROTOCOL_SCHEMA_VERSION),
  gameId: IdSchema,
  revision: RevisionSchema,
  rulesetId: IdSchema,
  rulesetVersion: z.number().int().positive(),
  mapId: IdSchema,
  contentVersion: z.string().trim().min(1).max(64),
  rngSeed: z.number().int().nonnegative(),
  rngCursor: z.number().int().nonnegative(),
  state: SerializableGameStateSchema,
}).strict()

export const DomainEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('starting-items-offered'), eventId: IdSchema, revision: RevisionSchema, playerId: IdSchema, itemIds: z.array(IdSchema).length(3) }).strict(),
  z.object({ type: z.literal('starting-item-chosen'), eventId: IdSchema, revision: RevisionSchema, playerId: IdSchema, itemId: IdSchema }).strict(),
  z.object({ type: z.literal('skin-selected'), eventId: IdSchema, revision: RevisionSchema, playerId: IdSchema, skinId: IdSchema }).strict(),
  z.object({ type: z.literal('order-die-rolled'), eventId: IdSchema, revision: RevisionSchema, playerId: IdSchema, face: z.number().int().min(1).max(6) }).strict(),
  z.object({ type: z.literal('turn-order-determined'), eventId: IdSchema, revision: RevisionSchema, playerIds: z.array(IdSchema).min(2).max(4) }).strict(),
  z.object({ type: z.literal('dice-rolled'), eventId: IdSchema, revision: RevisionSchema, playerId: IdSchema, purpose: z.enum(['move', 'check']), dice: DicePairSchema }).strict(),
  z.object({ type: z.literal('token-moved'), eventId: IdSchema, revision: RevisionSchema, playerId: IdSchema, fromSpaceId: SpaceIdSchema, path: z.array(SpaceIdSchema), toSpaceId: SpaceIdSchema }).strict(),
  z.object({ type: z.literal('event-offered'), eventId: IdSchema, revision: RevisionSchema, playerId: IdSchema, eventCardIds: z.array(IdSchema).length(3) }).strict(),
  z.object({ type: z.literal('collision-resolved'), eventId: IdSchema, revision: RevisionSchema, movingPlayerId: IdSchema, displacedPlayerId: IdSchema, fromSpaceId: SpaceIdSchema, toSpaceId: SpaceIdSchema, blocked: z.boolean() }).strict(),
  z.object({ type: z.literal('event-resolved'), eventId: IdSchema, revision: RevisionSchema, playerId: IdSchema, eventCardId: IdSchema, passed: z.boolean().nullable() }).strict(),
  z.object({ type: z.literal('item-changed'), eventId: IdSchema, revision: RevisionSchema, playerId: IdSchema, itemId: IdSchema.nullable() }).strict(),
  z.object({ type: z.literal('item-offered'), eventId: IdSchema, revision: RevisionSchema, playerId: IdSchema, itemId: IdSchema }).strict(),
  z.object({ type: z.literal('turn-skipped'), eventId: IdSchema, revision: RevisionSchema, playerId: IdSchema, remainingTurns: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('turn-advanced'), eventId: IdSchema, revision: RevisionSchema, playerId: IdSchema, round: z.number().int().positive() }).strict(),
  z.object({ type: z.literal('global-die-rule-changed'), eventId: IdSchema, revision: RevisionSchema, maxFace: z.number().int().min(1).max(6).nullable(), remainingRounds: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('game-won'), eventId: IdSchema, revision: RevisionSchema, playerId: IdSchema, spaceId: SpaceIdSchema }).strict(),
])

export const PresentationCueSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('item-use'), cueId: IdSchema, sequence: RevisionSchema, playerId: IdSchema,
    itemId: IdSchema, targetPlayerId: IdSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal('dice-roll'), cueId: IdSchema, sequence: RevisionSchema, playerId: IdSchema,
    rawDice: DicePairSchema, dice: DicePairSchema, movementTotal: z.number().int().nullable(),
    movementModifier: z.number().int(), adjustments: z.array(DiceAdjustmentSchema).max(2),
  }).strict(),
  z.object({ type: z.literal('route-preview'), cueId: IdSchema, sequence: RevisionSchema, playerId: IdSchema, path: z.array(SpaceIdSchema).min(1), targetSpaceId: SpaceIdSchema }).strict(),
  z.object({ type: z.literal('target-highlight'), cueId: IdSchema, sequence: RevisionSchema, spaceId: SpaceIdSchema }).strict(),
  z.object({ type: z.literal('token-hop'), cueId: IdSchema, sequence: RevisionSchema, playerId: IdSchema, path: z.array(SpaceIdSchema).min(1) }).strict(),
  z.object({
    type: z.literal('token-relocate'), cueId: IdSchema, sequence: RevisionSchema, playerId: IdSchema,
    fromSpaceId: SpaceIdSchema, toSpaceId: SpaceIdSchema, reason: z.enum(['collision', 'swap']), blocked: z.boolean().optional(),
  }).strict(),
  z.object({ type: z.literal('event-cards'), cueId: IdSchema, sequence: RevisionSchema, eventIds: z.array(IdSchema).length(3) }).strict(),
  z.object({ type: z.literal('game-over'), cueId: IdSchema, sequence: RevisionSchema, winnerPlayerId: IdSchema }).strict(),
])

export const AuthorityErrorCodeSchema = z.enum([
  'invalid_envelope',
  'unknown_command',
  'unknown_content',
  'duplicate_command',
  'stale_revision',
  'unauthorized_player',
  'illegal_command',
])

export const AuthorityErrorSchema = z.object({
  code: AuthorityErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
}).strict()

export const AuthorityUpdateSchema = z.object({
  snapshot: GameSnapshotSchema,
  events: z.array(DomainEventSchema),
  cues: z.array(PresentationCueSchema),
}).strict()

export const CommandResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), update: AuthorityUpdateSchema }).strict(),
  z.object({ ok: z.literal(false), error: AuthorityErrorSchema }).strict(),
])

export const RoomPlayerSchema = z.object({
  playerId: IdSchema,
  displayName: z.string().trim().min(1).max(48),
  skinId: IdSchema,
  seatIndex: z.number().int().min(0).max(1),
  connected: z.boolean(),
}).strict()

export const RoomStateSchema = z.object({
  schemaVersion: z.literal(PROTOCOL_SCHEMA_VERSION),
  roomCode: z.string().regex(/^[A-Z0-9]{6}$/),
  gameId: IdSchema,
  status: z.enum(['waiting', 'playing', 'finished']),
  players: z.array(RoomPlayerSchema).min(1).max(2),
}).strict()

export const RoomJoinResponseSchema = z.object({
  room: RoomStateSchema,
  playerId: IdSchema,
  recoveryToken: IdSchema,
}).strict()

export const ClientRoomMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('command'), envelope: CommandEnvelopeSchema }).strict(),
  z.object({ type: z.literal('sync-request') }).strict(),
])

export const ServerRoomMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('room-state'), room: RoomStateSchema, snapshot: GameSnapshotSchema.optional() }).strict(),
  z.object({ type: z.literal('command-result'), commandId: IdSchema, result: CommandResultSchema }).strict(),
  z.object({ type: z.literal('authority-update'), update: AuthorityUpdateSchema }).strict(),
  z.object({ type: z.literal('room-error'), code: IdSchema, message: z.string().min(1).max(256) }).strict(),
])

export type GameCommand = z.infer<typeof GameCommandSchema>
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>
export type PlayerSnapshot = z.infer<typeof PlayerSnapshotSchema>
export type SerializableGameState = z.infer<typeof SerializableGameStateSchema>
export type GameSnapshot = z.infer<typeof GameSnapshotSchema>
export type DomainEvent = z.infer<typeof DomainEventSchema>
export type PresentationCue = z.infer<typeof PresentationCueSchema>
export type AuthorityErrorCode = z.infer<typeof AuthorityErrorCodeSchema>
export type AuthorityError = z.infer<typeof AuthorityErrorSchema>
export type AuthorityUpdate = z.infer<typeof AuthorityUpdateSchema>
export type CommandResult = z.infer<typeof CommandResultSchema>
export type RoomPlayer = z.infer<typeof RoomPlayerSchema>
export type RoomState = z.infer<typeof RoomStateSchema>
export type RoomJoinResponse = z.infer<typeof RoomJoinResponseSchema>
export type ClientRoomMessage = z.infer<typeof ClientRoomMessageSchema>
export type ServerRoomMessage = z.infer<typeof ServerRoomMessageSchema>
