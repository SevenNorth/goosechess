import { createMachine } from 'xstate'

export type PresentationStage =
  | 'ready'
  | 'rolling'
  | 'routePreview'
  | 'targetEmphasis'
  | 'routeFade'
  | 'moving'

export type PresentationEvent =
  | { readonly type: 'ROLL_STARTED' }
  | { readonly type: 'ROUTE_STARTED' }
  | { readonly type: 'DICE_DONE'; readonly hasRoute: boolean }
  | { readonly type: 'ROUTE_DONE' }
  | { readonly type: 'TARGET_DONE' }
  | { readonly type: 'ROUTE_HIDDEN' }
  | { readonly type: 'MOVE_DONE' }
  | { readonly type: 'RESET' }

export const presentationMachine = createMachine({
  types: {} as { events: PresentationEvent },
  id: 'presentation',
  initial: 'ready',
  on: { RESET: '.ready' },
  states: {
    ready: { on: { ROLL_STARTED: 'rolling', ROUTE_STARTED: 'routePreview' } },
    rolling: {
      on: {
        DICE_DONE: [
          { guard: ({ event }) => event.hasRoute, target: 'routePreview' },
          { target: 'ready' },
        ],
      },
    },
    routePreview: { on: { ROUTE_DONE: 'targetEmphasis' } },
    targetEmphasis: { on: { TARGET_DONE: 'routeFade' } },
    routeFade: { on: { ROUTE_HIDDEN: 'moving' } },
    moving: { on: { MOVE_DONE: 'ready' } },
  },
})
