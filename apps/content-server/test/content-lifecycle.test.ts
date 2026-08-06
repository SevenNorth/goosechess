import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createAccountRecord,
  InMemoryAccountRepository,
  type Role,
} from '../src/auth.js'
import { createContentServer } from '../src/server.js'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  let assetDirectory = ''

  beforeEach(async () => {
    assetDirectory = await mkdtemp(join(tmpdir(), 'goose-content-assets-'))
    server = createContentServer({
      accounts: new InMemoryAccountRepository([
        account('player-1', 'player', 'player'),
        account('editor-1', 'editor', 'content-editor'),
        account('admin-1', 'admin', 'admin'),
      ]),
      port: nextPort++,
      assetDirectory,
    })
    const address = await server.listen()
    baseUrl = `http://${address.host}:${address.port}`
  })

  afterEach(async () => {
    await server.close()
    await rm(assetDirectory, { recursive: true, force: true })
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

  it('uploads authenticated image assets and serves immutable content URLs', async () => {
    const editorCookie = await login('editor')
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

    const unauthenticated = await request('/admin/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: png,
    })
    expect(unauthenticated.status).toBe(401)

    const uploaded = await request('/admin/assets', {
      method: 'POST',
      headers: { Cookie: editorCookie, 'Content-Type': 'image/png' },
      body: png,
    })
    expect(uploaded.status).toBe(201)
    const body = await uploaded.json() as { asset: { url: string; size: number } }
    expect(body.asset.url).toMatch(/^\/content-assets\/[a-f0-9]{64}\.png$/)
    expect(body.asset.size).toBe(png.length)

    const served = await request(body.asset.url)
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await served.arrayBuffer())).toEqual(png)
    expect(await readFile(join(assetDirectory, body.asset.url.split('/').at(-1)!))).toEqual(png)

    const invalid = await request('/admin/assets', {
      method: 'POST',
      headers: { Cookie: editorCookie, 'Content-Type': 'image/png' },
      body: Buffer.from('not an image'),
    })
    expect(invalid.status).toBe(400)
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

  it('deletes only editable drafts and records the deletion audit', async () => {
    const editorCookie = await login('editor')
    const adminCookie = await login('admin')
    const createdResponse = await createDraft(editorCookie)
    const created = (await createdResponse.json()) as { draft: { id: string } }

    const deleted = await request(`/admin/drafts/${created.draft.id}`, {
      method: 'DELETE',
      headers: { Cookie: editorCookie },
    })
    expect(deleted.status).toBe(204)
    expect((await request(`/admin/drafts/${created.draft.id}`, {
      headers: { Cookie: editorCookie },
    })).status).toBe(404)

    const submittedResponse = await createDraft(editorCookie, { ...eventContent(), id: 'submitted-event' })
    const submitted = (await submittedResponse.json()) as { draft: { id: string } }
    await request(`/admin/drafts/${submitted.draft.id}/submit`, { method: 'POST', headers: { Cookie: editorCookie } })
    const blocked = await request(`/admin/drafts/${submitted.draft.id}`, {
      method: 'DELETE',
      headers: { Cookie: editorCookie },
    })
    expect(blocked.status).toBe(409)

    const audit = await request('/admin/audit?limit=100', { headers: { Cookie: adminCookie } })
    expect(await audit.json()).toMatchObject({
      audit: expect.arrayContaining([expect.objectContaining({ action: 'draft.deleted', entityId: created.draft.id })]),
    })
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
    const firstRuntimeResponse = await request('/runtime/content/current')
    expect(firstRuntimeResponse.status).toBe(200)
    const firstRuntime = (await firstRuntimeResponse.json()) as {
      bundle: { version: string; releaseVersions: string[]; definitions: Array<{ definition: { events: Array<{ id: string; title: string }> } }> }
    }
    expect(firstRuntime.bundle.releaseVersions).toEqual([firstRelease.release.version])
    expect(firstRuntime.bundle.definitions[0].definition.events.find((event) => event.id === 'managed-harbor-bell')?.title).toBe('Version one')

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
    const secondRuntime = (await (await request('/runtime/content/current')).json()) as { bundle: { version: string } }
    expect(secondRuntime.bundle.version).not.toBe(firstRuntime.bundle.version)
    const historical = await request(`/runtime/content/${encodeURIComponent(firstRuntime.bundle.version)}`)
    expect(historical.status).toBe(200)
    expect(await historical.json()).toMatchObject({ bundle: { version: firstRuntime.bundle.version } })

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
    expect(await (await request('/runtime/content/current')).json()).toMatchObject({
      bundle: { version: firstRuntime.bundle.version },
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
