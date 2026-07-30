import { calculateMovementPath, isWinningSpace } from './map.js'
import { DeterministicRandom, rollDice, type RandomSource } from './random.js'
import type {
  CoreGameCommand,
  EventDefinition,
  GameDefinition,
  GameEffect,
  GameState,
  ParticipantState,
  RuleCommandResult,
  RuleCue,
  RuleEvent,
} from './types.js'

type MutableParticipant = { -readonly [Key in keyof ParticipantState]: ParticipantState[Key] }
type MutableStateFields = {
  -readonly [Key in keyof Omit<GameState, 'players' | 'pendingEventIds' | 'recentEventIds'>]: GameState[Key]
}
type WorkingState = MutableStateFields & {
  players: MutableParticipant[]
  turnOrderGroups: string[][]
  orderRollResults: Array<{ playerId: string; face: number }>
  orderRollHistory: Array<{ playerIds: string[]; results: Array<{ playerId: string; face: number }> }>
  startingItemOfferIds: string[]
  pendingEventIds: string[]
  recentEventIds: string[]
}

function cloneState(state: GameState): WorkingState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    turnOrderGroups: state.turnOrderGroups.map((group) => [...group]),
    orderRollResults: state.orderRollResults.map((result) => ({ ...result })),
    orderRollHistory: state.orderRollHistory.map((round) => ({
      playerIds: [...round.playerIds],
      results: round.results.map((result) => ({ ...result })),
    })),
    startingItemOfferIds: [...state.startingItemOfferIds],
    pendingEventIds: [...state.pendingEventIds],
    recentEventIds: [...state.recentEventIds],
    globalDieRule: state.globalDieRule ? { ...state.globalDieRule } : null,
    lastDice: state.lastDice ? { ...state.lastDice, faces: [...state.lastDice.faces] as [number, number] } : null,
    rng: { ...state.rng },
  }
}

function reject(code: 'illegal_command' | 'unknown_content' | 'unauthorized_player', message: string): RuleCommandResult {
  return { ok: false, code, message }
}

function playerOf(state: WorkingState, playerId: string) {
  return state.players.find((player) => player.playerId === playerId)
}

function nextPlayer(state: WorkingState, playerId: string) {
  const order = state.turnOrderGroups.flat()
  const currentIndex = order.indexOf(playerId)
  return playerOf(state, order[(currentIndex + 1) % order.length])!
}

function unresolvedOrderGroupIndex(state: WorkingState) {
  return state.turnOrderGroups.findIndex((group) => group.length > 1)
}

function drawStartingItemOffers(definition: GameDefinition, random: RandomSource): [string, string, string] {
  const blocked = new Set(definition.map.blockedItemIds ?? [])
  const pool = definition.ruleset.itemPoolIds.filter((itemId) => !blocked.has(itemId))
  if (pool.length < 3) throw new Error('At least three starting items must be available.')
  const offers: string[] = []
  while (offers.length < 3) {
    offers.push(...pool.splice(random.nextInt(0, pool.length - 1), 1))
  }
  return offers as [string, string, string]
}

function beginStartingItemChoice(
  state: WorkingState,
  definition: GameDefinition,
  random: RandomSource,
  events: RuleEvent[],
) {
  const playerId = state.turnOrderGroups.flat().find((candidate) => playerOf(state, candidate)?.itemId === null)
  if (!playerId) {
    state.phase = 'awaiting-action'
    state.activePlayerId = state.turnOrderGroups.flat()[0]
    state.startingItemOfferIds = []
    return
  }
  const itemIds = drawStartingItemOffers(definition, random)
  state.phase = 'choosing-starting-item'
  state.activePlayerId = playerId
  state.startingItemOfferIds = [...itemIds]
  events.push({ type: 'starting-items-offered', playerId, itemIds })
}

