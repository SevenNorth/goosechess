import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import {
  RoomJoinResponseSchema,
  ServerRoomMessageSchema,
  type RoomJoinResponse,
  type ServerRoomMessage,
} from '@goose-chess/game-protocol'
import { type DiagnosticEntry } from '../src/observability.js'
import { TokenBucketRateLimiter } from '../src/rate-limit.js'
import { createGameServer, type GameServerOptions } from '../src/server.js'

interface SocketInbox {
  readonly socket: WebSocket
  next(predicate: (message: ServerRoomMessage) => boolean): Promise<ServerRoomMessage>
}

async function openInbox(url: string): Promise<SocketInbox> {
  const socket = new WebSocket(url)
  const messages: ServerRoomMessage[] = []
  const waiters: Array<{
    predicate: (message: ServerRoomMessage) => boolean
    resolve: (message: ServerRoomMessage) => void
  }> = []
  socket.on('message', (raw) => {
    const message = ServerRoomMessageSchema.parse(JSON.parse(raw.toString()))
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(message))
    if (waiterIndex >= 0) waiters.splice(waiterIndex, 1)[0].resolve(message)
    else messages.push(message)
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  return {
    socket,
    next(predicate) {
      const index = messages.findIndex(predicate)
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0])
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve }
        waiters.push(waiter)
        setTimeout(() => {
          const pendingIndex = waiters.indexOf(waiter)
          if (pendingIndex >= 0) {
            waiters.splice(pendingIndex, 1)
            reject(new Error('Timed out waiting for WebSocket message.'))
          }
        }, 3_000)
      })
    },
  }
}

async function createRoom(baseUrl: string): Promise<RoomJoinResponse> {
  const response = await fetch(`${baseUrl}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: '港口旅人', skinId: 'goose-white' }),
  })
  expect(response.status).toBe(201)
  return RoomJoinResponseSchema.parse(await response.json())
}

describe('token bucket rate limiter', () => {
  it('refills capacity over the configured window', () => {
    let now = 1_000
    const limiter = new TokenBucketRateLimiter({ capacity: 2, refillWindowMs: 1_000 }, () => now)

    expect(limiter.consume('client').allowed).toBe(true)
    expect(limiter.consume('client').allowed).toBe(true)
    expect(limiter.consume('client')).toEqual({ allowed: false, retryAfterMs: 500 })

    now += 500
    expect(limiter.consume('client').allowed).toBe(true)
  })
})

describe('game server production safeguards', () => {
  const cleanups: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  })

  async function startServer(options: GameServerOptions = {}) {
    const server = createGameServer({ port: 0, ...options })
    const address = await server.listen()
    cleanups.push(() => server.close())
    return {
      server,
      baseUrl: `http://127.0.0.1:${address.port}`,
      socketUrl(room: RoomJoinResponse) {
        return `ws://127.0.0.1:${address.port}/rooms/${room.room.roomCode}/connect?token=${room.recoveryToken}`
      },
    }
  }

  it('reports health, room gauges, and normalized HTTP metrics', async () => {
    const { baseUrl } = await startServer()
    await createRoom(baseUrl)

    const healthResponse = await fetch(`${baseUrl}/health`)
    expect(healthResponse.status).toBe(200)
    await expect(healthResponse.json()).resolves.toMatchObject({
      ok: true,
      rooms: {
        totalRooms: 1,
        waitingRooms: 1,
        remotePlayers: 1,
      },
    })

    const metricsResponse = await fetch(`${baseUrl}/metrics`)
    expect(metricsResponse.headers.get('content-type')).toContain('text/plain')
    const metrics = await metricsResponse.text()
    expect(metrics).toContain('goose_chess_rooms{status="waiting"} 1')
    expect(metrics).toContain('goose_chess_remote_players 1')
    expect(metrics).toContain('goose_chess_http_requests_total{method="POST",route="/rooms",status="201"} 1')
  })

  it('returns 429 with retry guidance when room mutations exceed the IP budget', async () => {
    const diagnostics: DiagnosticEntry[] = []
    const { baseUrl } = await startServer({
      diagnosticSink: (entry) => diagnostics.push(entry),
      rateLimits: {
        roomMutations: { capacity: 1, refillWindowMs: 60_000 },
      },
    })
    await createRoom(baseUrl)

    const limited = await fetch(`${baseUrl}/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: '第二位', skinId: 'goose-blue' }),
    })
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    await expect(limited.json()).resolves.toMatchObject({ code: 'rate_limited' })
    expect(diagnostics).toContainEqual(expect.objectContaining({
      severity: 'warning',
      event: 'rate_limit_rejected',
    }))

    const metrics = await (await fetch(`${baseUrl}/metrics`)).text()
    expect(metrics).toContain('goose_chess_rate_limit_rejections_total{scope="http"} 1')
  })

  it('counts invalid protocol messages without logging payloads or recovery tokens', async () => {
    const diagnostics: DiagnosticEntry[] = []
    const { baseUrl, socketUrl } = await startServer({
      diagnosticSink: (entry) => diagnostics.push(entry),
    })
    const room = await createRoom(baseUrl)
    const inbox = await openInbox(socketUrl(room))
    cleanups.push(() => inbox.socket.terminate())
    await inbox.next((message) => message.type === 'room-state')

    const secretPayload = `not-json-${room.recoveryToken}`
    inbox.socket.send(secretPayload)
    await expect(inbox.next((message) => message.type === 'room-error')).resolves.toMatchObject({
      type: 'room-error',
      code: 'invalid_message',
    })

    const diagnostic = diagnostics.find((entry) => entry.event === 'invalid_protocol_message')
    expect(diagnostic).toMatchObject({ severity: 'warning', roomCode: room.room.roomCode })
    expect(JSON.stringify(diagnostic)).not.toContain(room.recoveryToken)
    expect(JSON.stringify(diagnostic)).not.toContain(secretPayload)

    const metrics = await (await fetch(`${baseUrl}/metrics`)).text()
    expect(metrics).toContain('goose_chess_protocol_messages_total{outcome="invalid",type="unknown"} 1')
  })

  it('closes a WebSocket that exceeds its per-connection message budget', async () => {
    const { baseUrl, socketUrl } = await startServer({
      rateLimits: {
        websocketMessages: { capacity: 1, refillWindowMs: 60_000 },
      },
    })
    const room = await createRoom(baseUrl)
    const inbox = await openInbox(socketUrl(room))
    cleanups.push(() => inbox.socket.terminate())
    await inbox.next((message) => message.type === 'room-state')

    inbox.socket.send(JSON.stringify({ type: 'sync-request' }))
    await inbox.next((message) => message.type === 'room-state')
    inbox.socket.send(JSON.stringify({ type: 'sync-request' }))
    await expect(inbox.next((message) => message.type === 'room-error')).resolves.toMatchObject({
      type: 'room-error',
      code: 'rate_limited',
    })
    await new Promise<void>((resolve) => inbox.socket.once('close', () => resolve()))

    const metrics = await (await fetch(`${baseUrl}/metrics`)).text()
    expect(metrics).toContain('goose_chess_rate_limit_rejections_total{scope="websocket_message"} 1')
    expect(metrics).toContain('goose_chess_ws_connections_current 0')
  })
})
