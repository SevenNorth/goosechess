import { describe, expect, it } from 'vitest'
import { isJsonValue, type AuthorityReducer, type RandomSource } from '../src/index.js'

describe('game-core boundaries', () => {
  it('accepts plain JSON and rejects runtime objects', () => {
    expect(isJsonValue({ players: [{ id: 'p1', spaceId: 3 }], active: true })).toBe(true)
    expect(isJsonValue(new Map([['spaceId', 3]]))).toBe(false)
    expect(isJsonValue(new Set([1, 2]))).toBe(false)
    expect(isJsonValue(() => undefined)).toBe(false)
  })

  it('defines a reducer contract without runtime dependencies', () => {
    const random: RandomSource = {
      nextInt: () => 4,
      snapshot: () => ({ seed: 1, cursor: 1 }),
    }
    const reducer: AuthorityReducer<number, { amount: number }, string, string> = (state, command, source) => ({
      state: state + command.amount + source.nextInt(1, 6),
      events: ['advanced'],
      cues: ['token-hop'],
    })

    expect(reducer(2, { amount: 3 }, random)).toEqual({ state: 9, events: ['advanced'], cues: ['token-hop'] })
  })
})
