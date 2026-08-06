import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  compileManagedContent,
  getManagedContentId,
  hashJsonContent,
  validateManagedContent,
  type ContentValidationResult,
  type ManagedContentKind,
} from '@goose-chess/content-tools'
import {
  builtInRuntimeContentBundle,
  composeRuntimeContentBundle,
  type RuntimeContentBundle,
  type RuntimeContentRelease,
} from '@goose-chess/content-tools/runtime-content'

export type ContentDraftStatus =
  | 'draft'
  | 'in-review'
  | 'approved'
  | 'rejected'
  | 'published'

export interface ContentDraft {
  readonly id: string
  readonly contentKey: string
  readonly kind: ManagedContentKind
  readonly title: string
  readonly status: ContentDraftStatus
  readonly currentRevision: number
  readonly content: unknown
  readonly contentHash: string
  readonly validation: ContentValidationResult
  readonly createdBy: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface ContentRelease {
  readonly version: string
  readonly contentKey: string
  readonly draftId: string
  readonly revision: number
  readonly kind: ManagedContentKind
  readonly content: unknown
  readonly contentHash: string
  readonly active: boolean
  readonly publishedBy: string
  readonly publishedAt: number
}

export interface ContentAuditEntry {
  readonly id: string
  readonly actorId: string
  readonly action: string
  readonly entityType: string
  readonly entityId: string
  readonly details: unknown
  readonly createdAt: number
}

export interface ContentStorePort {
  listDrafts(): Promise<readonly ContentDraft[]>
  getDraft(id: string): Promise<ContentDraft>
  createDraft(input: {
    readonly kind: ManagedContentKind
    readonly title: string
    readonly content: unknown
  }, actorId: string): Promise<ContentDraft>
  updateDraft(id: string, input: {
    readonly expectedRevision: number
    readonly title?: string
    readonly content: unknown
  }, actorId: string): Promise<ContentDraft>
  deleteDraft(id: string, actorId: string): Promise<void>
  submitDraft(id: string, actorId: string): Promise<ContentDraft>
  reviewDraft(id: string, decision: 'approve' | 'reject', reason: string | undefined, actorId: string): Promise<ContentDraft>
  publishDraft(id: string, actorId: string): Promise<ContentRelease>
  listReleases(): Promise<readonly ContentRelease[]>
  rollbackRelease(version: string, actorId: string): Promise<ContentRelease>
  getCurrentRuntimeBundle(): Promise<RuntimeContentBundle>
  getRuntimeBundle(version: string): Promise<RuntimeContentBundle>
  listAudit(limit?: number): Promise<readonly ContentAuditEntry[]>
  close(): Promise<void> | void
}

export class ContentStoreError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

interface DraftRow {
  readonly id: string
  readonly content_key: string
  readonly kind: ManagedContentKind
  readonly title: string
  readonly status: ContentDraftStatus
  readonly current_revision: number
  readonly payload_json: string
  readonly content_hash: string
  readonly validation_json: string
  readonly created_by: string
  readonly created_at: number
  readonly updated_at: number
}

interface ReleaseRow {
  readonly version: string
  readonly content_key: string
  readonly draft_id: string
  readonly revision: number
  readonly kind: ManagedContentKind
  readonly payload_json: string
  readonly content_hash: string
  readonly active: number
  readonly published_by: string
  readonly published_at: number
}

interface AuditRow {
  readonly id: string
  readonly actor_id: string
  readonly action: string
  readonly entity_type: string
  readonly entity_id: string
  readonly details_json: string
  readonly created_at: number
}

interface RuntimeBundleRow {
  readonly version: string
  readonly payload_json: string
  readonly release_versions_json: string
  readonly content_hash: string
  readonly active: number
  readonly created_at: number
}

export interface SqliteContentStoreOptions {
  readonly now?: () => number
  readonly idFactory?: () => string
}

const DRAFT_SELECT = `
  SELECT
    d.id,
    d.content_key,
    d.kind,
    d.title,
    d.status,
    d.current_revision,
    r.payload_json,
    r.content_hash,
    r.validation_json,
    d.created_by,
    d.created_at,
    d.updated_at
  FROM content_drafts d
  JOIN content_revisions r
    ON r.draft_id = d.id
   AND r.revision = d.current_revision
`

export class SqliteContentStore implements ContentStorePort {
  private readonly database: DatabaseSync
  private readonly now: () => number
  private readonly idFactory: () => string
  private closed = false