function submitOrderRoll(
  state: WorkingState,
  definition: GameDefinition,
  random: RandomSource,
  playerId: string,
  face: number,
  events: RuleEvent[],
) {
  const groupIndex = unresolvedOrderGroupIndex(state)
  const group = state.turnOrderGroups[groupIndex]
  if (groupIndex < 0 || !group?.includes(playerId)) return false
  state.orderRollResults.push({ playerId, face })
  events.push({ type: 'order-die-rolled', playerId, face })

  const nextPlayerId = group.find((candidate) => !state.orderRollResults.some((result) => result.playerId === candidate))
  if (nextPlayerId) {
    state.activePlayerId = nextPlayerId
    return true
  }

  const results = group.map((candidate) => state.orderRollResults.find((result) => result.playerId === candidate)!)
  state.orderRollHistory.push({ playerIds: [...group], results: results.map((result) => ({ ...result })) })
  const sorted = [...results].sort((left, right) => right.face - left.face || group.indexOf(left.playerId) - group.indexOf(right.playerId))
  const replacement: string[][] = []
  for (const result of sorted) {
    const previous = replacement.at(-1)
    const previousFace = previous && results.find((entry) => entry.playerId === previous[0])?.face
    if (previous && previousFace === result.face) previous.push(result.playerId)
    else replacement.push([result.playerId])
  }
  state.turnOrderGroups.splice(groupIndex, 1, ...replacement)
  state.orderRollResults = []

  const nextGroupIndex = unresolvedOrderGroupIndex(state)
  if (nextGroupIndex >= 0) {
    state.activePlayerId = state.turnOrderGroups[nextGroupIndex][0]
  } else {
    const playerIds = state.turnOrderGroups.flat()
    events.push({ type: 'turn-order-determined', playerIds })
    beginStartingItemChoice(state, definition, random, events)
  }
  return true
}

function itemBehavior(definition: GameDefinition, itemId: string | null) {
  return definition.items.find((item) => item.id === itemId)?.effect ?? null
}

function winGame(state: WorkingState, playerId: string, events: RuleEvent[], cues: RuleCue[]) {
  const player = playerOf(state, playerId)
  if (!player) return
  state.phase = 'game-over'
  state.winnerPlayerId = playerId
  state.pendingEventIds = []
  state.pendingItemId = null
  state.eventContinuation = null
  events.push({ type: 'game-won', playerId, spaceId: player.spaceId })
  cues.push({ type: 'game-over', winnerPlayerId: playerId })
}

export interface MovementSettlement {
  readonly state: GameState
  readonly events: readonly RuleEvent[]
  readonly cues: readonly RuleCue[]
  readonly landedOnEvent: boolean
}

export function settleMovement(
  sourceState: GameState,
  definition: GameDefinition,
  playerId: string,
  spaces: number,
): MovementSettlement {
  const state = cloneState(sourceState)
  const events: RuleEvent[] = []
  const cues: RuleCue[] = []
  const movingPlayer = playerOf(state, playerId)
  if (!movingPlayer) throw new Error(`Unknown player id: ${playerId}.`)

  const movement = calculateMovementPath(definition.map, movingPlayer.spaceId, spaces)
  movingPlayer.spaceId = movement.toSpaceId
  events.push({
    type: 'token-moved',
    playerId,
    fromSpaceId: movement.fromSpaceId,
    path: movement.path,
    toSpaceId: movement.toSpaceId,
  })
  if (movement.path.length) {
    cues.push(
      { type: 'route-preview', playerId, path: movement.path, targetSpaceId: movement.toSpaceId },
      { type: 'target-highlight', spaceId: movement.toSpaceId },
      { type: 'token-hop', playerId, path: movement.path },
    )
  }

  if (isWinningSpace(definition.map, movement.toSpaceId)) {
    winGame(state, playerId, events, cues)
    return { state, events, cues, landedOnEvent: false }
  }

  const startSpaceId = definition.map.spaces[0].index
  const collisionProtected = movement.toSpaceId === startSpaceId || definition.map.winningSpaceIds.includes(movement.toSpaceId)
  if (!collisionProtected) {
    const occupants = state.players
      .filter((player) => player.playerId !== playerId && player.spaceId === movement.toSpaceId)
      .sort((left, right) => left.seatIndex - right.seatIndex)
    for (const occupant of occupants) {
      const blocked = itemBehavior(definition, occupant.itemId) === 'collision-shield'
      if (blocked) {
        const itemId = occupant.itemId
        if (!itemId) throw new Error('A collision shield must reference a held item.')
        occupant.itemId = null
        movingPlayer.spaceId = movement.fromSpaceId
        events.push({ type: 'item-changed', playerId: occupant.playerId, itemId: null })
        cues.push({ type: 'item-use', playerId: occupant.playerId, itemId })
      } else {
        occupant.spaceId = movement.fromSpaceId
      }
      events.push({
        type: 'collision-resolved',
        movingPlayerId: playerId,
        displacedPlayerId: occupant.playerId,
        fromSpaceId: movement.toSpaceId,
        toSpaceId: blocked ? movement.toSpaceId : movement.fromSpaceId,
        blocked,
      })
      cues.push({
        type: 'token-relocate',
        playerId: occupant.playerId,
        fromSpaceId: movement.toSpaceId,
        toSpaceId: blocked ? movement.toSpaceId : movement.fromSpaceId,
        reason: 'collision',
        blocked,
      })
      if (blocked) {
        cues.push({
          type: 'token-relocate',
          playerId: movingPlayer.playerId,
          fromSpaceId: movement.toSpaceId,
          toSpaceId: movement.fromSpaceId,
          reason: 'collision',
          blocked: false,
        })
      }
    }
  }

  const landedOnEvent = definition.map.spaces.find((space) => space.index === movingPlayer.spaceId)?.kind === 'event'
  return { state, events, cues, landedOnEvent }
}

