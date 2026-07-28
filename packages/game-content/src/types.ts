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

export interface LandmarkContentDefinition {
  id: string
  title: string
  spaceIds: readonly number[]
}

export interface MapContentDefinition {
  id: string
  version: number
  title: string
  spaceCount: number
  winningSpaceIds: readonly number[]
  landmarkIds: readonly string[]
}

export interface SkinContentDefinition {
  id: string
  version: number
  title: string
  assetKey: string
}

export interface RulesetContentDefinition {
  id: string
  version: number
  playerCount: { min: number; max: number }
  mapIds: readonly string[]
  eventPoolIds: readonly string[]
  itemPoolIds: readonly string[]
  skinIds: readonly string[]
}

export interface ContentManifest {
  contentVersion: string
  maps: readonly MapContentDefinition[]
  landmarks: readonly LandmarkContentDefinition[]
  events: readonly EventCard[]
  items: readonly ItemCard[]
  skins: readonly SkinContentDefinition[]
  rulesets: readonly RulesetContentDefinition[]
}
