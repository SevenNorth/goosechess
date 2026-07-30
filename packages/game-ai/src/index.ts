import {
  calculateMovementPath,
  type CoreGameCommand,
  type GameDecisionView,
  type GameEffect,
  type ItemBehavior,
  type RandomSource,
} from '@goose-chess/game-core'

export interface AiDecision<TCommand = CoreGameCommand> {
  readonly command: TCommand
  readonly reasonTag: string
  readonly score: number
}

export interface GooseAiStrategy {
  decide(view: GameDecisionView, random: RandomSource): AiDecision | null
}

export interface AiCommandSubmitter<TResult = unknown> {
  submit(playerId: string, command: CoreGameCommand): Promise<TResult>
}

export interface AiTurnResult<TResult = unknown> {
  readonly decision: AiDecision
  readonly result: TResult
}

export class AiTurnController<TResult = unknown> {
  constructor(
    private readonly strategy: GooseAiStrategy,
    private readonly submitter: AiCommandSubmitter<TResult>,
    private readonly randomForDecision: (view: GameDecisionView) => RandomSource,
  ) {}

  async takeTurn(view: GameDecisionView): Promise<AiTurnResult<TResult> | null> {
    const decision = this.strategy.decide(view, this.randomForDecision(view))
    if (!decision) return null
    const result = await this.submitter.submit(view.viewerPlayerId, decision.command)
    return { decision, result }
  }
}

interface ScoredCommand {
  readonly command: CoreGameCommand
  readonly score: number
  readonly reasonTag: string
}

const ITEM_VALUES: Readonly<Record<ItemBehavior, number>> = {
  'check-pass': 8,
  'move-plus-three': 6,
  'opponent-back-two': 5,
  'teleport-beach': 7,
  'fixed-eight': 7,
  'opponent-max-three': 6,
  'skip-shield': 7,
  'collision-shield': 7,
}

function playerOf(view: GameDecisionView, playerId = view.viewerPlayerId) {
  return view.players.find((player) => player.playerId === playerId)
}

function nextPlayer(view: GameDecisionView) {
  const actor = playerOf(view)
  if (!actor) return undefined
  const currentIndex = view.turnOrderPlayerIds.indexOf(actor.playerId)
  return playerOf(view, view.turnOrderPlayerIds[(currentIndex + 1) % view.turnOrderPlayerIds.length])
}

function itemBehavior(view: GameDecisionView, itemId: string | null) {
  return view.relevantItems.find((item) => item.id === itemId)?.effect
}

function itemValue(view: GameDecisionView, itemId: string | null) {
  const behavior = itemBehavior(view, itemId)
  return behavior ? ITEM_VALUES[behavior] : 0
}

function progressValue(view: GameDecisionView, playerId: string, spaces: number) {
  const player = playerOf(view, playerId)
  if (!player) return 0
  const movement = calculateMovementPath(view.map, player.spaceId, spaces)
  if (view.map.winningSpaceIds.includes(movement.toSpaceId)) return 100
  const progress = movement.toSpaceId - player.spaceId
  const collision = view.players.some((candidate) => candidate.playerId !== playerId && candidate.spaceId === movement.toSpaceId)
  return progress + (collision ? 5 : 0) - (movement.bounced ? 4 : 0)
}

function effectUtility(view: GameDecisionView, effects: readonly GameEffect[]) {
  const actor = playerOf(view)
  const opponent = nextPlayer(view)
  if (!actor) return 0
  return effects.reduce((utility, effect) => {
    switch (effect.type) {
      case 'move': return utility + progressValue(view, actor.playerId, effect.spaces)
      case 'opponent-move': return utility - (opponent ? progressValue(view, opponent.playerId, effect.spaces) : 0)
      case 'skip': return utility - effect.turns * 7
      case 'extra-turn': return utility + 9
      case 'gain-item': return utility + 6
      case 'swap': return utility + (opponent ? opponent.spaceId - actor.spaceId : 0)
      case 'world-max-die': return utility + (actor.rank === 1 ? 2 : -1) * effect.rounds
    }
  }, 0)
}

function checkSuccessProbability(maxFace: number, threshold: number) {
  let successes = 0
  for (let first = 1; first <= maxFace; first += 1) {
    for (let second = 1; second <= maxFace; second += 1) {
      if (first + second >= threshold) successes += 1
    }
  }
  return successes / (maxFace * maxFace)
}

function scoreEvent(view: GameDecisionView, eventId: string): ScoredCommand {
  const event = view.offeredEvents.find((candidate) => candidate.id === eventId)
  if (!event) return { command: { type: 'choose-event', eventId }, score: -Infinity, reasonTag: 'event-unavailable' }
  let score = effectUtility(view, event.effect ?? [])
  if (event.threshold !== undefined) {
    const actor = playerOf(view)
    const guaranteed = itemBehavior(view, actor?.itemId ?? null) === 'check-pass'
    const probability = guaranteed ? 1 : checkSuccessProbability(view.dieRule.maxFace, event.threshold)
    score = probability * effectUtility(view, event.success ?? [])
      + (1 - probability) * effectUtility(view, event.failure ?? [])
  }
  score += event.aiValue * 0.2
  return {
    command: { type: 'choose-event', eventId },
    score,
    reasonTag: event.threshold === undefined ? 'event-high-expected-value' : 'event-probability-advantage',
  }
}

