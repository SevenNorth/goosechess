import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createAccountRecord,
  InMemoryAccountRepository,
  type Role,
} from '../src/auth.js'
import { createContentServer } from '../src/server.js'

function account(id: string, username: string, role: Role) {
  return createAccountRecord({
    id,
    username,
    displayName: username,
    role,
    password: 'correct horse battery',
  })
}

function eventContent(title = 'Harbor bell') {
  return {
    id: 'managed-harbor-bell',
    title,
    flavor: 'The bell rings across the harbor.',
    kind: '常规事件',
    effect: [{ type: 'extra-turn' }],
    successText: 'Take another turn.',
    accent: 'teal',
    aiValue: 8,
  }
}

describe('content lifecycle API', () => {
  let server: ReturnType<typeof createContentServer>
  let baseUrl = ''
  let nextPort = 19088

  beforeEach(async () => {
    server = createContentServer({
      accounts: new InMemoryAccountRepository([
        account('player-1', 'player', 'player'),
        account('editor-1', 'editor', 'content-editor'),
        account('admin-1', 'admin', 'admin'),
      ]),
      port: nextPort++,
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

  async function login(username: string) {
    const response = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password: 'correct horse battery' }),
    })
    expect(response.status).toBe(200)
    return response.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
  }

  async function createDraft(cookie: string, content = eventContent()) {
    return request('/admin/drafts', {
      method: 'POST',
      headers: { Cookie: cookie },
      body: JSON.stringify({
        kind: 'event',
        title: content.title,
        content,
      }),
    })
  }

  it('rejects unauthenticated users and player accounts on every management write', async () => {
    const unauthenticated = await createDraft('')
    expect(unauthenticated.status).toBe(401)

    const playerCookie = await login('player')
    const forbidden = await createDraft(playerCookie)
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toMatchObject({ code: 'forbidden' })
  })

  it('stores invalid drafts but blocks review submission until a valid revision exists', async () => {
    const editorCookie = await login('editor')
    const invalidContent = {
      ...eventContent(),
      effect: [],
    }
    const createdResponse = await createDraft(editorCookie, invalidContent)
    expect(createdResponse.status).toBe(201)
    const created = (await createdResponse.json()) as {
      draft: { id: string; currentRevision: number; validation: { valid: boolean } }
    }
    expect(created.draft.currentRevision).toBe(1)
    expect(created.draft.validation.valid).toBe(false)

    const blocked = await request(`/admin/drafts/${created.draft.id}/submit`, {
      method: 'POST',
      headers: { Cookie: editorCookie },
    })
    expect(blocked.status).toBe(409)
    expect(await blocked.json()).toMatchObject({ code: 'validation_failed' })

    const updated = await request(`/admin/drafts/${created.draft.id}`, {
      method: 'PUT',
      headers: { Cookie: editorCookie },
      body: JSON.stringify({
        expectedRevision: 1,
        content: eventContent('Corrected harbor bell'),
      }),
    })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({
      draft: {
        currentRevision: 2,
        validation: { valid: true },
      },
    })

    const staleUpdate = await request(`/admin/drafts/${created.draft.id}`, {
      method: 'PUT',
      headers: { Cookie: editorCookie },
      body: JSON.stringify({
        expectedRevision: 1,
        content: eventContent('Stale write'),
      }),
    })
    expect(staleUpdate.status).toBe(409)
    expect(await staleUpdate.json()).toMatchObject({ code: 'revision_conflict' })
  })

  it('reviews, publishes, supersedes, rolls back, and audits immutable releases', async () => {
    const editorCookie = await login('editor')
    const adminCookie = await login('admin')

    const firstCreated = await createDraft(editorCookie, eventContent('Version one'))
    const firstDraft = (await firstCreated.json()) as { draft: { id: string } }
    await request(`/admin/drafts/${firstDraft.draft.id}/submit`, {
      method: 'POST',
      headers: { Cookie: editorCookie },
    })

    const editorReview = await request(`/admin/drafts/${firstDraft.draft.id}/review`, {
      method: 'POST',
      headers: { Cookie: editorCookie },
      body: JSON.stringify({ decision: 'approve' }),
    })
    expect(editorReview.status).toBe(403)

    const firstApproval = await request(`/admin/drafts/${firstDraft.draft.id}/review`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: JSON.stringify({ decision: 'approve' }),
    })
    expect(firstApproval.status).toBe(200)

    const firstPublished = await request(`/admin/drafts/${firstDraft.draft.id}/publish`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    })
    expect(firstPublished.status).toBe(201)
    const firstRelease = (await firstPublished.json()) as {
      release: { version: string; active: boolean; contentHash: string }
    }
    expect(firstRelease.release.active).toBe(true)
    expect(firstRelease.release.contentHash).toMatch(/^[a-f0-9]{64}$/)

    const secondCreated = await createDraft(editorCookie, eventContent('Version two'))
    const secondDraft = (await secondCreated.json()) as { draft: { id: string } }
    await request(`/admin/drafts/${secondDraft.draft.id}/submit`, {
      method: 'POST',
      headers: { Cookie: editorCookie },
    })
    await request(`/admin/drafts/${secondDraft.draft.id}/review`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: JSON.stringify({ decision: 'approve' }),
    })
    const secondPublished = await request(`/admin/drafts/${secondDraft.draft.id}/publish`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    })
    const secondRelease = (await secondPublished.json()) as {
      release: { version: string }
    }

    const releasesBeforeRollback = await request('/admin/releases', {
      headers: { Cookie: editorCookie },
    })
    const beforeBody = (await releasesBeforeRollback.json()) as {
      releases: Array<{ version: string; active: boolean }>
    }
    expect(beforeBody.releases.find((entry) => entry.version === firstRelease.release.version)?.active).toBe(false)
    expect(beforeBody.releases.find((entry) => entry.version === secondRelease.release.version)?.active).toBe(true)

    const rollback = await request(
      `/admin/releases/${encodeURIComponent(firstRelease.release.version)}/rollback`,
      {
        method: 'POST',
        headers: { Cookie: adminCookie },
      },
    )
    expect(rollback.status).toBe(200)
    expect(await rollback.json()).toMatchObject({
      release: {
        version: firstRelease.release.version,
        active: true,
      },
    })

    const auditResponse = await request('/admin/audit?limit=100', {
      headers: { Cookie: adminCookie },
    })
    expect(auditResponse.status).toBe(200)
    const audit = (await auditResponse.json()) as {
      audit: Array<{ action: string; actorId: string; details: unknown }>
    }
    expect(audit.audit.map((entry) => entry.action)).toEqual(expect.arrayContaining([
      'draft.created',
      'draft.submitted',
      'draft.approved',
      'release.published',
      'release.rolled-back',
    ]))
    expect(audit.audit.filter((entry) => entry.action.startsWith('release.')).every(
      (entry) => entry.actorId === 'admin-1',
    )).toBe(true)
    expect(JSON.stringify(audit)).not.toContain('correct horse battery')
  })
})