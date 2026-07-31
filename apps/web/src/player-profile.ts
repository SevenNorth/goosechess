export const NICKNAME_MAX_WIDTH = 14
export const DEFAULT_PLAYER_NICKNAME = '玩家'
export const DEFAULT_PLAYER_SKIN_ID = 'goose-white'

export const PLAYER_SKIN_OPTIONS = [
  { id: 'goose-white', label: '白鹅', color: '#ece9dc' },
  { id: 'goose-yellow', label: '黄鹅', color: '#dda735' },
  { id: 'goose-blue', label: '蓝鹅', color: '#75a7d5' },
  { id: 'goose-pink', label: '粉鹅', color: '#db7d9c' },
] as const

export interface PlayerProfile {
  readonly nickname: string
  readonly skinId: string
}

const PROFILE_STORAGE_KEY = 'goose-chess-player-profile-v1'
const ALLOWED_NICKNAME = /^[\p{L}\p{N} ·'_.-]+$/u

export function normalizeNickname(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

export function nicknameDisplayWidth(value: string) {
  return [...normalizeNickname(value)].reduce((width, character) => (
    width + ((character.codePointAt(0) ?? 0) <= 0x7f ? 1 : 2)
  ), 0)
}

export function nicknameValidationMessage(value: string) {
  const nickname = normalizeNickname(value)
  if (!nickname) return '请输入棋手昵称'
  if (!ALLOWED_NICKNAME.test(nickname)) return '昵称仅支持中英文、数字、空格和常用连接符'
  if (nicknameDisplayWidth(nickname) > NICKNAME_MAX_WIDTH) return '中文最多 7 个，英文最多 14 个'
  return null
}

export function loadPlayerProfile(): PlayerProfile {
  const fallback = { nickname: DEFAULT_PLAYER_NICKNAME, skinId: DEFAULT_PLAYER_SKIN_ID }
  if (typeof window === 'undefined') return fallback
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROFILE_STORAGE_KEY) ?? 'null') as Partial<PlayerProfile> | null
    if (!parsed) return fallback
    const nickname = typeof parsed.nickname === 'string' ? normalizeNickname(parsed.nickname) : fallback.nickname
    const skinId = PLAYER_SKIN_OPTIONS.some((skin) => skin.id === parsed.skinId) ? parsed.skinId! : fallback.skinId
    return nicknameValidationMessage(nickname) ? fallback : { nickname, skinId }
  } catch {
    return fallback
  }
}

export function savePlayerProfile(profile: PlayerProfile) {
  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile))
}
