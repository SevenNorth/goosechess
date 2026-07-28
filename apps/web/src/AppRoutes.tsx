import { Bot, ChevronRight, Construction, Dices, UsersRound } from 'lucide-react'
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom'
import App from './App'

const MODES = [
  { id: '1v1', opponents: 1 },
  { id: '1v2', opponents: 2 },
  { id: '1v3', opponents: 3 },
] as const

function PreparationPage() {
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

        <div className="mode-grid">
          {MODES.map((mode, index) => (
            <Link className="mode-option" to="/play" key={mode.id}>
              <span className="mode-number">0{index + 1}</span>
              <div className="mode-icon"><UsersRound /></div>
              <div>
                <strong>{mode.id}</strong>
                <small>1 名玩家 · {mode.opponents} 名电脑棋手</small>
              </div>
              <ChevronRight />
            </Link>
          ))}
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
