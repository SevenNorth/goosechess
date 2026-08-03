import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import {
  PROTOCOL_SCHEMA_VERSION,
  RoomJoinResponseSchema,
  ServerRoomMessageSchema,
  type CommandEnvelope,
  type RoomJoinResponse,
  type ServerRoomMessage,
} from '@goose-chess/game-protocol'
import { createGameServer } from '../src/server.js'

interface SocketInbox {
  readonly socket: WebSocket
  next(predicate: (message: ServerRoomMessage) => boolean): Promise<ServerRoomMessage>
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(JSON.stringify(payload))
  return RoomJoinResponseSchema.parse(payload)
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
    if (waiterIndex >= 0) {
      waiters.splice(waiterIndex, 1)[0].resolve(message)
    } else {
      messages.push(message)
    }
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
        }, 2_000)
      })
    },
  }
}

describe('game server room flow', () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
  })

  async function setupRoom() {
    const server = createGameServer({ port: 0 })
    const address = await server.listen()
    cleanups.push(() => server.close())
    const baseUrl = `http://127.0.0.1:${address.port}`
    const creator = await postJson(`${baseUrl}/rooms`, { displayName: '港口旅人', skinId: 'goose-white' })
    const guest = await postJson(`${baseUrl}/rooms/${creator.room.roomCode}/join`, { displayName: '晚班水手', skinId: 'goose-blue' })
    const socketUrl = (participant: RoomJoinResponse) => (
      `ws://127.0.0.1:${address.port}/rooms/${creator.room.roomCode}/connect?token=${participant.recoveryToken}`
    )
    return { creator, guest, socketUrl }
  }

  it('creates a room and starts when the second player joins', async () => {
    const { creator, guest } = await setupRoom()
    expect(creator.room.status).toBe('waiting')
    expect(guest.room.status).toBe('playing')
    expect(guest.room.players.map((player) => player.displayName)).toEqual(['港口旅人', '晚班水手'])
  })

  it('broadcasts accepted updates and makes duplicate commands idempotent', async () => {
    const { creator, guest, socketUrl } = await setupRoom()
    const first = await openInbox(socketUrl(creator))
    const second = await openInbox(socketUrl(guest))
    cleanups.push(async () => {
      first.socket.terminate()
      second.socket.terminate()
    })
    first.socket.send('{not-json')
    const malformed = await first.next((message) => message.type === 'room-error' && message.code === 'invalid_message')
    expect(malformed.type).toBe('room-error')

    const initial = await first.next((message) => message.type === 'room-state' && Boolean(message.snapshot))
    expect(initial.type).toBe('room-state')
    if (initial.type !== 'room-state' || !initial.snapshot) throw new Error('Missing initial snapshot.')

    const envelope: CommandEnvelope = {
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      gameId: creator.room.gameId,
      commandId: 'first-order-roll',
      playerId: creator.playerId,
      expectedRevision: initial.snapshot.revision,
      command: { type: 'request-order-roll' },
    }
    first.socket.send(JSON.stringify({ type: 'command', envelope }))
    const [firstUpdate, secondUpdate, firstResult] = await Promise.all([
      first.next((message) => message.type === 'authority-update'),
      second.next((message) => message.type === 'authority-update'),
      first.next((message) => message.type === 'command-result' && message.commandId === envelope.commandId),
    ])
    expect(firstUpdate.type === 'authority-update' && firstUpdate.update.snapshot.revision).toBe(1)
    expect(secondUpdate.type === 'authority-update' && secondUpdate.update.snapshot.revision).toBe(1)
    expect(firstResult.type === 'command-result' && firstResult.result.ok).toBe(true)

    first.socket.send(JSON.stringify({ type: 'command', envelope }))
    const duplicate = await first.next((message) => message.type === 'command-result' && message.commandId === envelope.commandId)
    expect(duplicate.type === 'command-result' && duplicate.result.ok && duplicate.result.update.snapshot.revision).toBe(1)
  })

  it('rejects stale revisions and restores a seat after reconnecting', async () => {
    const { creator, guest, socketUrl } = await setupRoom()
    const first = await openInbox(socketUrl(creator))
    const second = await openInbox(socketUrl(guest))
    cleanups.push(async () => {
      first.socket.terminate()
      second.socket.terminate()
    })
    const initial = await first.next((message) => message.type === 'room-state' && Boolean(message.snapshot))
    if (initial.type !== 'room-state' || !initial.snapshot) throw new Error('Missing initial snapshot.')

    const accepted: CommandEnvelope = {
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      gameId: creator.room.gameId,
      commandId: 'accepted-roll',
      playerId: creator.playerId,
      expectedRevision: 0,
      command: { type: 'request-order-roll' },
    }
    first.socket.send(JSON.stringify({ type: 'command', envelope: accepted }))
    await first.next((message) => message.type === 'command-result' && message.commandId === accepted.commandId)

    const stale: CommandEnvelope = {
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      gameId: creator.room.gameId,
      commandId: 'stale-roll',
      playerId: guest.playerId,
      expectedRevision: 0,
      command: { type: 'request-order-roll' },
    }
    second.socket.send(JSON.stringify({ type: 'command', envelope: stale }))
    const rejected = await second.next((message) => message.type === 'command-result' && message.commandId === stale.commandId)
    expect(rejected.type === 'command-result' && !rejected.result.ok && rejected.result.error.code).toBe('stale_revision')

    first.socket.terminate()
    const recovered = await openInbox(socketUrl(creator))
    cleanups.push(async () => recovered.socket.terminate())
    const restored = await recovered.next((message) => message.type === 'room-state' && Boolean(message.snapshot))
    expect(restored.type === 'room-state' && restored.snapshot?.revision).toBe(1)
    expect(restored.type === 'room-state' && restored.room.players[0].playerId).toBe(creator.playerId)
  })

  it('does not expose another players private item choices', async () => {
    const { creator, guest, socketUrl } = await setupRoom()
    const first = await openInbox(socketUrl(creator))
    const second = await openInbox(socketUrl(guest))
    cleanups.push(async () => {
      first.socket.terminate()
      second.socket.terminate()
    })
    const creatorState = await first.next((message) => message.type === 'room-state' && Boolean(message.snapshot))
    const guestState = await second.next((message) => message.type === 'room-state' && Boolean(message.snapshot))
    if (creatorState.type !== 'room-state' || guestState.type !== 'room-state') throw new Error('Missing room state.')
    expect(creatorState.snapshot?.rngSeed).toBe(0)
    expect(guestState.snapshot?.state.players.find((player) => player.playerId === creator.playerId)?.itemId).toBeNull()
  })
})
