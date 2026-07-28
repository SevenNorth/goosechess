export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export interface RngState {
  readonly seed: number
  readonly cursor: number
}

export interface RandomSource {
  nextInt(minInclusive: number, maxInclusive: number): number
  snapshot(): RngState
}

export interface PublicPlayerView {
  readonly playerId: string
  readonly seatIndex: number
  readonly spaceId: number
  readonly itemId: string | null
}

export interface DecisionOption<TCommand extends JsonValue = JsonValue> {
  readonly command: TCommand
  readonly reasonTags: readonly string[]
}

export interface DecisionView<TCommand extends JsonValue = JsonValue> {
  readonly gameId: string
  readonly revision: number
  readonly activePlayerId: string
  readonly players: readonly PublicPlayerView[]
  readonly legalOptions: readonly DecisionOption<TCommand>[]
}

export interface AuthorityTransition<TState, TEvent, TCue> {
  readonly state: TState
  readonly events: readonly TEvent[]
  readonly cues: readonly TCue[]
}

export type AuthorityReducer<TState, TCommand, TEvent, TCue> = (
  state: Readonly<TState>,
  command: Readonly<TCommand>,
  random: RandomSource,
) => AuthorityTransition<TState, TEvent, TCue>

export type RuleResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly message: string }

export function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false

  const prototype = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false

  seen.add(value)
  const entries = Array.isArray(value) ? value : Object.values(value)
  const valid = entries.every((entry) => isJsonValue(entry, seen))
  seen.delete(value)
  return valid
}
