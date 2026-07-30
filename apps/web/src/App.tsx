import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  Check,
  Crown,
  Dices,
  Footprints,
  History,
  House,
  PackageOpen,
  RotateCcw,
  SlidersHorizontal,
  Shield,
  Sparkles,
  UserRound,
  VolumeX,
  X,
} from 'lucide-react'
import { AiTurnController, createGooseAiStrategy } from '@goose-chess/game-ai'
import { DeterministicRandom, type CoreGameCommand, type EventDefinition } from '@goose-chess/game-core'
import { DEFAULT_GAME_DEFINITION } from '@goose-chess/game-content'
import {
  createOfflineMatch,
  type AuthorityUpdate,
  type CommandResult,
  type GameSnapshot,
  type OfflineMatchMode,
} from '@goose-chess/game-protocol'
import { PixiBoard } from './scene/PixiBoard'
import type { BoardSceneController } from './scene/BoardScene'
import type { PresentationStage } from './game-client/machine/presentation-machine'
import type { ThreeDiceRollerHandle } from './dice/ThreeDiceRoller'
import { ItemUsePresentation, type ItemUsePresentationData } from './items/ItemUsePresentation'

const ThreeDiceRoller = lazy(() => import('./dice/ThreeDiceRoller').then((module) => ({ default: module.ThreeDiceRoller })))

const GAME_DEFINITION = DEFAULT_GAME_DEFINITION

const STAGE_LABELS: Readonly<Record<PresentationStage, string>> = {
  ready: '等待行动',
  rolling: '骰子滚动',
  routePreview: '路线预览',
  targetEmphasis: '目标锁定',
  routeFade: '路线收起',
  moving: '棋子移动',
}
const COLOR_HEX: Readonly<Record<string, string>> = {
  pink: '#e82f73', blue: '#3977c5', gold: '#d4a43a', teal: '#2baf9c',
}
const SKIN_SWATCHES = [
  { id: 'goose-white', label: '白鹅', color: '#ece9dc' },
  { id: 'goose-yellow', label: '黄鹅', color: '#dda735' },
  { id: 'goose-blue', label: '蓝鹅', color: '#75a7d5' },
  { id: 'goose-pink', label: '粉鹅', color: '#db7d9c' },
] as const
const ITEM_COPY: Readonly<Record<string, { icon: typeof Footprints; description: string }>> = {
  boots: { icon: Footprints, description: '使用后，本次移动额外前进 3 格。' },
  clover: { icon: Sparkles, description: '下一次骰子检定必定成功。' },
  cat: { icon: Shield, description: '自动抵消下一次被撞回效果。' },
  barnacle: { icon: PackageOpen, description: '让下一位对手立即后退 2 格。' },
  duckling: { icon: PackageOpen, description: '立即来到拾荒沙滩。' },
  compass: { icon: Dices, description: '本回合移动点数固定为 8。' },
  tea: { icon: PackageOpen, description: '下一位对手每颗骰子最多为 3。' },
  umbrella: { icon: Shield, description: '自动抵消下一次暂停回合效果。' },
  'lucky-coin': { icon: Sparkles, description: '下一次骰子检定必定成功。' },
  'spring-shoes': { icon: Footprints, description: '使用后，本次移动额外前进 3 格。' },
  'driftwood-shield': { icon: Shield, description: '自动抵消下一次被撞回效果。' },
  'warm-soup': { icon: Shield, description: '自动抵消下一次暂停回合效果。' },
}

interface LogEntry {
  readonly id: number
  readonly text: string
}

interface EventOutcome {
  readonly event: EventDefinition
  readonly passed: boolean | null
}

interface GameSessionProps {
  readonly mode: OfflineMatchMode
  readonly seed: number
  readonly onRestart: () => void
  readonly onExit?: () => void
  readonly animationSpeed: number
  readonly cameraMotion: boolean
  readonly onAnimationSpeedChange: (speed: number) => void
  readonly onCameraMotionChange: (enabled: boolean) => void
}