  constructor(databasePath: string, options: SqliteContentStoreOptions = {}) {
    if (databasePath !== ':memory:') mkdirSync(dirname(resolve(databasePath)), { recursive: true })
    this.database = new DatabaseSync(databasePath)
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomUUID
    this.database.exec('PRAGMA foreign_keys = ON')
    this.database.exec('PRAGMA journal_mode = WAL')
    this.database.exec('PRAGMA synchronous = FULL')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS content_drafts (
        id TEXT PRIMARY KEY,
        content_key TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('event', 'map', 'skin')),
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'in-review', 'approved', 'rejected', 'published')),
        current_revision INTEGER NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS content_revisions (
        draft_id TEXT NOT NULL REFERENCES content_drafts(id),
        revision INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        validation_json TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (draft_id, revision)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS content_reviews (
        id TEXT PRIMARY KEY,
        draft_id TEXT NOT NULL REFERENCES content_drafts(id),
        revision INTEGER NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
        reason TEXT,
        reviewer_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS content_releases (
        version TEXT PRIMARY KEY,
        content_key TEXT NOT NULL,
        draft_id TEXT NOT NULL REFERENCES content_drafts(id),
        revision INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('event', 'map', 'skin')),
        payload_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        active INTEGER NOT NULL CHECK (active IN (0, 1)),
        published_by TEXT NOT NULL,
        published_at INTEGER NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS content_releases_active_key
        ON content_releases(content_key)
        WHERE active = 1;

      CREATE TABLE IF NOT EXISTS runtime_content_bundles (
        version TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        release_versions_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        active INTEGER NOT NULL CHECK (active IN (0, 1)),
        created_at INTEGER NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX IF NOT EXISTS runtime_content_bundles_active
        ON runtime_content_bundles(active)
        WHERE active = 1;

      CREATE TABLE IF NOT EXISTS content_audit (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        details_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;
    `)
  }

  async listDrafts() {
    this.ensureOpen()
    const rows = this.database.prepare(`${DRAFT_SELECT} ORDER BY d.updated_at DESC`).all() as unknown as DraftRow[]
    return rows.map(toDraft)
  }

  async getDraft(id: string) {
    this.ensureOpen()
    return this.requireDraft(id)
  }

  async createDraft(
    input: {
      readonly kind: ManagedContentKind
      readonly title: string
      readonly content: unknown
    },
    actorId: string,
  ) {
    this.ensureOpen()
    const contentId = getManagedContentId(input.content)
    if (!contentId) {
      throw new ContentStoreError(400, 'content_id_required', '内容草稿必须提供稳定 id。')
    }
    const title = normalizedTitle(input.title)
    const id = this.idFactory()
    const timestamp = this.now()
    const validation = validateManagedContent(input.kind, input.content)
    const contentHash = hashJsonContent(input.content)
    const contentKey = `${input.kind}:${contentId}`

    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO content_drafts (
          id, content_key, kind, title, status, current_revision,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'draft', 1, ?, ?, ?)
      `).run(id, contentKey, input.kind, title, actorId, timestamp, timestamp)
      this.insertRevision(id, 1, input.content, contentHash, validation, actorId, timestamp)
      this.insertAudit(actorId, 'draft.created', 'draft', id, {
        contentKey,
        revision: 1,
        valid: validation.valid,
      }, timestamp)
    })
    return this.requireDraft(id)
  }

