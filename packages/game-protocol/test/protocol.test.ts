import { describe, expect, it } from 'vitest'
import {
  CommandEnvelopeSchema,
  GameSnapshotSchema,
  PresentationCueSchema,
  parseCommandEnvelope,
  parseGameSnapshot,
  validateCommandContext,
  type CommandEnvelope,
  type GameSnapshot,
} from '../src/index.js'

const envelope: CommandEnvelope = {
  schemaVersion: 2,
  gameId: 'game-1',
  commandId: 'command-1',
  playerId: 'player-1',
  expectedRevision: 4,
  command: { type: 'choose-event', eventId: 'fishing' },
}

const snapshot: GameSnapshot = {
  schemaVersion: 2,
  gameId: 'game-1',
  revision: 4,
  rulesetId: 'classic-race',
  rulesetVersion: 1,
  mapId: 'aup-port-65',
  contentVersion: '2026.07.28.1',
  rngSeed: 42,
  rngCursor: 8,
  state: {
    phase: 'awaiting-event-choice',
    round: 2,
    activePlayerId: 'player-1',
    players: [
      { playerId: 'player-1', seatIndex: 0, displayName: '玩家', controller: 'local', colorId: 'pink', skinId: 'goose-white', spaceId: 6, itemId: null, skipTurns: 0, nextMoveBonus: 0, nextMaxDie: null, nextFixedMoveTotal: null },
      { playerId: 'ai-1', seatIndex: 1, displayName: '电脑', controller: 'ai', colorId: 'blue', skinId: 'goose-blue', spaceId: 4, itemId: 'clover', skipTurns: 0, nextMoveBonus: 0, nextMaxDie: null, nextFixedMoveTotal: null },
    ],
    turnOrderGroups: [['player-1'], ['ai-1']],
    orderRollResults: [],
    orderRollHistory: [],
    pendingEventIds: ['fishing', 'crab', 'quiet'],
    pendingItemId: null,
    eventContinuation: 'end-turn',
    recentEventIds: ['tailwind'],
    winnerPlayerId: null,
    extraTurnQueued: false,
    globalDieRule: null,
    lastDice: null,
  },
}

const content = {
  eventIds: new Set(['fishing', 'crab', 'quiet']),
  itemIds: new Set(['clover']),
  skinIds: new Set(['goose-white', 'goose-blue']),
}

describe('game protocol', () => {
  it('round-trips command envelopes and snapshots through JSON', () => {
    const envelopeRoundTrip = JSON.parse(JSON.stringify(CommandEnvelopeSchema.parse(envelope)))
    const snapshotRoundTrip = JSON.parse(JSON.stringify(GameSnapshotSchema.parse(snapshot)))

    expect(parseCommandEnvelope(envelopeRoundTrip)).toEqual({ ok: true, value: envelope })
    expect(parseGameSnapshot(snapshotRoundTrip)).toEqual({ ok: true, value: snapshot })
  })

  it.each([
    ['function', () => undefined],
    ['Map', new Map([['playerId', 'player-1']])],
    ['Set', new Set(['player-1'])],
    ['class instance', new (class RuntimeHandle {})()],
  ])('rejects %s values before snapshot parsing', (_, runtimeValue) => {
    expect(parseGameSnapshot({ ...snapshot, runtimeValue })).toMatchObject({
      ok: false,
      error: { code: 'invalid_envelope' },
    })
  })

  it('rejects JSON values that cannot round-trip equivalently', () => {
    const sparsePlayers = Array(2)
    const symbolState = { ...snapshot.state, [Symbol('runtime')]: 'handle' }

    expect(parseGameSnapshot({ ...snapshot, state: { ...snapshot.state, players: sparsePlayers } })).toMatchObject({ ok: false })
    expect(parseGameSnapshot({ ...snapshot, state: symbolState })).toMatchObject({ ok: false })
  })

  it('returns structured errors for unknown commands and content', () => {
    expect(parseCommandEnvelope({ ...envelope, command: { type: 'teleport-anywhere' } })).toMatchObject({
      ok: false,
      error: { code: 'unknown_command' },
    })
    expect(validateCommandContext(envelope, {
      currentRevision: 4,
      seenCommandIds: new Set(),
      content: { ...content, eventIds: new Set() },
    })).toMatchObject({ code: 'unknown_content', details: { contentId: 'fishing' } })
  })

  it('returns structured duplicate and stale revision errors', () => {
    expect(validateCommandContext(envelope, {
      currentRevision: 4,
      seenCommandIds: new Set(['command-1']),
      content,
    })).toMatchObject({ code: 'duplicate_command' })
    expect(validateCommandContext(envelope, {
      currentRevision: 5,
      seenCommandIds: new Set(),
      content,
    })).toMatchObject({ code: 'stale_revision', retryable: true })
  })

  it('serializes collision and swap relocation cues', () => {
    expect(PresentationCueSchema.parse({
      type: 'token-relocate', cueId: 'r4-c2', sequence: 402, playerId: 'player-1',
      fromSpaceId: 18, toSpaceId: 6, reason: 'collision', blocked: false,
    })).toMatchObject({ type: 'token-relocate', reason: 'collision', toSpaceId: 6 })
  })
})
