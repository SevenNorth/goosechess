import { useState } from 'react'
import { Dices } from 'lucide-react'
import { Navigate, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { OFFLINE_MATCH_MODES, type OfflineMatchMode } from '@goose-chess/game-protocol'
import App from './App'
import { createMatchSeed, parseSeedParameter } from './match-seed'
import { PreparationPage } from './PreparationPage'
import { MapPreviewPage } from './MapPreviewPage'
import { OnlineRoomPage } from './OnlineRoomPage'
import {
  DEFAULT_PLAYER_NICKNAME,
  DEFAULT_PLAYER_SKIN_ID,
  PLAYER_SKIN_OPTIONS,
  nicknameValidationMessage,
  normalizeNickname,
} from './player-profile'

function PlayPage() {
  const navigate = useNavigate()
  const [parameters] = useSearchParams()
  const [fallbackSeed] = useState(createMatchSeed)
  const requestedMode = parameters.get('mode')
  const mode: OfflineMatchMode = OFFLINE_MATCH_MODES.includes(requestedMode as OfflineMatchMode)
    ? requestedMode as OfflineMatchMode
    : '1v1'
  const requestedSeed = parseSeedParameter(parameters.get('seed'))
  const requestedNickname = normalizeNickname(parameters.get('name') ?? '')
  const localDisplayName = nicknameValidationMessage(requestedNickname) ? DEFAULT_PLAYER_NICKNAME : requestedNickname
  const requestedSkinId = parameters.get('skin')
  const localSkinId = PLAYER_SKIN_OPTIONS.some((skin) => skin.id === requestedSkinId)
    ? requestedSkinId!
    : DEFAULT_PLAYER_SKIN_ID
  const requestedSpeed = Number(parameters.get('speed'))
  return <App
    mode={mode}
    seed={requestedSeed ?? fallbackSeed}
    localDisplayName={localDisplayName}
    localSkinId={localSkinId}
    animationSpeed={Number.isFinite(requestedSpeed) && requestedSpeed >= 0.75 && requestedSpeed <= 20 ? requestedSpeed : undefined}
    onExit={() => navigate('/')}
  />
}

export default function AppRoutes() {
  return (
    <>
      <Routes>
        <Route path="/" element={<PreparationPage />} />
        <Route path="/play" element={<PlayPage />} />
        <Route path="/maps/:mapId" element={<MapPreviewPage />} />
        <Route path="/room/:roomCode" element={<OnlineRoomPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <aside className="desktop-size-warning" role="status" aria-label="桌面窗口尺寸提示">
        <Dices />
        <strong>请扩大为横向桌面窗口</strong>
        <span>鹅了个棋当前需要至少 1180 x 680 的横屏空间。</span>
      </aside>
    </>
  )
}
