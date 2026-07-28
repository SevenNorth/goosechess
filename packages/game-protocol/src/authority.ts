import type { AuthorityUpdate, CommandEnvelope, CommandResult, GameSnapshot } from './schemas.js'

export type AuthorityListener = (update: AuthorityUpdate) => void

export interface GameAuthorityPort {
  getSnapshot(): GameSnapshot
  submit(envelope: CommandEnvelope): Promise<CommandResult>
  subscribe(listener: AuthorityListener): () => void
}
