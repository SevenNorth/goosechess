import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import {
  PROTOCOL_SCHEMA_VERSION,
  RoomJoinResponseSchema,
  ServerRoomMessageSchema,
  type CommandEnvelope,
  type LobbyCommand,
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
        }, 3_000)
      })
    },
  }
}

function sendLobby(inbox: SocketInbox, command: LobbyCommand, requestId = crypto.randomUUID()) {
  inbox.socket.send(JSON.stringify({ type: 'lobby-command', requestId, command }))
  return inbox.next((message) => message.type === 'lobby-result' && message.requestId === requestId)
}

describe('game server private lobby and room flow', () => {
  const cleanups: Array<() => Promise<void>> = []

  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
  })

  async function setupLobby() {
    const server = createGameServer({ port: 0 })
    const address = await server.listen()
    cleanups.push(() => server.close())
    const baseUrl = `http://127.0.0.1:${address.port}`
    const creator = await postJson(`${baseUrl}/rooms`, { displayName: '港口旅人', skinId: 'goose-white' })
    const guest = await postJson(`${baseUrl}/rooms/${creator.room.roomCode}/join`, { displayName: '晚班水手', skinId: 'goose-blue' })
    const socketUrl = (participant: RoomJoinResponse) => (
      `ws://127.0.0.1:${address.port}/rooms/${creator.room.roomCode}/connect?token=${participant.recoveryToken}`
    )
    return { baseUrl, creator, guest, socketUrl }
  }

  async function startTwoPlayerRoom() {
    const setup = await setupLobby()
    const host = await openInbox(setup.socketUrl(setup.creator))
    const guest = await openInbox(setup.socketUrl(setup.guest))
    cleanups.push(async () => {
      host.socket.terminate()
      guest.socket.terminate()
    })
    await host.next((message) => message.type === 'room-state')
    await guest.next((message) => message.type === 'room-state')
    expect(await sendLobby(host, { type: 'set-ready', ready: true })).toMatchObject({ type: 'lobby-result', ok: true })
    expect(await sendLobby(guest, { type: 'set-ready', ready: true })).toMatchObject({ type: 'lobby-result', ok: true })
    expect(await sendLobby(host, { type: 'start-game' })).toMatchObject({ type: 'lobby-result', ok: true })
    const started = await host.next((message) => message.type === 'room-state' && message.room.status === 'playing')
    if (started.type !== 'room-state' || !started.snapshot) throw new Error('Missing started snapshot.')
    return { ...setup, host, guestInbox: guest, initialSnapshot: started.snapshot }
  }

  it('creates a four-seat lobby and rejects a fifth player', async () => {
    const { baseUrl, creator, guest } = await setupLobby()
    expect(creator.room).toMatchObject({
      status: 'waiting',
      maxPlayers: 4,
      hostPlayerId: creator.playerId,
      mapId: 'test-harbor-7',
    })
    expect(creator.room.players[0]).toMatchObject({ controller: 'remote', ready: false })

    const third = await postJson(`${baseUrl}/rooms/${creator.room.roomCode}/join`, { displayName: '灯塔看守', skinId: 'goose-yellow' })
    const fourth = await postJson(`${baseUrl}/rooms/${creator.room.roomCode}/join`, { displayName: '码头领航', skinId: 'goose-pink' })
    expect(third.room.status).toBe('waiting')
    expect(fourth.room.players).toHaveLength(4)
    expect(guest.room.status).toBe('waiting')

    const response = await fetch(`${baseUrl}/rooms/${creator.room.roomCode}/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: '第五位', skinId: 'goose-white' }),
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'room_full' })
  })

  it('enforces host permissions and readiness before manual start', async () => {
    const { creator, guest, socketUrl } = await setupLobby()
    const host = await openInbox(socketUrl(creator))
    const guestInbox = await openInbox(socketUrl(guest))
    cleanups.push(async () => {
      host.socket.terminate()
      guestInbox.socket.terminate()
    })
    await host.next((message) => message.type === 'room-state')
    await guestInbox.next((message) => message.type === 'room-state')

    expect(await sendLobby(guestInbox, { type: 'add-ai' }, 'guest-add-ai')).toMatchObject({
      type: 'lobby-result',
      ok: false,
      error: { code: 'host_only' },
    })
    expect(await sendLobby(host, { type: 'start-game' }, 'start-too-early')).toMatchObject({
      type: 'lobby-result',
      ok: false,
      error: { code: 'players_not_ready' },
    })

    await sendLobby(host, { type: 'set-ready', ready: true })
    await sendLobby(guestInbox, { type: 'set-ready', ready: true })
    expect(await sendLobby(host, { type: 'start-game' }, 'start-ready')).toMatchObject({ ok: true })
    const started = await guestInbox.next((message) => message.type === 'room-state' && message.room.status === 'playing')
    expect(started.type === 'room-state' && started.snapshot?.state.players).toHaveLength(2)
  })

  it('adds and removes AI seats and runs AI commands on the server', async () => {
    const server = createGameServer({ port: 0 })
    const address = await server.listen()
    cleanups.push(() => server.close())
    const baseUrl = `http://127.0.0.1:${address.port}`
    const creator = await postJson(`${baseUrl}/rooms`, { displayName: '房主', skinId: 'goose-white' })
    const socketUrl = `ws://127.0.0.1:${address.port}/rooms/${creator.room.roomCode}/connect?token=${creator.recoveryToken}`
    const host = await openInbox(socketUrl)
    cleanups.push(async () => host.socket.terminate())
    await host.next((message) => message.type === 'room-state')

    await sendLobby(host, { type: 'add-ai' }, 'add-ai-one')
    const withAi = await host.next((message) => message.type === 'room-state' && message.room.players.some((player) => player.controller === 'ai'))
    if (withAi.type !== 'room-state') throw new Error('Missing AI room state.')
    const ai = withAi.room.players.find((player) => player.controller === 'ai')
    expect(ai).toMatchObject({ ready: true, connected: true })
    await sendLobby(host, { type: 'remove-player', playerId: ai!.playerId }, 'remove-ai')
    const removed = await host.next((message) => message.type === 'room-state' && message.room.players.length === 1)
    expect(removed.type === 'room-state' && removed.room.players).toHaveLength(1)

    await sendLobby(host, { type: 'add-ai' }, 'add-ai-two')
    await sendLobby(host, { type: 'set-ready', ready: true }, 'host-ready')
    await sendLobby(host, { type: 'start-game' }, 'start-with-ai')
    const started = await host.next((message) => message.type === 'room-state' && message.room.status === 'playing')
    if (started.type !== 'room-state' || !started.snapshot) throw new Error('Missing AI started snapshot.')
    expect(started.snapshot.state.players.map((player) => player.controller)).toEqual(['remote', 'ai'])
    const activeAi = started.room.players.find((player) => player.controller === 'ai')
    expect(activeAi).toBeDefined()

    const envelope: CommandEnvelope = {
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      gameId: creator.room.gameId,
      commandId: 'host-order-roll',
      playerId: creator.playerId,
      expectedRevision: started.snapshot.revision,
      command: { type: 'request-order-roll' },
    }
    host.socket.send(JSON.stringify({ type: 'command', envelope }))
    const aiUpdate = await host.next((message) => (
      message.type === 'authority-update'
      && message.update.events.some((event) => event.type === 'order-die-rolled' && event.playerId === activeAi!.playerId)
    ))
    expect(aiUpdate.type === 'authority-update' && aiUpdate.update.snapshot.revision).toBeGreaterThanOrEqual(2)
  })

  it('keeps duplicate commands idempotent and rejects stale revisions', async () => {
    const { creator, guest, host, guestInbox, initialSnapshot } = await startTwoPlayerRoom()
    const envelope: CommandEnvelope = {
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      gameId: creator.room.gameId,
      commandId: 'first-order-roll',
      playerId: creator.playerId,
      expectedRevision: initialSnapshot.revision,
      command: { type: 'request-order-roll' },
    }
    host.socket.send(JSON.stringify({ type: 'command', envelope }))
    const accepted = await host.next((message) => message.type === 'command-result' && message.commandId === envelope.commandId)
    expect(accepted.type === 'command-result' && accepted.result.ok).toBe(true)

    host.socket.send(JSON.stringify({ type: 'command', envelope }))
    const duplicate = await host.next((message) => message.type === 'command-result' && message.commandId === envelope.commandId)
    expect(duplicate.type === 'command-result' && duplicate.result.ok && duplicate.result.update.snapshot.revision).toBe(1)

    const stale: CommandEnvelope = {
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      gameId: creator.room.gameId,
      commandId: 'stale-order-roll',
      playerId: guest.playerId,
      expectedRevision: 0,
      command: { type: 'request-order-roll' },
    }
    guestInbox.socket.send(JSON.stringify({ type: 'command', envelope: stale }))
    const rejected = await guestInbox.next((message) => message.type === 'command-result' && message.commandId === stale.commandId)
    expect(rejected.type === 'command-result' && !rejected.result.ok && rejected.result.error.code).toBe('stale_revision')
  })

  it('restores a started seat without exposing private state', async () => {
    const { creator, host, socketUrl } = await startTwoPlayerRoom()
    host.socket.terminate()
    const recovered = await openInbox(socketUrl(creator))
    cleanups.push(async () => recovered.socket.terminate())
    const restored = await recovered.next((message) => message.type === 'room-state' && Boolean(message.snapshot))
    expect(restored.type === 'room-state' && restored.snapshot?.revision).toBe(0)
    expect(restored.type === 'room-state' && restored.room.players[0].playerId).toBe(creator.playerId)
    expect(restored.type === 'room-state' && restored.snapshot?.rngSeed).toBe(0)
  })
})
