import { randomUUID } from 'node:crypto'
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import type { Duplex } from 'node:stream'
import {
  ClientRoomMessageSchema,
  PROTOCOL_SCHEMA_VERSION,
  ServerRoomMessageSchema,
  type ServerRoomMessage,
} from '@goose-chess/game-protocol'
import { WebSocketServer, type WebSocket } from 'ws'
import {
  GameServerMetrics,
  type DiagnosticEntry,
  type DiagnosticSeverity,
  type DiagnosticSink,
} from './observability.js'
import { TokenBucketRateLimiter, type RateLimitPolicy } from './rate-limit.js'
import { RoomStore, RoomStoreError, type RoomProfile } from './room-store.js'

const JSON_LIMIT = 8 * 1024
const DEFAULT_RATE_LIMITS = {
  roomMutations: { capacity: 20, refillWindowMs: 60_000 },
  websocketUpgrades: { capacity: 30, refillWindowMs: 60_000 },
  websocketMessages: { capacity: 80, refillWindowMs: 10_000 },
} as const

type DiagnosticDetails = Omit<DiagnosticEntry, 'event' | 'severity' | 'timestamp'>

export interface GameServerRateLimits {
  readonly roomMutations?: RateLimitPolicy
  readonly websocketUpgrades?: RateLimitPolicy
  readonly websocketMessages?: RateLimitPolicy
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: IncomingHttpHeaders = {},
) {
  response.writeHead(status, {
    'Access-Control-Allow-Headers': 'authorization,content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  })
  response.end(JSON.stringify(body))
}

function sendMetrics(response: ServerResponse, body: string) {
  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
  })
  response.end(body)
}

async function readJson(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    length += buffer.length
    if (length > JSON_LIMIT) throw new RoomStoreError('payload_too_large', '请求内容过大。')
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new RoomStoreError('invalid_request', '请求格式无效。')
  }
}

function parseProfile(body: unknown): RoomProfile & { recoveryToken?: string } {
  if (!body || typeof body !== 'object') throw new RoomStoreError('invalid_request', '请求格式无效。')
  const record = body as Record<string, unknown>
  if (typeof record.displayName !== 'string' || typeof record.skinId !== 'string') {
    throw new RoomStoreError('invalid_request', '需要提供昵称和棋子外观。')
  }
  return {
    displayName: record.displayName,
    skinId: record.skinId,
    ...(typeof record.recoveryToken === 'string' ? { recoveryToken: record.recoveryToken } : {}),
  }
}

function socketSend(socket: WebSocket, message: ServerRoomMessage) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(ServerRoomMessageSchema.parse(message)))
}

function normalizedRoute(method: string, pathname: string) {
  if (method === 'GET' && pathname === '/health') return '/health'
  if (method === 'GET' && pathname === '/metrics') return '/metrics'
  if (method === 'POST' && pathname === '/rooms') return '/rooms'
  if (method === 'POST' && /^\/rooms\/[A-Z0-9]{6}\/join$/i.test(pathname)) return '/rooms/:roomCode/join'
  if (method === 'GET' && /^\/rooms\/[A-Z0-9]{6}\/content$/i.test(pathname)) return '/rooms/:roomCode/content'
  if (method === 'OPTIONS') return 'options'
  return 'not_found'
}

function sourceAddress(request: IncomingMessage, trustProxy: boolean) {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for']
    const header = Array.isArray(forwarded) ? forwarded[0] : forwarded
    const address = header?.split(',')[0]?.trim()
    if (address) return address
  }
  return request.socket.remoteAddress ?? 'unknown'
}

function rejectUpgrade(socket: Duplex, status: number, message: string, retryAfterSeconds?: number) {
  const body = JSON.stringify({ code: status === 429 ? 'rate_limited' : 'upgrade_rejected', message })
  const headers = [
    `HTTP/1.1 ${status} ${status === 429 ? 'Too Many Requests' : 'Bad Request'}`,
    'Connection: close',
    'Content-Type: application/json; charset=utf-8',
    `Content-Length: ${Buffer.byteLength(body)}`,
    ...(retryAfterSeconds ? [`Retry-After: ${retryAfterSeconds}`] : []),
    '',
    body,
  ]
  socket.end(headers.join('\r\n'))
}

export interface GameServerOptions {
  readonly host?: string
  readonly port?: number
  readonly store?: RoomStore
  readonly disconnectGraceMs?: number
  readonly now?: () => number
  readonly rateLimits?: GameServerRateLimits
  readonly metrics?: GameServerMetrics
  readonly diagnosticSink?: DiagnosticSink
  readonly trustProxy?: boolean
}

