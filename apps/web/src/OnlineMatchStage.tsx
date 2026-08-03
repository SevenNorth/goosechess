import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft, Check, Crown, Dices, PackageOpen, Wifi, WifiOff, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { DEFAULT_GAME_DEFINITION } from '@goose-chess/game-content'
import type { AuthorityUpdate, GameCommand, GameSnapshot, RoomState } from '@goose-chess/game-protocol'
import { PixiBoard } from './scene/PixiBoard'
import type { BoardSceneController } from './scene/BoardScene'
import type { PresentationStage } from './game-client/machine/presentation-machine'
import type { ThreeDiceRollerHandle } from './dice/ThreeDiceRoller'
import { ItemUsePresentation, type ItemUsePresentationData } from './items/ItemUsePresentation'
import { PauseTurnIndicator } from './hud/PauseTurnIndicator'
import { PauseTurnOverlay } from './hud/PauseTurnOverlay'
import { COLOR_HEX, ITEM_COPY, eventById, itemById } from './game-presentation-content'
import { playerSkinOption } from './player-profile'

const ThreeDiceRoller = lazy(() => import('./dice/ThreeDiceRoller').then((module) => ({ default: module.ThreeDiceRoller })))

const STAGE_LABELS: Readonly<Record<PresentationStage, string>> = {
  ready: '等待行动',
  rolling: '骰子滚动',
  routePreview: '路线预览',
  targetEmphasis: '目标锁定',
  routeFade: '路线收起',
  moving: '棋子移动',
}

export interface OnlineQueuedUpdate {
  readonly id: number
  readonly update: AuthorityUpdate
  readonly previousSnapshot: GameSnapshot
}

interface OnlineMatchStageProps {
  readonly room: RoomState
  readonly snapshot: GameSnapshot
  readonly viewerPlayerId: string
  readonly legalCommands: readonly GameCommand[]
  readonly pendingUpdates: readonly OnlineQueuedUpdate[]
  readonly connection: 'connecting' | 'connected' | 'disconnected'
  readonly commandBusy: boolean
  readonly notice: string
  readonly onSubmit: (command: GameCommand) => void
  readonly onPresented: (id: number) => void
}

interface PausePresentationState {
  readonly id: number
  readonly playerId: string
  readonly previousTurns: number
  readonly remainingTurns: number
  readonly durationMs: number
}

interface ItemGainConfirmation {
  readonly itemId: string
  readonly revision: number
}

interface CountdownConfirmButtonProps {
  readonly label: string
  readonly seconds: number
  readonly className?: string
  readonly disabled?: boolean
  readonly onConfirm: () => void
}

function CountdownConfirmButton({ label, seconds, className, disabled, onConfirm }: CountdownConfirmButtonProps) {
  const actionRef = useRef(onConfirm)
  const firedRef = useRef(false)
  const [remainingSeconds, setRemainingSeconds] = useState(seconds)

  useEffect(() => {
    actionRef.current = onConfirm
  }, [onConfirm])

  const confirm = useCallback(() => {
    if (firedRef.current) return
    firedRef.current = true
    actionRef.current()
  }, [])

  useEffect(() => {
    const deadline = Date.now() + seconds * 1_000
    const interval = window.setInterval(() => {
      setRemainingSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1_000)))
    }, 200)
    const timeout = window.setTimeout(confirm, seconds * 1_000)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [confirm, seconds])

  return (
    <button className={className} type="button" aria-label={label} disabled={disabled} onClick={confirm}>
      <Check /> {label}<span className="confirm-countdown" aria-hidden="true">{remainingSeconds}秒</span>
    </button>
  )
}

