import type { RandomSource } from './random.js'

export * from './types.js'
export * from './random.js'
export * from './map.js'
export * from './content.js'
export * from './state.js'
export * from './rules.js'
export * from './decision.js'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

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
