import { describe, expect, it } from 'vitest'
import {
  DeterministicRandom,
  calculateMovementPath,
  createInitialGameState,
  createMapRegistry,
  drawEventChoices,
  reduceGameCommand,
  settleMovement,
} from '../src/index.js'
import { makeDefinition, makeMap, makeParticipants } from './fixtures.js'

describe('deterministic rule kernel', () => {
  it('restores the random stream from seed and cursor', () => {
    const first = new DeterministicRandom({ seed: 42, cursor: 0 })
    first.nextInt(1, 6)
    first.nextInt(1, 6)
    const restored = new DeterministicRandom(first.snapshot())

    expect([first.nextInt(1, 6), first.nextInt(1, 6)]).toEqual([
      restored.nextInt(1, 6),
      restored.nextInt(1, 6),
    ])
  })

  it('downweights recently resolved events while drawing unique choices', () => {
    const definition = makeDefinition()
    let normalSelections = 0
    let recentSelections = 0
    for (let seed = 0; seed < 300; seed += 1) {
      const normal = drawEventChoices(definition, [], new DeterministicRandom({ seed, cursor: 0 }))
      const recent = drawEventChoices(definition, ['move-one'], new DeterministicRandom({ seed, cursor: 0 }))
      normalSelections += Number(normal.some((event) => event.id === 'move-one'))
      recentSelections += Number(recent.some((event) => event.id === 'move-one'))
      expect(new Set(recent.map((event) => event.id)).size).toBe(3)
    }
    expect(recentSelections).toBeLessThan(normalSelections)
  })

  it('uses map order for bounce paths and wins on final spaces 63, 64, or 65', () => {
    const map = makeMap(66, [63, 64, 65])
    const definition = makeDefinition(map)
    const source = createInitialGameState({ definition, participants: makeParticipants(2, [62, 0]), seed: 1 })

    expect(calculateMovementPath(map, 62, 5)).toMatchObject({ path: [63, 64, 65, 64, 63], toSpaceId: 63, bounced: true })
    for (const distance of [1, 2, 3, 5]) {
      const result = settleMovement(source, definition, 'p0', distance)
      expect(result.state.winnerPlayerId).toBe('p0')
      expect([63, 64, 65]).toContain(result.state.players[0].spaceId)
    }

    const fixedFive = {
      ...source,
      players: source.players.map((player) => player.playerId === 'p0' ? { ...player, nextFixedMoveTotal: 5 } : player),
    }
    const rolled = reduceGameCommand(fixedFive, definition, 'p0', { type: 'request-roll' })
    expect(rolled.ok).toBe(true)
    if (rolled.ok) {
      expect(rolled.events.find((event) => event.type === 'token-moved')).toMatchObject({ path: [63, 64, 65, 64, 63], toSpaceId: 63 })
      expect(rolled.state.winnerPlayerId).toBe('p0')
    }
  })

  it('applies event movement through the same immediate victory pipeline', () => {
    const definition = makeDefinition(makeMap(66, [63, 64, 65]))
    const initial = createInitialGameState({ definition, participants: makeParticipants(2, [62, 0]), seed: 2 })
    const state = { ...initial, phase: 'awaiting-event-choice' as const, pendingEventIds: ['move-one'], eventContinuation: 'end-turn' as const }
    const result = reduceGameCommand(state, definition, 'p0', { type: 'choose-event', eventId: 'move-one' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.winnerPlayerId).toBe('p0')
      expect(result.events.some((event) => event.type === 'game-won')).toBe(true)
    }
  })

  it('moves the previous occupant back to the movement origin after a collision', () => {
    const definition = makeDefinition(makeMap(20, [19]))
    const initial = createInitialGameState({ definition, participants: makeParticipants(2, [4, 6]), seed: 3 })
    const result = settleMovement(initial, definition, 'p0', 2)

    expect(result.state.players.map((player) => player.spaceId)).toEqual([6, 4])
    expect(result.cues.filter((cue) => cue.type === 'token-relocate')).toEqual([
      { type: 'token-relocate', playerId: 'p1', fromSpaceId: 6, toSpaceId: 4, reason: 'collision', blocked: false },
    ])
  })

  it('bounces the moving token when a collision shield keeps the occupant in place', () => {
    const definition = makeDefinition(makeMap(20, [19]))
    const initial = createInitialGameState({ definition, participants: makeParticipants(2, [4, 6]), seed: 3 })
    const state = {
      ...initial,
      players: initial.players.map((player) => player.playerId === 'p1' ? { ...player, itemId: 'cat' } : player),
    }
    const result = settleMovement(state, definition, 'p0', 2)
    const collisions = result.events.filter((event) => event.type === 'collision-resolved')

    expect(collisions).toMatchObject([{ movingPlayerId: 'p0', displacedPlayerId: 'p1', blocked: true }])
    expect(result.cues.filter((cue) => cue.type === 'token-relocate')).toEqual([
      { type: 'token-relocate', playerId: 'p1', fromSpaceId: 6, toSpaceId: 6, reason: 'collision', blocked: true },
      { type: 'token-relocate', playerId: 'p0', fromSpaceId: 6, toSpaceId: 4, reason: 'collision', blocked: false },
    ])
    expect(result.state.players.map((player) => player.spaceId)).toEqual([4, 6])
    expect(result.state.players[1].itemId).toBeNull()
  })

  it.each([2, 3, 4])('advances a full %i-player round without hardcoded identities', (playerCount) => {
    const definition = makeDefinition(makeMap(100, [99]))
    let state = createInitialGameState({ definition, participants: makeParticipants(playerCount), seed: 11 })
    for (let turn = 0; turn < playerCount; turn += 1) {
      const result = reduceGameCommand(state, definition, state.activePlayerId, { type: 'request-roll' })
      expect(result.ok).toBe(true)
      if (result.ok) state = result.state
    }
    expect(state.round).toBe(2)
    expect(state.activePlayerId).toBe('p0')
  })

  it('skips paused seats and keeps extra actions in the same round', () => {
    const definition = makeDefinition(makeMap(100, [99]))
    const initial = createInitialGameState({ definition, participants: makeParticipants(3), seed: 12 })
    const paused = {
      ...initial,
      players: initial.players.map((player) => player.playerId === 'p1' ? { ...player, skipTurns: 1 } : player),
    }
    const moved = reduceGameCommand(paused, definition, 'p0', { type: 'request-roll' })
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(moved.state.activePlayerId).toBe('p2')
    expect(moved.events.some((event) => event.type === 'turn-skipped' && event.playerId === 'p1')).toBe(true)

    const eventState = { ...initial, phase: 'awaiting-event-choice' as const, pendingEventIds: ['extra'], eventContinuation: 'end-turn' as const }
    const extra = reduceGameCommand(eventState, definition, 'p0', { type: 'choose-event', eventId: 'extra' })
    expect(extra.ok).toBe(true)
    if (extra.ok) expect(extra.state).toMatchObject({ activePlayerId: 'p0', round: 1, phase: 'awaiting-action' })
  })

  it('offers item replacement and remembers the two most recent events', () => {
    const definition = makeDefinition(makeMap(100, [99]))
    const initial = createInitialGameState({ definition, participants: makeParticipants(2), seed: 18 })
    const eventState = {
      ...initial,
      phase: 'awaiting-event-choice' as const,
      pendingEventIds: ['gain'],
      eventContinuation: 'end-turn' as const,
      recentEventIds: ['extra', 'skip'],
    }
    const gained = reduceGameCommand(eventState, definition, 'p0', { type: 'choose-event', eventId: 'gain' })
    expect(gained.ok).toBe(true)
    if (!gained.ok) return
    expect(gained.state.phase).toBe('awaiting-item-choice')
    expect(gained.state.pendingItemId).not.toBeNull()
    expect(gained.state.recentEventIds).toEqual(['skip', 'gain'])

    const kept = reduceGameCommand(gained.state, definition, 'p0', { type: 'choose-item', itemId: null })
    expect(kept.ok).toBe(true)
    if (kept.ok) {
      expect(kept.state.players[0].itemId).toBe('clover')
      expect(kept.state.activePlayerId).toBe('p1')
    }

    const chosen = reduceGameCommand(gained.state, definition, 'p0', { type: 'choose-item', itemId: gained.state.pendingItemId })
    expect(chosen.ok).toBe(true)
    if (chosen.ok) {
      expect(chosen.state.players[0].itemId).toBe(gained.state.pendingItemId)
      expect(chosen.state.activePlayerId).toBe('p1')
    }
  })

  it('records public check dice and applies temporary die limits', () => {
    const definition = makeDefinition(makeMap(100, [99]))
    const initial = createInitialGameState({ definition, participants: makeParticipants(2, [10, 0]), seed: 27 })
    const checkState = { ...initial, phase: 'awaiting-event-choice' as const, pendingEventIds: ['check'], eventContinuation: 'end-turn' as const }
    const checked = reduceGameCommand(checkState, definition, 'p0', { type: 'choose-event', eventId: 'check' })
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(checked.state.lastDice?.purpose).toBe('check')
    expect(checked.state.players[0].itemId).toBeNull()
    expect(checked.events.some((event) => event.type === 'dice-rolled' && event.purpose === 'check')).toBe(true)

    const slowState = { ...initial, phase: 'awaiting-event-choice' as const, pendingEventIds: ['slow'], eventContinuation: 'end-turn' as const }
    const slowed = reduceGameCommand(slowState, definition, 'p0', { type: 'choose-event', eventId: 'slow' })
    expect(slowed.ok).toBe(true)
    if (!slowed.ok) return
    expect(slowed.state.globalDieRule).toEqual({ maxFace: 3, remainingRounds: 2 })
    const rolled = reduceGameCommand(slowed.state, definition, 'p1', { type: 'request-roll' })
    expect(rolled.ok).toBe(true)
    if (rolled.ok) expect(Math.max(...(rolled.state.lastDice?.faces ?? []))).toBeLessThanOrEqual(3)
  })

  it('consumes active items before applying deterministic move modifiers', () => {
    const definition = makeDefinition(makeMap(100, [99]))
    const initial = createInitialGameState({ definition, participants: makeParticipants(2), seed: 44 })
    const equipped = {
      ...initial,
      players: initial.players.map((player) => player.playerId === 'p0' ? { ...player, itemId: 'boots' } : player),
    }
    const used = reduceGameCommand(equipped, definition, 'p0', { type: 'use-item', itemId: 'boots' })
    expect(used.ok).toBe(true)
    if (!used.ok) return
    expect(used.state.players[0]).toMatchObject({ itemId: null, nextMoveBonus: 3 })
    const rolled = reduceGameCommand(used.state, definition, 'p0', { type: 'request-roll' })
    expect(rolled.ok).toBe(true)
    if (rolled.ok) {
      const rawTotal = rolled.state.lastDice?.total ?? 0
      expect(rolled.state.players[0].spaceId).toBe(rawTotal + 3)
    }
  })

  it('applies swap effects without depending on player control type', () => {
    const definition = makeDefinition(makeMap(100, [99]))
    const initial = createInitialGameState({ definition, participants: makeParticipants(2, [7, 18]), seed: 31 })
    const state = { ...initial, phase: 'awaiting-event-choice' as const, pendingEventIds: ['swap'], eventContinuation: 'end-turn' as const }
    const result = reduceGameCommand(state, definition, 'p0', { type: 'choose-event', eventId: 'swap' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.players.map((player) => player.spaceId)).toEqual([18, 7])
      expect(result.cues.filter((cue) => cue.type === 'token-relocate')).toEqual([
        { type: 'token-relocate', playerId: 'p0', fromSpaceId: 7, toSpaceId: 18, reason: 'swap' },
        { type: 'token-relocate', playerId: 'p1', fromSpaceId: 18, toSpaceId: 7, reason: 'swap' },
      ])
    }
  })

  it('does not let skin choice alter dice, events, or movement', () => {
    const definition = makeDefinition(makeMap(100, [99]))
    const white = createInitialGameState({ definition, participants: makeParticipants(2, [], 'white'), seed: 99 })
    const yellow = createInitialGameState({ definition, participants: makeParticipants(2, [], 'yellow'), seed: 99 })
    const whiteResult = reduceGameCommand(white, definition, 'p0', { type: 'request-roll' })
    const yellowResult = reduceGameCommand(yellow, definition, 'p0', { type: 'request-roll' })

    expect(whiteResult.ok && yellowResult.ok).toBe(true)
    if (whiteResult.ok && yellowResult.ok) {
      expect(whiteResult.state.lastDice).toEqual(yellowResult.state.lastDice)
      expect(whiteResult.state.rng).toEqual(yellowResult.state.rng)
      expect(whiteResult.state.players.map((player) => player.spaceId)).toEqual(yellowResult.state.players.map((player) => player.spaceId))
      expect(whiteResult.events).toEqual(yellowResult.events)
    }
  })

  it('rejects commands after a winner is committed', () => {
    const definition = makeDefinition(makeMap(8, [6, 7]))
    const initial = createInitialGameState({ definition, participants: makeParticipants(2, [5, 0]), seed: 2 })
    const won = settleMovement(initial, definition, 'p0', 1).state
    expect(reduceGameCommand(won, definition, 'p0', { type: 'request-roll' })).toMatchObject({ ok: false, code: 'illegal_command' })
  })

  it('supports multiple map definitions in a registry', () => {
    const registry = createMapRegistry([makeMap(8, [6, 7]), makeMap(12, [11])])
    expect(registry.get('map-8').spaces).toHaveLength(8)
    expect(registry.get('map-12').spaces).toHaveLength(12)
  })
})