function mergeSettlement(state: WorkingState, settlement: MovementSettlement, events: RuleEvent[], cues: RuleCue[]) {
  Object.assign(state, cloneState(settlement.state))
  events.push(...settlement.events)
  cues.push(...settlement.cues)
}

function weightedPick<T extends { id: string }>(
  pool: readonly T[],
  count: number,
  random: RandomSource,
  weightOf: (entry: T) => number,
): T[] {
  const available = [...pool]
  const selected: T[] = []
  while (selected.length < count && available.length) {
    const weights = available.map((entry) => Math.max(1, Math.round(weightOf(entry) * 100)))
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    let roll = random.nextInt(1, total)
    let selectedIndex = 0
    for (let index = 0; index < weights.length; index += 1) {
      roll -= weights[index]
      if (roll <= 0) {
        selectedIndex = index
        break
      }
    }
    selected.push(available.splice(selectedIndex, 1)[0])
  }
  return selected
}

export function drawEventChoices(definition: GameDefinition, recentEventIds: readonly string[], random: RandomSource) {
  const allowedIds = definition.map.allowedEventIds
    ? new Set(definition.map.allowedEventIds)
    : new Set(definition.ruleset.eventPoolIds)
  const pool = definition.events.filter((event) => allowedIds.has(event.id) && definition.ruleset.eventPoolIds.includes(event.id))
  const choices = weightedPick(pool, 3, random, (event) => (event.weight ?? 1) * (recentEventIds.includes(event.id) ? 0.25 : 1))
  if (choices.length !== 3) throw new Error('The active event pool must contain at least three events.')
  return choices as [EventDefinition, EventDefinition, EventDefinition]
}

function offerEvents(
  state: WorkingState,
  definition: GameDefinition,
  random: RandomSource,
  playerId: string,
  continuation: 'end-turn' | 'awaiting-action',
  events: RuleEvent[],
  cues: RuleCue[],
) {
  const choices = drawEventChoices(definition, state.recentEventIds, random)
  const ids: [string, string, string] = [choices[0].id, choices[1].id, choices[2].id]
  state.phase = 'awaiting-event-choice'
  state.pendingEventIds = ids
  state.eventContinuation = continuation
  events.push({ type: 'event-offered', playerId, eventCardIds: ids })
  cues.push({ type: 'event-cards', eventIds: ids })
}

function decrementGlobalRule(state: WorkingState, events: RuleEvent[]) {
  if (!state.globalDieRule) return
  const remainingRounds = state.globalDieRule.remainingRounds - 1
  state.globalDieRule = remainingRounds > 0 ? { ...state.globalDieRule, remainingRounds } : null
  events.push({
    type: 'global-die-rule-changed',
    maxFace: state.globalDieRule?.maxFace ?? null,
    remainingRounds: state.globalDieRule?.remainingRounds ?? 0,
  })
}

function advanceTurn(state: WorkingState, events: RuleEvent[]) {
  state.pendingEventIds = []
  state.pendingItemId = null
  state.eventContinuation = null
  if (state.extraTurnQueued) {
    state.extraTurnQueued = false
    state.phase = 'awaiting-action'
    events.push({ type: 'turn-advanced', playerId: state.activePlayerId, round: state.round })
    return
  }

  const order = state.turnOrderGroups.flat()
  let currentIndex = order.indexOf(state.activePlayerId)
  for (;;) {
    currentIndex = (currentIndex + 1) % order.length
    if (currentIndex === 0) {
      state.round += 1
      decrementGlobalRule(state, events)
    }
    const candidate = playerOf(state, order[currentIndex])!
    if (candidate.skipTurns > 0) {
      candidate.skipTurns -= 1
      events.push({ type: 'turn-skipped', playerId: candidate.playerId, remainingTurns: candidate.skipTurns })
      continue
    }
    state.activePlayerId = candidate.playerId
    state.phase = 'awaiting-action'
    events.push({ type: 'turn-advanced', playerId: candidate.playerId, round: state.round })
    return
  }
}

