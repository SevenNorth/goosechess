import { useEffect, useState, type CSSProperties } from 'react'
import { ArrowUpRight, Bot, Dices, DoorOpen, LoaderCircle, MapPinned, Play, RefreshCw, UsersRound, X } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { DEFAULT_MAP_CONTENT, LANDMARK_DEFINITIONS } from '@goose-chess/game-content'
import {
  OFFLINE_MATCH_MODES,
  createOfflineAiDisplayNames,
  type OfflineMatchMode,
} from '@goose-chess/game-protocol'
import { createMatchSeed } from './match-seed'
import { createOnlineRoom, joinOnlineRoom } from './online-room-client'
import {
  DEFAULT_PLAYER_NICKNAME,
  NICKNAME_MAX_WIDTH,
  PLAYER_SKIN_OPTIONS,
  loadPlayerProfile,
  nicknameDisplayWidth,
  nicknameValidationMessage,
  normalizeNickname,
  savePlayerProfile,
} from './player-profile'

export function PreparationPage() {
  const navigate = useNavigate()
  const [selectedMode, setSelectedMode] = useState<OfflineMatchMode>('1v1')
  const [matchSeed, setMatchSeed] = useState(createMatchSeed)
  const [initialProfile] = useState(loadPlayerProfile)
  const [nickname, setNickname] = useState(initialProfile.nickname)
  const [selectedSkinId, setSelectedSkinId] = useState(initialProfile.skinId)
  const [profileOpen, setProfileOpen] = useState(true)
  const [onlineCode, setOnlineCode] = useState('')
  const [onlineBusy, setOnlineBusy] = useState(false)
  const [onlineError, setOnlineError] = useState('')
  const opponentCount = Number(selectedMode.at(-1))
  const normalizedNickname = normalizeNickname(nickname)
  const nicknameIssue = nicknameValidationMessage(nickname)
  const nicknameWidth = nicknameDisplayWidth(nickname)
  const selectedSkin = PLAYER_SKIN_OPTIONS.find((skin) => skin.id === selectedSkinId) ?? PLAYER_SKIN_OPTIONS[0]
  const aiDisplayNames = createOfflineAiDisplayNames(
    selectedMode,
    matchSeed,
    nicknameIssue ? DEFAULT_PLAYER_NICKNAME : normalizedNickname,
  )

  useEffect(() => {
    if (!nicknameIssue) savePlayerProfile({ nickname: normalizedNickname, skinId: selectedSkin.id })
  }, [nicknameIssue, normalizedNickname, selectedSkin.id])

  const enterOnlineRoom = async (action: 'create' | 'join') => {
    if (nicknameIssue || onlineBusy) return
    setOnlineBusy(true)
    setOnlineError('')
    try {
      const joined = action === 'create'
        ? await createOnlineRoom(normalizedNickname, selectedSkin.id)
        : await joinOnlineRoom(onlineCode, normalizedNickname, selectedSkin.id)
      navigate(`/room/${joined.room.roomCode}`)
    } catch (error) {
      setOnlineError(error instanceof Error ? error.message : '无法进入在线房间。')
    } finally {
      setOnlineBusy(false)
    }
  }

  const startMatch = () => {
    if (nicknameIssue) return
    const profile = { nickname: normalizedNickname, skinId: selectedSkin.id }
    const parameters = new URLSearchParams({
      mode: selectedMode,
      seed: String(matchSeed),
      name: profile.nickname,
      skin: profile.skinId,
    })
    navigate('/play?' + parameters.toString())
  }

  return (
    <main className="preparation-shell">
      <header className="preparation-header">
        <div className="brand-mark" aria-label="鹅了个棋">
          <span className="brand-goose">鹅</span>
          <div><strong>鹅了个棋</strong><small>奥普港桌面竞速</small></div>
        </div>
        <button
          className="profile-account-trigger"
          type="button"
          aria-label="个人信息"
          aria-expanded={profileOpen}
          aria-controls="player-profile-sidebar"
          onClick={() => setProfileOpen((open) => !open)}
        >
          <span style={{ '--profile-color': selectedSkin.color } as CSSProperties}>
            <img src={selectedSkin.imageSrc} alt="" />
          </span>
          <div><strong>{nicknameIssue ? DEFAULT_PLAYER_NICKNAME : normalizedNickname}</strong><small>本地档案</small></div>
        </button>
      </header>

      <aside className="map-library-sidebar" aria-labelledby="map-picker-title">
        <div className="mode-picker-title">
          <span id="map-picker-title"><MapPinned /> 棋盘地图</span>
          <small>当前可用 1 张</small>
        </div>
        <div className="map-picker-grid">
          <Link className="map-preview-card" to={`/maps/${DEFAULT_MAP_CONTENT.id}`} aria-label={`预览${DEFAULT_MAP_CONTENT.title}棋盘地图`}>
            <div className="map-card-art" aria-hidden="true">
              <img className="map-card-paper" src="/assets/maps/aup-port/paper-board.png" alt="" />
              <img className="map-card-landmark is-start" src="/assets/maps/aup-port/repair-room.png" alt="" />
              <img className="map-card-landmark is-middle" src="/assets/maps/aup-port/yellow-dog.png" alt="" />
              <img className="map-card-landmark is-finish" src="/assets/maps/aup-port/noise-house.png" alt="" />
            </div>
            <div className="map-card-copy">
              <small>经典竞速地图</small>
              <strong>{DEFAULT_MAP_CONTENT.title}</strong>
              <span>{DEFAULT_MAP_CONTENT.spaceCount - 1} 格路线 · {LANDMARK_DEFINITIONS.length} 处地标</span>
            </div>
            <ArrowUpRight />
          </Link>
        </div>
      </aside>

      <section className="preparation-content" aria-labelledby="prepare-title">
        <div className="preparation-heading">
          <span><Dices /> 离线对局</span>
          <h1 id="prepare-title">配置本局棋手</h1>
          <p>确定对局人数、你的昵称和棋子外观，再从维修室出发。</p>
        </div>

        <div className="mode-picker">
          <section className="preparation-section" aria-labelledby="mode-title">
            <div className="mode-picker-title">
              <span id="mode-title"><UsersRound /> 对局人数</span>
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
          </section>


          <section className="preparation-section opponent-roster" aria-labelledby="opponent-title">
            <div className="mode-picker-title">
              <span id="opponent-title"><Bot /> 本局对手</span>
              <button className="reroll-opponents" type="button" title="重新生成对手" aria-label="重新生成对手" onClick={() => setMatchSeed(createMatchSeed())}>
                <RefreshCw />
              </button>
            </div>
            <div className="opponent-list" aria-live="polite">
              {aiDisplayNames.map((name, index) => (
                <article key={name}>
                  <span><Bot /></span>
                  <div><strong>{name}</strong><small>电脑棋手 {index + 1}</small></div>
                </article>
              ))}
            </div>
          </section>

          <div className="match-roster-summary" aria-live="polite">
            <strong>{nicknameIssue ? DEFAULT_PLAYER_NICKNAME : normalizedNickname}</strong>
            <span>vs</span>
            <span>{aiDisplayNames.join(' · ')}</span>
          </div>
          <button className="primary-button start-match-button" type="button" disabled={Boolean(nicknameIssue)} onClick={startMatch}>
            <Play /> 开始对局
          </button>
        </div>

        <section className="online-room-entry" aria-labelledby="online-room-title">
          <header>
            <span><DoorOpen /> 在线房间</span>
            <small>2–4 人私人房间</small>
          </header>
          <p>创建私人房间，或输入另一位玩家分享的 6 位房间码。</p>
          <div className="online-room-actions">
            <button className="primary-button" type="button" disabled={Boolean(nicknameIssue) || onlineBusy} onClick={() => void enterOnlineRoom('create')}>
              {onlineBusy ? <LoaderCircle /> : <DoorOpen />} 创建房间
            </button>
            <label>
              <span>房间码</span>
              <input
                value={onlineCode}
                maxLength={6}
                placeholder="例如 A7K2MP"
                aria-label="6 位房间码"
                onChange={(event) => setOnlineCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
            </label>
            <button className="secondary-command" type="button" disabled={Boolean(nicknameIssue) || onlineBusy || onlineCode.length !== 6} onClick={() => void enterOnlineRoom('join')}>
              加入
            </button>
          </div>
          {onlineError && <strong className="online-room-error" role="alert">{onlineError}</strong>}
        </section>
      </section>
      {profileOpen && (
        <aside id="player-profile-sidebar" className="player-profile-sidebar" aria-labelledby="profile-title">
          <header className="profile-sidebar-header">
            <div><small>本地档案</small><strong id="profile-title">个人信息</strong></div>
            <button type="button" title="关闭个人信息" aria-label="关闭个人信息" onClick={() => setProfileOpen(false)}><X /></button>
          </header>
          <div className="player-profile-editor">
            <div className="profile-token-preview" style={{ '--profile-color': selectedSkin.color } as CSSProperties}>
              <img src={selectedSkin.imageSrc} alt={`${selectedSkin.label}棋子预览`} />
              <strong>{nicknameIssue ? DEFAULT_PLAYER_NICKNAME : normalizedNickname}</strong>
              <small>{selectedSkin.label}</small>
            </div>
            <div className="profile-fields">
              <label className="nickname-field" htmlFor="player-nickname">
                <span>昵称</span>
                <div>
                  <input
                    id="player-nickname"
                    value={nickname}
                    maxLength={NICKNAME_MAX_WIDTH}
                    aria-invalid={Boolean(nicknameIssue)}
                    aria-describedby="nickname-guidance"
                    onChange={(event) => setNickname(event.target.value)}
                  />
                  <strong className={nicknameIssue ? 'is-invalid' : ''}>{nicknameWidth}/{NICKNAME_MAX_WIDTH}</strong>
                </div>
                <small id="nickname-guidance">{nicknameIssue ?? '中文最多 7 个，英文最多 14 个'}</small>
              </label>
              <div className="profile-skin-field">
                <span>棋子外观</span>
                <div className="profile-skin-options" role="radiogroup" aria-label="棋子外观">
                  {PLAYER_SKIN_OPTIONS.map((skin) => (
                    <button
                      className={skin.id === selectedSkin.id ? 'profile-skin-option is-selected' : 'profile-skin-option'}
                      type="button"
                      role="radio"
                      aria-checked={skin.id === selectedSkin.id}
                      onClick={() => setSelectedSkinId(skin.id)}
                      key={skin.id}
                    >
                      <img src={skin.imageSrc} alt="" />
                      <span>{skin.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </aside>
      )}
    </main>
  )
}