export function createGameServer(options: GameServerOptions = {}) {
  const now = options.now ?? Date.now
  const store = options.store ?? new RoomStore({ disconnectGraceMs: options.disconnectGraceMs })
  const metrics = options.metrics ?? new GameServerMetrics(now)
  const trustProxy = options.trustProxy ?? false
  const roomMutationLimiter = new TokenBucketRateLimiter(
    options.rateLimits?.roomMutations ?? DEFAULT_RATE_LIMITS.roomMutations,
    now,
  )
  const websocketUpgradeLimiter = new TokenBucketRateLimiter(
    options.rateLimits?.websocketUpgrades ?? DEFAULT_RATE_LIMITS.websocketUpgrades,
    now,
  )
  const websocketMessageLimiter = new TokenBucketRateLimiter(
    options.rateLimits?.websocketMessages ?? DEFAULT_RATE_LIMITS.websocketMessages,
    now,
  )
  const startedAt = now()

  const diagnose = (
    severity: DiagnosticSeverity,
    event: string,
    details: DiagnosticDetails = {},
  ) => {
    const entry: DiagnosticEntry = {
      timestamp: new Date(now()).toISOString(),
      severity,
      event,
      ...details,
    }
    metrics.recordDiagnostic(event, severity)
    options.diagnosticSink?.(entry)
  }

  const matchDetails = (roomCode: string): DiagnosticDetails => {
    const context = store.getMatchDiagnostic(roomCode)
    if (!context) return { roomCode }
    return {
      roomCode: context.roomCode,
      gameId: context.gameId,
      revision: context.revision,
      phase: context.phase ?? undefined,
      activePlayerId: context.activePlayerId,
      pendingCommands: context.pendingCommands,
    }
  }

  const unsubscribeOwnership = store.subscribeOwnership((event) => {
    metrics.recordOwnership(event.type)
    if (event.type === 'lost') {
      diagnose('warning', 'room_ownership_lost', { roomCode: event.roomCode })
    }
  })

  const httpServer = createServer(async (request, response) => {
    const requestStartedAt = now()
    const method = request.method ?? 'UNKNOWN'
    const requestId = randomUUID()
    let route = 'invalid_url'
    let status = 500
    response.setHeader('X-Request-Id', requestId)

    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      route = normalizedRoute(method, url.pathname)
      if (method === 'OPTIONS') {
        status = 204
        response.writeHead(status, {
          'Access-Control-Allow-Headers': 'authorization,content-type',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Origin': '*',
        })
        response.end()
        return
      }

      if (method === 'GET' && url.pathname === '/health') {
        status = 200
        sendJson(response, status, {
          ok: true,
          protocolSchemaVersion: PROTOCOL_SCHEMA_VERSION,
          uptimeSeconds: Math.max(0, (now() - startedAt) / 1_000),
          rooms: store.getDiagnostics(),
        })
        return
      }
      if (method === 'GET' && url.pathname === '/metrics') {
        status = 200
        sendMetrics(response, metrics.render(store.getDiagnostics()))
        return
      }

      if (route === '/rooms' || route === '/rooms/:roomCode/join') {
        const limited = roomMutationLimiter.consume(sourceAddress(request, trustProxy))
        if (!limited.allowed) {
          status = 429
          metrics.recordRateLimit('http')
          diagnose('warning', 'rate_limit_rejected', { requestId })
          const retryAfterSeconds = Math.max(1, Math.ceil(limited.retryAfterMs / 1_000))
          sendJson(response, status, { code: 'rate_limited', message: '请求过于频繁，请稍后重试。' }, {
            'Retry-After': String(retryAfterSeconds),
          })
          return
        }
      }

      if (method === 'POST' && url.pathname === '/rooms') {
        status = 201
        sendJson(response, status, await store.createRoom(parseProfile(await readJson(request))))
        return
      }
      const joinMatch = url.pathname.match(/^\/rooms\/([A-Z0-9]{6})\/join$/i)
      if (method === 'POST' && joinMatch) {
        const profile = parseProfile(await readJson(request))
        status = 200
        sendJson(response, status, await store.joinRoom(joinMatch[1], profile, profile.recoveryToken))
        return
      }
      const contentMatch = url.pathname.match(/^\/rooms\/([A-Z0-9]{6})\/content$/i)
      if (method === 'GET' && contentMatch) {
        const authorization = request.headers.authorization
        const recoveryToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
        status = 200
        sendJson(response, status, await store.getRoomContent(contentMatch[1], recoveryToken))
        return
      }
      status = 404
      sendJson(response, status, { code: 'not_found', message: '接口不存在。' })
    } catch (error) {
      const known = error instanceof RoomStoreError
      status = known && (error.code === 'room_owned_elsewhere' || error.code === 'room_lease_lost')
        ? 409
        : known && error.code === 'invalid_recovery_token' ? 401 : known ? 400 : 500
      if (!known) {
        diagnose('error', 'http_handler_error', {
          requestId,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        })
      }
      sendJson(response, status, {
        code: known ? error.code : 'server_error',
        message: known ? error.message : '服务器处理请求时发生错误。',
        ...(known && error.ownerUrl ? { ownerUrl: error.ownerUrl } : {}),
      })
    } finally {
      metrics.recordHttp(method, route, status, Math.max(0, now() - requestStartedAt))
    }
  })

  const sockets = new WebSocketServer({ noServer: true, maxPayload: JSON_LIMIT })
  let closePromise: Promise<void> | null = null
  const connectionDetails = new WeakMap<WebSocket, {
    roomCode: string
    recoveryToken: string
    connectionId: string
    requestId: string
  }>()

  httpServer.on('upgrade', (request, socket, head) => {
    const requestId = randomUUID()
    try {
      const limited = websocketUpgradeLimiter.consume(sourceAddress(request, trustProxy))
      if (!limited.allowed) {
        metrics.recordRateLimit('websocket_upgrade')
        diagnose('warning', 'websocket_upgrade_rate_limited', { requestId })
        rejectUpgrade(socket, 429, '连接过于频繁，请稍后重试。', Math.max(1, Math.ceil(limited.retryAfterMs / 1_000)))
        return
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      const match = url.pathname.match(/^\/rooms\/([A-Z0-9]{6})\/connect$/i)
      const recoveryToken = url.searchParams.get('token')
      if (!match || !recoveryToken) {
        rejectUpgrade(socket, 400, 'WebSocket 地址或恢复凭证无效。')
        return
      }
      sockets.handleUpgrade(request, socket, head, (webSocket) => {
        connectionDetails.set(webSocket, {
          roomCode: match[1],
          recoveryToken,
          connectionId: randomUUID(),
          requestId,
        })
        sockets.emit('connection', webSocket, request)
      })
    } catch (error) {
      diagnose('error', 'websocket_upgrade_error', {
        requestId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      socket.destroy()
    }
  })

  sockets.on('connection', async (socket) => {
    metrics.openSocket()
    let unsubscribe: (() => void) | undefined
    let closed = false
    socket.once('close', () => {
      if (closed) return
      closed = true
      unsubscribe?.()
      metrics.closeSocket()
    })

    const details = connectionDetails.get(socket)
    if (!details) {
      diagnose('error', 'websocket_connection_context_missing')
      socket.close(1011)
      return
    }
    const { roomCode, recoveryToken, connectionId, requestId } = details
    try {
      const nextUnsubscribe = await store.subscribe(roomCode, recoveryToken, (message) => socketSend(socket, message))
      if (closed) {
        nextUnsubscribe()
        return
      }
      unsubscribe = nextUnsubscribe
    } catch (error) {
      diagnose('warning', 'websocket_connection_rejected', {
        requestId,
        roomCode,
        errorCode: error instanceof RoomStoreError ? error.code : 'connection_error',
        errorName: error instanceof Error ? error.name : 'UnknownError',
      })
      socketSend(socket, {
        type: 'room-error',
        code: error instanceof RoomStoreError ? error.code : 'connection_error',
        message: error instanceof Error ? error.message : '无法连接房间。',
        ...(error instanceof RoomStoreError && error.ownerUrl ? { ownerUrl: error.ownerUrl } : {}),
      })
      socket.close(error instanceof RoomStoreError && (error.code === 'room_owned_elsewhere' || error.code === 'room_lease_lost') ? 1012 : 1008)
      return
    }

    socket.on('error', (error) => {
      diagnose('warning', 'websocket_transport_error', {
        ...matchDetails(roomCode),
        requestId,
        errorName: error.name,
      })
    })

    socket.on('message', async (raw) => {
      const limited = websocketMessageLimiter.consume(connectionId)
      if (!limited.allowed) {
        metrics.recordRateLimit('websocket_message')
        metrics.recordProtocol('unknown', 'rejected')
        diagnose('warning', 'websocket_message_rate_limited', { ...matchDetails(roomCode), requestId })
        socketSend(socket, { type: 'room-error', code: 'rate_limited', message: '消息发送过于频繁，连接已关闭。' })
        socket.close(1008, 'rate limited')
        return
      }

      let decoded: unknown
      try {
        decoded = JSON.parse(raw.toString()) as unknown
      } catch {
        metrics.recordProtocol('unknown', 'invalid')
        diagnose('warning', 'invalid_protocol_message', { ...matchDetails(roomCode), requestId })
        socketSend(socket, { type: 'room-error', code: 'invalid_message', message: '消息格式无效。' })
        return
      }
      const parsed = ClientRoomMessageSchema.safeParse(decoded)
      if (!parsed.success) {
        metrics.recordProtocol('unknown', 'invalid')
        diagnose('warning', 'invalid_protocol_message', { ...matchDetails(roomCode), requestId })
        socketSend(socket, { type: 'room-error', code: 'invalid_message', message: '消息格式无效。' })
        return
      }

      try {
        if (parsed.data.type === 'sync-request') {
          await store.sync(roomCode, recoveryToken)
          metrics.recordProtocol(parsed.data.type, 'accepted')
          return
        }
        if (parsed.data.type === 'lobby-command') {
          const result = await store.submitLobby(roomCode, recoveryToken, parsed.data.command)
          metrics.recordProtocol(parsed.data.type, result.ok ? 'accepted' : 'rejected')
          metrics.recordCommand('lobby', result.ok ? 'accepted' : 'rejected', result.error?.code)
          if (!result.ok) {
            diagnose('warning', 'lobby_command_rejected', {
              ...matchDetails(roomCode),
              requestId,
              commandType: parsed.data.command.type,
              errorCode: result.error?.code,
            })
          }
          socketSend(socket, {
            type: 'lobby-result',
            requestId: parsed.data.requestId,
            ok: result.ok,
            ...(result.error ? { error: result.error } : {}),
          })
          return
        }
        const result = await store.submit(roomCode, recoveryToken, parsed.data.envelope)
        metrics.recordProtocol(parsed.data.type, result.ok ? 'accepted' : 'rejected')
        metrics.recordCommand('authority', result.ok ? 'accepted' : 'rejected', result.ok ? 'ok' : result.error.code)
        if (!result.ok) {
          diagnose('warning', 'authority_command_rejected', {
            ...matchDetails(roomCode),
            requestId,
            commandId: parsed.data.envelope.commandId,
            commandType: parsed.data.envelope.command.type,
            errorCode: result.error.code,
            expectedRevision: parsed.data.envelope.expectedRevision,
          })
        }
        socketSend(socket, {
          type: 'command-result',
          commandId: parsed.data.envelope.commandId,
          result,
        })
      } catch (error) {
        metrics.recordProtocol(parsed.data.type, 'error')
        metrics.recordCommand(parsed.data.type === 'lobby-command' ? 'lobby' : 'authority', 'error', 'server_error')
        diagnose('error', 'websocket_message_handler_error', {
          ...matchDetails(roomCode),
          requestId,
          commandId: parsed.data.type === 'command' ? parsed.data.envelope.commandId : undefined,
          commandType: parsed.data.type === 'command'
            ? parsed.data.envelope.command.type
            : parsed.data.type === 'lobby-command' ? parsed.data.command.type : undefined,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        })
        socketSend(socket, {
          type: 'room-error',
          code: error instanceof RoomStoreError ? error.code : 'server_error',
          message: error instanceof RoomStoreError ? error.message : '服务器处理消息时发生错误。',
          ...(error instanceof RoomStoreError && error.ownerUrl ? { ownerUrl: error.ownerUrl } : {}),
        })
      }
    })
  })

  return {
    store,
    metrics,
    httpServer,
    async listen() {
      await store.ready()
      await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject)
        httpServer.listen(options.port ?? 8787, options.host ?? '127.0.0.1', () => {
          httpServer.off('error', reject)
          resolve()
        })
      })
      const address = httpServer.address()
      if (!address || typeof address === 'string') throw new Error('Game server did not bind a TCP port.')
      return { host: options.host ?? '127.0.0.1', port: address.port }
    },
    close() {
      if (closePromise) return closePromise
      closePromise = (async () => {
        sockets.clients.forEach((socket) => socket.close())
        const closingSockets = new Promise<void>((resolve, reject) => {
          sockets.close((error) => error ? reject(error) : resolve())
        })
        const closingHttp = new Promise<void>((resolve, reject) => {
          httpServer.close((error) => error ? reject(error) : resolve())
        })
        await Promise.all([closingSockets, closingHttp])
        await store.close()
        unsubscribeOwnership()
      })()
      return closePromise
    },
  }
}