function gainRandomItem(
  state: WorkingState,
  definition: GameDefinition,
  random: RandomSource,
  playerId: string,
) {
  const player = playerOf(state, playerId)
  if (!player) return
  const blocked = new Set(definition.map.blockedItemIds ?? [])
  const pool = definition.items.filter((item) => definition.ruleset.itemPoolIds.includes(item.id) && !blocked.has(item.id) && item.id !== player.itemId)
  if (!pool.length) return
  const item = pool[random.nextInt(0, pool.length - 1)]
  if (player.itemId === null) {
    player.itemId = item.id
  } else {
    state.pendingItemId = item.id
  }
}

function applyMovementEffect(
  state: WorkingState,
  definition: GameDefinition,
  playerId: string,
  spaces: number,
  events: RuleEvent[],
  cues: RuleCue[],
) {
  const settlement = settleMovement(state, definition, playerId, spaces)
  mergeSettlement(state, settlement, events, cues)
}

function applyEffects(
  state: WorkingState,
  definition: GameDefinition,
  random: RandomSource,
  actorPlayerId: string,
  effects: readonly GameEffect[],
  events: RuleEvent[],
  cues: RuleCue[],
) {
  for (const effect of effects) {
    if (state.phase === 'game-over') break
    const actor = playerOf(state, actorPlayerId)
    if (!actor) break
    switch (effect.type) {
      case 'move':
        applyMovementEffect(state, definition, actorPlayerId, effect.spaces, events, cues)
        break
      case 'opponent-move':
        applyMovementEffect(state, definition, nextPlayer(state, actorPlayerId).playerId, effect.spaces, events, cues)
        break
      case 'skip':
        if (itemBehavior(definition, actor.itemId) === 'skip-shield') {
          const itemId = actor.itemId
          if (!itemId) throw new Error('A skip shield must reference a held item.')
          actor.itemId = null
          events.push({ type: 'item-changed', playerId: actorPlayerId, itemId: null })
          cues.push({ type: 'item-use', playerId: actorPlayerId, itemId })
        } else {
          actor.skipTurns += effect.turns
        }
        break
      case 'extra-turn':
        state.extraTurnQueued = true
        break
      case 'gain-item':
        gainRandomItem(state, definition, random, actorPlayerId)
        break
      case 'swap': {
        const opponent = nextPlayer(state, actorPlayerId)
        const actorSpace = actor.spaceId
        const opponentSpace = opponent.spaceId
        actor.spaceId = opponent.spaceId
        opponent.spaceId = actorSpace
        events.push(
          { type: 'token-moved', playerId: actor.playerId, fromSpaceId: actorSpace, path: [actor.spaceId], toSpaceId: actor.spaceId },
          { type: 'token-moved', playerId: opponent.playerId, fromSpaceId: opponentSpace, path: [opponent.spaceId], toSpaceId: opponent.spaceId },
        )
        cues.push(
          { type: 'token-relocate', playerId: actor.playerId, fromSpaceId: actorSpace, toSpaceId: actor.spaceId, reason: 'swap' },
          { type: 'token-relocate', playerId: opponent.playerId, fromSpaceId: opponentSpace, toSpaceId: opponent.spaceId, reason: 'swap' },
        )
        const winner = [actor, opponent].sort((left, right) => left.seatIndex - right.seatIndex)
          .find((player) => isWinningSpace(definition.map, player.spaceId))
        if (winner) winGame(state, winner.playerId, events, cues)
        break
      }
      case 'world-max-die':
        state.globalDieRule = { maxFace: effect.value, remainingRounds: effect.rounds }
        events.push({ type: 'global-die-rule-changed', maxFace: effect.value, remainingRounds: effect.rounds })
        break
      default: {
        const unreachable: never = effect
        throw new Error(`Unknown game effect: ${String(unreachable)}.`)
      }
    }
  }
}

