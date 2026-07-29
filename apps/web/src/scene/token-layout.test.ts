import { describe, expect, it } from 'vitest'
import { tokenOffset, type TokenPosition } from './token-layout'

const players: readonly TokenPosition[] = [
  { playerId: 'local', seatIndex: 0, spaceId: 3 },
  { playerId: 'ai-1', seatIndex: 1, spaceId: 0 },
  { playerId: 'ai-2', seatIndex: 2, spaceId: 0 },
]

describe('token layout', () => {
  it('centers a token that occupies its space alone', () => {
    expect(tokenOffset(players[0], players)).toEqual({ x: 0, y: 0 })
  })

  it('only offsets tokens that share the same space', () => {
    expect(tokenOffset(players[1], players)).toEqual({ x: -18, y: 0 })
    expect(tokenOffset(players[2], players)).toEqual({ x: 18, y: 0 })
  })
})
