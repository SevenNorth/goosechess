export type PlayerController = 'local' | 'ai' | 'remote'
export type GamePhase = 'determining-order' | 'choosing-starting-item' | 'awaiting-action' | 'awaiting-event-choice' | 'awaiting-item-choice' | 'game-over'
export type DicePair = readonly [number, number]

export interface BoardSpace {
  readonly index: number
  readonly x: number
  readonly y: number
  readonly rotation: number
  readonly kind: 'start' | 'normal' | 'event' | 'finish'
  readonly landmarkId?: string
}

export interface LandmarkDefinition {
  readonly id: string
  readonly name: string
  readonly spaceIds: readonly number[]
  readonly x?: number
  readonly y?: number
  readonly size?: number
}

export interface MapAssetManifest {
  readonly background: string
  readonly landmarkAtlas: string
  readonly landmarks?: Readonly<Record<string, string>>
}

export interface MapDefinition {
  readonly id: string
  readonly name: string
  readonly logicalSize: { readonly width: number; readonly height: number }
  readonly spaces: readonly BoardSpace[]
  readonly winningSpaceIds: readonly number[]
  readonly landmarks: readonly LandmarkDefinition[]
  readonly allowedEventIds?: readonly string[]
  readonly blockedItemIds?: readonly string[]
  readonly assets: MapAssetManifest
}

export type GameEffect =
  | { readonly type: 'move'; readonly spaces: number }
  | { readonly type: 'skip'; readonly turns: number }
  | { readonly type: 'extra-turn' }
  | { readonly type: 'gain-item' }
  | { readonly type: 'opponent-move'; readonly spaces: number }
  | { readonly type: 'swap' }
  | { readonly type: 'world-max-die'; readonly value: number; readonly rounds: number }

export type ItemBehavior =
  | 'check-pass'
  | 'move-plus-three'
  | 'opponent-back-two'
  | 'teleport-beach'
  | 'fixed-eight'
  | 'opponent-max-three'
  | 'skip-shield'
  | 'collision-shield'

export interface EventDefinition {
  readonly id: string
  readonly title: string
  readonly flavor: string
  readonly kind: '常规事件' | '骰子检定' | '奇遇事件'
  readonly threshold?: number
  readonly success?: readonly GameEffect[]
  readonly failure?: readonly GameEffect[]
  readonly effect?: readonly GameEffect[]
  readonly successText?: string
  readonly failureText?: string
  readonly weight?: number
  readonly aiValue: number
}

export interface ItemDefinition {
  readonly id: string
  readonly title: string
  readonly mode: '主动' | '被动'
  readonly effect: ItemBehavior
}

export interface TokenSkinDefinition {
  readonly id: string
  readonly name: string
  readonly atlas: string
  readonly animations: {
    readonly idle: string
    readonly active: string
    readonly hop: string
    readonly hit: string
  }
  readonly anchor: { readonly x: number; readonly y: number }
  readonly shadowScale: number
}

export interface RulesetDefinition {
  readonly id: string
  readonly version: number
  readonly playerCount: { readonly min: number; readonly max: number }
  readonly mapIds: readonly string[]
  readonly eventPoolIds: readonly string[]
  readonly itemPoolIds: readonly string[]
  readonly skinIds: readonly string[]
}

export interface GameDefinition {
  readonly contentVersion: string
  readonly map: MapDefinition
  readonly ruleset: RulesetDefinition
  readonly events: readonly EventDefinition[]
  readonly items: readonly ItemDefinition[]
  readonly skins: readonly TokenSkinDefinition[]
}

export interface ParticipantSetup {
  readonly playerId: string
  readonly seatIndex: number
  readonly controller: PlayerController
  readonly displayName: string
  readonly colorId: string
  readonly skinId: string
  readonly startingItemId?: string
  readonly spaceId?: number
}

export interface ParticipantState {
  readonly playerId: string
  readonly seatIndex: number
  readonly controller: PlayerController
  readonly displayName: string
  readonly colorId: string
  readonly skinId: string
  readonly spaceId: number
  readonly itemId: string | null
  readonly skipTurns: number
  readonly nextMoveBonus: number
  readonly nextMaxDie: number | null
  readonly nextFixedMoveTotal: number | null
}

export interface LastDiceResult {
  readonly playerId: string
  readonly purpose: 'move' | 'check'
  readonly faces: DicePair
  readonly total: number
}

export interface GlobalDieRule {
  readonly maxFace: number
  readonly remainingRounds: number
}

export interface RngState {
  readonly seed: number
  readonly cursor: number
}

