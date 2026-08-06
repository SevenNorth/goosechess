// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { DEFAULT_GAME_DEFINITION } from '@goose-chess/game-content'
import { LocalAuthority, PROTOCOL_SCHEMA_VERSION, type RoomPlayer } from '@goose-chess/game-protocol'
import { OnlineRoomPage } from './OnlineRoomPage'

vi.mock('./OnlineMatchStage', () => ({
  OnlineMatchStage: ({ snapshot, pendingUpdates, room, content }: {
    snapshot: { revision: number }
    pendingUpdates: readonly unknown[]
    room: { hostPlayerId: string }
    content: { definition: { map: { name: string } } }
  }) => (
    <div data-testid="mock-online-stage">
      revision:{snapshot.revision} queue:{pendingUpdates.length} host:{room.hostPlayerId} map:{content.definition.map.name}
    </div>
  ),
}))

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
  reconnectDeadlineAt: null,
  ready: false,
}

const guest: RoomPlayer = {
  playerId: 'player-guest',
  displayName: '晚班水手',
  skinId: 'goose-blue',
  seatIndex: 1,
  controller: 'remote',
  connected: true,
  reconnectDeadlineAt: null,
  ready: false,
}

const ai: RoomPlayer = {
  playerId: 'player-ai',
  displayName: '巡潮客',
  skinId: 'goose-yellow',
  seatIndex: 1,
  controller: 'ai',
  connected: true,
  reconnectDeadlineAt: null,
  ready: true,
}

