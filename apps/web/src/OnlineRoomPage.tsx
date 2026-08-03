import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowLeft,
  Bot,
  Check,
  Circle,
  Copy,
  Crown,
  Dices,
  LoaderCircle,
  MapPinned,
  Play,
  RefreshCw,
  UserMinus,
  UserPlus,
  UsersRound,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { TECHNICAL_SAMPLE_GAME_DEFINITION } from '@goose-chess/game-content'
import {
  PROTOCOL_SCHEMA_VERSION,
  ServerRoomMessageSchema,
  type GameCommand,
  type GameSnapshot,
  type LobbyCommand,
  type RoomState,
} from '@goose-chess/game-protocol'
import { loadOnlineIdentity, roomSocketUrl } from './online-room-client'
import { playerSkinOption } from './player-profile'

const PHASE_LABELS: Record<GameSnapshot['state']['phase'], string> = {
  'determining-order': '投骰决定行动顺序',
  'choosing-starting-item': '选择开局道具',
  'awaiting-action': '等待投骰',
  'awaiting-event-choice': '选择事件',
  'awaiting-item-choice': '确认获得道具',
  'game-over': '对局结束',
}

function eventText(event: { type: string; playerId?: string }, room: RoomState) {
  const playerName = event.playerId
    ? room.players.find((player) => player.playerId === event.playerId)?.displayName
    : null
  if (event.type === 'order-die-rolled') return `${playerName ?? '玩家'}完成了顺序投骰`
  if (event.type === 'starting-item-chosen') return `${playerName ?? '玩家'}选好了开局道具`
  if (event.type === 'dice-rolled') return `${playerName ?? '玩家'}投出了骰子`
  if (event.type === 'token-moved') return `${playerName ?? '玩家'}完成移动`
  if (event.type === 'turn-skipped') return `${playerName ?? '玩家'}跳过本回合`
  if (event.type === 'game-won') return `${playerName ?? '玩家'}抵达终点`
  return null
}

interface RoomRosterProps {
  readonly room: RoomState
  readonly snapshot: GameSnapshot | null
  readonly viewerPlayerId: string
  readonly canManage: boolean
  readonly busy: boolean
  readonly onRemove: (playerId: string) => void
}

