import {
  assertValidGameDefinition,
  type EventDefinition,
  type GameDefinition,
  type MapDefinition,
  type TokenSkinDefinition,
} from '@goose-chess/game-core'
import { DEFAULT_GAME_DEFINITION } from '@goose-chess/game-content'
import type { ManagedContentKind } from './index.js'

export interface RuntimeContentRelease {
  readonly version: string
  readonly kind: ManagedContentKind
  readonly contentKey: string
  readonly contentHash: string
  readonly content: unknown
}

export interface RuntimeGameDefinition {
  readonly mapId: string
  readonly mapVersion: string
  readonly definition: GameDefinition
}

export interface RuntimeContentBundle {
  readonly version: string
  readonly releaseVersions: readonly string[]
  readonly definitions: readonly RuntimeGameDefinition[]
}

function replaceById<T extends { readonly id: string }>(base: readonly T[], replacements: readonly T[]) {
  const entries = new Map(base.map((entry) => [entry.id, structuredClone(entry)]))
  replacements.forEach((entry) => entries.set(entry.id, structuredClone(entry)))
  return [...entries.values()]
}

function versionNumber(version: string) {
  let hash = 0x811c9dc5
  for (const character of version) hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 0x01000193)
  return (hash >>> 0) % 2_147_483_646 + 1
}

function eventPoolIds(content: unknown) {
  if (!content || typeof content !== 'object') return []
  const value = (content as Record<string, unknown>).poolIds
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function runtimeSkin(content: unknown): TokenSkinDefinition {
  const skin = content as TokenSkinDefinition
  return {
    id: skin.id,
    name: skin.name,
    atlas: skin.atlas,
    animations: structuredClone(skin.animations),
    anchor: structuredClone(skin.anchor),
    shadowScale: skin.shadowScale,
  }
}

function applyEventMemberships(map: MapDefinition, releases: readonly RuntimeContentRelease[]) {
  if (!map.eventPools) return map
  const releasedMemberships = new Map(releases.map((release) => [
    (release.content as { id: string }).id,
    new Set(eventPoolIds(release.content)),
  ]))
  const eventPools = map.eventPools.map((pool) => ({
    ...pool,
    eventIds: [
      ...pool.eventIds.filter((eventId) => !releasedMemberships.has(eventId)),
      ...[...releasedMemberships].filter(([, poolIds]) => poolIds.has(pool.id)).map(([eventId]) => eventId),
    ],
  }))
  const assignedReleasedIds = new Set(eventPools.flatMap((pool) => pool.eventIds))
  return {
    ...map,
    eventPools,
    allowedEventIds: map.allowedEventIds
      ? [...new Set([...map.allowedEventIds, ...assignedReleasedIds])]
      : undefined,
  }
}

export function composeRuntimeContentBundle(
  version: string,
  releases: readonly RuntimeContentRelease[],
  baseDefinition: GameDefinition = DEFAULT_GAME_DEFINITION,
): RuntimeContentBundle {
  const eventReleases = releases.filter((release) => release.kind === 'event')
  const skinReleases = releases.filter((release) => release.kind === 'skin')
  const mapReleases = releases.filter((release) => release.kind === 'map')
  const events = replaceById(
    baseDefinition.events,
    eventReleases.map((release) => release.content as EventDefinition),
  )
  const skins = replaceById(
    baseDefinition.skins,
    skinReleases.map((release) => runtimeSkin(release.content)),
  )
  const releasedMaps = mapReleases.map((release) => release.content as MapDefinition)
  const maps = replaceById([baseDefinition.map], releasedMaps)
  const mapVersionById = new Map(mapReleases.map((release) => [
    (release.content as MapDefinition).id,
    release.version,
  ]))
  const mapIds = maps.map((map) => map.id)
  const rulesetVersion = versionNumber(version)
  const definitions = maps.map((sourceMap) => {
    const map = applyEventMemberships(sourceMap, eventReleases)
    const definition: GameDefinition = {
      contentVersion: version,
      map,
      ruleset: {
        ...baseDefinition.ruleset,
        version: rulesetVersion,
        mapIds,
        eventPoolIds: events.map((event) => event.id),
        skinIds: skins.map((skin) => skin.id),
      },
      events,
      items: structuredClone(baseDefinition.items),
      skins,
    }
    assertValidGameDefinition(definition)
    return {
      mapId: map.id,
      mapVersion: mapVersionById.get(map.id) ?? `builtin:${map.id}`,
      definition,
    }
  })
  return {
    version,
    releaseVersions: releases.map((release) => release.version).sort(),
    definitions,
  }
}

export function builtInRuntimeContentBundle() {
  return composeRuntimeContentBundle(DEFAULT_GAME_DEFINITION.contentVersion, [])
}
