// @vitest-environment jsdom
import { StrictMode, useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { DEFAULT_GAME_DEFINITION } from '@goose-chess/game-content'
import { LocalAuthority, PROTOCOL_SCHEMA_VERSION, type GameCommand, type RoomState } from '@goose-chess/game-protocol'
import { OnlineMatchStage, type OnlineQueuedUpdate } from './OnlineMatchStage'

const room: RoomState = {
  schemaVersion: PROTOCOL_SCHEMA_VERSION,
  roomCode: 'ABC123',
  gameId: 'online-abc123',
  hostPlayerId: 'remote-host',
  mapId: 'aup-port-65',
  mapVersion: 'builtin:aup-port-65',
  contentVersion: DEFAULT_GAME_DEFINITION.contentVersion,
  rulesetVersion: DEFAULT_GAME_DEFINITION.ruleset.version,
  maxPlayers: 2,
  reconnectGraceMs: 30_000,
  status: 'playing',
  players: [
    { playerId: 'remote-host', displayName: '港口房主', skinId: 'goose-white', seatIndex: 0, controller: 'remote', connected: true, reconnectDeadlineAt: null, ready: true },
    { playerId: 'ai-one', displayName: '晚班水手', skinId: 'goose-yellow', seatIndex: 1, controller: 'ai', connected: true, reconnectDeadlineAt: null, ready: true },
  ],
}

describe('在线完整棋盘', () => {
  afterEach(cleanup)

  it('渲染奥普港场景并提交服务端允许的顺序投骰', async () => {
    const authority = LocalAuthority.create({
      gameId: room.gameId,
      definition: DEFAULT_GAME_DEFINITION,
      seed: 20260803,
      participants: [
        { playerId: 'remote-host', displayName: '港口房主', skinId: 'goose-white', seatIndex: 0, controller: 'remote', colorId: 'pink' },
        { playerId: 'ai-one', displayName: '晚班水手', skinId: 'goose-yellow', seatIndex: 1, controller: 'ai', colorId: 'blue' },
      ],
    })
    const snapshot = authority.getSnapshot()
    const legalCommands = authority.getDecisionView('remote-host').legalCommands as readonly GameCommand[]
    const onSubmit = vi.fn()

    render(
      <MemoryRouter>
        <OnlineMatchStage
          room={room}
          snapshot={snapshot}
          viewerPlayerId="remote-host"
          legalCommands={legalCommands}
          pendingUpdates={[]}
          connection="connected"
          presenceNow={Date.now()}
          ownReconnectDeadlineAt={null}
          commandBusy={false}
          notice=""
          onSubmit={onSubmit}
          onPresented={() => undefined}
        />
      </MemoryRouter>,
    )

    expect(screen.getByLabelText('65 格 PixiJS 竞速棋盘')).toBeTruthy()
    expect(screen.getByText('奥普港 65 格联机 · 房间 ABC123')).toBeTruthy()
    const roll = screen.getByRole('button', { name: '投掷单骰' })
    await waitFor(() => expect(roll.hasAttribute('disabled')).toBe(false))
    fireEvent.click(roll)
    expect(onSubmit).toHaveBeenCalledWith({ type: 'request-order-roll' })
  })

  it('使用房间锁定的地图定义和资源基址', () => {
    const definition = {
      ...structuredClone(DEFAULT_GAME_DEFINITION),
      contentVersion: 'content-v2',
      map: { ...structuredClone(DEFAULT_GAME_DEFINITION.map), name: '新版港口' },
      ruleset: { ...structuredClone(DEFAULT_GAME_DEFINITION.ruleset), version: 22 },
    }
    const customRoom = {
      ...room,
      contentVersion: definition.contentVersion,
      mapVersion: 'map-v2',
      rulesetVersion: definition.ruleset.version,
    }
    const authority = LocalAuthority.create({
      gameId: room.gameId,
      definition,
      seed: 20260806,
      participants: [
        { playerId: 'remote-host', displayName: '港口房主', skinId: 'goose-white', seatIndex: 0, controller: 'remote', colorId: 'pink' },
        { playerId: 'ai-one', displayName: '晚班水手', skinId: 'goose-yellow', seatIndex: 1, controller: 'ai', colorId: 'blue' },
      ],
    })

    render(
      <MemoryRouter>
        <OnlineMatchStage
          content={{ definition, assetBaseUrl: 'https://assets.example.com', serverUrl: 'https://game.example.com', maps: [] }}
          room={customRoom}
          snapshot={authority.getSnapshot()}
          viewerPlayerId="remote-host"
          legalCommands={[]}
          pendingUpdates={[]}
          connection="connected"
          presenceNow={Date.now()}
          ownReconnectDeadlineAt={null}
          commandBusy={false}
          notice=""
          onSubmit={() => undefined}
          onPresented={() => undefined}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('新版港口 65 格联机 · 房间 ABC123')).toBeTruthy()
  })


  it('在对局 HUD 显示其他玩家的重连倒计时', async () => {
    const authority = LocalAuthority.create({
      gameId: room.gameId,
      definition: DEFAULT_GAME_DEFINITION,
      seed: 20260803,
      participants: [
        { playerId: 'remote-host', displayName: '港口房主', skinId: 'goose-white', seatIndex: 0, controller: 'remote', colorId: 'pink' },
        { playerId: 'ai-one', displayName: '晚班水手', skinId: 'goose-yellow', seatIndex: 1, controller: 'ai', colorId: 'blue' },
      ],
    })
    const reconnectingRoom: RoomState = {
      ...room,
      players: [
        room.players[0],
        { ...room.players[1], controller: 'remote', connected: false, reconnectDeadlineAt: 6_000 },
      ],
    }

    render(
      <MemoryRouter>
        <OnlineMatchStage
          room={reconnectingRoom}
          snapshot={authority.getSnapshot()}
          viewerPlayerId="remote-host"
          legalCommands={[]}
          pendingUpdates={[]}
          connection="connected"
          presenceNow={1_000}
          ownReconnectDeadlineAt={null}
          commandBusy={false}
          notice=""
          onSubmit={() => undefined}
          onPresented={() => undefined}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('重连中 · 5 秒')).toBeTruthy()
  })

  it('在 Strict Mode 重新挂载后消费随后到达的权威更新', async () => {
    const authority = LocalAuthority.create({
      gameId: room.gameId,
      definition: DEFAULT_GAME_DEFINITION,
      seed: 20260803,
      participants: [
        { playerId: 'remote-host', displayName: '港口房主', skinId: 'goose-white', seatIndex: 0, controller: 'remote', colorId: 'pink' },
        { playerId: 'ai-one', displayName: '晚班水手', skinId: 'goose-yellow', seatIndex: 1, controller: 'ai', colorId: 'blue' },
      ],
    })
    const previousSnapshot = authority.getSnapshot()
    const onPresented = vi.fn()
    const renderStage = (pendingUpdates: Parameters<typeof OnlineMatchStage>[0]['pendingUpdates']) => (
      <StrictMode>
        <MemoryRouter>
          <OnlineMatchStage
            room={room}
            snapshot={pendingUpdates[0]?.update.snapshot ?? previousSnapshot}
            viewerPlayerId="remote-host"
            legalCommands={[]}
            pendingUpdates={pendingUpdates}
            connection="connected"
            presenceNow={Date.now()}
            ownReconnectDeadlineAt={null}
            commandBusy={false}
            notice=""
            onSubmit={() => undefined}
            onPresented={onPresented}
          />
        </MemoryRouter>
      </StrictMode>
    )
    const view = render(renderStage([]))
    await waitFor(() => expect(screen.getByLabelText('65 格 PixiJS 竞速棋盘')).toBeTruthy())

    const result = await authority.submit({
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      gameId: room.gameId,
      commandId: 'online-order-1',
      playerId: 'remote-host',
      expectedRevision: previousSnapshot.revision,
      command: { type: 'request-order-roll' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    view.rerender(renderStage([{
      id: 1,
      update: result.update,
      previousSnapshot,
    }]))

    await waitFor(() => expect(onPresented).toHaveBeenCalledWith(1))
    expect(screen.getByLabelText(result.update.snapshot.state.orderRollResults[0].face + ' 点')).toBeTruthy()
  })

  it('本地事件直接获得道具时显示三秒确认并自动继续队列', async () => {
    const authority = LocalAuthority.create({
      gameId: room.gameId,
      definition: DEFAULT_GAME_DEFINITION,
      seed: 20260803,
      participants: [
        { playerId: 'remote-host', displayName: '港口房主', skinId: 'goose-white', seatIndex: 0, controller: 'remote', colorId: 'pink' },
        { playerId: 'ai-one', displayName: '晚班水手', skinId: 'goose-yellow', seatIndex: 1, controller: 'ai', colorId: 'blue' },
      ],
    })
    const previousSnapshot = authority.getSnapshot()
    const nextSnapshot = {
      ...previousSnapshot,
      revision: previousSnapshot.revision + 1,
      state: {
        ...previousSnapshot.state,
        players: previousSnapshot.state.players.map((player) => player.playerId === 'remote-host'
          ? { ...player, itemId: 'boots' }
          : player),
      },
    }
    const queued: OnlineQueuedUpdate = {
      id: 2,
      previousSnapshot,
      update: {
        snapshot: nextSnapshot,
        events: [{
          type: 'event-resolved',
          eventId: 'r1-e0',
          revision: nextSnapshot.revision,
          playerId: 'remote-host',
          eventCardId: 'street-food',
          passed: null,
        }],
        cues: [],
      },
    }

    function QueueHarness() {
      const [pending, setPending] = useState<readonly OnlineQueuedUpdate[]>([queued])
      return (
        <MemoryRouter>
          <OnlineMatchStage
            room={room}
            snapshot={nextSnapshot}
            viewerPlayerId="remote-host"
            legalCommands={[]}
            pendingUpdates={pending}
            connection="connected"
            presenceNow={Date.now()}
            ownReconnectDeadlineAt={null}
            commandBusy={false}
            notice=""
            onSubmit={() => undefined}
            onPresented={(id) => setPending((current) => current.filter((update) => update.id !== id))}
          />
        </MemoryRouter>
      )
    }

    render(<QueueHarness />)
    await screen.findByRole('heading', { name: '确认收下道具' })
    expect(screen.getAllByText('轻便靴子').length).toBeGreaterThan(0)
    await waitFor(
      () => expect(screen.queryByRole('heading', { name: '确认收下道具' })).toBeNull(),
      { timeout: 4_000 },
    )
  })
})
