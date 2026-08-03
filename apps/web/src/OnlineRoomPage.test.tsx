// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { RoomPlayer } from '@goose-chess/game-protocol'
import { OnlineRoomPage } from './OnlineRoomPage'

interface SocketListenerEvent {
  readonly data?: string
}

class FakeWebSocket {
  static readonly OPEN = 1
  static readonly instances: FakeWebSocket[] = []

  readonly sent: unknown[] = []
  readonly listeners = new Map<string, Array<(event: SocketListenerEvent) => void>>()
  readyState = FakeWebSocket.OPEN

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: (event: SocketListenerEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  send(value: string) {
    this.sent.push(JSON.parse(value) as unknown)
  }

  close() {
    this.readyState = 3
  }

  emit(type: string, data?: unknown) {
    const event = data === undefined ? {} : { data: JSON.stringify(data) }
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }
}

const host: RoomPlayer = {
  playerId: 'player-host',
  displayName: '港口房主',
  skinId: 'goose-white',
  seatIndex: 0,
  controller: 'remote',
  connected: true,
  ready: false,
}

const ai: RoomPlayer = {
  playerId: 'player-ai',
  displayName: '巡潮客',
  skinId: 'goose-yellow',
  seatIndex: 1,
  controller: 'ai',
  connected: true,
  ready: true,
}

function roomState(players: RoomPlayer[] = [host]) {
  return {
    type: 'room-state' as const,
    room: {
      schemaVersion: 8 as const,
      roomCode: 'ABC123',
      gameId: 'game-room',
      hostPlayerId: host.playerId,
      mapId: 'aup-port-65',
      maxPlayers: 4,
      status: 'waiting' as const,
      players,
    },
    legalCommands: [],
  }
}

describe('在线房间大厅', () => {
  afterEach(() => {
    cleanup()
    window.sessionStorage.clear()
    FakeWebSocket.instances.length = 0
    vi.unstubAllGlobals()
  })

  it('房主可以添加电脑、准备并手动开始对局', () => {
    window.sessionStorage.setItem('goose-chess-online-room-v1:ABC123', JSON.stringify({
      playerId: host.playerId,
      recoveryToken: 'recovery-host',
    }))
    vi.stubGlobal('WebSocket', FakeWebSocket)

    render(
      <MemoryRouter initialEntries={['/room/abc123']}>
        <Routes><Route path="/room/:roomCode" element={<OnlineRoomPage />} /></Routes>
      </MemoryRouter>,
    )

    const socket = FakeWebSocket.instances[0]
    act(() => {
      socket.emit('open')
      socket.emit('message', roomState())
    })

    expect(screen.getByText('私人房间大厅')).toBeTruthy()
    expect(screen.getAllByText('空闲座位')).toHaveLength(3)
    expect(screen.getByRole('button', { name: '开始对局' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '添加电脑' }))
    expect(socket.sent.at(-1)).toMatchObject({ type: 'lobby-command', command: { type: 'add-ai' } })
    act(() => {
      socket.emit('message', { type: 'lobby-result', requestId: 'add-ai-result', ok: true })
      socket.emit('message', roomState([host, ai]))
    })
    expect(screen.getByText('电脑棋手')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '准备' }))
    expect(socket.sent.at(-1)).toMatchObject({ type: 'lobby-command', command: { type: 'set-ready', ready: true } })
    act(() => {
      socket.emit('message', { type: 'lobby-result', requestId: 'ready-result', ok: true })
      socket.emit('message', roomState([{ ...host, ready: true }, ai]))
    })

    const startButton = screen.getByRole('button', { name: '开始对局' })
    expect(startButton.hasAttribute('disabled')).toBe(false)
    fireEvent.click(startButton)
    expect(socket.sent.at(-1)).toMatchObject({ type: 'lobby-command', command: { type: 'start-game' } })
  })
})