export interface OrderRollResult {
  readonly playerId: string
  readonly face: number
}

export interface OrderRollRound {
  readonly playerIds: readonly string[]
  readonly results: readonly OrderRollResult[]
}

export interface GameState {
  readonly phase: GamePhase
  readonly round: number
  readonly activePlayerId: string
  readonly players: readonly ParticipantState[]
  readonly turnOrderGroups: readonly (readonly string[])[]
  readonly orderRollResults: readonly OrderRollResult[]
  readonly orderRollHistory: readonly OrderRollRound[]
  readonly startingItemOfferIds: readonly string[]
  readonly rng: RngState
  readonly pendingEventIds: readonly string[]
  readonly pendingItemId: string | null
  readonly eventContinuation: 'end-turn' | 'awaiting-action' | null
  readonly recentEventIds: readonly string[]
  readonly winnerPlayerId: string | null
  readonly extraTurnQueued: boolean
  readonly globalDieRule: GlobalDieRule | null
  readonly lastDice: LastDiceResult | null
}

export type CoreGameCommand =
  | { readonly type: 'select-skin'; readonly skinId: string }
  | { readonly type: 'choose-starting-item'; readonly itemId: string }
  | { readonly type: 'request-order-roll' }
  | { readonly type: 'use-item'; readonly itemId: string }
  | { readonly type: 'request-roll' }
  | { readonly type: 'choose-event'; readonly eventId: string }
  | { readonly type: 'choose-item'; readonly itemId: string | null }
  | { readonly type: 'continue' }

export type RuleEvent =
  | { readonly type: 'starting-items-offered'; readonly playerId: string; readonly itemIds: readonly [string, string, string] }
  | { readonly type: 'starting-item-chosen'; readonly playerId: string; readonly itemId: string }
  | { readonly type: 'skin-selected'; readonly playerId: string; readonly skinId: string }
  | { readonly type: 'order-die-rolled'; readonly playerId: string; readonly face: number }
  | { readonly type: 'turn-order-determined'; readonly playerIds: readonly string[] }
  | { readonly type: 'dice-rolled'; readonly playerId: string; readonly purpose: 'move' | 'check'; readonly dice: DicePair }
  | { readonly type: 'token-moved'; readonly playerId: string; readonly fromSpaceId: number; readonly path: readonly number[]; readonly toSpaceId: number }
  | { readonly type: 'collision-resolved'; readonly movingPlayerId: string; readonly displacedPlayerId: string; readonly fromSpaceId: number; readonly toSpaceId: number; readonly blocked: boolean }
  | { readonly type: 'event-offered'; readonly playerId: string; readonly eventCardIds: readonly [string, string, string] }
  | { readonly type: 'event-resolved'; readonly playerId: string; readonly eventCardId: string; readonly passed: boolean | null }
  | { readonly type: 'item-changed'; readonly playerId: string; readonly itemId: string | null }
  | { readonly type: 'item-offered'; readonly playerId: string; readonly itemId: string }
  | { readonly type: 'turn-skipped'; readonly playerId: string; readonly remainingTurns: number }
  | { readonly type: 'turn-advanced'; readonly playerId: string; readonly round: number }
  | { readonly type: 'global-die-rule-changed'; readonly maxFace: number | null; readonly remainingRounds: number }
  | { readonly type: 'game-won'; readonly playerId: string; readonly spaceId: number }

export type RuleCue =
  | { readonly type: 'dice-roll'; readonly playerId: string; readonly dice: DicePair }
  | { readonly type: 'route-preview'; readonly playerId: string; readonly path: readonly number[]; readonly targetSpaceId: number }
  | { readonly type: 'target-highlight'; readonly spaceId: number }
  | { readonly type: 'token-hop'; readonly playerId: string; readonly path: readonly number[] }
  | { readonly type: 'token-relocate'; readonly playerId: string; readonly fromSpaceId: number; readonly toSpaceId: number; readonly reason: 'collision' | 'swap'; readonly blocked?: boolean }
  | { readonly type: 'event-cards'; readonly eventIds: readonly [string, string, string] }
  | { readonly type: 'game-over'; readonly winnerPlayerId: string }

export interface RuleTransition {
  readonly ok: true
  readonly state: GameState
  readonly events: readonly RuleEvent[]
  readonly cues: readonly RuleCue[]
}

export interface RuleRejection {
  readonly ok: false
  readonly code: 'illegal_command' | 'unknown_content' | 'unauthorized_player'
  readonly message: string
}

export type RuleCommandResult = RuleTransition | RuleRejection
