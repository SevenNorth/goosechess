import { describe, expect, it } from 'vitest'
import {
  calculatePathToNextLandmark,
  createInitialGameState,
  reduceGameCommand,
  type EventDefinition,
  type MapDefinition,
} from '../src/index.js'
import { makeDefinition, makeMap, makeParticipants } from './fixtures.js'

function landmarkMap() {
  const base = makeMap(12, [11])
  return {
    ...base,
    spaces: base.spaces.map((space) => ({
      ...space,
      ...(space.index === 3
        ? { landmarkId: 'snack-stand' }
        : space.index === 7 || space.index === 8
          ? { landmarkId: 'madhouse' }
          : space.index === 10
            ? { landmarkId: 'lighthouse' }
            : {}),
    })),
    landmarks: [
      { id: 'snack-stand', name: 'Snack Stand', spaceIds: [3] },
      { id: 'madhouse', name: 'Madhouse', spaceIds: [7, 8] },
      { id: 'lighthouse', name: 'Lighthouse', spaceIds: [10] },
    ],
  } satisfies MapDefinition
}

describe('move to next landmark effect', () => {
  it('finds the next distinct map landmark and stays put after the last one', () => {
    const map = landmarkMap()
    expect(calculatePathToNextLandmark(map, 1)).toMatchObject({ path: [2, 3], toSpaceId: 3 })
    expect(calculatePathToNextLandmark(map, 3)).toMatchObject({ path: [4, 5, 6, 7], toSpaceId: 7 })
    expect(calculatePathToNextLandmark(map, 7)).toMatchObject({ path: [8, 9, 10], toSpaceId: 10 })
    expect(calculatePathToNextLandmark(map, 10)).toMatchObject({ path: [], toSpaceId: 10 })
  })

  it('settles the effect through the normal movement and collision pipeline', () => {
    const baseDefinition = makeDefinition(landmarkMap())
    const event = {
      id: 'next-landmark',
      title: 'Next landmark',
      flavor: 'Move forward.',
      kind: '常规事件',
      effect: [{ type: 'move-to-next-landmark' }],
      aiValue: 5,
    } as const satisfies EventDefinition
    const definition = {
      ...baseDefinition,
      events: [...baseDefinition.events, event],
      ruleset: {
        ...baseDefinition.ruleset,
        eventPoolIds: [...baseDefinition.ruleset.eventPoolIds, event.id],
      },
    }
    const initial = createInitialGameState({
      definition,
      participants: makeParticipants(2, [1, 3]),
      seed: 9,
    })
    const state = {
      ...initial,
      phase: 'awaiting-event-choice' as const,
      pendingEventIds: [event.id],
      eventContinuation: 'end-turn' as const,
    }
    const result = reduceGameCommand(state, definition, 'p0', { type: 'choose-event', eventId: event.id })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.players.map((player) => player.spaceId)).toEqual([3, 1])
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'token-moved',
      playerId: 'p0',
      path: [2, 3],
      toSpaceId: 3,
    }))
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'collision-resolved',
      movingPlayerId: 'p0',
      displacedPlayerId: 'p1',
    }))
  })
})
