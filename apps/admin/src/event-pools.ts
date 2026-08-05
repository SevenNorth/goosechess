import { DEFAULT_MAP_DEFINITION } from '@goose-chess/game-content'
import type { ContentDraft } from './types'

export interface EventPoolOption {
  readonly id: string
  readonly label: string
  readonly source: 'general' | 'default-map' | 'map-draft' | 'existing-draft'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function eventPoolOptions(
  mapDrafts: readonly ContentDraft[],
  selectedIds: readonly string[] = [],
): EventPoolOption[] {
  const options = new Map<string, EventPoolOption>()
  options.set('general', { id: 'general', label: '通用事件池', source: 'general' })

  for (const pool of DEFAULT_MAP_DEFINITION.eventPools ?? []) {
    if (pool.id === 'general') continue
    options.set(pool.id, {
      id: pool.id,
      label: pool.name,
      source: 'default-map',
    })
  }

  for (const draft of mapDrafts) {
    if (draft.kind !== 'map' || !isRecord(draft.content) || !Array.isArray(draft.content.eventPools)) continue
    for (const value of draft.content.eventPools) {
      if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim()) continue
      const id = value.id.trim()
      options.set(id, {
        id,
        label: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : id,
        source: 'map-draft',
      })
    }
  }

  for (const id of selectedIds) {
    if (!options.has(id)) options.set(id, { id, label: id, source: 'existing-draft' })
  }
  return [...options.values()]
}