function useActiveItem(
  state: WorkingState,
  definition: GameDefinition,
  random: RandomSource,
  playerId: string,
  itemId: string,
  events: RuleEvent[],
  cues: RuleCue[],
): RuleCommandResult | null {
  const player = playerOf(state, playerId)
  const item = definition.items.find((candidate) => candidate.id === itemId)
  if (!item) return reject('unknown_content', `Unknown item id: ${itemId}.`)
  if (!player || player.itemId !== itemId || item.mode !== '主动') return reject('illegal_command', 'The requested item cannot be used now.')
  player.itemId = null
  events.push({ type: 'item-changed', playerId, itemId: null })
  cues.push({ type: 'item-use', playerId, itemId })

  switch (item.effect) {
    case 'move-plus-three':
      player.nextMoveBonus += 3
      break
    case 'opponent-back-two':
      applyMovementEffect(state, definition, nextPlayer(state, playerId).playerId, -2, events, cues)
      break
    case 'teleport-beach': {
      const beach = definition.map.landmarks.find((landmark) => landmark.id === 'scavenger-beach')?.spaceIds[0]
      if (beach === undefined || player.spaceId >= beach) return reject('illegal_command', 'This item cannot be used from the current space.')
      const settlement = settleMovement(state, definition, playerId, beach - player.spaceId)
      mergeSettlement(state, settlement, events, cues)
      if (settlement.landedOnEvent && state.phase !== 'game-over') offerEvents(state, definition, random, playerId, 'awaiting-action', events, cues)
      break
    }
    case 'fixed-eight':
      player.nextFixedMoveTotal = 8
      break
    case 'opponent-max-three':
      nextPlayer(state, playerId).nextMaxDie = 3
      break
    case 'check-pass':
    case 'skip-shield':
    case 'collision-shield':
      return reject('illegal_command', 'Passive items cannot be activated manually.')
    default: {
      const unreachable: never = item.effect
      throw new Error(`Unknown item behavior: ${String(unreachable)}.`)
    }
  }
  return null
}

