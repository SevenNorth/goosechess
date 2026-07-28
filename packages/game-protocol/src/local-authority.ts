import {
  createInitialGameState,
  createGameDecisionView,
  reduceGameCommand,
  type CoreGameCommand,
  type GameDefinition,
  type GameState,
  type ParticipantSetup,
  type RuleCue,
  type RuleEvent,
} from '@goose-chess/game-core'
import type { AuthorityListener, GameAuthorityPort } from './authority.js'
import {
  AuthorityUpdateSchema,
  CommandResultSchema,
  GameSnapshotSchema,
  PROTOCOL_SCHEMA_VERSION,
  type CommandEnvelope,
  type CommandResult,
  type DomainEvent,
  type GameCommand,
  type GameSnapshot,
  type PresentationCue,
} from './schemas.js'
import { createAuthorityError, parseCommandEnvelope, validateCommandContext } from './validation.js'

export interface CreateLocalAuthorityOptions {
  readonly gameId: string
  readonly definition: GameDefinition
  readonly participants: readonly ParticipantSetup[]
  readonly seed: number
}

export interface RestoreLocalAuthorityOptions {
  readonly definition: GameDefinition
  readonly snapshot: GameSnapshot
}

function toCoreCommand(command: GameCommand): CoreGameCommand {
  switch (command.type) {
    case 'select-skin': return { type: command.type, skinId: command.skinId }
    case 'choose-starting-item': return { type: command.type, itemId: command.itemId }
    case 'use-item': return { type: command.type, itemId: command.itemId }
    case 'request-roll': return { type: command.type }
    case 'choose-event': return { type: command.type, eventId: command.eventId }
    case 'choose-item': return { type: command.type, itemId: command.itemId }
    case 'continue': return { type: command.type }
  }
}

function toSnapshot(gameId: string, revision: number, definition: GameDefinition, state: GameState): GameSnapshot {
  return GameSnapshotSchema.parse({
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    gameId,
    revision,
    rulesetId: definition.ruleset.id,
    rulesetVersion: definition.ruleset.version,
    mapId: definition.map.id,
    contentVersion: definition.contentVersion,
    rngSeed: state.rng.seed,
    rngCursor: state.rng.cursor,
    state: {
      phase: state.phase,
      round: state.round,
      activePlayerId: state.activePlayerId,
      players: state.players.map((player) => ({ ...player })),
      pendingEventIds: [...state.pendingEventIds],
      pendingItemId: state.pendingItemId,
      eventContinuation: state.eventContinuation,
      recentEventIds: [...state.recentEventIds],
      winnerPlayerId: state.winnerPlayerId,
      extraTurnQueued: state.extraTurnQueued,
      globalDieRule: state.globalDieRule,
      lastDice: state.lastDice ? { ...state.lastDice, faces: [...state.lastDice.faces] } : null,
    },
  })
}

function fromSnapshot(snapshot: GameSnapshot): GameState {
  return {
    phase: snapshot.state.phase,
    round: snapshot.state.round,
    activePlayerId: snapshot.state.activePlayerId,
    players: snapshot.state.players.map((player) => ({ ...player })),
    rng: { seed: snapshot.rngSeed, cursor: snapshot.rngCursor },
    pendingEventIds: [...snapshot.state.pendingEventIds],
    pendingItemId: snapshot.state.pendingItemId,
    eventContinuation: snapshot.state.eventContinuation,
    recentEventIds: [...snapshot.state.recentEventIds],
    winnerPlayerId: snapshot.state.winnerPlayerId,
    extraTurnQueued: snapshot.state.extraTurnQueued,
    globalDieRule: snapshot.state.globalDieRule,
    lastDice: snapshot.state.lastDice ? { ...snapshot.state.lastDice, faces: [...snapshot.state.lastDice.faces] } : null,
  }
}

function assertSnapshotMatchesDefinition(snapshot: GameSnapshot, definition: GameDefinition) {
  const issues: string[] = []
  if (snapshot.mapId !== definition.map.id) issues.push('mapId')
  if (snapshot.rulesetId !== definition.ruleset.id || snapshot.rulesetVersion !== definition.ruleset.version) issues.push('ruleset version')
  if (snapshot.contentVersion !== definition.contentVersion) issues.push('content version')

  const playerIds = new Set(snapshot.state.players.map((player) => player.playerId))
  const itemIds = new Set(definition.items.map((item) => item.id))
  const skinIds = new Set(definition.skins.map((skin) => skin.id))
  const eventIds = new Set(definition.events.map((event) => event.id))
  const spaceIds = new Set(definition.map.spaces.map((space) => space.index))
  if (playerIds.size !== snapshot.state.players.length || !playerIds.has(snapshot.state.activePlayerId)) issues.push('player identities')
  snapshot.state.players.forEach((player, index) => {
    if (player.seatIndex !== index || !spaceIds.has(player.spaceId) || !skinIds.has(player.skinId) || (player.itemId !== null && !itemIds.has(player.itemId))) {
      issues.push(`player ${player.playerId}`)
    }
  })
  if (snapshot.state.pendingEventIds.some((eventId) => !eventIds.has(eventId))) issues.push('pending events')
  if (snapshot.state.recentEventIds.some((eventId) => !eventIds.has(eventId))) issues.push('recent events')
  if (snapshot.state.pendingItemId !== null && !itemIds.has(snapshot.state.pendingItemId)) issues.push('pending item')
  if (snapshot.state.winnerPlayerId !== null && !playerIds.has(snapshot.state.winnerPlayerId)) issues.push('winner')
  if ((snapshot.state.phase === 'game-over') !== (snapshot.state.winnerPlayerId !== null)) issues.push('game-over phase')
  if (issues.length) throw new Error(`Snapshot does not match the supplied game definition: ${issues.join(', ')}.`)
}

