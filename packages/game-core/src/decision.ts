import type {
  CoreGameCommand,
  EventDefinition,
  GameDefinition,
  GamePhase,
  GameState,
  ItemDefinition,
  MapDefinition,
  ParticipantState,
} from './types.js'

export interface PublicDecisionPlayer {
  readonly playerId: string
  readonly seatIndex: number
  readonly controller: ParticipantState['controller']
  readonly spaceId: number
  readonly itemId: string | null
  readonly skipTurns: number
  readonly rank: number
  readonly nextMoveBonus: number
  readonly nextMaxDie: number | null
  readonly nextFixedMoveTotal: number | null
}

export interface PublicDecisionMap {
  readonly id: string
  readonly spaces: MapDefinition['spaces']
  readonly winningSpaceIds: readonly number[]
}

export interface PublicDieRule {
  readonly maxFace: number
  readonly remainingRounds: number | null
}

export interface GameDecisionView {
  readonly gameId: string
  readonly revision: number
  readonly viewerPlayerId: string
  readonly phase: GamePhase
  readonly round: number
  readonly activePlayerId: string
  readonly turnOrderPlayerIds: readonly string[]
  readonly players: readonly PublicDecisionPlayer[]
  readonly map: PublicDecisionMap
  readonly dieRule: PublicDieRule
  readonly offeredEvents: readonly EventDefinition[]
  readonly startingItemOffers: readonly ItemDefinition[]
  readonly relevantItems: readonly ItemDefinition[]
  readonly pendingItemId: string | null
  readonly legalCommands: readonly CoreGameCommand[]
}

export interface CreateDecisionViewOptions {
  readonly gameId: string
  readonly revision: number
  readonly playerId: string
}

function canUseItem(state: GameState, definition: GameDefinition, playerId: string, itemId: string) {
  const player = state.players.find((candidate) => candidate.playerId === playerId)
  const item = definition.items.find((candidate) => candidate.id === itemId)
  if (!player || player.itemId !== itemId || item?.mode !== '主动') return false
  if (item.effect !== 'teleport-beach') return true
  const beach = definition.map.landmarks.find((landmark) => landmark.id === 'scavenger-beach')?.spaceIds[0]
  return beach !== undefined && player.spaceId < beach
}

export function getLegalCommands(
  state: GameState,
  definition: GameDefinition,
  playerId: string,
): readonly CoreGameCommand[] {
  const player = state.players.find((candidate) => candidate.playerId === playerId)
  if (!player || state.phase === 'game-over') return []

  if (state.phase === 'determining-order') {
    const hasRolled = state.orderRollResults.some((result) => result.playerId === playerId)
      || state.orderRollHistory.some((round) => round.results.some((result) => result.playerId === playerId))
    const commands: CoreGameCommand[] = hasRolled
      ? []
      : definition.ruleset.skinIds.map((skinId) => ({ type: 'select-skin', skinId }))
    if (state.activePlayerId === playerId) commands.unshift({ type: 'request-order-roll' })
    return commands
  }

  if (state.phase === 'choosing-starting-item') {
    return state.activePlayerId === playerId
      ? state.startingItemOfferIds.map((itemId) => ({ type: 'choose-starting-item' as const, itemId }))
      : []
  }

  if (state.activePlayerId !== playerId) return []
  if (state.phase === 'awaiting-action') {
    const commands: CoreGameCommand[] = [{ type: 'request-roll' }]
    if (player.itemId && canUseItem(state, definition, playerId, player.itemId)) {
      commands.push({ type: 'use-item', itemId: player.itemId })
    }
    return commands
  }
  if (state.phase === 'awaiting-event-choice') {
    return state.pendingEventIds.map((eventId) => ({ type: 'choose-event' as const, eventId }))
  }
  if (state.phase === 'awaiting-item-choice' && state.pendingItemId) {
    return [
      { type: 'choose-item', itemId: state.pendingItemId },
      { type: 'choose-item', itemId: null },
    ]
  }
  return []
}

function rankPlayers(players: readonly ParticipantState[]) {
  const ordered = [...players].sort((left, right) => right.spaceId - left.spaceId || left.seatIndex - right.seatIndex)
  return new Map(ordered.map((player, index) => [player.playerId, index + 1]))
}

export function createGameDecisionView(
  state: GameState,
  definition: GameDefinition,
  options: CreateDecisionViewOptions,
): GameDecisionView {
  if (!state.players.some((player) => player.playerId === options.playerId)) {
    throw new Error(`Unknown decision viewer: ${options.playerId}.`)
  }
  const ranks = rankPlayers(state.players)
  const legalCommands = getLegalCommands(state, definition, options.playerId)
  const relevantItemIds = new Set<string>()
  state.players.forEach((player) => {
    if (player.itemId) relevantItemIds.add(player.itemId)
  })
  if (state.pendingItemId) relevantItemIds.add(state.pendingItemId)
  state.startingItemOfferIds.forEach((itemId) => relevantItemIds.add(itemId))
  legalCommands.forEach((command) => {
    if ('itemId' in command && command.itemId) relevantItemIds.add(command.itemId)
  })

  return {
    gameId: options.gameId,
    revision: options.revision,
    viewerPlayerId: options.playerId,
    phase: state.phase,
    round: state.round,
    activePlayerId: state.activePlayerId,
    turnOrderPlayerIds: state.turnOrderGroups.flat(),
    players: state.players.map((player) => ({
      playerId: player.playerId,
      seatIndex: player.seatIndex,
      controller: player.controller,
      spaceId: player.spaceId,
      itemId: player.itemId,
      skipTurns: player.skipTurns,
      rank: ranks.get(player.playerId) ?? state.players.length,
      nextMoveBonus: player.nextMoveBonus,
      nextMaxDie: player.nextMaxDie,
      nextFixedMoveTotal: player.nextFixedMoveTotal,
    })),
    map: {
      id: definition.map.id,
      spaces: definition.map.spaces.map((space) => ({ ...space })),
      winningSpaceIds: [...definition.map.winningSpaceIds],
    },
    dieRule: {
      maxFace: state.globalDieRule?.maxFace ?? 6,
      remainingRounds: state.globalDieRule?.remainingRounds ?? null,
    },
    offeredEvents: state.pendingEventIds.map((eventId) => {
      const event = definition.events.find((candidate) => candidate.id === eventId)
      if (!event) throw new Error(`Unknown offered event: ${eventId}.`)
      return { ...event }
    }),
    startingItemOffers: definition.items.filter((item) => state.startingItemOfferIds.includes(item.id)).map((item) => ({ ...item })),
    relevantItems: definition.items.filter((item) => relevantItemIds.has(item.id)).map((item) => ({ ...item })),
    pendingItemId: state.pendingItemId,
    legalCommands,
  }
}
