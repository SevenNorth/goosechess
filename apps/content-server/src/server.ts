import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  MANAGED_CONTENT_KINDS,
  type ManagedContentKind,
} from '@goose-chess/content-tools'
import {
  type AccountRepository,
  InMemoryAccountRepository,
  type PublicAccount,
  type Role,
  SessionStore,
  hasRole,
  toPublicAccount,
  verifyPassword,
} from './auth.js'
import {
  ContentStoreError,
  type ContentStorePort,
  SqliteContentStore,
} from './content-store.js'

const JSON_LIMIT = 1024 * 1024
const ASSET_LIMIT = 5 * 1024 * 1024
const SESSION_COOKIE = 'goose_session'
const IMAGE_EXTENSIONS = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
])

function matchesImageType(body: Buffer, contentType: string) {
  if (contentType === 'image/png') return body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (contentType === 'image/jpeg') return body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff
  return body.length >= 12 && body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP'
}

export interface ContentServerOptions {
  readonly host?: string
  readonly port?: number
  readonly accounts?: AccountRepository
  readonly sessions?: SessionStore
  readonly contentStore?: ContentStorePort
  readonly cookieSecure?: boolean
  readonly allowedOrigin?: string
  readonly assetDirectory?: string
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  })
  response.end(JSON.stringify(body))
}

function sendEmpty(response: ServerResponse, status: number, headers: Record<string, string> = {}) {
  response.writeHead(status, headers)
  response.end()
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    length += buffer.length
    if (length > JSON_LIMIT) {
      throw new HttpError(413, 'payload_too_large', '请求内容过大。')
    }
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new HttpError(400, 'invalid_request', '请求格式无效。')
  }
}

async function readBody(request: IncomingMessage, limit: number) {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    length += buffer.length
    if (length > limit) throw new HttpError(413, 'payload_too_large', '图片不能超过 5 MB。')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

function requestRecord(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_request', '请求格式无效。')
  }
  return body as Record<string, unknown>
}

function parseCookies(header: string | undefined) {
  const cookies = new Map<string, string>()
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const name = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    try {
      cookies.set(name, decodeURIComponent(value))
    } catch {
      continue
    }
  }
  return cookies
}

