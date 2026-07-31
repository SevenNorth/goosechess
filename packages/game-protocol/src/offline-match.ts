import type { GameDefinition, ParticipantSetup } from '@goose-chess/game-core'
import { LocalGameController } from './controller.js'
import { LocalAuthority } from './local-authority.js'

export const OFFLINE_MATCH_MODES = ['1v1', '1v2', '1v3'] as const
export type OfflineMatchMode = typeof OFFLINE_MATCH_MODES[number]

export interface OfflineMatchConfig {
  readonly mode: OfflineMatchMode
  readonly gameId: string
  readonly seed: number
  readonly localDisplayName?: string
  readonly localSkinId?: string
}

export interface OfflineMatch {
  readonly config: OfflineMatchConfig
  readonly participants: readonly ParticipantSetup[]
  readonly authority: LocalAuthority
  readonly controller: LocalGameController
}

export function aiOpponentCount(mode: OfflineMatchMode) {
  const count = Number(mode.at(-1))
  if (!OFFLINE_MATCH_MODES.includes(mode) || !Number.isInteger(count) || count < 1 || count > 3) {
    throw new RangeError(`Unsupported offline match mode: ${mode}.`)
  }
  return count
}

export const OFFLINE_AI_DISPLAY_NAMES = [
  '港口邮差',
  '晚班水手',
  '灰帽船长',
  '灯塔看守',
  '旧船票客',
  '茶摊老板',
  '维修学徒',
  '码头领航员',
  '海风记者',
  '纸船商人',
  '锚点技师',
  '雨衣游客',
] as const

function seededNameRank(seed: number, name: string) {
  let hash = (seed ^ 0x811c9dc5) >>> 0
  for (const character of name) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function createOfflineAiDisplayNames(mode: OfflineMatchMode, seed: number, localDisplayName = '玩家') {
  const normalizedLocalName = localDisplayName.trim().toLocaleLowerCase()
  return OFFLINE_AI_DISPLAY_NAMES
    .filter((name) => name.toLocaleLowerCase() !== normalizedLocalName)
    .map((name) => ({ name, rank: seededNameRank(seed, name) }))
    .sort((left, right) => left.rank - right.rank || left.name.localeCompare(right.name))
    .slice(0, aiOpponentCount(mode))
    .map(({ name }) => name)
}

export function createOfflineParticipants(config: OfflineMatchConfig, definition: GameDefinition): readonly ParticipantSetup[] {
  const playerCount = aiOpponentCount(config.mode) + 1
  const skinIds = definition.ruleset.skinIds
  if (!skinIds.length) throw new Error('An offline match requires at least one token skin.')
  const localSkinId = config.localSkinId ?? skinIds[0]
  if (!skinIds.includes(localSkinId)) throw new Error(`Unknown local skin id: ${localSkinId}.`)

  const localDisplayName = config.localDisplayName?.trim() || '玩家'
  const aiDisplayNames = createOfflineAiDisplayNames(config.mode, config.seed, localDisplayName)
  const aiSkinIds = skinIds.filter((skinId) => skinId !== localSkinId)
  return Array.from({ length: playerCount }, (_, seatIndex) => ({
    playerId: seatIndex === 0 ? 'local-player' : `ai-${seatIndex}`,
    seatIndex,
    controller: seatIndex === 0 ? 'local' as const : 'ai' as const,
    displayName: seatIndex === 0 ? localDisplayName : aiDisplayNames[seatIndex - 1],
    colorId: ['pink', 'blue', 'gold', 'teal'][seatIndex],
    skinId: seatIndex === 0
      ? localSkinId
      : aiSkinIds[(seatIndex - 1) % aiSkinIds.length] ?? localSkinId,
  }))
}

export function createOfflineMatch(config: OfflineMatchConfig, definition: GameDefinition): OfflineMatch {
  const participants = createOfflineParticipants(config, definition)
  const authority = LocalAuthority.create({
    gameId: config.gameId,
    definition,
    participants,
    seed: config.seed,
  })
  return {
    config,
    participants,
    authority,
    controller: new LocalGameController({ authority }),
  }
}