function roomState(players: RoomPlayer[] = [host]) {
  return {
    type: 'room-state' as const,
    room: {
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      roomCode: 'ABC123',
      gameId: 'game-room',
      hostPlayerId: host.playerId,
      mapId: 'aup-port-65',
      mapVersion: `builtin:${DEFAULT_GAME_DEFINITION.map.id}`,
      contentVersion: DEFAULT_GAME_DEFINITION.contentVersion,
      rulesetVersion: DEFAULT_GAME_DEFINITION.ruleset.version,
      maxPlayers: 4,
      reconnectGraceMs: 30_000,
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
    vi.restoreAllMocks()
  })

  it('首次进入时显示正在恢复最新房间状态', () => {
    window.sessionStorage.setItem('goose-chess-online-room-v1:ABC123', JSON.stringify({
      playerId: host.playerId,
      recoveryToken: 'recovery-host',
    }))
    vi.stubGlobal('WebSocket', FakeWebSocket)

    render(
      <MemoryRouter initialEntries={['/room/ABC123']}>
        <Routes><Route path="/room/:roomCode" element={<OnlineRoomPage />} /></Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: '正在恢复房间' })).toBeTruthy()
    expect(screen.getByText('正在连接游戏服务并读取最新房间状态。')).toBeTruthy()
  })

  it('连接中断且还没有快照时显示服务不可用并继续重连', () => {
    window.sessionStorage.setItem('goose-chess-online-room-v1:ABC123', JSON.stringify({
      playerId: host.playerId,
      recoveryToken: 'recovery-host',
    }))
    vi.stubGlobal('WebSocket', FakeWebSocket)

    render(
      <MemoryRouter initialEntries={['/room/ABC123']}>
        <Routes><Route path="/room/:roomCode" element={<OnlineRoomPage />} /></Routes>
      </MemoryRouter>,
    )

    act(() => FakeWebSocket.instances[0].emit('close'))
    expect(screen.getByRole('heading', { name: '正在恢复房间' })).toBeTruthy()
    expect(screen.getByText('游戏服务暂时不可用，正在继续重连。')).toBeTruthy()
  })

  it('服务端拒绝恢复时显示明确错误并提供返回入口', () => {
    window.sessionStorage.setItem('goose-chess-online-room-v1:ABC123', JSON.stringify({
      playerId: host.playerId,
      recoveryToken: 'recovery-host',
    }))
    vi.stubGlobal('WebSocket', FakeWebSocket)

    render(
      <MemoryRouter initialEntries={['/room/ABC123']}>
        <Routes><Route path="/room/:roomCode" element={<OnlineRoomPage />} /></Routes>
      </MemoryRouter>,
    )

    act(() => FakeWebSocket.instances[0].emit('message', {
      type: 'room-error',
      code: 'room_not_found',
      message: '找不到这个房间。',
    }))
    expect(screen.getByRole('heading', { name: '无法恢复房间' })).toBeTruthy()
    expect(screen.getByText('找不到这个房间。')).toBeTruthy()
    expect(screen.getByRole('link', { name: '返回准备' })).toBeTruthy()
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

  it('加载并显示房间锁定的已发布地图', async () => {
    window.sessionStorage.setItem('goose-chess-online-room-v1:ABC123', JSON.stringify({
      playerId: host.playerId,
      recoveryToken: 'recovery-host',
    }))
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const definition = {
      ...structuredClone(DEFAULT_GAME_DEFINITION),
      contentVersion: 'content-v2',
      map: { ...structuredClone(DEFAULT_GAME_DEFINITION.map), name: '新版奥普港' },
      ruleset: { ...structuredClone(DEFAULT_GAME_DEFINITION.ruleset), version: 22 },
    }
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer recovery-host')
      return new Response(JSON.stringify({
        schemaVersion: PROTOCOL_SCHEMA_VERSION,
        contentVersion: 'content-v2',
        mapVersion: 'map-v2',
        assetBaseUrl: 'https://assets.example.com',
        maps: [{
          id: DEFAULT_GAME_DEFINITION.map.id,
          mapVersion: 'map-v2',
          name: '新版奥普港',
          spaceCount: DEFAULT_GAME_DEFINITION.map.spaces.length,
          markerCount: DEFAULT_GAME_DEFINITION.map.landmarks.length,
          backgroundAsset: DEFAULT_GAME_DEFINITION.map.assets.background,
        }, {
          id: 'new-route',
          mapVersion: 'map-new-route-v1',
          name: '新版航道',
          spaceCount: 20,
          markerCount: 4,
          backgroundAsset: DEFAULT_GAME_DEFINITION.map.assets.background,
        }],
        definition,
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter initialEntries={['/room/ABC123']}>
        <Routes><Route path="/room/:roomCode" element={<OnlineRoomPage />} /></Routes>
      </MemoryRouter>,
    )

    const state = roomState()
    act(() => {
      FakeWebSocket.instances[0].emit('open')
      FakeWebSocket.instances[0].emit('message', {
        ...state,
        room: {
          ...state.room,
          contentVersion: 'content-v2',
          mapVersion: 'map-v2',
          rulesetVersion: 22,
        },
      })
    })

    expect(await screen.findByText('新版奥普港')).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('radio', { name: /新版航道/ }))
    expect(FakeWebSocket.instances[0].sent.at(-1)).toMatchObject({
      type: 'lobby-command',
      command: { type: 'set-map', mapId: 'new-route' },
    })
  })



  it('当前连接断开时连接栏和本人卡片使用同一本地倒计时', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    window.sessionStorage.setItem('goose-chess-online-room-v1:ABC123', JSON.stringify({
      playerId: host.playerId,
      recoveryToken: 'recovery-host',
    }))
    vi.stubGlobal('WebSocket', FakeWebSocket)

    render(
      <MemoryRouter initialEntries={['/room/ABC123']}>
        <Routes><Route path="/room/:roomCode" element={<OnlineRoomPage />} /></Routes>
      </MemoryRouter>,
    )

    const socket = FakeWebSocket.instances[0]
    act(() => {
      socket.emit('open')
      socket.emit('message', roomState())
      socket.emit('close')
    })

    expect(screen.getAllByText('重连中 · 30 秒')).toHaveLength(2)
  })

  it('显示离线玩家的重连倒计时', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    window.sessionStorage.setItem('goose-chess-online-room-v1:ABC123', JSON.stringify({
      playerId: host.playerId,
      recoveryToken: 'recovery-host',
    }))
    vi.stubGlobal('WebSocket', FakeWebSocket)

    render(
      <MemoryRouter initialEntries={['/room/ABC123']}>
        <Routes><Route path="/room/:roomCode" element={<OnlineRoomPage />} /></Routes>
      </MemoryRouter>,
    )

    const socket = FakeWebSocket.instances[0]
    act(() => {
      socket.emit('open')
      socket.emit('message', roomState([host, { ...guest, connected: false, reconnectDeadlineAt: 6_000 }]))
    })

    expect(screen.getByText('重连中 · 5 秒')).toBeTruthy()
  })

  it('房主转移后立即撤下原房主的管理操作', () => {
    window.sessionStorage.setItem('goose-chess-online-room-v1:ABC123', JSON.stringify({
      playerId: host.playerId,
      recoveryToken: 'recovery-host',
    }))
    vi.stubGlobal('WebSocket', FakeWebSocket)

    render(
      <MemoryRouter initialEntries={['/room/ABC123']}>
        <Routes><Route path="/room/:roomCode" element={<OnlineRoomPage />} /></Routes>
      </MemoryRouter>,
    )

    const socket = FakeWebSocket.instances[0]
    act(() => {
      socket.emit('open')
      socket.emit('message', roomState([host, guest]))
    })
    expect(screen.getByRole('button', { name: '添加电脑' })).toBeTruthy()

    const transferred = roomState([host, guest])
    act(() => socket.emit('message', {
      ...transferred,
      room: { ...transferred.room, hostPlayerId: guest.playerId },
    }))

    expect(screen.queryByRole('button', { name: '添加电脑' })).toBeNull()
    expect(screen.queryByRole('button', { name: '开始对局' })).toBeNull()
  })

  it('权威房间快照替换旧表现队列并直接恢复最新修订', () => {
    window.sessionStorage.setItem('goose-chess-online-room-v1:ABC123', JSON.stringify({
      playerId: host.playerId,
      recoveryToken: 'recovery-host',
    }))
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const authority = LocalAuthority.create({
      gameId: 'game-room',
      definition: DEFAULT_GAME_DEFINITION,
      seed: 20260803,
      participants: [
        { playerId: host.playerId, displayName: host.displayName, skinId: host.skinId, seatIndex: 0, controller: 'remote', colorId: 'pink' },
        { playerId: guest.playerId, displayName: guest.displayName, skinId: guest.skinId, seatIndex: 1, controller: 'remote', colorId: 'blue' },
      ],
    })
    const initialSnapshot = authority.getSnapshot()
    const playingRoom = { ...roomState([host, guest]).room, status: 'playing' as const }

    render(
      <MemoryRouter initialEntries={['/room/ABC123']}>
        <Routes><Route path="/room/:roomCode" element={<OnlineRoomPage />} /></Routes>
      </MemoryRouter>,
    )

    const socket = FakeWebSocket.instances[0]
    act(() => {
      socket.emit('open')
      socket.emit('message', {
        type: 'room-state',
        room: playingRoom,
        snapshot: initialSnapshot,
        legalCommands: [],
      })
      socket.emit('message', {
        type: 'authority-update',
        update: { snapshot: { ...initialSnapshot, revision: 1 }, events: [], cues: [] },
        legalCommands: [],
      })
    })
    expect(screen.getByTestId('mock-online-stage').textContent).toContain('revision:1 queue:1')

    act(() => socket.emit('message', {
      type: 'room-state',
      room: playingRoom,
      snapshot: { ...initialSnapshot, revision: 2 },
      legalCommands: [],
    }))
    expect(screen.getByTestId('mock-online-stage').textContent).toContain('revision:2 queue:0')
  })

})
