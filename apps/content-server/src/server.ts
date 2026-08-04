import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
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

const JSON_LIMIT = 16 * 1024
const SESSION_COOKIE = 'goose_session'

export interface ContentServerOptions {
  readonly host?: string
  readonly port?: number
  readonly accounts?: AccountRepository
  readonly sessions?: SessionStore
  readonly cookieSecure?: boolean
  readonly allowedOrigin?: string
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
      throw new AuthHttpError(413, 'payload_too_large', '请求内容过大。')
    }
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new AuthHttpError(400, 'invalid_request', '请求格式无效。')
  }
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
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Origin': allowedOrigin,
    Vary: 'Origin',
  }
}

function loginInput(body: unknown) {
  if (!body || typeof body !== 'object') {
    throw new AuthHttpError(400, 'invalid_request', '请求格式无效。')
  }
  const record = body as Record<string, unknown>
  if (typeof record.username !== 'string' || typeof record.password !== 'string') {
    throw new AuthHttpError(400, 'invalid_request', '需要提供用户名和密码。')
  }
  return { username: record.username, password: record.password }
}

export class AuthHttpError extends Error {
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
  readonly token: string
  readonly expiresAt: number
}

export function createContentServer(options: ContentServerOptions = {}) {
  const accounts: AccountRepository = options.accounts ?? new InMemoryAccountRepository()
  const sessions = options.sessions ?? new SessionStore()
  const cookieSecure = options.cookieSecure ?? false

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
      token: token as string,
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
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname

    try {
      if (method === 'OPTIONS') {
        sendEmpty(response, 204, headers)
        return
      }
      if (method === 'GET' && pathname === '/health') {
        sendJson(response, 200, { ok: true })
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
      sendJson(response, 404, { code: 'not_found', message: '接口不存在。' })
    } catch (error) {
      const known = error instanceof AuthHttpError
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
            await accounts.close?.()
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