function decorateEvent(event: RuleEvent, revision: number, index: number): DomainEvent {
  const common = { eventId: `r${revision}-e${index}`, revision }
  switch (event.type) {
    case 'starting-item-chosen': return { ...common, ...event }
    case 'skin-selected': return { ...common, ...event }
    case 'dice-rolled': return { ...common, ...event, dice: [...event.dice] as [number, number] }
    case 'token-moved': return { ...common, ...event, path: [...event.path] }
    case 'collision-resolved': return { ...common, ...event }
    case 'event-offered': return { ...common, ...event, eventCardIds: [...event.eventCardIds] as [string, string, string] }
    case 'event-resolved': return { ...common, ...event }
    case 'item-changed': return { ...common, ...event }
    case 'item-offered': return { ...common, ...event }
    case 'turn-skipped': return { ...common, ...event }
    case 'turn-advanced': return { ...common, ...event }
    case 'global-die-rule-changed': return { ...common, ...event }
    case 'game-won': return { ...common, ...event }
  }
}

function decorateCue(cue: RuleCue, revision: number, index: number): PresentationCue {
  const common = { cueId: `r${revision}-c${index}`, sequence: revision * 100 + index }
  switch (cue.type) {
    case 'dice-roll': return { ...common, ...cue, dice: [...cue.dice] as [number, number] }
    case 'route-preview': return { ...common, ...cue, path: [...cue.path] }
    case 'target-highlight': return { ...common, ...cue }
    case 'token-hop': return { ...common, ...cue, path: [...cue.path] }
    case 'event-cards': return { ...common, ...cue, eventIds: [...cue.eventIds] as [string, string, string] }
    case 'game-over': return { ...common, ...cue }
  }
}

export class LocalAuthority implements GameAuthorityPort {
  private readonly definition: GameDefinition
  private readonly gameId: string
  private readonly listeners = new Set<AuthorityListener>()
  private readonly processedCommands = new Map<string, { envelope: CommandEnvelope; result: CommandResult }>()
  private state: GameState
  private snapshot: GameSnapshot

  private constructor(definition: GameDefinition, snapshot: GameSnapshot) {
    this.definition = definition
    this.gameId = snapshot.gameId
    this.snapshot = snapshot
    this.state = fromSnapshot(snapshot)
  }

  static create(options: CreateLocalAuthorityOptions) {
    const state = createInitialGameState(options)
    return new LocalAuthority(options.definition, toSnapshot(options.gameId, 0, options.definition, state))
  }

  static restore(options: RestoreLocalAuthorityOptions) {
    const snapshot = GameSnapshotSchema.parse(options.snapshot)
    assertSnapshotMatchesDefinition(snapshot, options.definition)
    return new LocalAuthority(options.definition, snapshot)
  }

  getSnapshot() {
    return GameSnapshotSchema.parse(this.snapshot)
  }

  getDecisionView(playerId: string) {
    return createGameDecisionView(this.state, this.definition, {
      gameId: this.gameId,
      revision: this.snapshot.revision,
      playerId,
    })
  }

  async submit(envelope: CommandEnvelope): Promise<CommandResult> {
    const parsed = parseCommandEnvelope(envelope)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const acceptedEnvelope = parsed.value
    const cached = this.processedCommands.get(acceptedEnvelope.commandId)
    if (cached) {
      if (JSON.stringify(cached.envelope) === JSON.stringify(acceptedEnvelope)) return CommandResultSchema.parse(cached.result)
      return { ok: false, error: createAuthorityError('duplicate_command', 'This commandId was reused with a different payload.') }
    }
    if (acceptedEnvelope.gameId !== this.gameId) {
      return { ok: false, error: createAuthorityError('invalid_envelope', 'The command targets a different game.') }
    }

    const contextError = validateCommandContext(acceptedEnvelope, {
      currentRevision: this.snapshot.revision,
      seenCommandIds: new Set(this.processedCommands.keys()),
      content: {
        eventIds: new Set(this.definition.events.map((event) => event.id)),
        itemIds: new Set(this.definition.items.map((item) => item.id)),
        skinIds: new Set(this.definition.skins.map((skin) => skin.id)),
      },
    })
    if (contextError) return { ok: false, error: contextError }

    const transition = reduceGameCommand(this.state, this.definition, acceptedEnvelope.playerId, toCoreCommand(acceptedEnvelope.command))
    if (!transition.ok) {
      return {
        ok: false,
        error: createAuthorityError(transition.code, transition.message),
      }
    }

    const revision = this.snapshot.revision + 1
    this.state = transition.state
    this.snapshot = toSnapshot(this.gameId, revision, this.definition, this.state)
    const update = {
      snapshot: this.getSnapshot(),
      events: transition.events.map((event, index) => decorateEvent(event, revision, index)),
      cues: transition.cues.map((cue, index) => decorateCue(cue, revision, index)),
    }
    const result = CommandResultSchema.parse({ ok: true, update })
    this.processedCommands.set(acceptedEnvelope.commandId, { envelope: acceptedEnvelope, result })
    for (const listener of this.listeners) listener(AuthorityUpdateSchema.parse(update))
    return CommandResultSchema.parse(result)
  }

  subscribe(listener: AuthorityListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
