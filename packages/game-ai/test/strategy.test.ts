import { describe, expect, it } from 'vitest'
import { createFirstLegalStrategy } from '../src/index.js'

describe('AI strategy boundary', () => {
  it('chooses only from the public legal option list', () => {
    const strategy = createFirstLegalStrategy<{ type: string }>()
    const decision = strategy.decide({
      gameId: 'game-1',
      revision: 3,
      activePlayerId: 'ai-1',
      players: [],
      legalOptions: [
        { command: { type: 'request-roll' }, reasonTags: ['only-legal-command'] },
      ],
    })

    expect(decision).toEqual({ command: { type: 'request-roll' }, reasonTag: 'only-legal-command' })
  })
})
