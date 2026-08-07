export type Role = 'player' | 'content-editor' | 'admin'
export type DraftStatus = 'draft' | 'in-review' | 'approved' | 'rejected' | 'published'
export type Accent = 'coral' | 'teal' | 'gold'
export type EventKind = '常规事件' | '骰子检定' | '奇遇事件'

export interface PublicUser {
  readonly id: string
  readonly username: string
  readonly displayName: string
  readonly role: Role
}

export interface ValidationIssue {
  readonly path: string
  readonly code: string
  readonly message: string
}

export interface ValidationResult {
  readonly valid: boolean
  readonly issues: readonly ValidationIssue[]
}

export type EventEffect =
  | { type: 'move'; spaces: number }
  | { type: 'move-to-next-landmark' }
  | { type: 'opponent-move'; spaces: number }
  | { type: 'skip'; turns: number }
  | { type: 'world-max-die'; value: number; rounds: number }
  | { type: 'extra-turn' }
  | { type: 'gain-item' }
  | { type: 'swap' }

export interface ManagedEventContent {
  id: string
  title: string
  flavor: string
  kind: EventKind
  accent: Accent
  aiValue: number
  weight: number
  poolIds: string[]
  threshold?: number
  effect?: EventEffect[]
  success?: EventEffect[]
  failure?: EventEffect[]
  successText: string
  failureText?: string
}

export interface ManagedSkinContent {
  id: string
  version: number
  title: string
  name: string
  atlas: string
  animations: { idle: string; active: string; hop: string; hit: string }
  anchor: { x: number; y: number }
  shadowScale: number
  production: {
    source: string
    thumbnail: string
    shadow: string
    sourceWidth: number
    sourceHeight: number
    subjectWidth: number
    subjectHeight: number
    transparentPixelRatio: number
  }
}

export interface ContentDraft {
  readonly id: string
  readonly contentKey: string
  readonly kind: 'event' | 'map' | 'skin'
  readonly title: string
  readonly status: DraftStatus
  readonly currentRevision: number
  readonly content: unknown
  readonly contentHash: string
  readonly validation: ValidationResult
  readonly createdBy: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface ContentRelease {
  readonly version: string
  readonly contentKey: string
  readonly draftId: string
  readonly revision: number
  readonly kind: 'event' | 'map' | 'skin'
  readonly content: unknown
  readonly contentHash: string
  readonly active: boolean
  readonly publishedBy: string
  readonly publishedAt: number
}

export interface AuditEntry {
  readonly id: string
  readonly actorId: string
  readonly action: string
  readonly entityType: string
  readonly entityId: string
  readonly details: unknown
  readonly createdAt: number
}
