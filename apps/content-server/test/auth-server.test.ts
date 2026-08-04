import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createAccountRecord,
  InMemoryAccountRepository,
  SessionStore,
  SqliteAccountRepository,
  type Role,
  verifyPassword,
} from '../src/auth.js'
import { createContentServer } from '../src/server.js'

function account(
  id: string,
  username: string,
  role: Role,
  password = 'correct horse battery',
) {
  return createAccountRecord({
    id,
    username,
    displayName: username,
    role,
    password,
  })
}

function cookiesFrom(response: Response) {
  const setCookie = response.headers.get('set-cookie')
  expect(setCookie).toMatch(/goose_session=/)
  return {
    setCookie: setCookie ?? '',
    cookie: setCookie?.split(';', 1)[0] ?? '',
  }
}

describe('content server authentication and RBAC', () => {
  let server: ReturnType<typeof createContentServer>
  let baseUrl = ''

  beforeEach(async () => {
    const accounts = new InMemoryAccountRepository([
      account('player-1', 'player', 'player'),
      account('editor-1', 'editor', 'content-editor'),
      account('admin-1', 'admin', 'admin'),
    ])
    server = createContentServer({
      accounts,
      port: 0,
      cookieSecure: true,
      allowedOrigin: 'https://admin.example.test',
    })
    const address = await server.listen()
    baseUrl = `http://${address.host}:${address.port}`
  })

  afterEach(async () => {
    await server.close()
  })

  async function request(path: string, init: RequestInit = {}) {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  }

  async function login(username: string, password = 'correct horse battery') {
    const response = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    return { response, ...cookiesFrom(response) }
  }

  it('hashes passwords and verifies only the original secret', () => {
    const record = account('hash-test', 'hash-test', 'player')
    expect(record.passwordHash).not.toContain('correct horse battery')
    expect(verifyPassword('correct horse battery', record.passwordHash)).toBe(true)
    expect(verifyPassword('wrong password', record.passwordHash)).toBe(false)
  })

  it('creates a session cookie and returns the public account without credentials', async () => {
    const { response, setCookie } = await login('EDITOR')
    expect(response.status).toBe(200)
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Lax')
    const body = (await response.json()) as {
      user: Record<string, unknown>
      expiresAt: number
    }
    expect(body.user).toEqual({
      id: 'editor-1',
      username: 'editor',
      displayName: 'editor',
      role: 'content-editor',
    })
    expect(body.user).not.toHaveProperty('passwordHash')
    expect(body.expiresAt).toBeGreaterThan(Date.now())
  })

  it('rejects missing and invalid credentials without revealing account state', async () => {
    const missing = await request('/admin/me')
    expect(missing.status).toBe(401)
    expect(await missing.json()).toMatchObject({ code: 'unauthenticated' })

    const invalid = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'unknown', password: 'wrong password' }),
    })
    expect(invalid.status).toBe(401)
    expect(await invalid.json()).toMatchObject({ code: 'invalid_credentials' })
  })

  it('enforces roles on the server and exposes role-specific permissions', async () => {
    const player = await login('player')
    const playerAccess = await request('/admin/me', {
      headers: { Cookie: player.cookie },
    })
    expect(playerAccess.status).toBe(403)

    const editor = await login('editor')
    const editorAccess = await request('/admin/me', {
      headers: { Cookie: editor.cookie },
    })
    expect(editorAccess.status).toBe(200)
    expect(await editorAccess.json()).toMatchObject({
      user: { role: 'content-editor' },
      permissions: ['content:edit', 'content:preview'],
    })

    const admin = await login('admin')
    const adminAccess = await request('/admin/me', {
      headers: { Cookie: admin.cookie },
    })
    expect(adminAccess.status).toBe(200)
    expect(await adminAccess.json()).toMatchObject({
      user: { role: 'admin' },
      permissions: [
        'content:edit',
        'content:review',
        'content:publish',
        'content:rollback',
      ],
    })
  })

  it('supports session lookup, logout revocation, and CORS preflight', async () => {
    const { cookie } = await login('editor')
    const session = await request('/auth/session', {
      headers: { Cookie: cookie },
    })
    expect(session.status).toBe(200)
    expect(await session.json()).toMatchObject({
      user: { username: 'editor' },
    })

    const preflight = await request('/auth/session', {
      method: 'OPTIONS',
      headers: { Origin: 'https://admin.example.test' },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe(
      'https://admin.example.test',
    )
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true')

    const logout = await request('/auth/logout', {
      method: 'POST',
      headers: { Cookie: cookie },
    })
    expect(logout.status).toBe(204)
    const afterLogout = await request('/auth/session', {
      headers: { Cookie: cookie },
    })
    expect(afterLogout.status).toBe(401)
  })

  it('persists account roles and password hashes in SQLite', async () => {
    const repository = new SqliteAccountRepository(':memory:')
    try {
      const record = account('sqlite-admin', 'sqlite-admin', 'admin')
      await repository.upsert(record)
      expect(await repository.findByUsername('SQLITE-ADMIN')).toEqual(record)
      expect(await repository.findById('sqlite-admin')).toEqual(record)
    } finally {
      repository.close()
    }
  })

  it('rejects tampered and expired session tokens', () => {
    let now = 1_000
    const sessions = new SessionStore({
      now: () => now,
      ttlMs: 60_000,
      secret: '0123456789abcdef',
    })
    const created = sessions.create('editor-1')
    expect(sessions.resolve(created.token)).toEqual({
      accountId: 'editor-1',
      expiresAt: created.expiresAt,
    })
    expect(sessions.resolve(created.token + 'x')).toBeNull()
    now = created.expiresAt
    expect(sessions.resolve(created.token)).toBeNull()
  })
})