function hashPlayerId(playerId: string) {
  let hash = 2166136261
  for (const character of playerId) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function decisionRandom(seed: number, revision: number, playerId: string) {
  return new DeterministicRandom({
    seed: (seed ^ Math.imul(revision + 1, 0x9e3779b1) ^ hashPlayerId(playerId)) >>> 0,
    cursor: 0,
  })
}

function eventById(eventId: string) {
  return GAME_DEFINITION.events.find((event) => event.id === eventId)
}

function itemById(itemId: string | null) {
  return itemId ? GAME_DEFINITION.items.find((item) => item.id === itemId) : undefined
}

function gameLogLines(update: AuthorityUpdate) {
  const lines: string[] = []
  const usedItems = new Set(update.cues.filter((cue) => cue.type === 'item-use').map((cue) => cue.playerId))
  for (const cue of update.cues) {
    if (cue.type !== 'item-use') continue
    const player = update.snapshot.state.players.find((candidate) => candidate.playerId === cue.playerId)
    const item = itemById(cue.itemId)
    lines.push(`${player?.displayName ?? cue.playerId} 使用了「${item?.title ?? cue.itemId}」。`)
  }
  for (const event of update.events) {
    if (event.type === 'dice-rolled') lines.push(`${event.playerId} 掷出 ${event.dice[0] + event.dice[1]} 点。`)
    if (event.type === 'order-die-rolled') lines.push(`${event.playerId} 的座次骰为 ${event.face} 点。`)
    if (event.type === 'turn-order-determined') lines.push(`行动顺序已确定：${event.playerIds.join(' → ')}。`)
    if (event.type === 'starting-item-chosen') lines.push(`${event.playerId} 已选择起始道具。`)
    if (event.type === 'collision-resolved') lines.push(event.blocked ? `${event.displacedPlayerId} 挡住了碰撞。` : `${event.displacedPlayerId} 被撞回。`)
    if (event.type === 'event-resolved') lines.push(`事件「${eventById(event.eventCardId)?.title ?? event.eventCardId}」已结算。`)
    if (event.type === 'item-changed' && (event.itemId !== null || !usedItems.has(event.playerId))) lines.push(`${event.playerId} 的道具已更新。`)
    if (event.type === 'game-won') lines.push(`${event.playerId} 抵达试航终点。`)
  }
  return lines
}

function GameSession({ mode, seed, onRestart, onExit, animationSpeed, cameraMotion, onAnimationSpeedChange, onCameraMotionChange }: GameSessionProps) {
  const [match] = useState(() => createOfflineMatch({ mode, seed, gameId: `offline-${mode}-${seed}` }, GAME_DEFINITION))
  const [snapshot, setSnapshot] = useState(() => match.authority.getSnapshot())
  const [board, setBoard] = useState<BoardSceneController | null>(null)
  const diceRef = useRef<ThreeDiceRollerHandle>(null)
  const [presentationStage, setPresentationStage] = useState<PresentationStage>('ready')
  const [locked, setLocked] = useState(false)
  const lockedRef = useRef(false)
  const mountedRef = useRef(true)
  const [selectedSkin, setSelectedSkin] = useState('goose-white')
  const [selectedStartingItem, setSelectedStartingItem] = useState<string | null>(null)
  const [itemDetailsOpen, setItemDetailsOpen] = useState(false)
  const [keepPendingItem, setKeepPendingItem] = useState(false)
  const [eventOutcome, setEventOutcome] = useState<EventOutcome | null>(null)
  const [showOrderResult, setShowOrderResult] = useState(false)
  const [showWin, setShowWin] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [itemUsePresentation, setItemUsePresentation] = useState<ItemUsePresentationData | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([{ id: 1, text: '试航棋盘已经铺好。' }])
  const logId = useRef(2)
  const itemUseId = useRef(1)
  const itemUseResolver = useRef<(() => void) | null>(null)

  const aiController = useMemo(() => new AiTurnController(
    createGooseAiStrategy(),
    match.controller,
    (view) => decisionRandom(seed, view.revision, view.viewerPlayerId),
  ), [match, seed])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      itemUseResolver.current?.()
      itemUseResolver.current = null
    }
  }, [])

  const finishItemUse = useCallback(() => {
    const resolve = itemUseResolver.current
    itemUseResolver.current = null
    setItemUsePresentation(null)
    resolve?.()
  }, [])

  const presentItemUse = useCallback((playerId: string, itemId: string, sourceSnapshot: GameSnapshot, speed: number) => {
    const player = sourceSnapshot.state.players.find((candidate) => candidate.playerId === playerId)
    const item = itemById(itemId)
    if (!player || !item || !mountedRef.current) return Promise.resolve()
    const copy = ITEM_COPY[item.id]
    return new Promise<void>((resolve) => {
      itemUseResolver.current = resolve
      setItemUsePresentation({
        id: itemUseId.current++,
        playerName: player.displayName,
        playerColor: COLOR_HEX[player.colorId],
        itemTitle: item.title,
        itemMode: item.mode,
        description: copy?.description ?? item.description,
        source: playerId === 'local-player' ? 'local' : 'remote',
        durationMs: import.meta.env.MODE === 'test' ? 500 : Math.max(700, 2_100 / speed),
        Icon: copy?.icon ?? PackageOpen,
      })
    })
  }, [])

  const addLogs = useCallback((lines: readonly string[]) => {
    if (!lines.length) return
    setLogs((current) => [
      ...lines.map((text) => ({ id: logId.current++, text })),
      ...current,
    ].slice(0, 24))
  }, [])

  const presentResult = useCallback(async (result: CommandResult, previousSnapshot: GameSnapshot, actorIsLocal: boolean) => {
    if (!result.ok) {
      addLogs([`命令被拒绝：${result.error.message}`])
      return false
    }
    if (!mountedRef.current) return false
    setSnapshot(result.update.snapshot)
    addLogs(gameLogLines(result.update))
    const resolved = result.update.events.find((event) => event.type === 'event-resolved')
    const gameWon = result.update.events.some((event) => event.type === 'game-won')
    const orderDetermined = result.update.events.some((event) => event.type === 'turn-order-determined')
    if (board) {
      await board.playUpdate(result.update, previousSnapshot, {
        onStageChange: (stage) => mountedRef.current && setPresentationStage(stage),
        speed: animationSpeed,
        cameraMotion,
        playDice: (dice, speed) => diceRef.current?.roll(dice, speed) ?? Promise.resolve(),
        cancelDice: () => diceRef.current?.cancel(),
        playItemUse: (playerId, itemId, speed) => presentItemUse(playerId, itemId, previousSnapshot, speed),
        cancelItemUse: finishItemUse,
      })
    } else {
      for (const cue of result.update.cues) {
        if (cue.type === 'item-use') await presentItemUse(cue.playerId, cue.itemId, previousSnapshot, animationSpeed)
      }
    }
    if (actorIsLocal && resolved?.type === 'event-resolved') {
      const event = eventById(resolved.eventCardId)
      if (event) setEventOutcome({ event, passed: resolved.passed })
    }
    if (gameWon) setShowWin(true)
    if (orderDetermined) setShowOrderResult(true)
    return true
  }, [addLogs, animationSpeed, board, cameraMotion, finishItemUse, presentItemUse])

  const submitLocal = useCallback(async (command: CoreGameCommand) => {
    if (lockedRef.current) return false
    lockedRef.current = true
    setLocked(true)
    const previous = match.authority.getSnapshot()
    const result = await match.controller.submit('local-player', command)
    const ok = await presentResult(result, previous, true)
    lockedRef.current = false
    if (mountedRef.current) setLocked(false)
    return ok
  }, [match, presentResult])

  const rollForOrder = useCallback(async () => {
    if (lockedRef.current) return
    lockedRef.current = true
    setLocked(true)
    let previous = match.authority.getSnapshot()
    if (previous.state.players.find((player) => player.playerId === 'local-player')?.skinId !== selectedSkin) {
      const skinResult = await match.controller.submit('local-player', { type: 'select-skin', skinId: selectedSkin })
      if (!await presentResult(skinResult, previous, true)) {
        lockedRef.current = false
        setLocked(false)
        return
      }
      previous = match.authority.getSnapshot()
    }
    const result = await match.controller.submit('local-player', { type: 'request-order-roll' })
    await presentResult(result, previous, true)
    lockedRef.current = false
    if (mountedRef.current) setLocked(false)
  }, [match, presentResult, selectedSkin])

  const shouldDriveAi = snapshot.state.phase !== 'game-over'
    && !eventOutcome
    && !showOrderResult
    && snapshot.state.players.find((player) => player.playerId === snapshot.state.activePlayerId)?.controller === 'ai'

  useEffect(() => {
    if (!shouldDriveAi || lockedRef.current) return
    let cancelled = false
    const delay = window.setTimeout(() => {
      void (async () => {
        lockedRef.current = true
        setLocked(true)
        for (let step = 0; step < 8 && !cancelled; step += 1) {
          const current = match.authority.getSnapshot()
          if (current.state.phase === 'game-over') break
          const playerId = current.state.activePlayerId
          const player = current.state.players.find((candidate) => candidate.playerId === playerId)
          if (!playerId || player?.controller !== 'ai') break
          const turn = await aiController.takeTurn(match.authority.getDecisionView(playerId))
          if (!turn || !await presentResult(turn.result, current, false)) break
          addLogs([`${player.displayName}：${turn.decision.reasonTag}`])
          if (turn.result.ok && turn.result.update.events.some((event) => event.type === 'turn-order-determined')) break
          if ((current.state.phase === 'determining-order' || current.state.phase === 'choosing-starting-item') && import.meta.env.MODE !== 'test') {
            await new Promise((resolve) => window.setTimeout(resolve, Math.max(140, 520 / animationSpeed)))
          }
          const next = match.authority.getSnapshot()
          const nextPlayer = next.state.players.find((candidate) => candidate.playerId === next.state.activePlayerId)
          if (nextPlayer?.controller !== 'ai') break
        }
        lockedRef.current = false
        if (mountedRef.current) setLocked(false)
      })()
    }, import.meta.env.MODE === 'test' ? 0 : Math.max(30, 520 / animationSpeed))
    return () => {
      cancelled = true
      window.clearTimeout(delay)
    }
  }, [addLogs, aiController, animationSpeed, locked, match, presentResult, shouldDriveAi, snapshot.revision])

  const localPlayer = snapshot.state.players.find((player) => player.playerId === 'local-player')!
  const activePlayer = snapshot.state.players.find((player) => player.playerId === snapshot.state.activePlayerId)!
  const localItem = itemById(localPlayer.itemId)
  const LocalItemIcon = localItem ? ITEM_COPY[localItem.id]?.icon ?? PackageOpen : PackageOpen
  const localDecision = match.authority.getDecisionView('local-player')
  const canRoll = !locked && !showOrderResult && board && snapshot.state.phase === 'awaiting-action' && snapshot.state.activePlayerId === 'local-player'
  const canUseItem = localItem && localDecision.legalCommands.some((command) => command.type === 'use-item' && command.itemId === localItem.id)
  const offeredEvents = snapshot.state.pendingEventIds.map(eventById).filter((event) => event !== undefined)
  const pendingItem = itemById(snapshot.state.pendingItemId)
  const activeSpace = GAME_DEFINITION.map.spaces.find((space) => space.index === activePlayer.spaceId)
  const activeLandmark = GAME_DEFINITION.map.landmarks.find((landmark) => landmark.id === activeSpace?.landmarkId)
  const finalSpaceId = GAME_DEFINITION.map.spaces.at(-1)?.index ?? 65
  const standings = [...snapshot.state.players].sort((left, right) => right.spaceId - left.spaceId || left.seatIndex - right.seatIndex)
  const provisionalOrder = snapshot.state.turnOrderGroups.flat()
  const unresolvedOrderGroup = snapshot.state.turnOrderGroups.find((group) => group.length > 1) ?? []
  const latestOrderFaces = new Map<string, number>()
  for (const round of snapshot.state.orderRollHistory) {
    for (const result of round.results) latestOrderFaces.set(result.playerId, result.face)
  }
  for (const result of snapshot.state.orderRollResults) latestOrderFaces.set(result.playerId, result.face)
  const localHasOrderRoll = snapshot.state.orderRollResults.some((result) => result.playerId === 'local-player')
    || snapshot.state.orderRollHistory.some((round) => round.results.some((result) => result.playerId === 'local-player'))
  const startingItemOffers = snapshot.state.startingItemOfferIds.map(itemById).filter((item) => item !== undefined)
  const startingItemChoiceIndex = provisionalOrder.findIndex((playerId) => playerId === snapshot.state.activePlayerId)

  useEffect(() => {
    if (snapshot.state.phase !== 'choosing-starting-item' || snapshot.state.activePlayerId !== 'local-player') return
    setSelectedStartingItem((current) => snapshot.state.startingItemOfferIds.includes(current ?? '')
      ? current
      : snapshot.state.startingItemOfferIds[0] ?? null)
  }, [snapshot.revision, snapshot.state.activePlayerId, snapshot.state.phase, snapshot.state.startingItemOfferIds])

  return (
    <main className="stage5-shell">
      <PixiBoard map={GAME_DEFINITION.map} snapshot={snapshot} onReady={(controller) => { controller.sync(snapshot); setBoard(controller) }} onDispose={() => setBoard(null)} />
      <Suspense fallback={null}>
        <ThreeDiceRoller
          ref={diceRef}
          canRoll={Boolean(canRoll)}
          stage={presentationStage}
          onRoll={() => void submitLocal({ type: 'request-roll' })}
        />
      </Suspense>
      {itemUsePresentation && (
        <ItemUsePresentation key={itemUsePresentation.id} presentation={itemUsePresentation} onComplete={finishItemUse} />
      )}

      <header className="stage5-topbar">
        <div className="stage5-brand"><span>鹅</span><div><strong>鹅了个棋</strong><small>奥普港 65 格竞速 · {mode}</small></div></div>
        <div className="topbar-actions">
          {onExit && <button className="icon-command" type="button" title="返回首页" aria-label="返回首页" onClick={onExit}><House /></button>}
          <button className="icon-command" type="button" title="对局日志" aria-label="对局日志" onClick={() => setShowLogs(true)}><History /></button>
          <button className="icon-command" type="button" title="表现设置" aria-label="表现设置" onClick={() => setShowSettings(true)}><SlidersHorizontal /></button>
          <button className="icon-command" type="button" title="声音尚未接入" aria-label="声音尚未接入" disabled><VolumeX /></button>
          <button className="icon-command" type="button" title="重新开始" aria-label="重新开始" onClick={onRestart}><RotateCcw /></button>
        </div>
      </header>

      <section className="floating-players" aria-label="参赛棋手">
        {snapshot.state.players.map((player) => {
          const itemLabel = player.playerId === 'local-player' ? itemById(player.itemId)?.title ?? '无道具' : '道具保密'
          const progress = Math.round(player.spaceId / finalSpaceId * 100)
          return (
            <article className={player.playerId === snapshot.state.activePlayerId ? 'hud-player is-active' : 'hud-player'} key={player.playerId} style={{ '--seat-color': COLOR_HEX[player.colorId] } as React.CSSProperties}>
              <span className="hud-avatar">{player.controller === 'local' ? <UserRound /> : <Bot />}</span>
              <div className="hud-player-copy">
                <div><strong title={player.displayName}>{player.displayName}</strong><span>{player.spaceId} / {finalSpaceId}</span></div>
                <div className="hud-progress"><i style={{ width: `${progress}%` }} /></div>
                <small>{itemLabel}{player.skipTurns ? ` · 暂停 ${player.skipTurns}` : ''}</small>
              </div>
            </article>
          )
        })}
      </section>

      <aside className="round-float" aria-label="回合信息">
        <small>ROUND</small><strong>{snapshot.state.round}</strong><span>{STAGE_LABELS[presentationStage]}</span>
      </aside>

      {snapshot.state.globalDieRule && <aside className="world-rule-float"><Dices /><div><small>全局骰子规则</small><strong>单骰最多 {snapshot.state.globalDieRule.maxFace} 点</strong><span>剩余 {snapshot.state.globalDieRule.remainingRounds} 轮</span></div></aside>}

      <section className="turn-banner" aria-live="polite">
        <span style={{ background: COLOR_HEX[activePlayer.colorId] }} />
        <div><small>当前行动</small><strong>{activePlayer.displayName}</strong></div>
      </section>

      <button className={`${localItem ? 'held-item has-item' : 'held-item'}${presentationStage === 'ready' ? '' : ' is-obscured'}`} type="button" onClick={() => localItem && setItemDetailsOpen(true)} disabled={!localItem || locked}>
        {localItem ? <>
          <span>当前道具 · {localItem.mode}</span><strong>{localItem.title}</strong><small>{ITEM_COPY[localItem.id]?.description}</small>
        </> : <><PackageOpen /><strong>暂无道具</strong></>}
      </button>

      {(snapshot.state.phase === 'determining-order' || showOrderResult) && (
        <div className="overlay-stage order-overlay">
          <section className="order-panel" role="dialog" aria-modal="true" aria-labelledby="order-title">
            <div className="panel-kicker">开局座次</div>
            <h2 id="order-title">{showOrderResult ? '行动顺序已确定' : unresolvedOrderGroup.length < snapshot.state.players.length ? '同点小组重新投掷' : '投掷单骰决定顺序'}</h2>
            {!showOrderResult && !localHasOrderRoll && snapshot.state.activePlayerId === 'local-player' && <div className="skin-picker" role="radiogroup" aria-label="棋子皮肤">
              {SKIN_SWATCHES.map((skin) => <button type="button" role="radio" aria-checked={selectedSkin === skin.id} className={selectedSkin === skin.id ? 'skin-choice is-selected' : 'skin-choice'} onClick={() => setSelectedSkin(skin.id)} key={skin.id}>
                <i style={{ background: skin.color }} /><span>{skin.label}</span>
              </button>)}
            </div>}
            <ol className="order-list">
              {provisionalOrder.map((playerId, index) => {
                const player = snapshot.state.players.find((candidate) => candidate.playerId === playerId)!
                const isTied = unresolvedOrderGroup.includes(playerId)
                const isRolling = snapshot.state.phase === 'determining-order' && snapshot.state.activePlayerId === playerId
                return <li className={`${isTied ? 'is-tied' : ''} ${isRolling ? 'is-rolling' : ''}`} key={playerId} style={{ '--seat-color': COLOR_HEX[player.colorId] } as React.CSSProperties}>
                  <span className="order-rank">{index + 1}</span>
                  <span className="order-player"><i /><strong>{player.displayName}</strong><small>{isRolling ? '等待投掷' : isTied ? '同点组' : '暂定'}</small></span>
                  <span className="order-die" aria-label={latestOrderFaces.has(playerId) ? `${latestOrderFaces.get(playerId)} 点` : '尚未投掷'}>{latestOrderFaces.get(playerId) ?? '·'}</span>
                </li>
              })}
            </ol>
            {showOrderResult
              ? <button className="primary-command order-command" type="button" onClick={() => setShowOrderResult(false)}><Check /> 选择起始道具</button>
              : snapshot.state.activePlayerId === 'local-player'
                ? <button className="primary-command order-command" type="button" disabled={locked || !board} onClick={() => void rollForOrder()}><Dices /> 投掷单骰</button>
                : <div className="order-wait" aria-live="polite"><Dices /> {activePlayer.displayName} 正在投掷</div>}
          </section>
        </div>
      )}

      {!showOrderResult && snapshot.state.phase === 'choosing-starting-item' && (
        <div className="overlay-stage setup-overlay">
          <section className="setup-panel" role="dialog" aria-modal="true" aria-labelledby="setup-title">
            <div className="panel-kicker">起始道具 · {startingItemChoiceIndex + 1}/{snapshot.state.players.length}</div>
            <h1 id="setup-title">{activePlayer.displayName} 选择起始道具</h1>
            {snapshot.state.activePlayerId === 'local-player' ? <>
              <div className="setup-item-grid" role="radiogroup" aria-label="抽取的起始道具">
                {startingItemOffers.map((item) => {
                  const Icon = ITEM_COPY[item.id]?.icon ?? PackageOpen
                  return <button type="button" role="radio" aria-checked={selectedStartingItem === item.id} className={selectedStartingItem === item.id ? 'setup-item is-selected' : 'setup-item'} onClick={() => setSelectedStartingItem(item.id)} key={item.id}>
                    <Icon /><span>{item.mode}</span><strong>{item.title}</strong><small>{ITEM_COPY[item.id]?.description}</small>{selectedStartingItem === item.id && <Check />}
                  </button>
                })}
              </div>
              <button className="primary-command setup-start" type="button" disabled={locked || !selectedStartingItem} onClick={() => selectedStartingItem && void submitLocal({ type: 'choose-starting-item', itemId: selectedStartingItem })}><Check /> 确认选择</button>
            </> : <div className="order-wait" aria-live="polite"><PackageOpen /> {activePlayer.displayName} 正在选择</div>}
          </section>
        </div>
      )}

      {!locked && snapshot.state.phase === 'awaiting-event-choice' && snapshot.state.activePlayerId === 'local-player' && (
        <div className="overlay-stage event-overlay">
          <section className="event-panel" aria-labelledby="event-title">
            <div className="panel-kicker">{activeLandmark ? `${activeLandmark.name} · 地标事件` : '遭遇事件'}</div><h2 id="event-title">从三张牌中选择</h2>
            <div className="event-card-grid">
              {offeredEvents.map((event, index) => <button className={`event-choice tone-${index}`} type="button" disabled={locked} onClick={() => void submitLocal({ type: 'choose-event', eventId: event.id })} key={event.id}>
                <span>{event.kind}</span><div className="event-sketch">{['!', '?', '↗'][index]}</div><strong title={event.title}>{event.title}</strong><p>{event.flavor}</p><small>{event.threshold ? `双骰 ≥ ${event.threshold}` : '直接结算'}</small>
              </button>)}
            </div>
          </section>
        </div>
      )}

      {eventOutcome && (
        <div className="overlay-stage outcome-overlay">
          <section className="outcome-panel">
            <div className={eventOutcome.passed === false ? 'outcome-mark is-failure' : 'outcome-mark'}>{eventOutcome.passed === false ? <X /> : <Check />}</div>
            <div className="panel-kicker">事件结算</div><h2>{eventOutcome.event.title}</h2>
            <p>{eventOutcome.passed === false ? eventOutcome.event.failureText : eventOutcome.event.successText}</p>
            <button className="primary-command" type="button" onClick={() => setEventOutcome(null)}>继续</button>
          </section>
        </div>
      )}

      {!locked && !eventOutcome && snapshot.state.phase === 'awaiting-item-choice' && snapshot.state.activePlayerId === 'local-player' && pendingItem && (
        <div className="overlay-stage item-compare-overlay">
          <section className="item-compare-panel" role="dialog" aria-modal="true" aria-labelledby="item-compare-title"><div className="panel-kicker">发现新道具</div><h2 id="item-compare-title">选择保留的道具</h2>
            <div className="item-compare-grid" role="radiogroup" aria-label="要保留的道具">
              <button className={keepPendingItem ? '' : 'is-selected'} type="button" role="radio" aria-checked={!keepPendingItem} disabled={locked} onClick={() => setKeepPendingItem(false)}><span>当前</span><strong>{localItem?.title}</strong><small>{ITEM_COPY[localItem?.id ?? '']?.description}</small>{!keepPendingItem && <Check className="item-choice-check" />}</button>
              <button className={keepPendingItem ? 'is-selected' : ''} type="button" role="radio" aria-checked={keepPendingItem} disabled={locked} onClick={() => setKeepPendingItem(true)}><span>新道具</span><strong>{pendingItem.title}</strong><small>{ITEM_COPY[pendingItem.id]?.description}</small>{keepPendingItem && <Check className="item-choice-check" />}</button>
            </div>
            <button className="primary-command item-choice-confirm" type="button" disabled={locked} onClick={() => { const itemId = keepPendingItem ? pendingItem.id : null; setKeepPendingItem(false); void submitLocal({ type: 'choose-item', itemId }) }}><Check /> 确认保留</button>
          </section>
        </div>
      )}

      {itemDetailsOpen && localItem && (
        <div className="item-modal-backdrop" onClick={() => setItemDetailsOpen(false)}>
          <section className="item-modal" role="dialog" aria-modal="true" aria-labelledby="item-modal-title" onClick={(event) => event.stopPropagation()}>
            <button className="drawer-close" type="button" title="关闭道具详情" aria-label="关闭道具详情" onClick={() => setItemDetailsOpen(false)}><X /></button>
            <div className="item-modal-icon"><LocalItemIcon /></div><span>{localItem.mode}道具</span><h2 id="item-modal-title">{canUseItem ? `使用${localItem.title}` : localItem.title}</h2><p>{ITEM_COPY[localItem.id]?.description}</p>
            <div className="item-modal-actions"><button className="secondary-command" type="button" onClick={() => setItemDetailsOpen(false)}>取消</button>{canUseItem && <button className="primary-command" type="button" disabled={locked} onClick={() => { setItemDetailsOpen(false); void submitLocal({ type: 'use-item', itemId: localItem.id }) }}><Check /> 确认使用</button>}</div>
          </section>
        </div>
      )}

      {snapshot.state.phase === 'game-over' && showWin && (
        <div className="overlay-stage win-overlay"><section className="win-panel"><div className="win-landmark"><img src="/assets/maps/aup-port/noise-house.png" alt="喧声屋" /><Crown /></div><div className="win-summary"><div className="panel-kicker">喧声屋终局</div><h2>{snapshot.state.players.find((player) => player.playerId === snapshot.state.winnerPlayerId)?.displayName} 获胜</h2><p>进入第 {snapshot.state.players.find((player) => player.playerId === snapshot.state.winnerPlayerId)?.spaceId} 格 · 第 {snapshot.state.round} 轮</p><ol className="final-ranking">{standings.map((player, index) => <li key={player.playerId}><span>{index + 1}</span><strong>{player.displayName}</strong><small>第 {player.spaceId} 格</small></li>)}</ol><button className="primary-command" type="button" onClick={onRestart}><RotateCcw /> 再来一局</button></div></section></div>
      )}

      {showLogs && <div className="log-drawer-backdrop" onClick={() => setShowLogs(false)}><aside className="log-drawer" onClick={(event) => event.stopPropagation()}><header><h2>对局日志</h2><button className="drawer-close" type="button" title="关闭日志" aria-label="关闭日志" onClick={() => setShowLogs(false)}><X /></button></header>{logs.map((entry) => <p key={entry.id}>{entry.text}</p>)}</aside></div>}

      {showSettings && <div className="settings-backdrop" onClick={() => setShowSettings(false)}><section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
        <header><div><span>桌面表现</span><h2 id="settings-title">表现设置</h2></div><button className="drawer-close" type="button" title="关闭设置" aria-label="关闭设置" onClick={() => setShowSettings(false)}><X /></button></header>
        <div className="settings-row"><div><strong>动画速度</strong><small>调整骰子、路线与棋子移动节奏</small></div><div className="speed-segments" role="radiogroup" aria-label="动画速度">{[0.75, 1, 1.5, 2].map((speed) => <button type="button" role="radio" aria-checked={animationSpeed === speed} className={animationSpeed === speed ? 'is-selected' : ''} onClick={() => onAnimationSpeedChange(speed)} key={speed}>{speed}x</button>)}</div></div>
        <label className="settings-row camera-setting"><div><strong>自动镜头跟随</strong><small>仅在棋盘无法完整显示时跟随目标；仍可拖拽查看</small></div><input type="checkbox" checked={cameraMotion} onChange={(event) => onCameraMotionChange(event.target.checked)} /><span aria-hidden="true" /></label>
      </section></div>}
    </main>
  )
}

export interface AppProps {
  readonly mode?: OfflineMatchMode
  readonly seed?: number
  readonly animationSpeed?: number
  readonly cameraMotion?: boolean
  readonly onExit?: () => void
}

function App({ mode = '1v1', seed = 20260728, animationSpeed: initialAnimationSpeed = 1, cameraMotion: initialCameraMotion = true, onExit }: AppProps) {
  const [restart, setRestart] = useState(0)
  const [animationSpeed, setAnimationSpeed] = useState(initialAnimationSpeed)
  const [cameraMotion, setCameraMotion] = useState(initialCameraMotion)
  return <GameSession
    key={`${mode}-${seed}-${restart}`}
    mode={mode}
    seed={seed + restart}
    animationSpeed={animationSpeed}
    cameraMotion={cameraMotion}
    onAnimationSpeedChange={setAnimationSpeed}
    onCameraMotionChange={setCameraMotion}
    onRestart={() => setRestart((value) => value + 1)}
    onExit={onExit}
  />
}

export default App
