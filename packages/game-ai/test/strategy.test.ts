import { describe, expect, it, vi } from 'vitest'
import { DeterministicRandom, type GameDecisionView, type ItemDefinition } from '@goose-chess/game-core'
import { AiTurnController, createGooseAiStrategy } from '../src/index.js'

const ITEMS: ItemDefinition[] = [
  { id: 'boots', title: 'Boots', mode: '主动', effect: 'move-plus-three' },
  { id: 'clover', title: 'Clover', mode: '被动', effect: 'check-pass' },
  { id: 'cat', title: 'Cat', mode: '被动', effect: 'collision-shield' },
]

function view(overrides: Partial<GameDecisionView> = {}): GameDecisionView {
  return {
    gameId: 'game-1', revision: 3, viewerPlayerId: 'ai-1', phase: 'awaiting-action', round: 4,
    activePlayerId: 'ai-1',
    turnOrderPlayerIds: ['local', 'ai-1'],
    players: [
      { playerId: 'local', seatIndex: 0, controller: 'local', spaceId: 22, itemId: null, skipTurns: 0, rank: 1, nextMoveBonus: 0, nextMaxDie: null, nextFixedMoveTotal: null },
      { playerId: 'ai-1', seatIndex: 1, controller: 'ai', spaceId: 10, itemId: null, skipTurns: 0, rank: 2, nextMoveBonus: 0, nextMaxDie: null, nextFixedMoveTotal: null },
    ],
    map: {
      id: 'map',
      spaces: Array.from({ length: 30 }, (_, index) => ({ index, x: index, y: 0, rotation: 0, kind: index === 0 ? 'start' : index >= 28 ? 'finish' : 'normal' })),
      winningSpaceIds: [28, 29],
    },
    dieRule: { maxFace: 6, remainingRounds: null },
    offeredEvents: [], relevantItems: ITEMS, pendingItemId: null,
    legalCommands: [{ type: 'request-roll' }],
    ...overrides,
  }
}

describe('explainable Goose AI', () => {
  it('selects the event with the better probability-weighted effect', () => {
    const decisionView = view({
      phase: 'awaiting-event-choice',
      offeredEvents: [
        { id: 'risk', title: 'Risk', flavor: '', kind: '骰子检定', threshold: 12, success: [{ type: 'move', spaces: 8 }], failure: [{ type: 'move', spaces: -5 }], aiValue: 5 },
        { id: 'safe', title: 'Safe', flavor: '', kind: '骰子检定', threshold: 5, success: [{ type: 'move', spaces: 4 }], failure: [], aiValue: 5 },
      ],
      legalCommands: [{ type: 'choose-event', eventId: 'risk' }, { type: 'choose-event', eventId: 'safe' }],
    })
    const decision = createGooseAiStrategy().decide(decisionView, new DeterministicRandom({ seed: 1, cursor: 0 }))

    expect(decision?.command).toEqual({ type: 'choose-event', eventId: 'safe' })
    expect(decision?.reasonTag).toBe('event-probability-advantage')
  })

  it('uses a movement item when its expected result beats rolling immediately', () => {
    const decisionView = view({
      players: view().players.map((player) => player.playerId === 'ai-1' ? { ...player, itemId: 'boots' } : player),
      legalCommands: [{ type: 'request-roll' }, { type: 'use-item', itemId: 'boots' }],
    })

    expect(createGooseAiStrategy().decide(decisionView, new DeterministicRandom({ seed: 2, cursor: 0 }))).toMatchObject({
      command: { type: 'use-item', itemId: 'boots' },
      reasonTag: 'item-improves-movement',
    })
  })

  it('keeps a more valuable held item instead of accepting a weaker replacement', () => {
    const decisionView = view({
      phase: 'awaiting-item-choice',
      players: view().players.map((player) => player.playerId === 'ai-1' ? { ...player, itemId: 'clover' } : player),
      pendingItemId: 'boots',
      legalCommands: [{ type: 'choose-item', itemId: 'boots' }, { type: 'choose-item', itemId: null }],
    })

    expect(createGooseAiStrategy().decide(decisionView, new DeterministicRandom({ seed: 3, cursor: 0 }))).toMatchObject({
      command: { type: 'choose-item', itemId: null },
      reasonTag: 'keep-higher-value-item',
    })
  })

  it('submits its selected command through the shared controller port', async () => {
    const submitter = { submit: vi.fn().mockResolvedValue({ ok: true }) }
    const controller = new AiTurnController(createGooseAiStrategy(), submitter, () => new DeterministicRandom({ seed: 4, cursor: 0 }))
    const result = await controller.takeTurn(view())

    expect(submitter.submit).toHaveBeenCalledWith('ai-1', { type: 'request-roll' })
    expect(result?.decision.reasonTag).toBe('only-legal-command')
  })

  it('repeats the same decision when the injected random source is restored', () => {
    const decisionView = view({ legalCommands: [{ type: 'request-roll' }, { type: 'select-skin', skinId: 'white' }] })
    const first = createGooseAiStrategy().decide(decisionView, new DeterministicRandom({ seed: 99, cursor: 0 }))
    const second = createGooseAiStrategy().decide(decisionView, new DeterministicRandom({ seed: 99, cursor: 0 }))
    expect(first).toEqual(second)
  })
})
