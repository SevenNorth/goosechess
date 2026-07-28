import { useState } from 'react'
import { Bot, Construction, Dices, Play, UsersRound } from 'lucide-react'
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { OFFLINE_MATCH_MODES, type OfflineMatchMode } from '@goose-chess/game-protocol'
import App from './App'

function PreparationPage() {
  const [selectedMode, setSelectedMode] = useState<OfflineMatchMode>('1v1')
  const opponentCount = Number(selectedMode.at(-1))

  return (
    <main className="preparation-shell">
      <header className="preparation-header">
        <div className="brand-mark" aria-label="鹅了个棋">
          <span className="brand-goose">鹅</span>
          <div><strong>鹅了个棋</strong><small>奥普港桌面竞速</small></div>
        </div>
      </header>

      <section className="preparation-content" aria-labelledby="prepare-title">
        <div className="preparation-heading">
          <span><Dices /> 离线对局</span>
          <h1 id="prepare-title">选择人机模式</h1>
          <p>你将从维修室出发，与电脑棋手争先抵达喧声屋。</p>
        </div>

        <div className="mode-picker">
          <div className="mode-picker-title">
            <span><UsersRound /> 对局人数</span>
            <small>共 {opponentCount + 1} 名棋手</small>
          </div>
          <div className="mode-segments" role="radiogroup" aria-label="人机对战模式">
            {OFFLINE_MATCH_MODES.map((mode) => (
              <button
                className={mode === selectedMode ? 'mode-segment is-selected' : 'mode-segment'}
                type="button"
                role="radio"
                aria-checked={mode === selectedMode}
                onClick={() => setSelectedMode(mode)}
                key={mode}
              >
                <strong>{mode}</strong>
                <small>{Number(mode.at(-1))} 名电脑</small>
              </button>
            ))}
          </div>
          <div className="mode-summary" aria-live="polite">
            <div className="mode-icon"><UsersRound /></div>
            <div><strong>玩家 vs 电脑棋手</strong><small>1 名本地玩家 · {opponentCount} 名电脑棋手</small></div>
          </div>
          <Link className="primary-button start-match-button" to={`/play?mode=${selectedMode}`}>
            <Play /> 开始对局
          </Link>
        </div>

        <div className="online-note">
          <Bot />
          <div><strong>在线房间</strong><span>独立游戏服务器将在在线阶段接入。</span></div>
          <span className="status-tag">规划中</span>
        </div>
      </section>
    </main>
  )
}

function RoomUnavailablePage() {
  const { roomCode } = useParams()

  return (
    <main className="route-message-shell">
      <section className="route-message">
        <Construction />
        <span>在线房间</span>
        <h1>{roomCode}</h1>
        <p>联机服务尚未开放，这个房间暂时无法加入。</p>
        <Link className="primary-button" to="/">返回准备</Link>
      </section>
    </main>
  )
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<PreparationPage />} />
      <Route path="/play" element={<App />} />
      <Route path="/room/:roomCode" element={<RoomUnavailablePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
