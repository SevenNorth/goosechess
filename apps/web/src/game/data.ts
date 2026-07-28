import {
  EVENTS,
  FINISH,
  ITEMS,
  LANDMARKS,
  LEGACY_EVENT_SPACE_IDS,
} from '@goose-chess/game-content'

export { EVENTS, FINISH, ITEMS, LANDMARKS }

export const EVENT_SPACES = new Set<number>(LEGACY_EVENT_SPACE_IDS)

export const getItem = (id: string | null) => ITEMS.find((item) => item.id === id) ?? null
