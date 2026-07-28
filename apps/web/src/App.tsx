/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowDownToLine,
  Bot,
  ChevronRight,
  CircleHelp,
  Dices,
  Flag,
  History,
  RotateCcw,
  Sparkles,
  UserRound,
  X,
  Zap,
} from 'lucide-react'
import { EVENTS, EVENT_SPACES, FINISH, ITEMS, LANDMARKS, getItem } from './game/data'
import type { Effect, EventCard, GamePhase, ItemCard, LogEntry, Player, PlayerId, WorldRule } from './game/types'

const makePlayers = (): Record<PlayerId, Player> => ({
  human: { id: 'human', name: '你', position: 0, item: null, skipTurns: 0, nextMoveBonus: 0, nextMaxDie: null, nextFixedTotal: null },
  ai: { id: 'ai', name: '蓝棋手', position: 0, item: null, skipTurns: 0, nextMoveBonus: 0, nextMaxDie: null, nextFixedTotal: null },
})

const STARTING_ITEMS = ['duckling', 'clover', 'barnacle']
const opponentOf = (id: PlayerId): PlayerId => (id === 'human' ? 'ai' : 'human')
const randomDie = (max = 6) => Math.min(Math.floor(Math.random() * 6) + 1, max)
const randomFrom = <T,>(values: T[]) => values[Math.floor(Math.random() * values.length)]

function movePosition(position: number, spaces: number) {
  if (spaces <= 0) return Math.max(0, position + spaces)
  const raw = position + spaces
  return raw <= FINISH ? raw : Math.max(0, FINISH - (raw - FINISH))
}

function pickEvents() {
  const pool = [...EVENTS]
  const picked: EventCard[] = []
  while (picked.length < 3) picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0])
  return picked
}

function desktopPosition(index: number) {
  if (index === 0) return { x: 5.5, y: 86 }
  const line = (start: number, end: number, from: number, to: number, fixed: number, horizontal = true) => {
    const t = (index - from) / Math.max(1, to - from)
    return horizontal ? { x: start + (end - start) * t, y: fixed } : { x: fixed, y: start + (end - start) * t }
  }
  if (index <= 15) return line(11, 81, 1, 15, 86)
  if (index <= 20) return line(78, 46, 16, 20, 85, false)
  if (index <= 34) return line(80, 18, 21, 34, 17)
  if (index <= 40) return line(23, 52, 35, 40, 14, false)
  if (index <= 52) return line(19, 77, 41, 52, 57)
  if (index <= 56) return line(52, 34, 53, 56, 82, false)
  return line(76, 31, 57, 65, 35)
}

function mobilePosition(index: number) {
  if (index === 0) return { x: 5, y: 93 }
  const rows = [9, 9, 9, 9, 9, 9, 11]
  let cursor = 1
  for (let row = 0; row < rows.length; row += 1) {
    const length = rows[row]
    if (index < cursor + length) {
      const at = index - cursor
      const leftToRight = row % 2 === 0
      const x = 9 + (82 * at) / (length - 1)
      return { x: leftToRight ? x : 100 - x, y: 92 - row * 14 }
    }
    cursor += length
  }
  return { x: 91, y: 8 }
}

