import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowLeft,
  Bot,
  Check,
  Circle,
  Copy,
  Crown,
  LoaderCircle,
  MapPinned,
  Play,
  UserMinus,
  UserPlus,
  UsersRound,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import {
  PROTOCOL_SCHEMA_VERSION,
  ServerRoomMessageSchema,
  type GameCommand,
  type GameSnapshot,
  type LobbyCommand,
  type RoomPlayer,
  type RoomState,
} from '@goose-chess/game-protocol'
import { loadOnlineIdentity, roomSocketUrl } from './online-room-client'
import { playerSkinOption } from './player-profile'
import { OnlineMatchStage, type OnlineQueuedUpdate } from './OnlineMatchStage'

function reconnectSeconds(deadlineAt: number | null, now: number) {
  return deadlineAt === null ? null : Math.max(0, Math.ceil((deadlineAt - now) / 1_000))
}

function playerPresenceLabel(
  player: RoomPlayer,
  viewerPlayerId: string,
  connection: 'connecting' | 'connected' | 'disconnected',
  ownReconnectDeadlineAt: number | null,
  now: number,
) {
  if (player.controller === 'ai') return '电脑棋手'
  const locallyDisconnected = player.playerId === viewerPlayerId && connection !== 'connected'
  if (player.connected && !locallyDisconnected) return '在线'
  const deadlineAt = locallyDisconnected ? ownReconnectDeadlineAt : player.reconnectDeadlineAt
  const remaining = reconnectSeconds(deadlineAt, now)
  return remaining !== null && remaining > 0 ? '重连中 · ' + remaining + ' 秒' : '暂时离线'
}

interface RoomRosterProps {
  readonly room: RoomState
  readonly snapshot: GameSnapshot | null
  readonly viewerPlayerId: string
  readonly canManage: boolean
  readonly busy: boolean
  readonly connection: 'connecting' | 'connected' | 'disconnected'
  readonly now: number
  readonly ownReconnectDeadlineAt: number | null
  readonly onRemove: (playerId: string) => void
}

function RoomRoster({ room, snapshot, viewerPlayerId, canManage, busy, connection, now, ownReconnectDeadlineAt, onRemove }: RoomRosterProps) {
  return (
    <aside className="online-player-list" aria-label="房间玩家">
      <header><strong>房间棋手</strong><span>{room.players.length}/{room.maxPlayers}</span></header>
      {room.players.map((player) => {
        const skin = playerSkinOption(player.skinId)
        const position = snapshot?.state.players.find((candidate) => candidate.playerId === player.playerId)
        const isHost = player.playerId === room.hostPlayerId
        const removable = canManage && player.playerId !== viewerPlayerId && (player.controller === 'ai' || !player.ready)
        const presence = playerPresenceLabel(player, viewerPlayerId, connection, ownReconnectDeadlineAt, now)
        return (
          <article
            className={[
              player.playerId === snapshot?.state.activePlayerId ? 'is-active' : '',
              room.status === 'waiting' && player.ready ? 'is-ready' : '',
            ].filter(Boolean).join(' ')}
            key={player.playerId}
          >
            <span className="online-player-avatar" style={{ '--player-color': skin.color } as CSSProperties}>
              <img src={skin.imageSrc} alt="" />
            </span>
            <div>
              <strong>{player.displayName}{player.playerId === viewerPlayerId ? '（你）' : ''}</strong>
              <small className={player.controller === 'remote' && (!player.connected || (player.playerId === viewerPlayerId && connection !== 'connected')) ? 'is-reconnecting' : ''}>
                {player.controller === 'ai' ? <><Bot /> {presence}</> : presence}
                {snapshot ? ` · 第 ${position ? position.spaceId + 1 : 1} 格` : ''}
              </small>
              {room.status === 'waiting' && (
                <span className={player.ready ? 'lobby-ready-tag is-ready' : 'lobby-ready-tag'}>
                  {player.ready ? <Check /> : <Circle />}
                  {player.ready ? '已准备' : '未准备'}
                </span>
              )}
            </div>
            <div className="online-player-badges">
              {isHost && <span title="房主" aria-label="房主"><Crown /></span>}
              {removable && (
                <button
                  type="button"
                  disabled={busy}
                  title={`移除${player.displayName}`}
                  aria-label={`移除${player.displayName}`}
                  onClick={() => onRemove(player.playerId)}
                >
                  <UserMinus />
                </button>
              )}
            </div>
          </article>
        )
      })}
      {room.status === 'waiting' && Array.from({ length: room.maxPlayers - room.players.length }, (_, index) => (
        <article className="is-empty" key={`empty-${index}`}>
          <span>{room.players.length + index + 1}</span>
          <div><strong>空闲座位</strong><small>等待玩家或电脑</small></div>
        </article>
      ))}
    </aside>
  )
}

