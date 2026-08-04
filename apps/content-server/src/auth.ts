import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const ROLES = ['player', 'content-editor', 'admin'] as const
export type Role = (typeof ROLES)[number]

export interface AccountRecord {
  readonly id: string
  readonly username: string
  readonly displayName: string
  readonly role: Role
  readonly passwordHash: string
}

export interface PublicAccount {
  readonly id: string
  readonly username: string
  readonly displayName: string
  readonly role: Role
}

export interface AccountRepository {
  findByUsername(username: string): Promise<AccountRecord | null>
  findById(id: string): Promise<AccountRecord | null>
  upsert(account: AccountRecord): Promise<void>
  close?(): Promise<void> | void
}

export interface SessionRecord {
  readonly accountId: string
  readonly expiresAt: number
}

export interface SessionStoreOptions {
  readonly now?: () => number
  readonly ttlMs?: number
  readonly secret?: string
}

const PASSWORD_KEY_LENGTH = 32
const PASSWORD_SALT_LENGTH = 16
const PASSWORD_MIN_LENGTH = 8
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1_000

function normalizeUsername(username: string) {
  return username.trim().toLowerCase()
}

function assertAccountField(value: string, field: string) {
  if (value.trim().length === 0 || value.length > 120) throw new Error(`Invalid account ${field}.`)
}

function parseRole(value: string): Role {
  if ((ROLES as readonly string[]).includes(value)) return value as Role
  throw new Error('Invalid account role.')
}

export function createPasswordHash(password: string, salt = randomBytes(PASSWORD_SALT_LENGTH)) {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`Password must contain at least ${PASSWORD_MIN_LENGTH} characters.`)
  }
  const key = scryptSync(password, salt, PASSWORD_KEY_LENGTH)
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`
}

export function verifyPassword(password: string, encoded: string) {
  if (password.length === 0) return false
  const parts = encoded.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  try {
    const salt = Buffer.from(parts[1], 'base64url')
    const expected = Buffer.from(parts[2], 'base64url')
    const actual = scryptSync(password, salt, expected.length)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function createAccountRecord(input: {
  readonly id: string
  readonly username: string
  readonly displayName: string
  readonly role: Role
  readonly password: string
}): AccountRecord {
  assertAccountField(input.id, 'id')
  assertAccountField(input.displayName, 'displayName')
  const username = normalizeUsername(input.username)
  assertAccountField(username, 'username')
  parseRole(input.role)
  return {
    id: input.id,
    username,
    displayName: input.displayName.trim(),
    role: input.role,
    passwordHash: createPasswordHash(input.password),
  }
}

export function toPublicAccount(account: AccountRecord): PublicAccount {
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    role: account.role,
  }
}

export class InMemoryAccountRepository implements AccountRepository {
  private readonly byId = new Map<string, AccountRecord>()
  private readonly byUsername = new Map<string, AccountRecord>()

  constructor(accounts: readonly AccountRecord[] = []) {
    for (const account of accounts) this.upsertSync(account)
  }

  findByUsername(username: string) {
    return Promise.resolve(this.byUsername.get(normalizeUsername(username)) ?? null)
  }

  findById(id: string) {
    return Promise.resolve(this.byId.get(id) ?? null)
  }

  upsert(account: AccountRecord) {
    this.upsertSync(account)
    return Promise.resolve()
  }

  private upsertSync(account: AccountRecord) {
    const existingById = this.byId.get(account.id)
    const existingByUsername = this.byUsername.get(account.username)
    if (existingById && existingById.username !== account.username) {
      this.byUsername.delete(existingById.username)
    }
    if (existingByUsername && existingByUsername.id !== account.id) {
      this.byId.delete(existingByUsername.id)
    }
    this.byId.set(account.id, account)
    this.byUsername.set(account.username, account)
  }
}

interface StoredAccountRow {
  readonly id: string
  readonly username: string
  readonly display_name: string
  readonly role: string
  readonly password_hash: string
}

export class SqliteAccountRepository implements AccountRepository {
  private readonly database: DatabaseSync
  private readonly findByUsernameStatement
  private readonly findByIdStatement
  private readonly upsertStatement
  private closed = false

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') mkdirSync(dirname(resolve(databasePath)), { recursive: true })
    this.database = new DatabaseSync(databasePath)
    this.database.exec('PRAGMA journal_mode = WAL')
    this.database.exec('PRAGMA synchronous = FULL')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('player', 'content-editor', 'admin')),
        password_hash TEXT NOT NULL
      ) STRICT
    `)
    this.findByUsernameStatement = this.database.prepare(
      'SELECT id, username, display_name, role, password_hash FROM accounts WHERE username = ?',
    )
    this.findByIdStatement = this.database.prepare(
      'SELECT id, username, display_name, role, password_hash FROM accounts WHERE id = ?',
    )
    this.upsertStatement = this.database.prepare(`
      INSERT INTO accounts (id, username, display_name, role, password_hash)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        display_name = excluded.display_name,
        role = excluded.role,
        password_hash = excluded.password_hash
    `)
  }

  async findByUsername(username: string) {
    this.ensureOpen()
    const row = this.findByUsernameStatement.get(normalizeUsername(username)) as unknown as
      | StoredAccountRow
      | undefined
    return row ? toAccountRecord(row) : null
  }

  async findById(id: string) {
    this.ensureOpen()
    const row = this.findByIdStatement.get(id) as unknown as StoredAccountRow | undefined
    return row ? toAccountRecord(row) : null
  }

  async upsert(account: AccountRecord) {
    this.ensureOpen()
    this.upsertStatement.run(
      account.id,
      account.username,
      account.displayName,
      account.role,
      account.passwordHash,
    )
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.database.close()
  }

  private ensureOpen() {
    if (this.closed) throw new Error('Account persistence is closed.')
  }
}

