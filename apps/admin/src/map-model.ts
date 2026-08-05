import { DEFAULT_MAP_DEFINITION } from '@goose-chess/game-content'
import { calculateMovementPath, validateMapDefinition, type MapDefinition } from '@goose-chess/game-core'

export function createDefaultMap(): MapDefinition {
  return structuredClone(DEFAULT_MAP_DEFINITION) as MapDefinition
}

export function mapFromUnknown(value: unknown): MapDefinition {
  if (!value || typeof value !== 'object') return createDefaultMap()
  const candidate = value as Partial<MapDefinition>
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || !Array.isArray(candidate.spaces)) {
    return createDefaultMap()
  }
  return structuredClone(candidate) as MapDefinition
}

export function csvValues(value: string) {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))]
}

export function integerCsvValues(value: string) {
  return [...new Set(csvValues(value).map(Number).filter(Number.isInteger))]
}

export function localMapIssues(map: MapDefinition) {
  return validateMapDefinition(map)
}

export function simulateMapPath(map: MapDefinition, fromSpaceId: number, distance: number) {
  return calculateMovementPath(map, fromSpaceId, distance)
}
