import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { ClientRoomMessageSchema, ServerRoomMessageSchema, type ServerRoomMessage } from '@goose-chess/game-protocol'
import { WebSocketServer, type WebSocket } from 'ws'
import { RoomStore, RoomStoreError, type RoomProfile } from './room-store.js'

const JSON_LIMIT = 8 * 1024

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(body))
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
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
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

export interface GameServerOptions {
  readonly host?: string
  readonly port?: number
  readonly store?: RoomStore
}

export function createGameServer(options: GameServerOptions = {}) {
  const store = options.store ?? new RoomStore()
  const httpServer = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Headers': 'content-type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Origin': '*',
      })
      response.end()
      return
    }

    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { ok: true })
        return
      }
      if (request.method === 'POST' && url.pathname === '/rooms') {
        sendJson(response, 201, store.createRoom(parseProfile(await readJson(request))))
        return
      }
      const joinMatch = url.pathname.match(/^\/rooms\/([A-Z0-9]{6})\/join$/i)
      if (request.method === 'POST' && joinMatch) {
        const profile = parseProfile(await readJson(request))
        sendJson(response, 200, store.joinRoom(joinMatch[1], profile, profile.recoveryToken))
        return
      }
      sendJson(response, 404, { code: 'not_found', message: '接口不存在。' })
    } catch (error) {
      const known = error instanceof RoomStoreError
      sendJson(response, known ? 400 : 500, {
        code: known ? error.code : 'server_error',
        message: known ? error.message : '服务器处理请求时发生错误。',
      })
    }
  })

  const sockets = new WebSocketServer({ noServer: true, maxPayload: JSON_LIMIT })
  const connectionDetails = new WeakMap<WebSocket, { roomCode: string; recoveryToken: string }>()
  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const match = url.pathname.match(/^\/rooms\/([A-Z0-9]{6})\/connect$/i)
      const recoveryToken = url.searchParams.get('token')
      if (!match || !recoveryToken) {
        socket.destroy()
        return
      }
      sockets.handleUpgrade(request, socket, head, (webSocket) => {
        connectionDetails.set(webSocket, { roomCode: match[1], recoveryToken })
        sockets.emit('connection', webSocket, request)
      })
    } catch {
      socket.destroy()
    }
  })

  sockets.on('connection', (socket) => {
    const details = connectionDetails.get(socket)
    if (!details) {
      socket.close(1011)
      return
    }
    const { roomCode, recoveryToken } = details
    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = store.subscribe(roomCode, recoveryToken, (message) => socketSend(socket, message))
    } catch (error) {
      socketSend(socket, {
        type: 'room-error',
        code: error instanceof RoomStoreError ? error.code : 'connection_error',
        message: error instanceof Error ? error.message : '无法连接房间。',
      })
      socket.close(1008)
      return
    }

    socket.on('message', async (raw) => {
      try {
        const parsed = ClientRoomMessageSchema.safeParse(JSON.parse(raw.toString()))
        if (!parsed.success) {
          socketSend(socket, { type: 'room-error', code: 'invalid_message', message: '消息格式无效。' })
          return
        }
        if (parsed.data.type === 'sync-request') {
          store.sync(roomCode, recoveryToken)
          return
        }
        if (parsed.data.type === 'lobby-command') {
          const result = store.submitLobby(roomCode, recoveryToken, parsed.data.command)
          socketSend(socket, {
            type: 'lobby-result',
            requestId: parsed.data.requestId,
            ok: result.ok,
            ...(result.error ? { error: result.error } : {}),
          })
          return
        }
        const result = await store.submit(roomCode, recoveryToken, parsed.data.envelope)
        socketSend(socket, {
          type: 'command-result',
          commandId: parsed.data.envelope.commandId,
          result,
        })
      } catch {
        socketSend(socket, { type: 'room-error', code: 'invalid_message', message: '消息格式无效。' })
      }
    })
    socket.on('close', () => unsubscribe?.())
  })

  return {
    store,
    httpServer,
    async listen() {
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
    async close() {
      sockets.clients.forEach((socket) => socket.close())
      await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()))
    },
  }
}
