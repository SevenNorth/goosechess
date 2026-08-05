import { describe, expect, it } from 'vitest'
import { DeterministicRandom, type GameDecisionView } from '@goose-chess/game-core'
import { createGooseAiStrategy } from '../src/index.js'

describe('next landmark effect utility', () => {
  it('scores the actual distance to the next landmark', () => {
    const view: GameDecisionView = {
      gameId: 'game-1',
      revision: 1,
      viewerPlayerId: 'ai',
      phase: 'awaiting-event-choice',
      round: 1,
      activePlayerId: 'ai',
      turnOrderPlayerIds: ['human', 'ai'],
      players: [
        { playerId: 'human', seatIndex: 0, controller: 'local', spaceId: 20, itemId: null, skipTurns: 0, rank: 1, nextMoveBonus: 0, nextMaxDie: null, nextFixedMoveTotal: null },
        { playerId: 'ai', seatIndex: 1, controller: 'ai', spaceId: 10, itemId: null, skipTurns: 0, rank: 2, nextMoveBonus: 0, nextMaxDie: null, nextFixedMoveTotal: null },
      ],
      map: {
        id: 'map',
        spaces: Array.from({ length: 30 }, (_, index) => ({
          index,
          x: index,
          y: 0,
          rotation: 0,
          kind: index === 0 ? 'start' : index >= 28 ? 'finish' : 'normal',
          ...(index === 15 ? { landmarkId: 'snack-stand' } : {}),
        })),
        winningSpaceIds: [28, 29],
      },
      dieRule: { maxFace: 6, remainingRounds: null },
      offeredEvents: [
        { id: 'one-space', title: 'One', flavor: '', kind: '常规事件', effect: [{ type: 'move', spaces: 1 }], aiValue: 1 },
        { id: 'next-place', title: 'Next', flavor: '', kind: '常规事件', effect: [{ type: 'move-to-next-landmark' }], aiValue: 1 },
      ],
      startingItemOffers: [],
      relevantItems: [],
      pendingItemId: null,
      legalCommands: [
        { type: 'choose-event', eventId: 'one-space' },
        { type: 'choose-event', eventId: 'next-place' },
      ],
    }

    expect(createGooseAiStrategy().decide(view, new DeterministicRandom({ seed: 3, cursor: 0 }))).toMatchObject({
      command: { type: 'choose-event', eventId: 'next-place' },
    })
  })
})
