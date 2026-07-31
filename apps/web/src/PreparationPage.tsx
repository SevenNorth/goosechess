import { useEffect, useState, type CSSProperties } from 'react'
import { Bot, Dices, Play, RefreshCw, UsersRound, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  OFFLINE_MATCH_MODES,
  createOfflineAiDisplayNames,
  type OfflineMatchMode,
} from '@goose-chess/game-protocol'
import { createMatchSeed } from './match-seed'
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
    <main className={profileOpen ? 'preparation-shell is-profile-open' : 'preparation-shell'}>
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

        <div className="online-note">
          <Bot />
          <div><strong>在线房间</strong><span>独立游戏服务器将在在线阶段接入。</span></div>
          <span className="status-tag">规划中</span>
        </div>
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
