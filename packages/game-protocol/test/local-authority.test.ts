import { describe, expect, it, vi } from 'vitest'
import { LocalAuthority, PROTOCOL_SCHEMA_VERSION, type CommandEnvelope, type GameCommand } from '../src/index.js'
import { AUTHORITY_DEFINITION, AUTHORITY_PARTICIPANTS } from './authority-fixture.js'

function command(commandId: string, playerId: string, expectedRevision: number, gameCommand: GameCommand): CommandEnvelope {
  return {
    schemaVersion: PROTOCOL_SCHEMA_VERSION,
    gameId: 'game-1',
    commandId,
    playerId,
    expectedRevision,
    command: gameCommand,
  }
}

function createAuthority() {
  return LocalAuthority.create({
    gameId: 'game-1',
    definition: AUTHORITY_DEFINITION,
    participants: AUTHORITY_PARTICIPANTS,
    seed: 20260728,
  })
}

describe('LocalAuthority', () => {
  it('replays a fixed seed and command sequence exactly', async () => {
    const first = createAuthority()
    const second = createAuthority()
    const commands = [
      command('c1', 'p0', 0, { type: 'request-roll' }),
      command('c2', 'p1', 1, { type: 'request-roll' }),
      command('c3', 'p0', 2, { type: 'request-roll' }),
    ]

    for (const envelope of commands) {
      expect(await first.submit(envelope)).toEqual(await second.submit(envelope))
    }
    expect(first.getSnapshot()).toEqual(second.getSnapshot())
  })

  it('continues identically after restoring an intermediate snapshot', async () => {
    const uninterrupted = createAuthority()
    await uninterrupted.submit(command('c1', 'p0', 0, { type: 'request-roll' }))
    const checkpoint = uninterrupted.getSnapshot()
    const restored = LocalAuthority.restore({ definition: AUTHORITY_DEFINITION, snapshot: checkpoint })
    const next = command('c2', 'p1', 1, { type: 'request-roll' })

    expect(await restored.submit(next)).toEqual(await uninterrupted.submit(next))
    expect(restored.getSnapshot()).toEqual(uninterrupted.getSnapshot())
  })

  it('restores a partially completed turn-order roll group', async () => {
    const participants = AUTHORITY_PARTICIPANTS.map((participant) => ({ ...participant, startingItemId: undefined }))
    const uninterrupted = LocalAuthority.create({
      gameId: 'game-1',
      definition: AUTHORITY_DEFINITION,
      participants,
      seed: 5,
    })
    await uninterrupted.submit(command('setup-1', 'p0', 0, { type: 'choose-starting-item', itemId: 'clover' }))
    await uninterrupted.submit(command('setup-2', 'p1', 1, { type: 'choose-starting-item', itemId: 'clover' }))
    await uninterrupted.submit(command('order-1', 'p0', 2, { type: 'request-order-roll' }))

    const restored = LocalAuthority.restore({ definition: AUTHORITY_DEFINITION, snapshot: uninterrupted.getSnapshot() })
    const next = command('order-2', 'p1', 3, { type: 'request-order-roll' })

    expect(await restored.submit(next)).toEqual(await uninterrupted.submit(next))
    expect(restored.getSnapshot()).toEqual(uninterrupted.getSnapshot())
  })

  it('rejects snapshots whose content references do not match the definition', () => {
    const authority = createAuthority()
    const snapshot = authority.getSnapshot()
    snapshot.state.players[0].skinId = 'unknown-skin'

    expect(() => LocalAuthority.restore({ definition: AUTHORITY_DEFINITION, snapshot })).toThrow(/player p0/)
  })

  it('is idempotent for duplicate commandIds and publishes accepted updates once', async () => {
    const authority = createAuthority()
    const listener = vi.fn()
    authority.subscribe(listener)
    const envelope = command('c1', 'p0', 0, { type: 'request-roll' })
    const first = await authority.submit(envelope)
    const duplicate = await authority.submit(envelope)

    expect(duplicate).toEqual(first)
    expect(authority.getSnapshot().revision).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('rejects commandId reuse with a different payload', async () => {
    const authority = createAuthority()
    await authority.submit(command('c1', 'p0', 0, { type: 'request-roll' }))

    expect(await authority.submit(command('c1', 'p1', 1, { type: 'request-roll' }))).toMatchObject({
      ok: false,
      error: { code: 'duplicate_command' },
    })
  })

  it('does not expose its internal snapshot through listeners', async () => {
    const authority = createAuthority()
    authority.subscribe((update) => {
      update.snapshot.state.players[0].spaceId = 29
    })
    await authority.submit(command('c1', 'p0', 0, { type: 'request-roll' }))

    expect(authority.getSnapshot().state.players[0].spaceId).not.toBe(29)
  })

  it('rejects stale revisions with a resynchronization error', async () => {
    const authority = createAuthority()
    expect(await authority.submit(command('stale', 'p0', 4, { type: 'request-roll' }))).toMatchObject({
      ok: false,
      error: { code: 'stale_revision', retryable: true },
    })
  })

  it('serializes a legal movement that is clamped to an empty path', async () => {
    const authority = LocalAuthority.create({
      gameId: 'game-1',
      definition: {
        ...AUTHORITY_DEFINITION,
        events: AUTHORITY_DEFINITION.events.map((event, index) => index === 0
          ? { ...event, effect: [{ type: 'move' as const, spaces: -2 }] }
          : event),
      },
      participants: AUTHORITY_PARTICIPANTS,
      seed: 1,
    })
    const snapshot = authority.getSnapshot()
    snapshot.state.phase = 'awaiting-event-choice'
    snapshot.state.pendingEventIds = ['event-a', 'event-b', 'event-c']
    const restored = LocalAuthority.restore({
      definition: {
        ...AUTHORITY_DEFINITION,
        events: AUTHORITY_DEFINITION.events.map((event, index) => index === 0
          ? { ...event, effect: [{ type: 'move' as const, spaces: -2 }] }
          : event),
      },
      snapshot,
    })

    const result = await restored.submit(command('empty-path', 'p0', 0, { type: 'choose-event', eventId: 'event-a' }))
    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.update.events).toContainEqual(expect.objectContaining({ type: 'token-moved', path: [] }))
  })
})
