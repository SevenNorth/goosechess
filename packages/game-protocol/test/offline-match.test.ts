import { describe, expect, it, vi } from 'vitest'
import { LocalGameController, createOfflineMatch, createOfflineParticipants } from '../src/index.js'
import { AUTHORITY_DEFINITION } from './authority-fixture.js'

describe('offline match composition', () => {
  it.each([
    ['1v1', 2],
    ['1v2', 3],
    ['1v3', 4],
  ] as const)('creates one local participant for %s', (mode, playerCount) => {
    const match = createOfflineMatch({ mode, gameId: `game-${mode}`, seed: 7 }, AUTHORITY_DEFINITION)

    expect(match.participants).toHaveLength(playerCount)
    expect(match.participants.filter((player) => player.controller === 'local')).toHaveLength(1)
    expect(match.participants.filter((player) => player.controller === 'ai')).toHaveLength(playerCount - 1)
  })

  it('rejects modes outside the explicit offline set at runtime', () => {
    expect(() => createOfflineParticipants({ mode: '2v2' as '1v1', gameId: 'g', seed: 1 }, AUTHORITY_DEFINITION)).toThrow(/Unsupported/)
  })

  it('uses the current revision and the same command envelope for every controller', async () => {
    const match = createOfflineMatch({ mode: '1v1', gameId: 'game-controller', seed: 8 }, AUTHORITY_DEFINITION)
    const submit = vi.spyOn(match.authority, 'submit')
    const controller = new LocalGameController({ authority: match.authority, commandIdFactory: (_, sequence) => `command-${sequence}` })

    await controller.submit('local-player', { type: 'request-order-roll' })

    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      gameId: 'game-controller',
      commandId: 'command-1',
      playerId: 'local-player',
      expectedRevision: 0,
      command: { type: 'request-order-roll' },
    }))
  })
})