export function reduceGameCommand(
  sourceState: GameState,
  definition: GameDefinition,
  actorPlayerId: string,
  command: CoreGameCommand,
): RuleCommandResult {
  if (sourceState.phase === 'game-over') return reject('illegal_command', 'The game has already ended.')
  const state = cloneState(sourceState)
  const actor = playerOf(state, actorPlayerId)
  if (!actor) return reject('unauthorized_player', `Unknown player id: ${actorPlayerId}.`)
  const random = new DeterministicRandom(state.rng)
  const events: RuleEvent[] = []
  const cues: RuleCue[] = []

  switch (command.type) {
    case 'select-skin': {
      const actorHasRolled = state.orderRollResults.some((result) => result.playerId === actorPlayerId)
        || state.orderRollHistory.some((round) => round.results.some((result) => result.playerId === actorPlayerId))
      if (state.phase !== 'determining-order' || actorHasRolled) return reject('illegal_command', 'Skins can only be selected before the participant rolls for turn order.')
      if (!definition.ruleset.skinIds.includes(command.skinId)) return reject('unknown_content', `Unknown skin id: ${command.skinId}.`)
      actor.skinId = command.skinId
      events.push({ type: 'skin-selected', playerId: actorPlayerId, skinId: command.skinId })
      break
    }
    case 'choose-starting-item': {
      if (state.phase !== 'choosing-starting-item' || state.activePlayerId !== actorPlayerId || actor.itemId !== null) {
        return reject('illegal_command', 'A starting item cannot be selected now.')
      }
      if (!state.startingItemOfferIds.includes(command.itemId)) return reject('illegal_command', 'The requested starting item was not offered.')
      actor.itemId = command.itemId
      events.push({ type: 'starting-item-chosen', playerId: actorPlayerId, itemId: command.itemId })
      state.startingItemOfferIds = []
      beginStartingItemChoice(state, definition, random, events)
      break
    }
    case 'request-order-roll': {
      if (state.phase !== 'determining-order' || state.activePlayerId !== actorPlayerId) {
        return reject('illegal_command', 'Only the current participant can roll for turn order.')
      }
      if (!submitOrderRoll(state, definition, random, actorPlayerId, random.nextInt(1, 6), events)) {
        return reject('illegal_command', 'The participant is not in the current order-roll group.')
      }
      break
    }
    case 'use-item': {
      if (state.phase !== 'awaiting-action' || state.activePlayerId !== actorPlayerId) return reject('illegal_command', 'An item can only be used by the active player before rolling.')
      const rejection = useActiveItem(state, definition, random, actorPlayerId, command.itemId, events, cues)
      if (rejection) return rejection
      break
    }
    case 'request-roll': {
      if (state.phase !== 'awaiting-action' || state.activePlayerId !== actorPlayerId) return reject('illegal_command', 'Only the active player can request a roll.')
      const maxFace = Math.min(state.globalDieRule?.maxFace ?? 6, actor.nextMaxDie ?? 6)
      const dice = rollDice(random, maxFace)
      const rawTotal = dice[0] + dice[1]
      const movementTotal = (actor.nextFixedMoveTotal ?? rawTotal) + actor.nextMoveBonus
      actor.nextMoveBonus = 0
      actor.nextMaxDie = null
      actor.nextFixedMoveTotal = null
      state.lastDice = { playerId: actorPlayerId, purpose: 'move', faces: dice, total: rawTotal }
      events.push({ type: 'dice-rolled', playerId: actorPlayerId, purpose: 'move', dice })
      cues.push({ type: 'dice-roll', playerId: actorPlayerId, dice })
      const settlement = settleMovement(state, definition, actorPlayerId, movementTotal)
      mergeSettlement(state, settlement, events, cues)
      if (state.winnerPlayerId === null) {
        if (settlement.landedOnEvent) offerEvents(state, definition, random, actorPlayerId, 'end-turn', events, cues)
        else advanceTurn(state, events)
      }
      break
    }
    case 'choose-event': {
      if (state.phase !== 'awaiting-event-choice' || state.activePlayerId !== actorPlayerId || !state.pendingEventIds.includes(command.eventId)) {
        return reject('illegal_command', 'The requested event is not currently available.')
      }
      const event = definition.events.find((candidate) => candidate.id === command.eventId)
      if (!event) return reject('unknown_content', `Unknown event id: ${command.eventId}.`)
      let passed: boolean | null = null
      let effects = event.effect ?? []
      if (event.threshold !== undefined) {
        const maxFace = state.globalDieRule?.maxFace ?? 6
        const dice = rollDice(random, maxFace)
        const total = dice[0] + dice[1]
        const guaranteed = itemBehavior(definition, actor.itemId) === 'check-pass'
        passed = guaranteed || total >= event.threshold
        if (guaranteed) {
          const itemId = actor.itemId
          if (!itemId) throw new Error('A guaranteed check must reference a held item.')
          actor.itemId = null
          events.push({ type: 'item-changed', playerId: actorPlayerId, itemId: null })
          cues.push({ type: 'item-use', playerId: actorPlayerId, itemId })
        }
        state.lastDice = { playerId: actorPlayerId, purpose: 'check', faces: dice, total }
        events.push({ type: 'dice-rolled', playerId: actorPlayerId, purpose: 'check', dice })
        cues.push({ type: 'dice-roll', playerId: actorPlayerId, dice })
        effects = passed ? event.success ?? [] : event.failure ?? []
      }
      const continuation = state.eventContinuation ?? 'end-turn'
      state.pendingEventIds = []
      state.recentEventIds = [...state.recentEventIds, event.id].slice(-2)
      events.push({ type: 'event-resolved', playerId: actorPlayerId, eventCardId: event.id, passed })
      applyEffects(state, definition, random, actorPlayerId, effects, events, cues)
      if (state.winnerPlayerId === null) {
        if (state.pendingItemId) {
          state.phase = 'awaiting-item-choice'
          state.eventContinuation = continuation
        } else if (continuation === 'awaiting-action') {
          state.phase = 'awaiting-action'
          state.eventContinuation = null
        } else {
          advanceTurn(state, events)
        }
      }
      break
    }
    case 'choose-item': {
      if (state.phase !== 'awaiting-item-choice' || state.activePlayerId !== actorPlayerId || !state.pendingItemId) {
        return reject('illegal_command', 'There is no pending item choice.')
      }
      if (command.itemId !== null && command.itemId !== state.pendingItemId) return reject('illegal_command', 'The requested item is not pending.')
      if (command.itemId) {
        actor.itemId = command.itemId
      }
      const continuation = state.eventContinuation ?? 'end-turn'
      state.pendingItemId = null
      if (continuation === 'awaiting-action') {
        state.phase = 'awaiting-action'
        state.eventContinuation = null
      } else {
        advanceTurn(state, events)
      }
      break
    }
    case 'continue':
      return reject('illegal_command', 'No rule phase currently requires a continue command.')
    default: {
      const unreachable: never = command
      throw new Error(`Unknown game command: ${String(unreachable)}.`)
    }
  }

  state.rng = random.snapshot()
  return { ok: true, state, events, cues }
}