function sessionCookie(token: string, secure: boolean, ttlMs: number) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=${Math.floor(ttlMs / 1_000)}`
}

function clearedSessionCookie(secure: boolean) {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
}

function corsHeaders(
  request: IncomingMessage,
  allowedOrigin: string | undefined,
): Record<string, string> {
  const origin = request.headers.origin
  if (!origin || !allowedOrigin || origin !== allowedOrigin) return {}
  return {
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Origin': allowedOrigin,
    Vary: 'Origin',
  }
}

function loginInput(body: unknown) {
  const record = requestRecord(body)
  if (typeof record.username !== 'string' || typeof record.password !== 'string') {
    throw new HttpError(400, 'invalid_request', '需要提供用户名和密码。')
  }
  return { username: record.username, password: record.password }
}

function createDraftInput(body: unknown) {
  const record = requestRecord(body)
  if (
    typeof record.kind !== 'string'
    || !(MANAGED_CONTENT_KINDS as readonly string[]).includes(record.kind)
    || typeof record.title !== 'string'
    || !('content' in record)
  ) {
    throw new HttpError(400, 'invalid_request', '需要提供内容类型、草稿标题和结构化内容。')
  }
  return {
    kind: record.kind as ManagedContentKind,
    title: record.title,
    content: record.content,
  }
}

function updateDraftInput(body: unknown) {
  const record = requestRecord(body)
  if (!Number.isInteger(record.expectedRevision) || !('content' in record)) {
    throw new HttpError(400, 'invalid_request', '需要提供 expectedRevision 和结构化内容。')
  }
  if (record.title !== undefined && typeof record.title !== 'string') {
    throw new HttpError(400, 'invalid_request', '草稿标题格式无效。')
  }
  return {
    expectedRevision: record.expectedRevision as number,
    ...(typeof record.title === 'string' ? { title: record.title } : {}),
    content: record.content,
  }
}

function reviewInput(body: unknown): {
  decision: 'approve' | 'reject'
  reason?: string
} {
  const record = requestRecord(body)
  if (record.decision !== 'approve' && record.decision !== 'reject') {
    throw new HttpError(400, 'invalid_request', '审核决定必须是 approve 或 reject。')
  }
  if (record.reason !== undefined && typeof record.reason !== 'string') {
    throw new HttpError(400, 'invalid_request', '审核原因格式无效。')
  }
  return {
    decision: record.decision,
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

interface AuthContext {
  readonly account: PublicAccount
  readonly expiresAt: number
}

export function createContentServer(options: ContentServerOptions = {}) {
  const accounts: AccountRepository = options.accounts ?? new InMemoryAccountRepository()
  const sessions = options.sessions ?? new SessionStore()
  const contentStore: ContentStorePort = options.contentStore ?? new SqliteContentStore(':memory:')
  const cookieSecure = options.cookieSecure ?? false
  const assetDirectory = resolve(options.assetDirectory ?? 'data/content-assets')

  async function getAuthContext(request: IncomingMessage): Promise<AuthContext | null> {
    const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE)
    const session = sessions.resolve(token)
    if (!session) return null
    const account = await accounts.findById(session.accountId)
    if (!account) {
      sessions.revoke(token)
      return null
    }
    return {
      account: toPublicAccount(account),
      expiresAt: session.expiresAt,
    }
  }

  async function requireRoles(
    request: IncomingMessage,
    response: ServerResponse,
    roles: readonly Role[],
  ) {
    const auth = await getAuthContext(request)
    if (!auth) {
      sendJson(response, 401, { code: 'unauthenticated', message: '请先登录。' })
      return null
    }
    if (!hasRole(auth.account.role, roles)) {
      sendJson(response, 403, {
        code: 'forbidden',
        message: '当前账号没有执行此操作的权限。',
      })
      return null
    }
    return auth
  }

  const httpServer = createServer(async (request, response) => {
    const headers = corsHeaders(request, options.allowedOrigin)
    for (const [name, value] of Object.entries(headers)) response.setHeader(name, value)
    const method = request.method ?? 'UNKNOWN'
    const url = new URL(request.url ?? '/', 'http://localhost')
    const pathname = url.pathname

    try {
      if (method === 'OPTIONS') {
        sendEmpty(response, 204, headers)
        return
      }
      if (method === 'GET' && pathname === '/health') {
        sendJson(response, 200, { ok: true })
        return
      }
      const assetMatch = pathname.match(/^\/content-assets\/([a-f0-9]{64})\.(png|jpg|webp)$/)
      if (method === 'GET' && assetMatch) {
        try {
          const body = await readFile(resolve(assetDirectory, `${assetMatch[1]}.${assetMatch[2]}`))
          const contentType = assetMatch[2] === 'png' ? 'image/png' : assetMatch[2] === 'jpg' ? 'image/jpeg' : 'image/webp'
          response.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable' })
          response.end(body)
        } catch {
          sendJson(response, 404, { code: 'asset_not_found', message: '贴图不存在。' })
        }
        return
      }
      if (method === 'POST' && pathname === '/auth/login') {
        const { username, password } = loginInput(await readJson(request))
        const account = await accounts.findByUsername(username)
        if (!account || !verifyPassword(password, account.passwordHash)) {
          sendJson(response, 401, {
            code: 'invalid_credentials',
            message: '用户名或密码错误。',
          })
          return
        }
        const session = sessions.create(account.id)
        sendJson(
          response,
          200,
          {
            user: toPublicAccount(account),
            expiresAt: session.expiresAt,
          },
          {
            'Set-Cookie': sessionCookie(session.token, cookieSecure, sessions.ttl),
          },
        )
        return
      }
      if (method === 'GET' && pathname === '/auth/session') {
        const auth = await getAuthContext(request)
        if (!auth) {
          sendJson(response, 401, {
            code: 'unauthenticated',
            message: '当前没有有效会话。',
          })
          return
        }
        sendJson(response, 200, { user: auth.account, expiresAt: auth.expiresAt })
        return
      }
      if (method === 'POST' && pathname === '/auth/logout') {
        const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE)
        sessions.revoke(token)
        sendEmpty(response, 204, { 'Set-Cookie': clearedSessionCookie(cookieSecure) })
        return
      }
      if (method === 'GET' && pathname === '/admin/me') {
        const auth = await requireRoles(request, response, ['content-editor', 'admin'])
        if (!auth) return
        sendJson(response, 200, {
          user: auth.account,
          permissions:
            auth.account.role === 'admin'
              ? ['content:edit', 'content:review', 'content:publish', 'content:rollback']
              : ['content:edit', 'content:preview'],
        })
        return
      }

      if (method === 'POST' && pathname === '/admin/assets') {
        const auth = await requireRoles(request, response, ['content-editor', 'admin'])
        if (!auth) return
        const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
        const extension = IMAGE_EXTENSIONS.get(contentType)
        if (!extension) throw new HttpError(415, 'unsupported_asset_type', '仅支持 PNG、JPEG 或 WebP 图片。')
        const body = await readBody(request, ASSET_LIMIT)
        if (body.length === 0) throw new HttpError(400, 'empty_asset', '图片内容为空。')
        if (!matchesImageType(body, contentType)) throw new HttpError(400, 'invalid_asset', '图片内容与文件格式不匹配。')
        const hash = createHash('sha256').update(body).digest('hex')
        await mkdir(assetDirectory, { recursive: true })
        await writeFile(resolve(assetDirectory, `${hash}.${extension}`), body, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error
        })
        sendJson(response, 201, { asset: { url: `/content-assets/${hash}.${extension}`, contentType, size: body.length } })
        return
      }

      if (pathname === '/admin/drafts' && method === 'GET') {
        const auth = await requireRoles(request, response, ['content-editor', 'admin'])
        if (!auth) return
        sendJson(response, 200, { drafts: await contentStore.listDrafts() })
        return
      }
      if (pathname === '/admin/drafts' && method === 'POST') {
        const auth = await requireRoles(request, response, ['content-editor', 'admin'])
        if (!auth) return
        const draft = await contentStore.createDraft(
          createDraftInput(await readJson(request)),
          auth.account.id,
        )
        sendJson(response, 201, { draft })
        return
      }

      const draftAction = pathname.match(/^\/admin\/drafts\/([^/]+)\/(submit|review|publish)$/)
      if (draftAction && method === 'POST') {
        const id = decodeURIComponent(draftAction[1])
        const action = draftAction[2]
        if (action === 'submit') {
          const auth = await requireRoles(request, response, ['content-editor', 'admin'])
          if (!auth) return
          sendJson(response, 200, { draft: await contentStore.submitDraft(id, auth.account.id) })
          return
        }
        const auth = await requireRoles(request, response, ['admin'])
        if (!auth) return
        if (action === 'review') {
          const review = reviewInput(await readJson(request))
          sendJson(response, 200, {
            draft: await contentStore.reviewDraft(
              id,
              review.decision,
              review.reason,
              auth.account.id,
            ),
          })
          return
        }
        sendJson(response, 201, {
          release: await contentStore.publishDraft(id, auth.account.id),
        })
        return
      }

      const draftMatch = pathname.match(/^\/admin\/drafts\/([^/]+)$/)
      if (draftMatch && method === 'GET') {
        const auth = await requireRoles(request, response, ['content-editor', 'admin'])
        if (!auth) return
        sendJson(response, 200, {
          draft: await contentStore.getDraft(decodeURIComponent(draftMatch[1])),
        })
        return
      }
      if (draftMatch && method === 'PUT') {
        const auth = await requireRoles(request, response, ['content-editor', 'admin'])
        if (!auth) return
        sendJson(response, 200, {
          draft: await contentStore.updateDraft(
            decodeURIComponent(draftMatch[1]),
            updateDraftInput(await readJson(request)),
            auth.account.id,
          ),
        })
        return
      }
      if (draftMatch && method === 'DELETE') {
        const auth = await requireRoles(request, response, ['content-editor', 'admin'])
        if (!auth) return
        await contentStore.deleteDraft(decodeURIComponent(draftMatch[1]), auth.account.id)
        sendEmpty(response, 204)
        return
      }

      if (pathname === '/admin/releases' && method === 'GET') {
        const auth = await requireRoles(request, response, ['content-editor', 'admin'])
        if (!auth) return
        sendJson(response, 200, { releases: await contentStore.listReleases() })
        return
      }
      const rollbackMatch = pathname.match(/^\/admin\/releases\/([^/]+)\/rollback$/)
      if (rollbackMatch && method === 'POST') {
        const auth = await requireRoles(request, response, ['admin'])
        if (!auth) return
        sendJson(response, 200, {
          release: await contentStore.rollbackRelease(
            decodeURIComponent(rollbackMatch[1]),
            auth.account.id,
          ),
        })
        return
      }
      if (pathname === '/admin/audit' && method === 'GET') {
        const auth = await requireRoles(request, response, ['admin'])
        if (!auth) return
        const limit = Number(url.searchParams.get('limit') ?? 100)
        sendJson(response, 200, {
          audit: await contentStore.listAudit(Number.isFinite(limit) ? limit : 100),
        })
        return
      }

      sendJson(response, 404, { code: 'not_found', message: '接口不存在。' })
    } catch (error) {
      const known = error instanceof HttpError || error instanceof ContentStoreError
      sendJson(response, known ? error.status : 500, {
        code: known ? error.code : 'server_error',
        message: known ? error.message : '服务器处理请求时发生错误。',
      })
    }
  })

  let closePromise: Promise<void> | null = null
  return {
    accounts,
    sessions,
    contentStore,
    httpServer,
    async listen() {
      await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject)
        httpServer.listen(options.port ?? 8788, options.host ?? '127.0.0.1', () => {
          httpServer.off('error', reject)
          resolve()
        })
      })
      const address = httpServer.address()
      if (!address || typeof address === 'string') {
        throw new Error('Content server did not bind a TCP port.')
      }
      return { host: options.host ?? '127.0.0.1', port: address.port }
    },
    close() {
      if (closePromise) return closePromise
      closePromise = new Promise<void>((resolve, reject) => {
        httpServer.close(async (error) => {
          if (error) {
            reject(error)
            return
          }
          try {
            await Promise.all([accounts.close?.(), contentStore.close()])
            resolve()
          } catch (closeError) {
            reject(closeError)
          }
        })
      })
      return closePromise
    },
  }
}
