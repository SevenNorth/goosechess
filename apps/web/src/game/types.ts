export type PlayerId = 'human' | 'ai'

export type Effect =
  | { type: 'move'; spaces: number }
  | { type: 'skip'; turns: number }
  | { type: 'extra-turn' }
  | { type: 'gain-item' }
  | { type: 'opponent-move'; spaces: number }
  | { type: 'swap' }
  | { type: 'world-max-die'; value: number; rounds: number }

export interface EventCard {
  id: string
  title: string
  flavor: string
  kind: '常规事件' | '骰子检定' | '奇遇事件'
  threshold?: number
  success?: Effect[]
  failure?: Effect[]
  effect?: Effect[]
  successText?: string
  failureText?: string
  accent: 'coral' | 'teal' | 'gold'
  aiValue: number
}

export type ItemEffect =
  | 'check-pass'
  | 'move-plus-three'
  | 'opponent-back-two'
  | 'teleport-beach'
  | 'fixed-eight'
  | 'opponent-max-three'
  | 'skip-shield'
  | 'collision-shield'

export interface ItemCard {
  id: string
  title: string
  description: string
  quote: string
  mode: '主动' | '被动'
  effect: ItemEffect
  priority: number
}

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
