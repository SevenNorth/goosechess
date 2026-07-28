import type { GameDefinition, ParticipantSetup } from '@goose-chess/game-core'
import { LocalGameController } from './controller.js'
import { LocalAuthority } from './local-authority.js'

export const OFFLINE_MATCH_MODES = ['1v1', '1v2', '1v3'] as const
export type OfflineMatchMode = typeof OFFLINE_MATCH_MODES[number]

export interface OfflineMatchConfig {
  readonly mode: OfflineMatchMode
  readonly gameId: string
  readonly seed: number
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

export function createOfflineParticipants(config: OfflineMatchConfig, definition: GameDefinition): readonly ParticipantSetup[] {
  const playerCount = aiOpponentCount(config.mode) + 1
  const skinIds = definition.ruleset.skinIds
  if (!skinIds.length) throw new Error('An offline match requires at least one token skin.')
  const localSkinId = config.localSkinId ?? skinIds[0]
  if (!skinIds.includes(localSkinId)) throw new Error(`Unknown local skin id: ${localSkinId}.`)

  return Array.from({ length: playerCount }, (_, seatIndex) => ({
    playerId: seatIndex === 0 ? 'local-player' : `ai-${seatIndex}`,
    seatIndex,
    controller: seatIndex === 0 ? 'local' as const : 'ai' as const,
    displayName: seatIndex === 0 ? '玩家' : `电脑 ${seatIndex}`,
    colorId: ['pink', 'blue', 'gold', 'teal'][seatIndex],
    skinId: seatIndex === 0 ? localSkinId : skinIds[seatIndex % skinIds.length],
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