function App() {
  const [players, setPlayers] = useState(makePlayers)
  const [active, setActive] = useState<PlayerId>('human')
  const [round, setRound] = useState(1)
  const [phase, setPhase] = useState<GamePhase>('setup')
  const [dice, setDice] = useState<[number, number]>([1, 1])
  const [eventChoices, setEventChoices] = useState<EventCard[]>([])
  const [selectedEvent, setSelectedEvent] = useState<EventCard | null>(null)
  const [eventResult, setEventResult] = useState('')
  const [checkDice, setCheckDice] = useState<[number, number] | null>(null)
  const [eventExtraTurn, setEventExtraTurn] = useState(false)
  const [pendingItem, setPendingItem] = useState<ItemCard | null>(null)
  const [winner, setWinner] = useState<PlayerId | null>(null)
  const [worldRule, setWorldRule] = useState<WorldRule | null>(null)
  const [showRules, setShowRules] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: 1, text: '棋盘已经铺好，选择一件起始道具。', tone: 'neutral' },
  ])
  const logId = useRef(2)
  const timers = useRef<number[]>([])

  const addLog = (text: string, tone: LogEntry['tone'] = 'neutral') => {
    setLogs((current) => [{ id: logId.current++, text, tone }, ...current].slice(0, 18))
  }

  const later = (callback: () => void, delay: number) => {
    const id = window.setTimeout(callback, delay)
    timers.current.push(id)
  }

  useEffect(() => () => timers.current.forEach(window.clearTimeout), [])

  const boardSpaces = useMemo(() => Array.from({ length: FINISH + 1 }, (_, index) => ({
    index,
    desktop: desktopPosition(index),
    mobile: mobilePosition(index),
  })), [])

  const advanceTurn = () => {
    const next = opponentOf(active)
    if (active === 'ai') {
      setRound((value) => value + 1)
      setWorldRule((rule) => rule && rule.rounds > 1 ? { ...rule, rounds: rule.rounds - 1 } : null)
    }
    setActive(next)
    setPhase('ready')
  }

  const finishEvent = () => {
    if (winner) {
      setPhase('game-over')
      return
    }
    setSelectedEvent(null)
    setCheckDice(null)
    setEventChoices([])
    if (eventExtraTurn) {
      addLog(`${players[active].name}获得额外行动。`, 'good')
      setEventExtraTurn(false)
      setPhase('ready')
    } else {
      advanceTurn()
    }
  }

  const collide = (movingId: PlayerId, origin: number, nextPlayers: Record<PlayerId, Player>) => {
    const otherId = opponentOf(movingId)
    if (nextPlayers[movingId].position === nextPlayers[otherId].position && nextPlayers[movingId].position > 0 && nextPlayers[movingId].position < FINISH) {
      const shield = getItem(nextPlayers[otherId].item)?.effect === 'collision-shield'
      if (shield) {
        nextPlayers[otherId] = { ...nextPlayers[otherId], item: null }
        addLog(`${nextPlayers[otherId].name}的小猫挡住了碰撞。`, 'good')
      } else {
        nextPlayers[otherId] = { ...nextPlayers[otherId], position: origin }
        addLog(`${nextPlayers[movingId].name}撞开了${nextPlayers[otherId].name}。`, movingId === 'human' ? 'good' : 'bad')
      }
    }
  }

  const openEvent = (id: PlayerId) => {
    const choices = pickEvents()
    setEventChoices(choices)
    setSelectedEvent(null)
    setCheckDice(null)
    setPhase('event-choice')
    addLog(`${players[id].name}触发了事件。`)
  }

  const landAfterMove = (id: PlayerId, nextPlayers: Record<PlayerId, Player>) => {
    const destination = nextPlayers[id].position
    if (destination === FINISH) {
      setWinner(id)
      setPhase('game-over')
      addLog(`${nextPlayers[id].name}抵达喧声屋！`, 'good')
    } else if (EVENT_SPACES.has(destination)) {
      openEvent(id)
    } else {
      advanceTurn()
    }
  }

  const completeMove = (id: PlayerId, rolled: [number, number], basePlayers = players) => {
    const player = basePlayers[id]
    const total = player.nextFixedTotal ?? rolled[0] + rolled[1] + player.nextMoveBonus
    const origin = player.position
    const destination = movePosition(origin, total)
    const nextPlayers = {
      ...basePlayers,
      [id]: { ...player, position: destination, nextMoveBonus: 0, nextMaxDie: null, nextFixedTotal: null },
    }
    collide(id, origin, nextPlayers)
    setPlayers(nextPlayers)
    const bounce = origin + total > FINISH
    addLog(`${player.name}掷出 ${total} 点，${bounce ? '越过终点后折返到' : '来到'} ${destination} 格。`, bounce ? 'bad' : 'neutral')
    later(() => landAfterMove(id, nextPlayers), 650)
  }

  const rollFor = (id: PlayerId, basePlayers = players, ignorePhase = false) => {
    if (!ignorePhase && phase !== 'ready') return
    const player = basePlayers[id]
    const limit = Math.min(worldRule?.maxDie ?? 6, player.nextMaxDie ?? 6)
    setPhase('rolling')
    let ticks = 0
    const animate = window.setInterval(() => {
      setDice([randomDie(limit), randomDie(limit)])
      ticks += 1
      if (ticks >= 7) {
        window.clearInterval(animate)
        const finalDice: [number, number] = [randomDie(limit), randomDie(limit)]
        setDice(finalDice)
        completeMove(id, finalDice, basePlayers)
      }
    }, 70)
  }

  const gainItem = (id: PlayerId, nextPlayers: Record<PlayerId, Player>) => {
    const available = ITEMS.filter((item) => item.id !== nextPlayers[id].item)
    const item = randomFrom(available)
    if (!nextPlayers[id].item) {
      nextPlayers[id] = { ...nextPlayers[id], item: item.id }
      addLog(`${nextPlayers[id].name}获得了「${item.title}」。`, 'good')
    } else if (id === 'human') {
      setPendingItem(item)
      return item
    } else {
      const old = getItem(nextPlayers[id].item)
      if (!old || item.priority >= old.priority) nextPlayers[id] = { ...nextPlayers[id], item: item.id }
      addLog(`${nextPlayers[id].name}整理了自己的道具。`)
    }
    return null
  }

  const applyEffects = (id: PlayerId, effects: readonly Effect[], consumeCurrentItem = false) => {
    const nextPlayers: Record<PlayerId, Player> = {
      human: { ...players.human },
      ai: { ...players.ai },
    }
    let extra = false
    let nextRule = worldRule
    let itemToChoose: ItemCard | null = null
    if (consumeCurrentItem) nextPlayers[id].item = null
    for (const effect of effects) {
      const otherId = opponentOf(id)
      if (effect.type === 'move') {
        const origin = nextPlayers[id].position
        nextPlayers[id].position = movePosition(origin, effect.spaces)
        collide(id, origin, nextPlayers)
      }
      if (effect.type === 'opponent-move') nextPlayers[otherId].position = movePosition(nextPlayers[otherId].position, effect.spaces)
      if (effect.type === 'skip') {
        const shielded = getItem(nextPlayers[id].item)?.effect === 'skip-shield'
        if (shielded) {
          nextPlayers[id].item = null
          addLog(`${nextPlayers[id].name}的旧雨伞挡住了暂停效果。`, 'good')
        } else nextPlayers[id].skipTurns += effect.turns
      }
      if (effect.type === 'extra-turn') extra = true
      if (effect.type === 'gain-item') itemToChoose = gainItem(id, nextPlayers) ?? itemToChoose
      if (effect.type === 'swap') {
        const here = nextPlayers[id].position
        nextPlayers[id].position = nextPlayers[otherId].position
        nextPlayers[otherId].position = here
      }
      if (effect.type === 'world-max-die') nextRule = { maxDie: effect.value, rounds: effect.rounds }
    }
    setPlayers(nextPlayers)
    setWorldRule(nextRule)
    setEventExtraTurn(extra)
    if (nextPlayers[id].position === FINISH) setWinner(id)
    if (nextPlayers[opponentOf(id)].position === FINISH) setWinner(opponentOf(id))
    return itemToChoose
  }

  const chooseEvent = (event: EventCard) => {
    if (phase !== 'event-choice') return
    setPhase('ai-thinking')
    setSelectedEvent(event)
    let passed = true
    let usedClover = false
    if (event.threshold) {
      const limit = worldRule?.maxDie ?? 6
      const resultDice: [number, number] = [randomDie(limit), randomDie(limit)]
      const item = getItem(players[active].item)
      usedClover = item?.effect === 'check-pass'
      passed = usedClover || resultDice[0] + resultDice[1] >= event.threshold
      setCheckDice(resultDice)
      if (usedClover) setPlayers((current) => ({ ...current, [active]: { ...current[active], item: null } }))
    }
    const effects = event.threshold ? (passed ? event.success ?? [] : event.failure ?? []) : event.effect ?? []
    const text = event.threshold
      ? `${passed ? '检定成功' : '检定失败'}${usedClover ? '，四叶草带来了好运' : ''}。${passed ? event.successText : event.failureText}`
      : event.successText ?? ''
    setEventResult(text)
    later(() => {
      const itemToChoose = applyEffects(active, effects, usedClover)
      setPhase(itemToChoose ? 'item-choice' : 'event-result')
    }, 420)
  }

  const chooseStartingItem = (item: ItemCard) => {
    const aiItem = randomFrom(ITEMS.filter((candidate) => candidate.id !== item.id))
    setPlayers((current) => ({
      human: { ...current.human, item: item.id },
      ai: { ...current.ai, item: aiItem.id },
    }))
    addLog(`你带上了「${item.title}」，蓝棋手带上了「${aiItem.title}」。`)
    setPhase('ready')
  }

  const choosePendingItem = (replace: boolean) => {
    if (!pendingItem) return
    if (replace) {
      setPlayers((current) => ({ ...current, human: { ...current.human, item: pendingItem.id } }))
      addLog(`你换上了「${pendingItem.title}」。`, 'good')
    } else addLog(`你放弃了「${pendingItem.title}」。`)
    setPendingItem(null)
    setPhase('event-result')
  }

  const activateItem = (id: PlayerId) => {
    const item = getItem(players[id].item)
    if (!item || item.mode !== '主动' || phase !== 'ready') return null
    if (item.effect === 'teleport-beach' && players[id].position >= 18) return null
    const nextPlayers: Record<PlayerId, Player> = { human: { ...players.human }, ai: { ...players.ai } }
    const other = opponentOf(id)
    nextPlayers[id].item = null
    if (item.effect === 'move-plus-three') nextPlayers[id].nextMoveBonus = 3
    if (item.effect === 'opponent-back-two') nextPlayers[other].position = movePosition(nextPlayers[other].position, -2)
    if (item.effect === 'teleport-beach') nextPlayers[id].position = 18
    if (item.effect === 'fixed-eight') nextPlayers[id].nextFixedTotal = 8
    if (item.effect === 'opponent-max-three') nextPlayers[other].nextMaxDie = 3
    setPlayers(nextPlayers)
    addLog(`${nextPlayers[id].name}使用了「${item.title}」。`, id === 'human' ? 'good' : 'bad')
    return nextPlayers
  }

  const restart = () => {
    timers.current.forEach(window.clearTimeout)
    timers.current = []
    setPlayers(makePlayers())
    setActive('human')
    setRound(1)
    setPhase('setup')
    setDice([1, 1])
    setEventChoices([])
    setSelectedEvent(null)
    setPendingItem(null)
    setWinner(null)
    setWorldRule(null)
    setLogs([{ id: logId.current++, text: '新棋局开始，选择一件起始道具。' }])
  }

  useEffect(() => {
    if (phase !== 'ready') return
    const player = players[active]
    if (player.skipTurns > 0) {
      setPhase('ai-thinking')
      later(() => {
        setPlayers((current) => ({ ...current, [active]: { ...current[active], skipTurns: current[active].skipTurns - 1 } }))
        addLog(`${player.name}暂停一回合。`, active === 'human' ? 'bad' : 'good')
        advanceTurn()
      }, 700)
      return
    }
    if (active === 'ai') {
      setPhase('ai-thinking')
      later(() => {
        const item = getItem(players.ai.item)
        const usable = item?.mode === '主动' && !(item.effect === 'teleport-beach' && players.ai.position >= 18)
        let preparedPlayers = players
        if (usable && (item.priority >= 6 || players.ai.position < players.human.position)) {
          preparedPlayers = activateItem('ai') ?? players
        }
        later(() => rollFor('ai', preparedPlayers, true), 320)
      }, 850)
    }
  }, [active, phase])

  useEffect(() => {
    if (phase !== 'event-choice' || active !== 'ai') return
    setPhase('ai-thinking')
    later(() => {
      const best = [...eventChoices].sort((a, b) => b.aiValue - a.aiValue)[0]
      chooseEvent(best)
    }, 900)
  }, [phase, active, eventChoices])

  useEffect(() => {
    if (phase === 'event-result' && active === 'ai') later(finishEvent, 900)
  }, [phase, active])

  const humanItem = getItem(players.human.item)
  const activePlayer = players[active]
  const canUseHumanItem = active === 'human' && phase === 'ready' && humanItem?.mode === '主动' && !(humanItem.effect === 'teleport-beach' && players.human.position >= 18)

  return (
    <main className="game-shell">
      <header className="topbar">
        <div className="brand-mark" aria-label="鹅了个棋">
          <span className="brand-goose">鹅</span>
          <div><strong>鹅了个棋</strong><small>奥普港桌面竞速</small></div>
        </div>
        <div className="top-actions">
          <button className="icon-button" onClick={() => setShowLog(true)} title="对局记录" aria-label="对局记录"><History /></button>
          <button className="icon-button" onClick={() => setShowRules(true)} title="规则" aria-label="规则"><CircleHelp /></button>
          <button className="icon-button" onClick={restart} title="重新开始" aria-label="重新开始"><RotateCcw /></button>
        </div>
      </header>

      <section className="game-layout">
        <aside className="players-panel" aria-label="玩家状态">
          {(['human', 'ai'] as PlayerId[]).map((id) => {
            const player = players[id]
            const item = getItem(player.item)
            return (
              <div className={`player-row ${active === id ? 'is-active' : ''}`} key={id}>
                <div className={`avatar avatar-${id}`}>{id === 'human' ? <UserRound /> : <Bot />}</div>
                <div className="player-copy">
                  <div><strong>{player.name}</strong><span>{player.position === FINISH ? '已抵达' : `${player.position} / ${FINISH}`}</span></div>
                  <div className="progress"><i style={{ width: `${player.position / FINISH * 100}%` }} /></div>
                  <small>{item ? `${item.mode} · ${item.title}` : '没有道具'}{player.skipTurns ? ` · 暂停 ${player.skipTurns}` : ''}</small>
                </div>
              </div>
            )
          })}
        </aside>

        <div className="board-wrap">
          <div className="board" aria-label="65 格竞速棋盘">
            <div className="paper-noise" />
            <svg className="board-art" viewBox="0 0 1000 600" role="img" aria-label="奥普港手绘地图">
              <g className="ink-lines" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M132 433h118v87H132zM148 433l42-54 44 54M190 379v141M161 470h24v50M210 463h23" />
                <path d="M399 400c25-47 66-47 92 0v72h-92zM414 400c9-24 21-36 31-42 12 8 24 22 31 42M445 358v114" />
                <path d="M695 303h120l-18 81H716zM708 303l47-62 49 62M743 340h25v44" />
                <path d="M348 176h141l-12 82H362zM372 176c4-64 95-64 99 0M416 145v113" />
                <path d="M572 174c26-48 92-42 112 9l-18 72h-88zM598 205h57M624 177v78" />
              </g>
              <g className="map-labels" textAnchor="middle">
                <text x="190" y="555">维修室</text><text x="445" y="505">小吃摊</text><text x="755" y="415">疯人院</text>
                <text x="420" y="285">水手之家</text><text x="625" y="282">十全大煮</text>
              </g>
              <path className="route-scribble" d="M90 520 C235 560 445 555 640 525 S865 475 855 360 S890 105 690 95 S310 80 165 120 S100 320 210 338 S720 335 790 285 S695 215 325 220" />
              <g className="goose-doodle" transform="translate(485 270)">
                <path d="M15 74c-22-13-19-40 1-50 7-4 10-13 5-20 19-5 37 14 30 32 20 5 29 19 23 38-15 14-43 15-59 0z" />
                <circle cx="38" cy="15" r="2" fill="currentColor" /><path d="M51 23l18 5-18 8" />
              </g>
            </svg>

            {boardSpaces.map(({ index, desktop, mobile }) => {
              const landmark = LANDMARKS[index]
              const event = EVENT_SPACES.has(index)
              const style = {
                '--x': `${desktop.x}%`, '--y': `${desktop.y}%`, '--mx': `${mobile.x}%`, '--my': `${mobile.y}%`,
              } as CSSProperties
              return (
                <div className={`space ${event ? 'event-space' : ''} ${index === 0 ? 'start-space' : ''} ${index === FINISH ? 'finish-space' : ''}`} style={style} key={index} title={landmark ?? `第 ${index} 格`}>
                  {index === FINISH ? <Flag /> : event ? <span className="event-glyph">鹅</span> : <span>{index}</span>}
                  {landmark && <em>{landmark}</em>}
                </div>
              )
            })}

            {(['human', 'ai'] as PlayerId[]).map((id) => {
              const pos = boardSpaces[players[id].position]
              const same = players.human.position === players.ai.position
              return (
                <div className={`token token-${id} ${active === id ? 'token-active' : ''} ${same ? `token-stack-${id}` : ''}`} style={{ '--x': `${pos.desktop.x}%`, '--y': `${pos.desktop.y}%`, '--mx': `${pos.mobile.x}%`, '--my': `${pos.mobile.y}%` } as CSSProperties} key={id}>
                  <span>{id === 'human' ? '鹅' : '蓝'}</span>
                </div>
              )
            })}

            <div className="round-stamp"><small>ROUND</small><strong>{round}</strong></div>
            {worldRule && <div className="world-rule"><Zap /> 单骰上限 {worldRule.maxDie} · {worldRule.rounds} 轮</div>}
          </div>
        </div>

        <aside className="turn-panel">
          <div className="turn-title"><span>{active === 'human' ? '你的回合' : '蓝棋手行动'}</span><small>{LANDMARKS[activePlayer.position] ?? `第 ${activePlayer.position} 格`}</small></div>
          <div className={`dice-pair ${phase === 'rolling' ? 'is-rolling' : ''}`} aria-label={`骰子 ${dice[0]} 和 ${dice[1]}`}>
            <div className="die">{dice[0]}</div><div className="die die-dark">{dice[1]}</div>
          </div>
          <button className="primary-button roll-button" disabled={active !== 'human' || phase !== 'ready'} onClick={() => rollFor('human')}>
            <Dices /> {phase === 'rolling' ? '骰子滚动中' : active === 'human' ? '掷骰子' : '等待对手'}
          </button>
          <div className={`item-slot ${humanItem ? 'has-item' : ''}`}>
            {humanItem ? <>
              <div className="item-heading"><span>{humanItem.mode}</span><strong>{humanItem.title}</strong></div>
              <p>{humanItem.description}</p>
              {humanItem.mode === '主动' && <button className="secondary-button" disabled={!canUseHumanItem} onClick={() => activateItem('human')}><Sparkles />使用道具</button>}
            </> : <div className="empty-item"><ArrowDownToLine /><span>道具槽为空</span></div>}
          </div>
          <div className="latest-log"><span>最新动态</span><p>{logs[0]?.text}</p></div>
        </aside>
      </section>

      {phase === 'setup' && <Modal className="setup-modal">
        <div className="modal-kicker">开局准备</div><h2>选择起始道具</h2><p className="modal-subtitle">只能带走一件。</p>
        <div className="card-grid">
          {STARTING_ITEMS.map((id) => getItem(id)!).map((item) => <ItemChoiceCard item={item} key={item.id} onClick={() => chooseStartingItem(item)} />)}
        </div>
      </Modal>}

      {(phase === 'event-choice' || phase === 'ai-thinking' && eventChoices.length > 0) && <Modal>
        <div className="modal-kicker">遭遇事件</div><h2>{active === 'human' ? '从三张牌中选择' : '蓝棋手正在考虑'}</h2>
        <div className="card-grid event-grid">
          {eventChoices.map((event) => <EventChoiceCard event={event} disabled={active === 'ai' || phase !== 'event-choice'} key={event.id} onClick={() => chooseEvent(event)} />)}
        </div>
      </Modal>}

      {phase === 'event-result' && selectedEvent && <Modal className="result-modal">
        <div className={`result-icon accent-${selectedEvent.accent}`}>鹅</div>
        <div className="modal-kicker">{selectedEvent.kind}</div><h2>{selectedEvent.title}</h2>
        {checkDice && <div className="check-line"><span className="mini-die">{checkDice[0]}</span><span className="mini-die">{checkDice[1]}</span><strong>{checkDice[0] + checkDice[1]}</strong><small>需要 {selectedEvent.threshold}+</small></div>}
        <p className="result-copy">{eventResult}</p>
        <button className="primary-button" onClick={finishEvent}>继续<ChevronRight /></button>
      </Modal>}

      {phase === 'item-choice' && pendingItem && <Modal>
        <div className="modal-kicker">道具槽已满</div><h2>留下哪一件？</h2>
        <div className="compare-items">
          <ItemChoiceCard item={getItem(players.human.item)!} onClick={() => choosePendingItem(false)} label="保留当前" />
          <ItemChoiceCard item={pendingItem} onClick={() => choosePendingItem(true)} label="换上新的" />
        </div>
      </Modal>}

      {phase === 'game-over' && winner && <Modal className="win-modal">
        <div className="crown">♛</div><div className="modal-kicker">抵达喧声屋</div>
        <h2>{winner === 'human' ? '这局是你的' : '蓝棋手先到一步'}</h2>
        <p className="modal-subtitle">共进行了 {round} 轮。</p>
        <button className="primary-button" onClick={restart}><RotateCcw />再来一局</button>
      </Modal>}

      {showRules && <Drawer title="规则" onClose={() => setShowRules(false)}>
        <div className="rule-list">
          <p><strong>目标</strong><span>从维修室出发，精确抵达第 65 格的喧声屋。</span></p>
          <p><strong>移动</strong><span>每回合掷两颗骰子；超过终点会按多出的点数折返。</span></p>
          <p><strong>碰撞</strong><span>落到对手所在格时，对手回到你移动前的位置。</span></p>
          <p><strong>事件</strong><span>鹅标记与地标会触发三选一事件，检定只看两颗骰子之和。</span></p>
          <p><strong>道具</strong><span>每人只能持有一件；主动道具在掷骰前使用。</span></p>
        </div>
      </Drawer>}

      {showLog && <Drawer title="对局记录" onClose={() => setShowLog(false)}>
        <div className="log-list">{logs.map((log) => <p className={log.tone} key={log.id}>{log.text}</p>)}</div>
      </Drawer>}
    </main>
  )
}

function Modal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className="modal-backdrop"><section className={`modal ${className}`}>{children}</section></div>
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="drawer-backdrop" onClick={onClose}><aside className="drawer" onClick={(event) => event.stopPropagation()}><header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X /></button></header>{children}</aside></div>
}

function ItemChoiceCard({ item, onClick, label = '选择' }: { item: ItemCard; onClick: () => void; label?: string }) {
  return <button className="choice-card item-card" onClick={onClick}><span className="card-type">{item.mode}</span><div className="card-sketch">{item.title.slice(0, 1)}</div><h3>{item.title}</h3><p>{item.description}</p><small>“{item.quote}”</small><b>{label}<ChevronRight /></b></button>
}

function EventChoiceCard({ event, onClick, disabled }: { event: EventCard; onClick: () => void; disabled: boolean }) {
  return <button className={`choice-card event-card accent-${event.accent}`} onClick={onClick} disabled={disabled}><span className="card-type">{event.kind}</span><div className="card-sketch">鹅</div><h3>{event.title}</h3><p>{event.flavor}</p><small>{event.threshold ? `掷双骰检定 · 需要 ${event.threshold}+` : event.successText}</small><b>选择事件<ChevronRight /></b></button>
}

export default App
