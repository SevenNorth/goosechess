import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft, Check, Copy, Dices, LoaderCircle, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { TECHNICAL_SAMPLE_GAME_DEFINITION } from '@goose-chess/game-content'
import {
  PROTOCOL_SCHEMA_VERSION,
  ServerRoomMessageSchema,
  type GameCommand,
  type GameSnapshot,
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
        } else if (message.type === 'room-error') {
          setNotice(message.message)
        }
      })
      socket.addEventListener('close', () => {
        if (socketRef.current === socket) socketRef.current = null
        if (!stopped) {
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
  }, [playerId, recoveryToken, roomCode])

  if (!identity) {
    return (
      <main className="route-message-shell">
        <section className="route-message">
          <WifiOff />
          <span>在线房间 {roomCode}</span>
          <h1>缺少房间身份</h1>
          <p>请从准备页面创建或加入房间。恢复凭证只保存在当前浏览器标签页中。</p>
          <Link className="primary-button" to="/">返回准备</Link>
        </section>
      </main>
    )
  }

  const activePlayer = room?.players.find((player) => player.playerId === snapshot?.state.activePlayerId)
  const ownSnapshot = snapshot?.state.players.find((player) => player.playerId === identity.playerId)
  const isOwnTurn = snapshot?.state.activePlayerId === identity.playerId
  const itemName = (itemId: string | null | undefined) => (
    TECHNICAL_SAMPLE_GAME_DEFINITION.items.find((item) => item.id === itemId)?.title ?? itemId ?? '暂无'
  )
  const eventName = (eventId: string) => (
    TECHNICAL_SAMPLE_GAME_DEFINITION.events.find((event) => event.id === eventId)?.title ?? eventId
  )

  const submit = (command: GameCommand) => {
    if (!snapshot || !identity || socketRef.current?.readyState !== WebSocket.OPEN) return
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

  const copyCode = async () => {
    await navigator.clipboard.writeText(roomCode)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1_200)
  }

  return (
    <main className="online-room-shell">
      <header className="online-room-header">
        <Link to="/" aria-label="返回准备页面"><ArrowLeft /></Link>
        <div>
          <small>本地联机技术样片</small>
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

      <section className="online-room-stage">
        <aside className="online-player-list" aria-label="房间玩家">
          <header><strong>房间棋手</strong><span>{room?.players.length ?? 1}/2</span></header>
          {room?.players.map((player) => {
            const skin = playerSkinOption(player.skinId)
            const position = snapshot?.state.players.find((candidate) => candidate.playerId === player.playerId)
            return (
              <article className={player.playerId === snapshot?.state.activePlayerId ? 'is-active' : ''} key={player.playerId}>
                <span className="online-player-avatar" style={{ '--player-color': skin.color } as CSSProperties}>
                  <img src={skin.imageSrc} alt="" />
                </span>
                <div>
                  <strong>{player.displayName}{player.playerId === identity.playerId ? '（你）' : ''}</strong>
                  <small>{player.connected ? '在线' : '暂时离线'} · 第 {position ? position.spaceId + 1 : 1} 格</small>
                </div>
              </article>
            )
          })}
          {(!room || room.players.length < 2) && (
            <article className="is-empty"><span>2</span><div><strong>等待加入</strong><small>分享上方房间码</small></div></article>
          )}
        </aside>

        <section className="online-sample-board" aria-label="8 格联机技术样片棋盘">
          <div className="online-board-heading">
            <span>测试港口 · 8 格</span>
            <strong>{snapshot ? PHASE_LABELS[snapshot.state.phase] : '等待另一名玩家加入'}</strong>
            <small>{snapshot ? `第 ${snapshot.state.round} 回合 · revision ${snapshot.revision}` : '双方到齐后自动开始'}</small>
          </div>
          <div className="online-track">
            {TECHNICAL_SAMPLE_GAME_DEFINITION.map.spaces.map((space) => (
              <div className={`online-space is-${space.kind}`} key={space.index}>
                <span>{space.index + 1}</span>
                {room?.players.map((player) => {
                  const playerState = snapshot?.state.players.find((candidate) => candidate.playerId === player.playerId)
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
            <div><small>上次骰点</small><strong>{snapshot?.state.lastDice ? snapshot.state.lastDice.faces.join(' + ') : '尚未投掷'}</strong></div>
          </div>
        </section>

        <aside className="online-activity">
          <header><strong>对局记录</strong><RefreshCw /></header>
          {activity.length ? activity.map((entry, index) => <p key={entry + index}>{entry}</p>) : <p>等待第一条权威事件。</p>}
        </aside>
      </section>

      <footer className="online-command-dock">
        {notice && <p role="alert">{notice}</p>}
        {!snapshot && <span><LoaderCircle /> 等待第二名玩家加入</span>}
        {snapshot?.state.phase === 'determining-order' && (
          <button className="primary-command" type="button" disabled={!isOwnTurn} onClick={() => submit({ type: 'request-order-roll' })}>
            <Dices /> {isOwnTurn ? '投骰决定顺序' : `等待 ${activePlayer?.displayName ?? '对方'} 投骰`}
          </button>
        )}
        {snapshot?.state.phase === 'choosing-starting-item' && (
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
        {snapshot?.state.phase === 'awaiting-action' && (
          <button className="primary-command" type="button" disabled={!isOwnTurn} onClick={() => submit({ type: 'request-roll' })}>
            <Dices /> {isOwnTurn ? '投掷骰子' : `等待 ${activePlayer?.displayName ?? '对方'} 行动`}
          </button>
        )}
        {snapshot?.state.phase === 'awaiting-event-choice' && (
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
        {snapshot?.state.phase === 'awaiting-item-choice' && (
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
        {snapshot?.state.phase === 'game-over' && (
          <strong>{room?.players.find((player) => player.playerId === snapshot.state.winnerPlayerId)?.displayName} 获胜</strong>
        )}
      </footer>
    </main>
  )
}
