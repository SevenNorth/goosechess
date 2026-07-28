import type { CoreGameCommand } from '@goose-chess/game-core'
import type { GameAuthorityPort } from './authority.js'
import { GameCommandSchema, PROTOCOL_SCHEMA_VERSION, type CommandResult } from './schemas.js'

export type CommandIdFactory = (playerId: string, sequence: number) => string

export interface GameCommandSubmitter {
  submit(playerId: string, command: CoreGameCommand): Promise<CommandResult>
}

export interface CreateLocalGameControllerOptions {
  readonly authority: GameAuthorityPort
  readonly commandIdFactory?: CommandIdFactory
}

export class LocalGameController implements GameCommandSubmitter {
  private readonly authority: GameAuthorityPort
  private readonly commandIdFactory: CommandIdFactory
  private sequence = 0

  constructor(options: CreateLocalGameControllerOptions) {
    this.authority = options.authority
    this.commandIdFactory = options.commandIdFactory ?? ((playerId, sequence) => `${playerId}-local-${sequence}`)
  }

  submit(playerId: string, command: CoreGameCommand) {
    this.sequence += 1
    const snapshot = this.authority.getSnapshot()
    return this.authority.submit({
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      gameId: snapshot.gameId,
      commandId: this.commandIdFactory(playerId, this.sequence),
      playerId,
      expectedRevision: snapshot.revision,
      command: GameCommandSchema.parse(command),
    })
  }
}