export function OnlineRoomPage() {
  const { roomCode: routeRoomCode = '' } = useParams()
  const roomCode = routeRoomCode.toUpperCase()
  const identity = loadOnlineIdentity(roomCode)
  const socketRef = useRef<WebSocket | null>(null)
  const snapshotRef = useRef<GameSnapshot | null>(null)
  const updateIdRef = useRef(1)
  const playerId = identity?.playerId ?? ''
  const recoveryToken = identity?.recoveryToken ?? ''
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [room, setRoom] = useState<RoomState | null>(null)
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null)
  const [notice, setNotice] = useState('')
  const [legalCommands, setLegalCommands] = useState<readonly GameCommand[]>([])
  const [pendingUpdates, setPendingUpdates] = useState<readonly OnlineQueuedUpdate[]>([])
  const [commandBusy, setCommandBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [lobbyBusy, setLobbyBusy] = useState(false)
  const [removed, setRemoved] = useState(false)
  const [ownReconnectDeadlineAt, setOwnReconnectDeadlineAt] = useState<number | null>(null)
  const [presenceNow, setPresenceNow] = useState(() => Date.now())

  useEffect(() => {
    if (!room) return
    if (connection === 'connected') {
      setOwnReconnectDeadlineAt(null)
      return
    }
    setOwnReconnectDeadlineAt((current) => current ?? Date.now() + room.reconnectGraceMs)
  }, [connection, room])

  const hasReconnectCountdown = Boolean(
    (ownReconnectDeadlineAt !== null && ownReconnectDeadlineAt > presenceNow)
    || room?.players.some((player) => player.reconnectDeadlineAt !== null && player.reconnectDeadlineAt > presenceNow),
  )

  useEffect(() => {
    if (!hasReconnectCountdown) return
    const interval = window.setInterval(() => setPresenceNow(Date.now()), 250)
    return () => window.clearInterval(interval)
  }, [hasReconnectCountdown])

  useEffect(() => {
    if (!playerId || !recoveryToken) return
    let stopped = false
    let retryTimer: number | undefined

    const connect = () => {
      if (stopped) return
      setConnection('connecting')
      const socket = new WebSocket(roomSocketUrl(roomCode, recoveryToken))
      socketRef.current = socket
      socket.addEventListener('open', () => {
        setConnection('connected')
        setNotice('')
        socket.send(JSON.stringify({ type: 'sync-request' }))
      })
      socket.addEventListener('message', (event) => {
        const parsed = ServerRoomMessageSchema.safeParse(JSON.parse(String(event.data)))
        if (!parsed.success) {
          setNotice('服务器返回了无法识别的消息。')
          return
        }
        const message = parsed.data
        if (message.type === 'room-state') {
          setRoom(message.room)
          setLegalCommands(message.legalCommands)
          if (message.snapshot) {
            snapshotRef.current = message.snapshot
            setSnapshot(message.snapshot)
            setPendingUpdates([])
          }
        } else if (message.type === 'authority-update') {
          const previousSnapshot = snapshotRef.current
          snapshotRef.current = message.update.snapshot
          setSnapshot(message.update.snapshot)
          setLegalCommands(message.legalCommands)
          if (previousSnapshot && message.update.snapshot.revision > previousSnapshot.revision) {
            setPendingUpdates((current) => [...current, {
              id: updateIdRef.current++,
              update: message.update,
              previousSnapshot,
            }])
          }
        } else if (message.type === 'command-result') {
          setCommandBusy(false)
          if (!message.result.ok) {
            setNotice(message.result.error.code === 'stale_revision'
              ? '状态已更新，请按最新画面重新操作。'
              : message.result.error.message)
            if (message.result.error.code === 'stale_revision') socket.send(JSON.stringify({ type: 'sync-request' }))
          }
        } else if (message.type === 'lobby-result') {
          setLobbyBusy(false)
          if (!message.ok) setNotice(message.error?.message ?? '大厅操作失败。')
        } else if (message.type === 'room-error') {
          setLobbyBusy(false)
          setCommandBusy(false)
          setNotice(message.message)
          if (message.code === 'removed_from_room') setRemoved(true)
        }
      })
      socket.addEventListener('close', () => {
        if (socketRef.current === socket) socketRef.current = null
        if (!stopped && !removed) {
          setConnection('disconnected')
          retryTimer = window.setTimeout(connect, 1_500)
        }
      })
    }

    connect()
    return () => {
      stopped = true
      if (retryTimer) window.clearTimeout(retryTimer)
      socketRef.current?.close()
    }
  }, [playerId, recoveryToken, roomCode, removed])

  if (!identity || removed) {
    return (
      <main className="route-message-shell">
        <section className="route-message">
          <WifiOff />
          <span>在线房间 {roomCode}</span>
          <h1>{removed ? '已离开房间' : '缺少房间身份'}</h1>
          <p>{removed ? '你已被房主移出这个房间。' : '请从准备页面创建或加入房间。恢复凭证只保存在当前浏览器标签页中。'}</p>
          <Link className="primary-button" to="/">返回准备</Link>
        </section>
      </main>
    )
  }

  const ownRoomPlayer = room?.players.find((player) => player.playerId === identity.playerId)
  const isHost = room?.hostPlayerId === identity.playerId
  const ownReconnectRemaining = reconnectSeconds(ownReconnectDeadlineAt, presenceNow)
  const connectionLabel = connection === 'connected'
    ? '已连接'
    : ownReconnectRemaining !== null && ownReconnectRemaining > 0
      ? '重连中 · ' + ownReconnectRemaining + ' 秒'
      : connection === 'connecting' ? '连接中' : '重连中'
  const canStart = Boolean(
    room
    && room.players.length >= 2
    && room.players.every((player) => player.ready),
  )
  const submit = (command: GameCommand) => {
    if (commandBusy || !snapshot || socketRef.current?.readyState !== WebSocket.OPEN) return
    setCommandBusy(true)
    setNotice('')
    socketRef.current.send(JSON.stringify({
      type: 'command',
      envelope: {
        schemaVersion: PROTOCOL_SCHEMA_VERSION,
        gameId: snapshot.gameId,
        commandId: crypto.randomUUID(),
        playerId: identity.playerId,
        expectedRevision: snapshot.revision,
        command,
      },
    }))
  }

  const submitLobby = (command: LobbyCommand) => {
    if (lobbyBusy || socketRef.current?.readyState !== WebSocket.OPEN) return
    setLobbyBusy(true)
    setNotice('')
    socketRef.current.send(JSON.stringify({
      type: 'lobby-command',
      requestId: crypto.randomUUID(),
      command,
    }))
  }

  const copyCode = async () => {
    await navigator.clipboard.writeText(roomCode)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_200)
  }

  const header = (
    <header className="online-room-header">
      <Link to="/" aria-label="返回准备页面"><ArrowLeft /></Link>
      <div>
        <small>{room?.status === 'waiting' ? '私人房间大厅' : '奥普港在线对局'}</small>
        <strong>房间 {roomCode}</strong>
      </div>
      <button type="button" onClick={copyCode} title="复制房间码" aria-label="复制房间码">
        {copied ? <Check /> : <Copy />}
      </button>
      <span className={`room-connection is-${connection}`}>
        {connection === 'connected' ? <Wifi /> : connection === 'connecting' ? <LoaderCircle /> : <WifiOff />}
        {connectionLabel}
      </span>
    </header>
  )

  if (!room) {
    return (
      <main className="online-room-shell">
        {header}
        <section className="route-message"><LoaderCircle /><h1>正在读取房间</h1></section>
      </main>
    )
  }

  if (room.status === 'waiting' || !snapshot) {
    return (
      <main className="online-room-shell">
        {header}
        <section className="online-room-stage is-lobby">
          <RoomRoster
            room={room}
            snapshot={null}
            viewerPlayerId={identity.playerId}
            canManage={isHost}
            busy={lobbyBusy}
            connection={connection}
            now={presenceNow}
            ownReconnectDeadlineAt={ownReconnectDeadlineAt}
            onRemove={(targetPlayerId) => submitLobby({ type: 'remove-player', playerId: targetPlayerId })}
          />

          <section className="online-lobby-panel" aria-labelledby="lobby-title">
            <div className="online-board-heading">
              <span>房间配置</span>
              <strong id="lobby-title">等待棋手准备</strong>
              <small>全部准备后由房主开始对局</small>
            </div>

            <div className="online-lobby-map">
              <header><span><MapPinned /> 棋盘地图</span><small>开局后锁定</small></header>
              <article className="is-selected">
                <div>
                  <small>经典竞速地图</small>
                  <strong>奥普港</strong>
                  <span>65 格路线 · 9 处地标 · 支持 2–4 名棋手</span>
                </div>
                <Check />
              </article>
              <p>开局后使用完整 PixiJS 棋盘，并按服务端权威事件播放骰子、路线和棋子移动。</p>
            </div>

            <div className="online-lobby-capacity">
              <header><span><UsersRound /> 房间容量</span><small>{isHost ? '房主可调整' : '由房主设置'}</small></header>
              <div role="radiogroup" aria-label="房间最大人数">
                {[2, 3, 4].map((capacity) => (
                  <button
                    className={room.maxPlayers === capacity ? 'is-selected' : ''}
                    type="button"
                    role="radio"
                    aria-checked={room.maxPlayers === capacity}
                    disabled={!isHost || lobbyBusy || capacity < room.players.length}
                    onClick={() => submitLobby({ type: 'set-capacity', maxPlayers: capacity })}
                    key={capacity}
                  >
                    {capacity} 人
                  </button>
                ))}
              </div>
            </div>
          </section>

          <aside className="online-lobby-summary">
            <header><strong>邀请与状态</strong><Copy /></header>
            <div className="lobby-code">
              <small>房间码</small>
              <strong>{roomCode}</strong>
              <button type="button" onClick={copyCode}>{copied ? '已复制' : '复制邀请'}</button>
            </div>
            <div className="lobby-readiness">
              <small>准备进度</small>
              <strong>{room.players.filter((player) => player.ready).length}/{room.players.length}</strong>
              <span>{canStart ? '可以开始' : '仍有棋手未准备'}</span>
            </div>
            {isHost && (
              <button
                className="secondary-command lobby-add-ai"
                type="button"
                disabled={lobbyBusy || room.players.length >= room.maxPlayers}
                onClick={() => submitLobby({ type: 'add-ai' })}
              >
                <UserPlus /> 添加电脑
              </button>
            )}
          </aside>
        </section>

        <footer className="online-command-dock">
          {notice && <p role="alert">{notice}</p>}
          <button
            className={ownRoomPlayer?.ready ? 'secondary-command' : 'primary-command'}
            type="button"
            disabled={lobbyBusy}
            onClick={() => submitLobby({ type: 'set-ready', ready: !ownRoomPlayer?.ready })}
          >
            {ownRoomPlayer?.ready ? <><Circle /> 取消准备</> : <><Check /> 准备</>}
          </button>
          {isHost && (
            <button
              className="primary-command"
              type="button"
              disabled={lobbyBusy || !canStart}
              onClick={() => submitLobby({ type: 'start-game' })}
            >
              <Play /> 开始对局
            </button>
          )}
        </footer>
      </main>
    )
  }

  return (
    <OnlineMatchStage
      room={room}
      snapshot={snapshot}
      viewerPlayerId={identity.playerId}
      legalCommands={legalCommands}
      pendingUpdates={pendingUpdates}
      connection={connection}
      presenceNow={presenceNow}
      ownReconnectDeadlineAt={ownReconnectDeadlineAt}
      commandBusy={commandBusy}
      notice={notice}
      onSubmit={submit}
      onPresented={(id) => setPendingUpdates((current) => current.filter((queued) => queued.id !== id))}
    />
  )
}
