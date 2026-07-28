export type PlayerId = 'human' | 'ai'

export type { Effect, EventCard, ItemCard, ItemEffect } from '@goose-chess/game-content'

export interface Player {
  id: PlayerId
  name: string
  position: number
  item: string | null
  skipTurns: number
  nextMoveBonus: number
  nextMaxDie: number | null
  nextFixedTotal: number | null
}

export interface LogEntry {
  id: number
  text: string
  tone?: 'good' | 'bad' | 'neutral'
}

export interface WorldRule {
  maxDie: number
  rounds: number
}

export type GamePhase =
  | 'setup'
  | 'ready'
  | 'rolling'
  | 'event-choice'
  | 'event-result'
  | 'item-choice'
  | 'ai-thinking'
  | 'game-over'
