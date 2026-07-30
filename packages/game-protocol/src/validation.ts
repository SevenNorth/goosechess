import type { z } from 'zod'
import {
  CommandEnvelopeSchema,
  GameSnapshotSchema,
  type AuthorityError,
  type AuthorityErrorCode,
  type CommandEnvelope,
  type GameCommand,
  type GameSnapshot,
} from './schemas.js'
import { findJsonCompatibilityIssue } from './json.js'

type ErrorDetails = Record<string, string | number | boolean | null>

export function createAuthorityError(
  code: AuthorityErrorCode,
  message: string,
  retryable = false,
  details?: ErrorDetails,
): AuthorityError {
  return { code, message, retryable, ...(details ? { details } : {}) }
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AuthorityError }

function formatZodIssue(issue: z.core.$ZodIssue | undefined) {
  if (!issue) return 'Protocol payload is invalid.'
  const path = issue.path.length ? issue.path.join('.') : 'payload'
  return `${path}: ${issue.message}`
}

export function parseCommandEnvelope(input: unknown): ValidationResult<CommandEnvelope> {
  const commandType = typeof input === 'object' && input !== null
    && 'command' in input && typeof input.command === 'object' && input.command !== null
    && 'type' in input.command
    ? input.command.type
    : undefined

  const parsed = CommandEnvelopeSchema.safeParse(input)
  if (parsed.success) return { ok: true, value: parsed.data }
  if (typeof commandType === 'string' && !GameCommandTypes.has(commandType)) {
    return { ok: false, error: createAuthorityError('unknown_command', `Unknown command type: ${commandType}.`) }
  }
  return { ok: false, error: createAuthorityError('invalid_envelope', formatZodIssue(parsed.error.issues[0])) }
}

export function parseGameSnapshot(input: unknown): ValidationResult<GameSnapshot> {
  const compatibilityIssue = findJsonCompatibilityIssue(input)
  if (compatibilityIssue) {
    return {
      ok: false,
      error: createAuthorityError('invalid_envelope', `${compatibilityIssue.path}: ${compatibilityIssue.reason}`),
    }
  }
  const parsed = GameSnapshotSchema.safeParse(input)
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: createAuthorityError('invalid_envelope', formatZodIssue(parsed.error.issues[0])) }
}

export interface KnownContentIds {
  readonly eventIds: ReadonlySet<string>
  readonly itemIds: ReadonlySet<string>
  readonly skinIds: ReadonlySet<string>
}

export interface CommandValidationContext {
  readonly currentRevision: number
  readonly seenCommandIds: ReadonlySet<string>
  readonly content: KnownContentIds
}

const GameCommandTypes: ReadonlySet<string> = new Set<GameCommand['type']>([
  'select-skin',
  'choose-starting-item',
  'request-order-roll',
  'use-item',
  'request-roll',
  'choose-event',
  'choose-item',
  'continue',
])

function referencedContent(command: GameCommand): { kind: keyof KnownContentIds; id: string } | null {
  switch (command.type) {
    case 'select-skin': return { kind: 'skinIds', id: command.skinId }
    case 'choose-starting-item':
    case 'use-item': return { kind: 'itemIds', id: command.itemId }
    case 'choose-item': return command.itemId ? { kind: 'itemIds', id: command.itemId } : null
    case 'choose-event': return { kind: 'eventIds', id: command.eventId }
    case 'request-order-roll':
    case 'request-roll':
    case 'continue': return null
  }
}

export function validateCommandContext(
  envelope: CommandEnvelope,
  context: CommandValidationContext,
): AuthorityError | null {
  if (context.seenCommandIds.has(envelope.commandId)) {
    return createAuthorityError('duplicate_command', 'This commandId has already been processed.', false, { commandId: envelope.commandId })
  }
  if (envelope.expectedRevision !== context.currentRevision) {
    return createAuthorityError('stale_revision', 'The command targets an outdated game revision.', true, {
      expectedRevision: envelope.expectedRevision,
      currentRevision: context.currentRevision,
    })
  }

  const reference = referencedContent(envelope.command)
  if (reference && !context.content[reference.kind].has(reference.id)) {
    return createAuthorityError('unknown_content', `Unknown content id: ${reference.id}.`, false, {
      contentId: reference.id,
      contentKind: reference.kind,
    })
  }
  return null
}
