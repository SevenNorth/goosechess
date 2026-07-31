// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_PLAYER_NICKNAME,
  DEFAULT_PLAYER_SKIN_ID,
  loadPlayerProfile,
  nicknameDisplayWidth,
  nicknameValidationMessage,
  savePlayerProfile,
} from './player-profile'

describe('player profile', () => {
  afterEach(() => window.localStorage.clear())

  it('按中文双宽、英文单宽校验昵称', () => {
    expect(nicknameDisplayWidth('七只Goose')).toBe(9)
    expect(nicknameValidationMessage('一二三四五六七')).toBeNull()
    expect(nicknameValidationMessage('abcdefghijklmn')).toBeNull()
    expect(nicknameValidationMessage('一二三四五六七八')).toBe('中文最多 7 个，英文最多 14 个')
    expect(nicknameValidationMessage('abcdefghijklmno')).toBe('中文最多 7 个，英文最多 14 个')
  })

  it('从本地档案读取有效资料并回退无效资料', () => {
    savePlayerProfile({ nickname: '灯塔客', skinId: 'goose-blue' })
    expect(loadPlayerProfile()).toEqual({ nickname: '灯塔客', skinId: 'goose-blue' })

    window.localStorage.setItem('goose-chess-player-profile-v1', '{"nickname":"","skinId":"missing"}')
    expect(loadPlayerProfile()).toEqual({
      nickname: DEFAULT_PLAYER_NICKNAME,
      skinId: DEFAULT_PLAYER_SKIN_ID,
    })
  })
})
