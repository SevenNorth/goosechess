import type { GameDecisionView } from '@goose-chess/game-core'
import type { AuthorityUpdate, CommandEnvelope, CommandResult, GameSnapshot } from './schemas.js'

export type AuthorityListener = (update: AuthorityUpdate) => void

export interface GameAuthorityPort {
  getSnapshot(): GameSnapshot
  getDecisionView(playerId: string): GameDecisionView
  submit(envelope: CommandEnvelope): Promise<CommandResult>
  subscribe(listener: AuthorityListener): () => void
}