function toAccountRecord(row: StoredAccountRow): AccountRecord {
  return {
    id: row.id,
    username: normalizeUsername(row.username),
    displayName: row.display_name,
    role: parseRole(row.role),
    passwordHash: row.password_hash,
  }
}

export class SessionStore {
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly secret: Buffer
  private readonly sessions = new Map<string, SessionRecord>()

  constructor(options: SessionStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_TTL_MS
    if (!Number.isFinite(this.ttlMs) || this.ttlMs < 60_000) {
      throw new Error('Session TTL must be at least one minute.')
    }
    this.secret = options.secret ? Buffer.from(options.secret, 'utf8') : randomBytes(32)
    if (this.secret.length < 16) throw new Error('Session secret must contain at least 16 bytes.')
  }

  create(accountId: string) {
    this.prune()
    const id = randomBytes(32).toString('base64url')
    const expiresAt = this.now() + this.ttlMs
    this.sessions.set(id, { accountId, expiresAt })
    return { token: `${id}.${this.sign(id)}`, expiresAt }
  }

  resolve(token: string | undefined): SessionRecord | null {
    if (!token || token.length > 512) return null
    const separator = token.lastIndexOf('.')
    if (separator <= 0) return null
    const id = token.slice(0, separator)
    const signature = token.slice(separator + 1)
    if (!this.isValidSignature(id, signature)) return null
    const session = this.sessions.get(id)
    if (!session || session.expiresAt <= this.now()) {
      this.sessions.delete(id)
      return null
    }
    return session
  }

  revoke(token: string | undefined) {
    if (!token) return
    const separator = token.lastIndexOf('.')
    if (separator > 0) this.sessions.delete(token.slice(0, separator))
  }

  get ttl() {
    return this.ttlMs
  }

  private sign(id: string) {
    return createHmac('sha256', this.secret).update(id).digest('base64url')
  }

  private isValidSignature(id: string, signature: string) {
    try {
      const actual = Buffer.from(signature, 'base64url')
      const expected = Buffer.from(this.sign(id), 'base64url')
      return actual.length === expected.length && timingSafeEqual(actual, expected)
    } catch {
      return false
    }
  }

  private prune() {
    const now = this.now()
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(id)
    }
  }
}

export function hasRole(role: Role, allowedRoles: readonly Role[]) {
  return allowedRoles.includes(role)
}