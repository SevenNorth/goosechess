import type {
  EventDefinition,
  GameEffect,
  ItemBehavior,
  ItemDefinition,
  TokenSkinDefinition,
} from '@goose-chess/game-core'

export type Effect = GameEffect

export interface EventCard extends EventDefinition {
  accent: 'coral' | 'teal' | 'gold'
}

export type ItemEffect = ItemBehavior

export interface ItemCard extends ItemDefinition {
  description: string
  quote: string
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

export interface SkinContentDefinition extends TokenSkinDefinition {
  version: number
  title: string
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
