import { assertValidGameDefinition } from './content.js'
import type { GameDefinition, GameState, ParticipantSetup, ParticipantState } from './types.js'

export interface CreateGameStateOptions {
  readonly definition: GameDefinition
  readonly participants: readonly ParticipantSetup[]
  readonly seed: number
}

export function createInitialGameState(options: CreateGameStateOptions): GameState {
  assertValidGameDefinition(options.definition)
  const { participants, definition } = options
  const { min, max } = definition.ruleset.playerCount
  if (participants.length < min || participants.length > max) throw new Error(`Player count must be between ${min} and ${max}.`)
  if (new Set(participants.map((participant) => participant.playerId)).size !== participants.length) throw new Error('Player ids must be unique.')
  if (new Set(participants.map((participant) => participant.seatIndex)).size !== participants.length) throw new Error('Seat indexes must be unique.')

  const startSpaceId = definition.map.spaces[0].index
  const itemIds = new Set(definition.items.map((item) => item.id))
  const skinIds = new Set(definition.skins.map((skin) => skin.id))
  const players: ParticipantState[] = [...participants]
    .sort((left, right) => left.seatIndex - right.seatIndex)
    .map((participant, index) => {
      if (participant.seatIndex !== index) throw new Error('Seat indexes must be contiguous and start at zero.')
      if (!skinIds.has(participant.skinId)) throw new Error(`Unknown skin id: ${participant.skinId}.`)
      if (participant.startingItemId && !itemIds.has(participant.startingItemId)) throw new Error(`Unknown item id: ${participant.startingItemId}.`)
      const spaceId = participant.spaceId ?? startSpaceId
      if (!definition.map.spaces.some((space) => space.index === spaceId)) throw new Error(`Unknown initial space: ${spaceId}.`)
      return {
        playerId: participant.playerId,
        seatIndex: participant.seatIndex,
        controller: participant.controller,
        displayName: participant.displayName,
        colorId: participant.colorId,
        skinId: participant.skinId,
        spaceId,
        itemId: participant.startingItemId ?? null,
        skipTurns: 0,
        nextMoveBonus: 0,
        nextMaxDie: null,
        nextFixedMoveTotal: null,
      }
    })

  const setupPreconfigured = players.every((player) => player.itemId !== null)
  return {
    phase: setupPreconfigured ? 'awaiting-action' : 'determining-order',
    round: 1,
    activePlayerId: players[0].playerId,
    players,
    turnOrderGroups: setupPreconfigured
      ? players.map((player) => [player.playerId])
      : [players.map((player) => player.playerId)],
    orderRollResults: [],
    orderRollHistory: [],
    startingItemOfferIds: [],
    startingItemOffersByPlayer: {},
    rng: { seed: options.seed >>> 0, cursor: 0 },
    pendingEventIds: [],
    pendingItemId: null,
    eventContinuation: null,
    recentEventIds: [],
    winnerPlayerId: null,
    extraTurnQueued: false,
    globalDieRule: null,
    lastDice: null,
  }
}
