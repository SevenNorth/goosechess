import { createActor } from 'xstate'
import { describe, expect, it } from 'vitest'
import { presentationMachine } from './presentation-machine'

describe('presentation machine', () => {
  it('enforces route, target, fade and movement ordering', () => {
    const actor = createActor(presentationMachine).start()
    const states: string[] = []
    actor.subscribe((snapshot) => states.push(String(snapshot.value)))

    actor.send({ type: 'ROLL_STARTED' })
    actor.send({ type: 'DICE_DONE', hasRoute: true })
    actor.send({ type: 'ROUTE_DONE' })
    actor.send({ type: 'TARGET_DONE' })
    actor.send({ type: 'ROUTE_HIDDEN' })
    actor.send({ type: 'MOVE_DONE' })

    expect(states).toEqual(['rolling', 'routePreview', 'targetEmphasis', 'routeFade', 'moving', 'ready'])
  })

  it('returns directly to ready after a check roll without movement cues', () => {
    const actor = createActor(presentationMachine).start()
    actor.send({ type: 'ROLL_STARTED' })
    actor.send({ type: 'DICE_DONE', hasRoute: false })
    expect(actor.getSnapshot().value).toBe('ready')
  })
})