function expectedRollValue(view: GameDecisionView, bonus = 0, fixedTotal: number | null = null) {
  const actor = playerOf(view)
  if (!actor) return -Infinity
  const maxFace = Math.min(view.dieRule.maxFace, actor.nextMaxDie ?? 6)
  let totalUtility = 0
  let outcomes = 0
  for (let first = 1; first <= maxFace; first += 1) {
    for (let second = 1; second <= maxFace; second += 1) {
      totalUtility += progressValue(view, actor.playerId, (fixedTotal ?? first + second) + actor.nextMoveBonus + bonus)
      outcomes += 1
    }
  }
  return totalUtility / outcomes
}

function scoreRoll(view: GameDecisionView): ScoredCommand {
  const actor = playerOf(view)
  const score = expectedRollValue(view, 0, actor?.nextFixedMoveTotal ?? null)
  let reasonTag = 'advance-toward-finish'
  if (score >= 50) reasonTag = 'finish-safe-roll'
  else if (actor && view.players.some((player) => player.playerId !== actor.playerId && player.spaceId > actor.spaceId && player.spaceId - actor.spaceId <= 12)) {
    reasonTag = 'collision-opportunity'
  } else if (actor?.rank !== 1) reasonTag = 'ranking-recovery'
  return { command: { type: 'request-roll' }, score, reasonTag }
}

function scoreItemUse(view: GameDecisionView, command: Extract<CoreGameCommand, { type: 'use-item' }>): ScoredCommand {
  const actor = playerOf(view)
  const opponent = command.targetPlayerId
    ? view.players.find((player) => player.playerId === command.targetPlayerId)
    : nextPlayer(view)
  const itemId = command.itemId
  const behavior = itemBehavior(view, itemId)
  let score: number
  let reasonTag = 'item-improves-movement'
  switch (behavior) {
    case 'move-plus-three': score = expectedRollValue(view, 3) + 2; break
    case 'fixed-eight': score = expectedRollValue(view, 0, 8) + 2; break
    case 'opponent-back-two':
      score = expectedRollValue(view) + (opponent ? Math.min(6, opponent.spaceId) * 0.4 : 0)
      reasonTag = 'item-disrupts-leader'
      break
    case 'teleport-beach': {
      const beach = view.map.spaces.find((space) => space.landmarkId === 'scavenger-beach')
      score = expectedRollValue(view) + Math.max(0, (beach?.index ?? actor?.spaceId ?? 0) - (actor?.spaceId ?? 0))
      reasonTag = 'item-shortcut-value'
      break
    }
    case 'opponent-max-three':
      score = expectedRollValue(view) + (opponent && actor && opponent.spaceId >= actor.spaceId ? 5 : 2)
      reasonTag = 'item-disrupts-leader'
      break
    default: score = -Infinity
  }
  return { command, score, reasonTag }
}

function scoreCommand(view: GameDecisionView, command: CoreGameCommand): ScoredCommand {
  switch (command.type) {
    case 'request-order-roll': return { command, score: 0, reasonTag: 'roll-for-turn-order' }
    case 'request-roll': return scoreRoll(view)
    case 'use-item': return scoreItemUse(view, command)
    case 'choose-event': return scoreEvent(view, command.eventId)
    case 'choose-starting-item':
      return { command, score: itemValue(view, command.itemId), reasonTag: 'starting-item-utility' }
    case 'choose-item': {
      const actor = playerOf(view)
      const keptItemId = actor?.itemId ?? null
      return command.itemId
        ? { command, score: itemValue(view, command.itemId), reasonTag: 'replace-with-higher-value' }
        : { command, score: itemValue(view, keptItemId), reasonTag: 'keep-higher-value-item' }
    }
    case 'select-skin': return { command, score: -100, reasonTag: 'skin-is-rules-neutral' }
    case 'continue': return { command, score: 0, reasonTag: 'only-legal-command' }
  }
}

export function createGooseAiStrategy(): GooseAiStrategy {
  return {
    decide(view, random) {
      if (!view.legalCommands.length) return null
      const scored = view.legalCommands.map((command) => {
        const option = scoreCommand(view, command)
        return { ...option, score: option.score + random.nextInt(0, 1000) / 10000 }
      })
      scored.sort((left, right) => right.score - left.score || JSON.stringify(left.command).localeCompare(JSON.stringify(right.command)))
      const selected = scored[0]
      return {
        command: selected.command,
        reasonTag: view.legalCommands.length === 1 ? 'only-legal-command' : selected.reasonTag,
        score: selected.score,
      }
    },
  }
}

export function createFirstLegalStrategy(): GooseAiStrategy {
  return {
    decide(view) {
      const command = view.legalCommands[0]
      return command ? { command, reasonTag: 'only-legal-command', score: 0 } : null
    },
  }
}