  async updateDraft(
    id: string,
    input: {
      readonly expectedRevision: number
      readonly title?: string
      readonly content: unknown
    },
    actorId: string,
  ) {
    this.ensureOpen()
    const draft = this.requireDraft(id)
    if (!['draft', 'rejected'].includes(draft.status)) {
      throw new ContentStoreError(409, 'invalid_draft_state', '只有草稿或已驳回内容可以继续修改。')
    }
    if (input.expectedRevision !== draft.currentRevision) {
      throw new ContentStoreError(409, 'revision_conflict', '草稿已被其他修订更新，请刷新后重试。')
    }
    const contentId = getManagedContentId(input.content)
    if (!contentId || `${draft.kind}:${contentId}` !== draft.contentKey) {
      throw new ContentStoreError(400, 'content_id_immutable', '草稿内容 id 不能在修订中改变。')
    }
    const revision = draft.currentRevision + 1
    const title = input.title === undefined ? draft.title : normalizedTitle(input.title)
    const timestamp = this.now()
    const validation = validateManagedContent(draft.kind, input.content)
    const contentHash = hashJsonContent(input.content)

    this.transaction(() => {
      this.insertRevision(id, revision, input.content, contentHash, validation, actorId, timestamp)
      this.database.prepare(`
        UPDATE content_drafts
        SET title = ?, status = 'draft', current_revision = ?, updated_at = ?
        WHERE id = ?
      `).run(title, revision, timestamp, id)
      this.insertAudit(actorId, 'draft.revised', 'draft', id, {
        revision,
        valid: validation.valid,
      }, timestamp)
    })
    return this.requireDraft(id)
  }

  async deleteDraft(id: string, actorId: string) {
    this.ensureOpen()
    const draft = this.requireDraft(id)
    if (!['draft', 'rejected'].includes(draft.status)) {
      throw new ContentStoreError(409, 'invalid_draft_state', '只有草稿或已驳回内容可以删除。')
    }
    const timestamp = this.now()
    this.transaction(() => {
      this.database.prepare('DELETE FROM content_reviews WHERE draft_id = ?').run(id)
      this.database.prepare('DELETE FROM content_revisions WHERE draft_id = ?').run(id)
      this.database.prepare('DELETE FROM content_drafts WHERE id = ?').run(id)
      this.insertAudit(actorId, 'draft.deleted', 'draft', id, {
        contentKey: draft.contentKey,
        revision: draft.currentRevision,
        status: draft.status,
      }, timestamp)
    })
  }

  async submitDraft(id: string, actorId: string) {
    this.ensureOpen()
    const draft = this.requireDraft(id)
    if (!['draft', 'rejected'].includes(draft.status)) {
      throw new ContentStoreError(409, 'invalid_draft_state', '当前状态不能提交审核。')
    }
    if (!draft.validation.valid) {
      throw new ContentStoreError(409, 'validation_failed', '自动校验未通过，不能提交审核。')
    }
    const timestamp = this.now()
    this.transaction(() => {
      this.database.prepare(`
        UPDATE content_drafts SET status = 'in-review', updated_at = ? WHERE id = ?
      `).run(timestamp, id)
      this.insertAudit(actorId, 'draft.submitted', 'draft', id, {
        revision: draft.currentRevision,
      }, timestamp)
    })
    return this.requireDraft(id)
  }

