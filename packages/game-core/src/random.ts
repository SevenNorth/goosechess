import type { DicePair, RngState } from './types.js'

export interface RandomSource {
  nextInt(minInclusive: number, maxInclusive: number): number
  snapshot(): RngState
}

export class DeterministicRandom implements RandomSource {
  private cursor: number
  private readonly seed: number

  constructor(state: RngState) {
    if (!Number.isInteger(state.seed) || !Number.isInteger(state.cursor) || state.cursor < 0) {
      throw new RangeError('RNG seed and cursor must be non-negative integers.')
    }
    this.seed = state.seed >>> 0
    this.cursor = state.cursor
  }

  nextInt(minInclusive: number, maxInclusive: number) {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive) || maxInclusive < minInclusive) {
      throw new RangeError('Random integer bounds must be valid integers.')
    }
    let value = (this.seed + Math.imul(this.cursor + 1, 0x6d2b79f5)) >>> 0
    this.cursor += 1
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    const unit = ((value ^ (value >>> 14)) >>> 0) / 4294967296
    return minInclusive + Math.floor(unit * (maxInclusive - minInclusive + 1))
  }

  snapshot(): RngState {
    return { seed: this.seed, cursor: this.cursor }
  }
}

export function rollDice(random: RandomSource, maxFace = 6): DicePair {
  if (!Number.isInteger(maxFace) || maxFace < 1 || maxFace > 6) {
    throw new RangeError('A die face limit must be between 1 and 6.')
  }
  return [random.nextInt(1, maxFace), random.nextInt(1, maxFace)]
}
