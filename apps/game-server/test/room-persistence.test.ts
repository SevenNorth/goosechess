import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { RoomStore } from '../src/room-store.js'
import { createGameServer } from '../src/server.js'
import { SqliteRoomPersistence } from '../src/sqlite-room-persistence.js'

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

function sendLobby(inbox: SocketInbox, command: LobbyCommand, requestId: string) {
  inbox.socket.send(JSON.stringify({ type: 'lobby-command', requestId, command }))
  return inbox.next((message) => message.type === 'lobby-result' && message.requestId === requestId)
}

async function closeSocket(socket: WebSocket) {
  if (socket.readyState === WebSocket.CLOSED) return
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))
  socket.terminate()
  await closed
}

describe('SQLite room persistence', () => {
  const cleanups: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  })

  function temporaryDatabase() {
    const directory = mkdtempSync(join(tmpdir(), 'goose-chess-room-'))
    cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
    return join(directory, 'rooms.sqlite')
  }

  async function startPersistentServer(databasePath: string) {
    const store = new RoomStore({
      persistence: new SqliteRoomPersistence(databasePath),
      cleanupIntervalMs: 60_000,
    })
    const server = createGameServer({ port: 0, store })
    const address = await server.listen()
    let closed = false
    cleanups.push(async () => {
      if (closed) return
      closed = true
      await server.close()
    })
    return {
      baseUrl: `http://127.0.0.1:${address.port}`,
      socketUrl(roomCode: string, participant: RoomJoinResponse) {
        return `ws://127.0.0.1:${address.port}/rooms/${roomCode}/connect?token=${participant.recoveryToken}`
      },
      async close() {
        if (closed) return
        closed = true
        await server.close()
      },
    }
  }

  it('restores a started room, private projection, legal commands, and duplicate results after restart', async () => {
    const databasePath = temporaryDatabase()
    const firstServer = await startPersistentServer(databasePath)
    const creator = await postJson(`${firstServer.baseUrl}/rooms`, {
      displayName: '港口旅人',
      skinId: 'goose-white',
    })
    const guest = await postJson(`${firstServer.baseUrl}/rooms/${creator.room.roomCode}/join`, {
      displayName: '晚班水手',
      skinId: 'goose-blue',
    })
    const hostInbox = await openInbox(firstServer.socketUrl(creator.room.roomCode, creator))
    const guestInbox = await openInbox(firstServer.socketUrl(creator.room.roomCode, guest))
    await hostInbox.next((message) => message.type === 'room-state')
    await guestInbox.next((message) => message.type === 'room-state')
    await sendLobby(hostInbox, { type: 'set-ready', ready: true }, 'host-ready')
    await sendLobby(guestInbox, { type: 'set-ready', ready: true }, 'guest-ready')
    await sendLobby(hostInbox, { type: 'start-game' }, 'start-game')
    const started = await hostInbox.next((message) => message.type === 'room-state' && message.room.status === 'playing')
    if (started.type !== 'room-state' || !started.snapshot) throw new Error('Missing started snapshot.')

    const envelope: CommandEnvelope = {
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      gameId: creator.room.gameId,
      commandId: 'persisted-order-roll',
      playerId: creator.playerId,
      expectedRevision: started.snapshot.revision,
      command: { type: 'request-order-roll' },
    }
    hostInbox.socket.send(JSON.stringify({ type: 'command', envelope }))
    const accepted = await hostInbox.next((message) => message.type === 'command-result' && message.commandId === envelope.commandId)
    expect(accepted.type === 'command-result' && accepted.result.ok).toBe(true)

    await Promise.all([closeSocket(hostInbox.socket), closeSocket(guestInbox.socket)])
    await firstServer.close()
    expect(readFileSync(databasePath).includes(Buffer.from(creator.recoveryToken))).toBe(false)

    const secondServer = await startPersistentServer(databasePath)
    const recoveredCreator = await postJson(`${secondServer.baseUrl}/rooms/${creator.room.roomCode}/join`, {
      displayName: '港口旅人',
      skinId: 'goose-white',
      recoveryToken: creator.recoveryToken,
    })
    expect(recoveredCreator.playerId).toBe(creator.playerId)
    expect(recoveredCreator.room.players.find((player) => player.playerId === guest.playerId)?.reconnectDeadlineAt).not.toBeNull()
    const recoveredInbox = await openInbox(secondServer.socketUrl(creator.room.roomCode, recoveredCreator))
    const restored = await recoveredInbox.next((message) => message.type === 'room-state' && Boolean(message.snapshot))
    if (restored.type !== 'room-state' || !restored.snapshot) throw new Error('Missing restored snapshot.')
    expect(restored.snapshot.revision).toBe(1)
    expect(restored.snapshot.rngSeed).toBe(0)
    expect(restored.snapshot.state.players.find((player) => player.playerId === guest.playerId)?.itemId).toBeNull()
    expect(restored.legalCommands.some((command) => command.type === 'request-order-roll')).toBe(false)

    recoveredInbox.socket.send(JSON.stringify({ type: 'command', envelope }))
    const duplicate = await recoveredInbox.next((message) => message.type === 'command-result' && message.commandId === envelope.commandId)
    expect(duplicate.type === 'command-result' && duplicate.result).toEqual(
      accepted.type === 'command-result' ? accepted.result : undefined,
    )
    recoveredInbox.socket.send(JSON.stringify({ type: 'sync-request' }))
    const afterDuplicate = await recoveredInbox.next((message) => message.type === 'room-state' && Boolean(message.snapshot))
    expect(afterDuplicate.type === 'room-state' && afterDuplicate.snapshot?.revision).toBe(1)
    await closeSocket(recoveredInbox.socket)
  })

  it('removes expired rooms before restoring them', () => {
    const databasePath = temporaryDatabase()
    let now = 1_000
    const firstStore = new RoomStore({
      persistence: new SqliteRoomPersistence(databasePath),
      roomTtlMs: 100,
      finishedRoomTtlMs: 100,
      cleanupIntervalMs: 60_000,
      now: () => now,
    })
    const created = firstStore.createRoom({ displayName: '过期棋手', skinId: 'goose-white' })
    firstStore.close()

    now = 1_101
    const restoredStore = new RoomStore({
      persistence: new SqliteRoomPersistence(databasePath),
      roomTtlMs: 100,
      finishedRoomTtlMs: 100,
      cleanupIntervalMs: 60_000,
      now: () => now,
    })
    expect(() => restoredStore.joinRoom(created.room.roomCode, {
      displayName: '过期棋手',
      skinId: 'goose-white',
    }, created.recoveryToken)).toThrowError(expect.objectContaining({ code: 'room_not_found' }))
    restoredStore.close()
  })
})