  async reviewDraft(
    id: string,
    decision: 'approve' | 'reject',
    reason: string | undefined,
    actorId: string,
  ) {
    this.ensureOpen()
    const draft = this.requireDraft(id)
    if (draft.status !== 'in-review') {
      throw new ContentStoreError(409, 'invalid_draft_state', '只有待审核内容可以执行审核。')
    }
    const normalizedReason = reason?.trim()
    if (decision === 'reject' && !normalizedReason) {
      throw new ContentStoreError(400, 'review_reason_required', '驳回内容时必须填写原因。')
    }
    const status: ContentDraftStatus = decision === 'approve' ? 'approved' : 'rejected'
    const timestamp = this.now()
    this.transaction(() => {
      this.database.prepare(`
        INSERT INTO content_reviews (
          id, draft_id, revision, decision, reason, reviewer_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        this.idFactory(),
        id,
        draft.currentRevision,
        decision,
        normalizedReason ?? null,
        actorId,
        timestamp,
      )
      this.database.prepare(`
        UPDATE content_drafts SET status = ?, updated_at = ? WHERE id = ?
      `).run(status, timestamp, id)
      this.insertAudit(actorId, `draft.${decision === 'approve' ? 'approved' : 'rejected'}`, 'draft', id, {
        revision: draft.currentRevision,
        ...(normalizedReason ? { reason: normalizedReason } : {}),
      }, timestamp)
    })
    return this.requireDraft(id)
  }

  async publishDraft(id: string, actorId: string) {
    this.ensureOpen()
    const draft = this.requireDraft(id)
    if (draft.status !== 'approved') {
      throw new ContentStoreError(409, 'invalid_draft_state', '只有审核通过的内容可以发布。')
    }
    const compiled = compileManagedContent(draft.kind, draft.content)
    const timestamp = this.now()
    const version = `${draft.kind}-${timestamp}-${compiled.hash.slice(0, 12)}-${this.idFactory().slice(0, 8)}`
    this.transaction(() => {
      this.database.prepare(`
        UPDATE content_releases SET active = 0 WHERE content_key = ? AND active = 1
      `).run(draft.contentKey)
      this.database.prepare(`
        INSERT INTO content_releases (
          version, content_key, draft_id, revision, kind, payload_json,
          content_hash, active, published_by, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      `).run(
        version,
        draft.contentKey,
        draft.id,
        draft.currentRevision,
        draft.kind,
        compiled.canonicalJson,
        compiled.hash,
        actorId,
        timestamp,
      )
      this.database.prepare(`
        UPDATE content_drafts SET status = 'published', updated_at = ? WHERE id = ?
      `).run(timestamp, draft.id)
      this.activateRuntimeBundle(timestamp)
      this.insertAudit(actorId, 'release.published', 'release', version, {
        draftId: draft.id,
        contentKey: draft.contentKey,
        revision: draft.currentRevision,
        hash: compiled.hash,
      }, timestamp)
    })
    return this.requireRelease(version)
  }

  async listReleases() {
    this.ensureOpen()
    const rows = this.database.prepare(`
      SELECT * FROM content_releases ORDER BY published_at DESC, version DESC
    `).all() as unknown as ReleaseRow[]
    return rows.map(toRelease)
  }

  async rollbackRelease(version: string, actorId: string) {
    this.ensureOpen()
    const release = this.requireRelease(version)
    const timestamp = this.now()
    this.transaction(() => {
      this.database.prepare(`
        UPDATE content_releases SET active = 0 WHERE content_key = ? AND active = 1
      `).run(release.contentKey)
      this.database.prepare(`
        UPDATE content_releases SET active = 1 WHERE version = ?
      `).run(version)
      this.activateRuntimeBundle(timestamp)
      this.insertAudit(actorId, 'release.rolled-back', 'release', version, {
        contentKey: release.contentKey,
        draftId: release.draftId,
        revision: release.revision,
      }, timestamp)
    })
    return this.requireRelease(version)
  }

  async getCurrentRuntimeBundle() {
    this.ensureOpen()
    const row = this.database.prepare(`
      SELECT * FROM runtime_content_bundles WHERE active = 1
    `).get() as unknown as RuntimeBundleRow | undefined
    if (row) return toRuntimeBundle(row)
    const activeReleaseCount = Number((this.database.prepare(`
      SELECT COUNT(*) AS count FROM content_releases WHERE active = 1
    `).get() as { count: number }).count)
    return activeReleaseCount > 0
      ? this.transaction(() => this.activateRuntimeBundle(this.now()))
      : builtInRuntimeContentBundle()
  }

  async getRuntimeBundle(version: string) {
    this.ensureOpen()
    const builtIn = builtInRuntimeContentBundle()
    if (version === builtIn.version) return builtIn
    const row = this.database.prepare(`
      SELECT * FROM runtime_content_bundles WHERE version = ?
    `).get(version) as unknown as RuntimeBundleRow | undefined
    if (!row) throw new ContentStoreError(404, 'runtime_bundle_not_found', '运行时内容版本不存在。')
    return toRuntimeBundle(row)
  }

  async listAudit(limit = 100) {
    this.ensureOpen()
    const boundedLimit = Math.max(1, Math.min(500, Math.floor(limit)))
    const rows = this.database.prepare(`
      SELECT * FROM content_audit ORDER BY created_at DESC, id DESC LIMIT ?
    `).all(boundedLimit) as unknown as AuditRow[]
    return rows.map(toAudit)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.database.close()
  }

  private requireDraft(id: string) {
    const row = this.database.prepare(`${DRAFT_SELECT} WHERE d.id = ?`).get(id) as unknown as DraftRow | undefined
    if (!row) throw new ContentStoreError(404, 'draft_not_found', '内容草稿不存在。')
    return toDraft(row)
  }

  private requireRelease(version: string) {
    const row = this.database.prepare(`
      SELECT * FROM content_releases WHERE version = ?
    `).get(version) as unknown as ReleaseRow | undefined
    if (!row) throw new ContentStoreError(404, 'release_not_found', '内容版本不存在。')
    return toRelease(row)
  }

  private activateRuntimeBundle(timestamp: number) {
    const rows = this.database.prepare(`
      SELECT * FROM content_releases WHERE active = 1 ORDER BY content_key, version
    `).all() as unknown as ReleaseRow[]
    const releases: RuntimeContentRelease[] = rows.map((row) => ({
      version: row.version,
      contentKey: row.content_key,
      contentHash: row.content_hash,
      kind: row.kind,
      content: JSON.parse(row.payload_json) as unknown,
    }))
    const contentHash = hashJsonContent(releases.map((release) => ({
      version: release.version,
      contentHash: release.contentHash,
    })))
    const version = `content-${contentHash.slice(0, 20)}`
    const bundle = composeRuntimeContentBundle(version, releases)
    this.database.prepare(`UPDATE runtime_content_bundles SET active = 0 WHERE active = 1`).run()
    this.database.prepare(`
      INSERT OR IGNORE INTO runtime_content_bundles (
        version, payload_json, release_versions_json, content_hash, active, created_at
      ) VALUES (?, ?, ?, ?, 0, ?)
    `).run(
      version,
      JSON.stringify(bundle),
      JSON.stringify(bundle.releaseVersions),
      contentHash,
      timestamp,
    )
    this.database.prepare(`UPDATE runtime_content_bundles SET active = 1 WHERE version = ?`).run(version)
    return bundle
  }

  private insertRevision(
    draftId: string,
    revision: number,
    content: unknown,
    contentHash: string,
    validation: ContentValidationResult,
    actorId: string,
    timestamp: number,
  ) {
    this.database.prepare(`
      INSERT INTO content_revisions (
        draft_id, revision, payload_json, content_hash,
        validation_json, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      draftId,
      revision,
      JSON.stringify(content),
      contentHash,
      JSON.stringify(validation),
      actorId,
      timestamp,
    )
  }

  private insertAudit(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    details: unknown,
    timestamp: number,
  ) {
    this.database.prepare(`
      INSERT INTO content_audit (
        id, actor_id, action, entity_type, entity_id, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.idFactory(),
      actorId,
      action,
      entityType,
      entityId,
      JSON.stringify(details),
      timestamp,
    )
  }

  private transaction<T>(operation: () => T) {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  private ensureOpen() {
    if (this.closed) throw new Error('Content persistence is closed.')
  }
}

function normalizedTitle(title: string) {
  const normalized = title.trim()
  if (normalized.length === 0 || normalized.length > 160) {
    throw new ContentStoreError(400, 'invalid_title', '草稿标题长度必须为 1 至 160 个字符。')
  }
  return normalized
}

function toDraft(row: DraftRow): ContentDraft {
  return {
    id: row.id,
    contentKey: row.content_key,
    kind: row.kind,
    title: row.title,
    status: row.status,
    currentRevision: row.current_revision,
    content: JSON.parse(row.payload_json) as unknown,
    contentHash: row.content_hash,
    validation: JSON.parse(row.validation_json) as ContentValidationResult,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function toRelease(row: ReleaseRow): ContentRelease {
  return {
    version: row.version,
    contentKey: row.content_key,
    draftId: row.draft_id,
    revision: row.revision,
    kind: row.kind,
    content: JSON.parse(row.payload_json) as unknown,
    contentHash: row.content_hash,
    active: row.active === 1,
    publishedBy: row.published_by,
    publishedAt: row.published_at,
  }
}

function toRuntimeBundle(row: RuntimeBundleRow): RuntimeContentBundle {
  const bundle = JSON.parse(row.payload_json) as RuntimeContentBundle
  if (bundle.version !== row.version) throw new Error(`Runtime content bundle ${row.version} has an invalid payload.`)
  return bundle
}

function toAudit(row: AuditRow): ContentAuditEntry {
  return {
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    details: JSON.parse(row.details_json) as unknown,
    createdAt: row.created_at,
  }
}