export function OnlineMatchStage({
  room,
  snapshot,
  viewerPlayerId,
  legalCommands,
  pendingUpdates,
  connection,
  commandBusy,
  notice,
  onSubmit,
  onPresented,
}: OnlineMatchStageProps) {
  const [presentedSnapshot, setPresentedSnapshot] = useState(snapshot)
  const [board, setBoard] = useState<BoardSceneController | null>(null)
  const [presentationStage, setPresentationStage] = useState<PresentationStage>('ready')
  const [selectedStartingItem, setSelectedStartingItem] = useState<string | null>(null)
  const [keepPendingItem, setKeepPendingItem] = useState(false)
  const [itemDetailsOpen, setItemDetailsOpen] = useState(false)
  const [selectedItemTargetId, setSelectedItemTargetId] = useState<string | null>(null)
  const [itemUsePresentation, setItemUsePresentation] = useState<ItemUsePresentationData | null>(null)
  const [pausePresentation, setPausePresentation] = useState<PausePresentationState | null>(null)
  const [itemGainConfirmation, setItemGainConfirmation] = useState<ItemGainConfirmation | null>(null)
  const diceRef = useRef<ThreeDiceRollerHandle>(null)
  const mountedRef = useRef(true)
  const processingIdRef = useRef<number | null>(null)
  const itemUseIdRef = useRef(1)
  const itemUseResolverRef = useRef<(() => void) | null>(null)
  const pauseIdRef = useRef(1)
  const pauseResolverRef = useRef<(() => void) | null>(null)
  const pauseTimerRef = useRef<number | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      itemUseResolverRef.current?.()
      pauseResolverRef.current?.()
      if (pauseTimerRef.current !== null) window.clearTimeout(pauseTimerRef.current)
    }
  }, [])

  const finishItemUse = useCallback(() => {
    const resolve = itemUseResolverRef.current
    itemUseResolverRef.current = null
    setItemUsePresentation(null)
    resolve?.()
  }, [])

  const presentItemUse = useCallback((
    playerId: string,
    itemId: string,
    targetPlayerId: string | undefined,
    sourceSnapshot: GameSnapshot,
    speed: number,
  ) => {
    const player = sourceSnapshot.state.players.find((candidate) => candidate.playerId === playerId)
    const target = sourceSnapshot.state.players.find((candidate) => candidate.playerId === targetPlayerId)
    const item = itemById(itemId)
    if (!player || !item || !mountedRef.current) return Promise.resolve()
    const copy = ITEM_COPY[item.id]
    return new Promise<void>((resolve) => {
      itemUseResolverRef.current = resolve
      setItemUsePresentation({
        id: itemUseIdRef.current++,
        playerName: player.displayName,
        targetPlayerName: target?.displayName,
        playerColor: COLOR_HEX[player.colorId],
        itemTitle: item.title,
        itemMode: item.mode,
        description: copy?.description ?? item.description,
        source: playerId === viewerPlayerId ? 'local' : 'remote',
        durationMs: import.meta.env.MODE === 'test' ? 50 : Math.max(2_600, 3_800 / speed),
        Icon: copy?.icon ?? PackageOpen,
      })
    })
  }, [viewerPlayerId])

  const finishPause = useCallback(() => {
    if (pauseTimerRef.current !== null) window.clearTimeout(pauseTimerRef.current)
    pauseTimerRef.current = null
    const resolve = pauseResolverRef.current
    pauseResolverRef.current = null
    setPausePresentation(null)
    resolve?.()
  }, [])

  const presentPause = useCallback((playerId: string, remainingTurns: number) => new Promise<void>((resolve) => {
    const durationMs = import.meta.env.MODE === 'test' ? 50 : 1_800
    pauseResolverRef.current = resolve
    setPausePresentation({
      id: pauseIdRef.current++,
      playerId,
      previousTurns: remainingTurns + 1,
      remainingTurns,
      durationMs,
    })
    pauseTimerRef.current = window.setTimeout(finishPause, durationMs)
  }), [finishPause])

  useEffect(() => {
    const queued = pendingUpdates[0]
    if (!board || !queued || itemGainConfirmation || processingIdRef.current !== null) return
    processingIdRef.current = queued.id
    void (async () => {
      await board.playUpdate(queued.update, queued.previousSnapshot, {
        speed: 1,
        cameraMotion: true,
        onStageChange: (stage) => mountedRef.current && setPresentationStage(stage),
        playDice: (cue, speed) => diceRef.current?.roll(cue, speed) ?? Promise.resolve(),
        cancelDice: () => diceRef.current?.cancel(),
        playItemUse: (playerId, itemId, targetPlayerId, speed) => (
          presentItemUse(playerId, itemId, targetPlayerId, queued.previousSnapshot, speed)
        ),
        cancelItemUse: finishItemUse,
      })
      for (const event of queued.update.events) {
        if (event.type === 'turn-skipped') await presentPause(event.playerId, event.remainingTurns)
      }
      const previousOwnItemId = queued.previousSnapshot.state.players.find(
        (player) => player.playerId === viewerPlayerId,
      )?.itemId ?? null
      const nextOwnItemId = queued.update.snapshot.state.players.find(
        (player) => player.playerId === viewerPlayerId,
      )?.itemId ?? null
      const directlyGainedItem = queued.update.events.some(
        (event) => event.type === 'event-resolved' && event.playerId === viewerPlayerId,
      ) && previousOwnItemId === null && nextOwnItemId !== null
        && queued.update.snapshot.state.pendingItemId === null
      if (mountedRef.current) {
        setPresentedSnapshot(queued.update.snapshot)
        if (directlyGainedItem) {
          setItemGainConfirmation({ itemId: nextOwnItemId, revision: queued.update.snapshot.revision })
        }
      }
    })().catch((error: unknown) => {
      console.error('Online presentation playback failed.', error)
      board.sync(queued.update.snapshot)
      if (mountedRef.current) setPresentedSnapshot(queued.update.snapshot)
    }).finally(() => {
      processingIdRef.current = null
      if (mountedRef.current) onPresented(queued.id)
    })
  }, [board, finishItemUse, itemGainConfirmation, onPresented, pendingUpdates, presentItemUse, presentPause, viewerPlayerId])

  useEffect(() => {
    if (pendingUpdates.length || processingIdRef.current !== null || snapshot.revision === presentedSnapshot.revision) return
    setPresentedSnapshot(snapshot)
    board?.sync(snapshot)
  }, [board, pendingUpdates.length, presentedSnapshot.revision, snapshot])

  const ownPlayer = presentedSnapshot.state.players.find((player) => player.playerId === viewerPlayerId)
  const activePlayer = presentedSnapshot.state.players.find((player) => player.playerId === presentedSnapshot.state.activePlayerId)
    ?? presentedSnapshot.state.players[0]
  const ownItem = itemById(ownPlayer?.itemId)
  const pendingItem = itemById(presentedSnapshot.state.pendingItemId)
  const gainedItem = itemById(itemGainConfirmation?.itemId)
  const locked = commandBusy || pendingUpdates.length > 0
    || snapshot.revision !== presentedSnapshot.revision
  const legal = <T extends GameCommand['type']>(type: T) => legalCommands.filter(
    (command): command is Extract<GameCommand, { type: T }> => command.type === type,
  )
  const orderRollCommand = legal('request-order-roll')[0]
  const movementRollCommand = legal('request-roll')[0]
  const startingItemCommands = legal('choose-starting-item')
  const eventChoiceCommands = legal('choose-event')
  const itemChoiceCommands = legal('choose-item')
  const itemUseCommands = legal('use-item')
  const itemTargetCommands = itemUseCommands.filter((command) => command.targetPlayerId !== undefined)
  const selectedStartingItemCommand = startingItemCommands.find(
    (command) => command.itemId === selectedStartingItem,
  )
  const selectedItemChoiceCommand = itemChoiceCommands.find(
    (command) => command.itemId === (keepPendingItem ? pendingItem?.id : null),
  )
  const selectedItemCommand = itemTargetCommands.length
    ? itemTargetCommands.find((command) => command.targetPlayerId === selectedItemTargetId)
    : itemUseCommands[0]
  const targetPlayers = itemTargetCommands.map((command) => presentedSnapshot.state.players.find(
    (player) => player.playerId === command.targetPlayerId,
  )).filter((player) => player !== undefined)
  const finalSpaceId = DEFAULT_GAME_DEFINITION.map.spaces.at(-1)?.index ?? 65
  const provisionalOrder = presentedSnapshot.state.turnOrderGroups.flat()
  const orderIndex = new Map(provisionalOrder.map((playerId, index) => [playerId, index]))
  const hudPlayers = [...presentedSnapshot.state.players].sort((left, right) => {
    const leftIndex = orderIndex.get(left.playerId)
    const rightIndex = orderIndex.get(right.playerId)
    if (leftIndex !== undefined && rightIndex !== undefined) return leftIndex - rightIndex
    if (leftIndex !== undefined) return -1
    if (rightIndex !== undefined) return 1
    return left.seatIndex - right.seatIndex
  })
  const latestOrderFaces = new Map<string, number>()
  for (const round of presentedSnapshot.state.orderRollHistory) {
    for (const result of round.results) latestOrderFaces.set(result.playerId, result.face)
  }
  for (const result of presentedSnapshot.state.orderRollResults) latestOrderFaces.set(result.playerId, result.face)
  const unresolvedOrderGroup = presentedSnapshot.state.turnOrderGroups.find((group) => group.length > 1) ?? []
  const startingItems = presentedSnapshot.state.startingItemOfferIds.map(itemById).filter((item) => item !== undefined)
  const offeredEvents = presentedSnapshot.state.pendingEventIds.map(eventById).filter((event) => event !== undefined)
  const activeSpace = DEFAULT_GAME_DEFINITION.map.spaces.find((space) => space.index === activePlayer.spaceId)
  const activeLandmark = DEFAULT_GAME_DEFINITION.map.landmarks.find((landmark) => landmark.id === activeSpace?.landmarkId)
  const pausedPlayer = pausePresentation
    ? presentedSnapshot.state.players.find((player) => player.playerId === pausePresentation.playerId)
    : undefined
  const standings = [...presentedSnapshot.state.players].sort(
    (left, right) => right.spaceId - left.spaceId || left.seatIndex - right.seatIndex,
  )

  useEffect(() => {
    if (presentedSnapshot.state.phase !== 'choosing-starting-item' || presentedSnapshot.state.activePlayerId !== viewerPlayerId) return
    setSelectedStartingItem((current) => presentedSnapshot.state.startingItemOfferIds.includes(current ?? '')
      ? current
      : presentedSnapshot.state.startingItemOfferIds[0] ?? null)
  }, [presentedSnapshot.revision, presentedSnapshot.state.activePlayerId, presentedSnapshot.state.phase, presentedSnapshot.state.startingItemOfferIds, viewerPlayerId])

  return (
    <main className="stage5-shell online-full-match">
      <PixiBoard
        map={DEFAULT_GAME_DEFINITION.map}
        snapshot={presentedSnapshot}
        onReady={(controller) => { controller.sync(presentedSnapshot); setBoard(controller) }}
        onDispose={() => setBoard(null)}
      />
      <Suspense fallback={null}>
        <ThreeDiceRoller
          ref={diceRef}
          canRoll={Boolean(!locked && movementRollCommand)}
          stage={presentationStage}
          onRoll={() => movementRollCommand && onSubmit(movementRollCommand)}
        />
      </Suspense>

      {itemUsePresentation && <ItemUsePresentation presentation={itemUsePresentation} onComplete={finishItemUse} />}
      {pausePresentation && pausedPlayer && (
        <PauseTurnOverlay
          playerName={pausedPlayer.displayName}
          playerColor={COLOR_HEX[pausedPlayer.colorId]}
          turns={pausePresentation.previousTurns}
          presentation={pausePresentation}
        />
      )}

      <header className="stage5-topbar">
        <div className="stage5-brand"><span>鹅</span><div><strong>鹅了个棋</strong><small>奥普港 65 格联机 · 房间 {room.roomCode}</small></div></div>
        <div className="online-match-connection">
          {connection === 'connected' ? <Wifi /> : <WifiOff />}
          <span>{connection === 'connected' ? '已连接' : connection === 'connecting' ? '连接中' : '重连中'}</span>
          <Link className="icon-command" to="/" title="返回准备" aria-label="返回准备"><ArrowLeft /></Link>
        </div>
      </header>

      <section className="floating-players" aria-label="联机参赛棋手">
        {hudPlayers.map((player) => {
          const skin = playerSkinOption(player.skinId)
          const progress = Math.round(player.spaceId / finalSpaceId * 100)
          return (
            <article className={player.playerId === activePlayer.playerId ? 'hud-player is-active' : 'hud-player'} key={player.playerId} style={{ '--seat-color': COLOR_HEX[player.colorId], '--avatar-color': skin.color } as CSSProperties}>
              <span className="hud-avatar"><img src={skin.imageSrc} alt={`${player.displayName}的棋子头像`} /></span>
              <div className="hud-player-copy">
                <div><strong title={player.displayName}>{player.displayName}{player.playerId === viewerPlayerId ? '（你）' : ''}</strong><span>{player.spaceId} / {finalSpaceId}</span></div>
                <div className="hud-progress"><i style={{ width: `${progress}%` }} /></div>
                {player.playerId === viewerPlayerId && <small>{ownItem?.title ?? '无道具'}</small>}
                <PauseTurnIndicator playerName={player.displayName} turns={player.skipTurns} />
              </div>
            </article>
          )
        })}
      </section>

      <aside className="round-float" aria-label="回合信息"><small>ROUND</small><strong>{presentedSnapshot.state.round}</strong><span>{STAGE_LABELS[presentationStage]}</span></aside>
      {presentedSnapshot.state.globalDieRule && <aside className="world-rule-float"><Dices /><div><small>全局骰子规则</small><strong>单骰最多 {presentedSnapshot.state.globalDieRule.maxFace} 点</strong><span>剩余 {presentedSnapshot.state.globalDieRule.remainingRounds} 轮</span></div></aside>}
      <section className="turn-banner" aria-live="polite"><span style={{ background: COLOR_HEX[activePlayer.colorId] }} /><div><small>当前行动</small><strong>{activePlayer.displayName}</strong></div></section>

      <button className={`${ownItem ? 'held-item has-item' : 'held-item'}${presentationStage === 'ready' ? '' : ' is-obscured'}`} type="button" disabled={!ownItem || locked} onClick={() => { setSelectedItemTargetId(null); setItemDetailsOpen(true) }}>
        {ownItem ? <><span>当前道具 · {ownItem.mode}</span><strong>{ownItem.title}</strong><small>{ITEM_COPY[ownItem.id]?.description}</small></> : <><PackageOpen /><strong>暂无道具</strong></>}
      </button>

      {notice && <p className="online-match-notice" role="alert">{notice}</p>}

      {presentedSnapshot.state.phase === 'determining-order' && (
        <div className="overlay-stage order-overlay"><section className="order-panel" role="dialog" aria-modal="true" aria-labelledby="online-order-title">
          <div className="panel-kicker">联机开局座次</div>
          <h2 id="online-order-title">{unresolvedOrderGroup.length < presentedSnapshot.state.players.length ? '同点小组重新投掷' : '投掷单骰决定顺序'}</h2>
          <ol className="order-list" style={{ '--order-player-count': provisionalOrder.length } as CSSProperties}>
            {provisionalOrder.map((playerId, index) => {
              const player = presentedSnapshot.state.players.find((candidate) => candidate.playerId === playerId)!
              return <li className={presentedSnapshot.state.activePlayerId === playerId ? 'is-rolling' : ''} key={playerId} style={{ '--seat-color': COLOR_HEX[player.colorId] } as CSSProperties}>
                <span className="order-rank">{index + 1}</span><span className="order-player"><strong>{player.displayName}</strong></span>
                <img className="order-token" src={playerSkinOption(player.skinId).imageSrc} alt={`${player.displayName}的棋子`} />
                <span className="order-die" aria-label={latestOrderFaces.has(playerId) ? `${latestOrderFaces.get(playerId)} 点` : '尚未投掷'}>{latestOrderFaces.get(playerId) ?? '·'}</span>
              </li>
            })}
          </ol>
          {orderRollCommand
            ? <button className="primary-command order-command" type="button" disabled={locked || !board} onClick={() => onSubmit(orderRollCommand)}><Dices /> 投掷单骰</button>
            : <div className="order-wait" aria-live="polite"><Dices /> {activePlayer.displayName} 正在投掷</div>}
        </section></div>
      )}

      {presentedSnapshot.state.phase === 'choosing-starting-item' && (
        <div className="overlay-stage setup-overlay"><section className="setup-panel" role="dialog" aria-modal="true" aria-labelledby="online-setup-title">
          <div className="panel-kicker">起始道具 · 联机房间</div><h1 id="online-setup-title">{activePlayer.displayName} 选择起始道具</h1>
          {activePlayer.playerId === viewerPlayerId ? <>
            <div className="setup-item-grid" role="radiogroup" aria-label="抽取的起始道具">
              {startingItems.map((item) => { const Icon = ITEM_COPY[item.id]?.icon ?? PackageOpen; return <button type="button" role="radio" aria-checked={selectedStartingItem === item.id} className={selectedStartingItem === item.id ? 'setup-item is-selected' : 'setup-item'} onClick={() => setSelectedStartingItem(item.id)} key={item.id}><Icon /><span>{item.mode}</span><strong>{item.title}</strong><small>{ITEM_COPY[item.id]?.description}</small>{selectedStartingItem === item.id && <Check />}</button> })}
            </div>
            <button className="primary-command setup-start" type="button" disabled={locked || !selectedStartingItemCommand} onClick={() => selectedStartingItemCommand && onSubmit(selectedStartingItemCommand)}><Check /> 确认选择</button>
          </> : <div className="order-wait"><PackageOpen /> {activePlayer.displayName} 正在选择</div>}
        </section></div>
      )}

      {!locked && presentedSnapshot.state.phase === 'awaiting-event-choice' && activePlayer.playerId === viewerPlayerId && (
        <div className="overlay-stage event-overlay"><section className="event-panel" aria-labelledby="online-event-title">
          <div className="panel-kicker">{activeLandmark ? `${activeLandmark.name} · 地标事件` : '遭遇事件'}</div><h2 id="online-event-title">从三张牌中选择</h2>
          <div className="event-card-grid">{offeredEvents.map((event, index) => { const eventCommand = eventChoiceCommands.find((command) => command.eventId === event.id); return <button className={`event-choice tone-${index}`} type="button" disabled={!eventCommand} onClick={() => eventCommand && onSubmit(eventCommand)} key={event.id}><span>{event.kind}</span><div className="event-sketch">{['!', '?', '↗'][index]}</div><strong>{event.title}</strong><p>{event.flavor}</p><small>{event.threshold ? `双骰 ≥ ${event.threshold}` : '直接结算'}</small></button> })}</div>
        </section></div>
      )}

      {!locked && presentedSnapshot.state.phase === 'awaiting-item-choice' && activePlayer.playerId === viewerPlayerId && pendingItem && (
        <div className="overlay-stage item-compare-overlay"><section className="item-compare-panel" role="dialog" aria-modal="true" aria-labelledby="online-item-title">
          <div className="panel-kicker">发现新道具</div><h2 id="online-item-title">选择保留的道具</h2>
          <div className="item-compare-grid" role="radiogroup" aria-label="要保留的道具">
            <button className={keepPendingItem ? '' : 'is-selected'} type="button" role="radio" aria-checked={!keepPendingItem} onClick={() => setKeepPendingItem(false)}><span>当前</span><strong>{ownItem?.title ?? '空道具栏'}</strong><small>{ownItem ? ITEM_COPY[ownItem.id]?.description : '保留空道具栏'}</small>{!keepPendingItem && <Check className="item-choice-check" />}</button>
            <button className={keepPendingItem ? 'is-selected' : ''} type="button" role="radio" aria-checked={keepPendingItem} onClick={() => setKeepPendingItem(true)}><span>新道具</span><strong>{pendingItem.title}</strong><small>{ITEM_COPY[pendingItem.id]?.description}</small>{keepPendingItem && <Check className="item-choice-check" />}</button>
          </div>
          <CountdownConfirmButton key={pendingItem.id} className="primary-command item-choice-confirm" label="确认保留" seconds={5} disabled={locked || !selectedItemChoiceCommand} onConfirm={() => { if (!selectedItemChoiceCommand) return; setKeepPendingItem(false); onSubmit(selectedItemChoiceCommand) }} />
        </section></div>
      )}

      {itemGainConfirmation && gainedItem && (
        <div className="overlay-stage item-compare-overlay"><section className="item-compare-panel item-gain-panel" role="dialog" aria-modal="true" aria-labelledby="online-item-gain-title">
          <div className="panel-kicker">获得新道具</div><h2 id="online-item-gain-title">确认收下道具</h2>
          <div className="item-compare-grid is-single"><article className="item-gain-card"><span>{gainedItem.mode}道具</span><strong>{gainedItem.title}</strong><small>{ITEM_COPY[gainedItem.id]?.description}</small><Check className="item-choice-check" /></article></div>
          <CountdownConfirmButton key={itemGainConfirmation.revision} className="primary-command item-choice-confirm" label="确认收下" seconds={3} onConfirm={() => setItemGainConfirmation(null)} />
        </section></div>
      )}

      {itemDetailsOpen && ownItem && (
        <div className="item-modal-backdrop" onClick={() => setItemDetailsOpen(false)}><section className={targetPlayers.length ? 'item-modal has-targets' : 'item-modal'} role="dialog" aria-modal="true" aria-labelledby="online-item-use-title" onClick={(event) => event.stopPropagation()}>
          <button className="drawer-close" type="button" title="关闭道具详情" aria-label="关闭道具详情" onClick={() => setItemDetailsOpen(false)}><X /></button>
          <div className="item-modal-icon"><PackageOpen /></div><span>{ownItem.mode}道具</span><h2 id="online-item-use-title">{itemUseCommands.length ? `使用${ownItem.title}` : ownItem.title}</h2><p>{ITEM_COPY[ownItem.id]?.description}</p>
          {targetPlayers.length > 0 && <div className="item-target-picker" role="radiogroup" aria-label="选择道具目标" style={{ '--target-count': Math.min(4, targetPlayers.length) } as CSSProperties}>{targetPlayers.map((player) => <button className={selectedItemTargetId === player.playerId ? 'is-selected' : ''} type="button" role="radio" aria-checked={selectedItemTargetId === player.playerId} onClick={() => setSelectedItemTargetId(player.playerId)} key={player.playerId} style={{ '--seat-color': COLOR_HEX[player.colorId] } as CSSProperties}><strong>{player.displayName}</strong><img src={playerSkinOption(player.skinId).imageSrc} alt={`${player.displayName}的棋子`} /><span>第 {player.spaceId} 格</span>{selectedItemTargetId === player.playerId && <Check />}</button>)}</div>}
          <div className="item-modal-actions"><button className="secondary-command" type="button" onClick={() => setItemDetailsOpen(false)}>取消</button>{itemUseCommands.length > 0 && <button className="primary-command" type="button" disabled={!selectedItemCommand || locked} onClick={() => { if (!selectedItemCommand) return; setItemDetailsOpen(false); onSubmit(selectedItemCommand) }}><Check /> 确认使用</button>}</div>
        </section></div>
      )}

      {presentedSnapshot.state.phase === 'game-over' && (
        <div className="overlay-stage win-overlay"><section className="win-panel"><div className="win-landmark"><img src="/assets/maps/aup-port/noise-house.png" alt="喧声屋" /><Crown /></div><div className="win-summary"><div className="panel-kicker">联机终局</div><h2>{presentedSnapshot.state.players.find((player) => player.playerId === presentedSnapshot.state.winnerPlayerId)?.displayName} 获胜</h2><p>第 {presentedSnapshot.state.round} 轮抵达喧声屋</p><ol className="final-ranking">{standings.map((player, index) => <li key={player.playerId}><span>{index + 1}</span><strong>{player.displayName}</strong><small>第 {player.spaceId} 格</small></li>)}</ol></div></section></div>
      )}
    </main>
  )
}