function RoomRoster({ room, snapshot, viewerPlayerId, canManage, busy, onRemove }: RoomRosterProps) {
  return (
    <aside className="online-player-list" aria-label="房间玩家">
      <header><strong>房间棋手</strong><span>{room.players.length}/{room.maxPlayers}</span></header>
      {room.players.map((player) => {
        const skin = playerSkinOption(player.skinId)
        const position = snapshot?.state.players.find((candidate) => candidate.playerId === player.playerId)
        const isHost = player.playerId === room.hostPlayerId
        const removable = canManage && player.playerId !== viewerPlayerId && (player.controller === 'ai' || !player.ready)
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
              <small>
                {player.controller === 'ai' ? <><Bot /> 电脑棋手</> : player.connected ? '在线' : '暂时离线'}
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
  const roomRef = useRef<RoomState | null>(null)
  const playerId = identity?.playerId ?? ''
  const recoveryToken = identity?.recoveryToken ?? ''
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [room, setRoom] = useState<RoomState | null>(null)
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null)
  const [notice, setNotice] = useState('')
  const [activity, setActivity] = useState<string[]>([])
  const [copied, setCopied] = useState(false)
  const [lobbyBusy, setLobbyBusy] = useState(false)
  const [removed, setRemoved] = useState(false)

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
          roomRef.current = message.room
          setRoom(message.room)
          if (message.snapshot) setSnapshot(message.snapshot)
        } else if (message.type === 'authority-update') {
          setSnapshot(message.update.snapshot)
          setActivity((current) => [
            ...message.update.events.map((item) => eventText(item, roomRef.current ?? {
              schemaVersion: PROTOCOL_SCHEMA_VERSION,
              roomCode,
              gameId: message.update.snapshot.gameId,
              hostPlayerId: playerId,
              mapId: message.update.snapshot.mapId,
              maxPlayers: message.update.snapshot.state.players.length,
              status: 'playing' as const,
              players: [],
            })).filter((item): item is string => Boolean(item)),
            ...current,
          ].slice(0, 5))
        } else if (message.type === 'command-result' && !message.result.ok) {
          setNotice(message.result.error.code === 'stale_revision'
            ? '状态已更新，请按最新画面重新操作。'
            : message.result.error.message)
          if (message.result.error.code === 'stale_revision') socket.send(JSON.stringify({ type: 'sync-request' }))
        } else if (message.type === 'lobby-result') {
          setLobbyBusy(false)
          if (!message.ok) setNotice(message.error?.message ?? '大厅操作失败。')
        } else if (message.type === 'room-error') {
          setLobbyBusy(false)
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
  const activePlayer = room?.players.find((player) => player.playerId === snapshot?.state.activePlayerId)
  const ownSnapshot = snapshot?.state.players.find((player) => player.playerId === identity.playerId)
  const isHost = room?.hostPlayerId === identity.playerId
  const isOwnTurn = snapshot?.state.activePlayerId === identity.playerId
  const canStart = Boolean(
    room
    && room.players.length >= 2
    && room.players.every((player) => player.ready),
  )
  const itemName = (itemId: string | null | undefined) => (
    TECHNICAL_SAMPLE_GAME_DEFINITION.items.find((item) => item.id === itemId)?.title ?? itemId ?? '暂无'
  )
  const eventName = (eventId: string) => (
    TECHNICAL_SAMPLE_GAME_DEFINITION.events.find((event) => event.id === eventId)?.title ?? eventId
  )

  const submit = (command: GameCommand) => {
    if (!snapshot || socketRef.current?.readyState !== WebSocket.OPEN) return
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
        <small>{room?.status === 'waiting' ? '私人房间大厅' : '本地联机技术样片'}</small>
        <strong>房间 {roomCode}</strong>
      </div>
      <button type="button" onClick={copyCode} title="复制房间码" aria-label="复制房间码">
        {copied ? <Check /> : <Copy />}
      </button>
      <span className={`room-connection is-${connection}`}>
        {connection === 'connected' ? <Wifi /> : connection === 'connecting' ? <LoaderCircle /> : <WifiOff />}
        {connection === 'connected' ? '已连接' : connection === 'connecting' ? '连接中' : '重连中'}
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
                  <small>联机技术样片</small>
                  <strong>测试港口</strong>
                  <span>8 格路线 · 支持 2–4 名棋手</span>
                </div>
                <Check />
              </article>
              <p>完整奥普港将在下一阶段接入现有 PixiJS 棋盘与表现队列。</p>
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
    <main className="online-room-shell">
      {header}
      <section className="online-room-stage">
        <RoomRoster
          room={room}
          snapshot={snapshot}
          viewerPlayerId={identity.playerId}
          canManage={false}
          busy={false}
          onRemove={() => undefined}
        />

        <section className="online-sample-board" aria-label="8 格联机技术样片棋盘">
          <div className="online-board-heading">
            <span>测试港口 · 8 格</span>
            <strong>{PHASE_LABELS[snapshot.state.phase]}</strong>
            <small>{`第 ${snapshot.state.round} 回合 · revision ${snapshot.revision}`}</small>
          </div>
          <div className="online-track">
            {TECHNICAL_SAMPLE_GAME_DEFINITION.map.spaces.map((space) => (
              <div className={`online-space is-${space.kind}`} key={space.index}>
                <span>{space.index + 1}</span>
                {room.players.map((player) => {
                  const playerState = snapshot.state.players.find((candidate) => candidate.playerId === player.playerId)
                  if (playerState?.spaceId !== space.index) return null
                  const skin = playerSkinOption(player.skinId)
                  return (
                    <img
                      className="online-track-token"
                      style={{ '--seat-offset': player.seatIndex } as CSSProperties}
                      src={skin.imageSrc}
                      alt={player.displayName}
                      title={player.displayName}
                      key={player.playerId}
                    />
                  )
                })}
              </div>
            ))}
          </div>
          <div className="online-turn-summary">
            <div><small>当前行动</small><strong>{activePlayer?.displayName ?? '等待开局'}</strong></div>
            <div><small>你的道具</small><strong>{itemName(ownSnapshot?.itemId)}</strong></div>
            <div><small>上次骰点</small><strong>{snapshot.state.lastDice ? snapshot.state.lastDice.faces.join(' + ') : '尚未投掷'}</strong></div>
          </div>
        </section>

        <aside className="online-activity">
          <header><strong>对局记录</strong><RefreshCw /></header>
          {activity.length ? activity.map((entry, index) => <p key={entry + index}>{entry}</p>) : <p>等待第一条权威事件。</p>}
        </aside>
      </section>

      <footer className="online-command-dock">
        {notice && <p role="alert">{notice}</p>}
        {snapshot.state.phase === 'determining-order' && (
          <button className="primary-command" type="button" disabled={!isOwnTurn} onClick={() => submit({ type: 'request-order-roll' })}>
            <Dices /> {isOwnTurn ? '投骰决定顺序' : `等待 ${activePlayer?.displayName ?? '对方'} 投骰`}
          </button>
        )}
        {snapshot.state.phase === 'choosing-starting-item' && (
          <div className="online-choice-row">
            {isOwnTurn
              ? snapshot.state.startingItemOfferIds.map((itemId) => (
                <button className="secondary-command" type="button" onClick={() => submit({ type: 'choose-starting-item', itemId })} key={itemId}>
                  {itemName(itemId)}
                </button>
              ))
              : <span>等待 {activePlayer?.displayName ?? '对方'} 选择开局道具</span>}
          </div>
        )}
        {snapshot.state.phase === 'awaiting-action' && (
          <button className="primary-command" type="button" disabled={!isOwnTurn} onClick={() => submit({ type: 'request-roll' })}>
            <Dices /> {isOwnTurn ? '投掷骰子' : `等待 ${activePlayer?.displayName ?? '对方'} 行动`}
          </button>
        )}
        {snapshot.state.phase === 'awaiting-event-choice' && (
          <div className="online-choice-row">
            {isOwnTurn
              ? snapshot.state.pendingEventIds.map((eventId) => (
                <button className="secondary-command" type="button" onClick={() => submit({ type: 'choose-event', eventId })} key={eventId}>
                  {eventName(eventId)}
                </button>
              ))
              : <span>等待 {activePlayer?.displayName ?? '对方'} 选择事件</span>}
          </div>
        )}
        {snapshot.state.phase === 'awaiting-item-choice' && (
          <div className="online-choice-row">
            {isOwnTurn ? (
              <>
                <button className="primary-command" type="button" onClick={() => submit({ type: 'choose-item', itemId: snapshot.state.pendingItemId })}>
                  保留 {itemName(snapshot.state.pendingItemId)}
                </button>
                <button className="secondary-command" type="button" onClick={() => submit({ type: 'choose-item', itemId: null })}>放弃</button>
              </>
            ) : <span>等待 {activePlayer?.displayName ?? '对方'} 确认道具</span>}
          </div>
        )}
        {snapshot.state.phase === 'game-over' && (
          <strong>{room.players.find((player) => player.playerId === snapshot.state.winnerPlayerId)?.displayName} 获胜</strong>
        )}
      </footer>
    </main>
  )
}
