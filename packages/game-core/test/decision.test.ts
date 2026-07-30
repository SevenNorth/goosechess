import { describe, expect, it } from 'vitest'
import { createGameDecisionView, createInitialGameState, getLegalCommands, reduceGameCommand } from '../src/index.js'
import { makeDefinition, makeParticipants } from './fixtures.js'

describe('public game decision view', () => {
  it('offers turn-order commands before starting items without exposing hidden RNG state', () => {
    const definition = makeDefinition()
    const participants = makeParticipants(2).map((participant) => ({ ...participant, startingItemId: undefined }))
    const state = createInitialGameState({ definition, participants, seed: 42 })
    const view = createGameDecisionView(state, definition, { gameId: 'g1', revision: 0, playerId: 'p0' })

    expect(view.phase).toBe('determining-order')
    expect(view.legalCommands.some((command) => command.type === 'request-order-roll')).toBe(true)
    expect(view.legalCommands.some((command) => command.type === 'choose-starting-item')).toBe(false)
    expect(view.startingItemOffers).toEqual([])
    expect(view.offeredEvents).toEqual([])
    expect(JSON.stringify(view)).not.toContain('"rng"')
    expect(JSON.stringify(view)).not.toContain('"seed"')
    expect(JSON.stringify(view)).not.toContain('recentEventIds')
  })

  it('only exposes event choices to the active player', () => {
    const definition = makeDefinition()
    let state = createInitialGameState({
      definition,
      participants: makeParticipants(2).map((participant) => ({ ...participant, startingItemId: 'boots' })),
      seed: 3,
    })
    state = { ...state, phase: 'awaiting-event-choice', pendingEventIds: ['move-one', 'extra', 'gain'] }

    expect(getLegalCommands(state, definition, 'p0').map((command) => command.type)).toEqual([
      'choose-event', 'choose-event', 'choose-event',
    ])
    expect(getLegalCommands(state, definition, 'p1')).toEqual([])
  })

  it('does not offer an active item after it becomes unusable', () => {
    const definition = makeDefinition()
    const initial = createInitialGameState({
      definition,
      participants: makeParticipants(2).map((participant) => ({ ...participant, startingItemId: 'boots' })),
      seed: 4,
    })
    const used = reduceGameCommand(initial, definition, 'p0', { type: 'use-item', itemId: 'boots' })
    expect(used.ok).toBe(true)
    if (!used.ok) return

    expect(getLegalCommands(used.state, definition, 'p0')).toEqual([{ type: 'request-roll' }])
  })

  it('enumerates one legal command per valid target for opponent items', () => {
    const definition = makeDefinition()
    const initial = createInitialGameState({ definition, participants: makeParticipants(3), seed: 8 })
    const state = {
      ...initial,
      players: initial.players.map((player) => player.playerId === 'p0' ? { ...player, itemId: 'tea' } : player),
    }

    expect(getLegalCommands(state, definition, 'p0').filter((command) => command.type === 'use-item')).toEqual([
      { type: 'use-item', itemId: 'tea', targetPlayerId: 'p1' },
      { type: 'use-item', itemId: 'tea', targetPlayerId: 'p2' },
    ])
  })
})
