import type { GameDefinition, GameEffect, MapDefinition } from './types.js'

function duplicateIds(entries: readonly { id: string }[], label: string) {
  const seen = new Set<string>()
  const issues: string[] = []
  for (const entry of entries) {
    if (!entry.id) issues.push(`${label} id must not be empty.`)
    if (seen.has(entry.id)) issues.push(`Duplicate ${label} id: ${entry.id}.`)
    seen.add(entry.id)
  }
  return issues
}

function validateEventPool(
  label: string,
  poolIds: readonly string[],
  eventIds: ReadonlySet<string>,
  rulesetEventIds: ReadonlySet<string>,
  allowedEventIds: ReadonlySet<string>,
) {
  const issues: string[] = []
  if (new Set(poolIds).size < 3) issues.push(`${label} must contain at least three unique events.`)
  for (const eventId of poolIds) {
    if (!eventIds.has(eventId)) issues.push(`${label} references unknown event ${eventId}.`)
    else if (!rulesetEventIds.has(eventId)) issues.push(`${label} references event ${eventId} outside the ruleset pool.`)
    else if (!allowedEventIds.has(eventId)) issues.push(`${label} references event ${eventId} blocked by the map.`)
  }
  return issues
}

function validateEffect(effect: GameEffect, eventId: string): string[] {
  switch (effect.type) {
    case 'move-to-next-landmark':
      return []
    case 'move':
    case 'opponent-move':
      return Number.isInteger(effect.spaces) ? [] : [`Event ${eventId} has a non-integer movement effect.`]
    case 'skip':
      return Number.isInteger(effect.turns) && effect.turns > 0 ? [] : [`Event ${eventId} has an invalid skip duration.`]
    case 'world-max-die':
      return Number.isInteger(effect.value) && effect.value >= 1 && effect.value <= 6 && Number.isInteger(effect.rounds) && effect.rounds > 0
        ? []
        : [`Event ${eventId} has an invalid temporary die rule.`]
    case 'extra-turn':
    case 'gain-item':
    case 'swap':
      return []
    default: {
      const unreachable: never = effect
      return [`Event ${eventId} has an unknown effect: ${String(unreachable)}.`]
    }
  }
}

export function validateMapDefinition(map: MapDefinition): string[] {
  const issues = [
    ...duplicateIds(map.landmarks, 'landmark'),
    ...duplicateIds(map.markers ?? [], 'marker'),
    ...duplicateIds(map.eventPools ?? [], 'event pool'),
  ]
  const markerIds = new Set((map.markers ?? []).map((marker) => marker.id))
  const eventPoolIds = new Set((map.eventPools ?? []).map((pool) => pool.id))
  if (map.spaces.length < 2) issues.push(`Map ${map.id} must contain at least two spaces.`)
  map.spaces.forEach((space, index) => {
    if (space.index !== index) issues.push(`Map ${map.id} space order is invalid at index ${index}.`)
    if (!Number.isFinite(space.x) || !Number.isFinite(space.y) || !Number.isFinite(space.rotation)) {
      issues.push(`Map ${map.id} space ${space.index} has invalid coordinates.`)
    }
    if (space.landmarkId && !map.landmarks.some((landmark) => landmark.id === space.landmarkId)) {
      issues.push(`Map ${map.id} space ${space.index} references unknown landmark ${space.landmarkId}.`)
    }
    if (space.markerId && !markerIds.has(space.markerId)) {
      issues.push(`Map ${map.id} space ${space.index} references unknown marker ${space.markerId}.`)
    }
    if (space.eventPoolId && !eventPoolIds.has(space.eventPoolId)) {
      issues.push(`Map ${map.id} space ${space.index} references unknown event pool ${space.eventPoolId}.`)
    }
  })
  for (const winningSpaceId of map.winningSpaceIds) {
    if (!map.spaces.some((space) => space.index === winningSpaceId)) {
      issues.push(`Map ${map.id} references unknown winning space ${winningSpaceId}.`)
    }
  }
  for (const landmark of map.landmarks) {
    for (const spaceId of landmark.spaceIds) {
      const space = map.spaces[spaceId]
      if (!space || space.landmarkId !== landmark.id) {
        issues.push(`Landmark ${landmark.id} and space ${spaceId} are inconsistent.`)
      }
    }
    if (landmark.x !== undefined && (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y) || !Number.isFinite(landmark.size) || (landmark.size ?? 0) <= 0)) {
      issues.push(`Landmark ${landmark.id} has invalid presentation coordinates.`)
    }
    if (map.assets.landmarks && !map.assets.landmarks[landmark.id]) issues.push(`Landmark ${landmark.id} has no asset path.`)
  }
  for (const marker of map.markers ?? []) {
    for (const spaceId of marker.spaceIds) {
      const space = map.spaces[spaceId]
      if (!space || space.markerId !== marker.id) {
        issues.push(`Marker ${marker.id} and space ${spaceId} are inconsistent.`)
      }
    }
    if (marker.kind !== 'location' && marker.eventPoolId) {
      issues.push(`Marker ${marker.id} of kind ${marker.kind} cannot reference an event pool.`)
    }
    if (marker.kind === 'location' && (!marker.eventPoolId || !eventPoolIds.has(marker.eventPoolId))) {
      issues.push(`Location marker ${marker.id} must reference an existing event pool.`)
    }
    const transform = marker.transform
    if (!marker.asset || !Number.isFinite(transform.x) || !Number.isFinite(transform.y)
      || !Number.isFinite(transform.scale) || transform.scale <= 0 || !Number.isFinite(transform.rotation)) {
      issues.push(`Marker ${marker.id} has invalid presentation data.`)
    }
  }
  if (!map.assets.background || !map.assets.landmarkAtlas) issues.push(`Map ${map.id} has an invalid asset manifest.`)
  return issues
}

export function validateGameDefinition(definition: GameDefinition): string[] {
  const issues = [
    ...validateMapDefinition(definition.map),
    ...duplicateIds(definition.events, 'event'),
    ...duplicateIds(definition.items, 'item'),
    ...duplicateIds(definition.skins, 'skin'),
  ]
  const eventIds = new Set(definition.events.map((event) => event.id))
  const rulesetEventIds = new Set(definition.ruleset.eventPoolIds)
  const allowedEventIds = new Set(definition.map.allowedEventIds ?? definition.ruleset.eventPoolIds)
  const itemIds = new Set(definition.items.map((item) => item.id))
  const skinIds = new Set(definition.skins.map((skin) => skin.id))

  if (!definition.ruleset.mapIds.includes(definition.map.id)) issues.push(`Ruleset ${definition.ruleset.id} does not allow map ${definition.map.id}.`)
  for (const eventId of definition.ruleset.eventPoolIds) if (!eventIds.has(eventId)) issues.push(`Ruleset references unknown event ${eventId}.`)
  for (const eventId of definition.map.allowedEventIds ?? []) {
    if (!eventIds.has(eventId)) issues.push(`Map ${definition.map.id} allows unknown event ${eventId}.`)
    else if (!rulesetEventIds.has(eventId)) issues.push(`Map ${definition.map.id} allows event ${eventId} outside the ruleset pool.`)
  }
  for (const eventPool of definition.map.eventPools ?? []) {
    issues.push(...validateEventPool(
      `Map ${definition.map.id} event pool ${eventPool.id}`,
      eventPool.eventIds,
      eventIds,
      rulesetEventIds,
      allowedEventIds,
    ))
  }
  const usesScopedEventPools = Boolean(definition.map.genericEventPoolIds || definition.map.landmarkEventPoolIds)
  if (usesScopedEventPools) {
    if (definition.map.genericEventPoolIds) {
      issues.push(...validateEventPool(
        `Map ${definition.map.id} generic event pool`,
        definition.map.genericEventPoolIds,
        eventIds,
        rulesetEventIds,
        allowedEventIds,
      ))
    } else {
      issues.push(`Map ${definition.map.id} uses landmark event pools without a generic event pool.`)
    }
    const configuredLandmarkPools = definition.map.landmarkEventPoolIds ?? {}
    const eventLandmarkIds = new Set(definition.map.spaces
      .filter((space) => space.kind === 'event' && space.landmarkId)
      .map((space) => space.landmarkId!))
    for (const landmarkId of eventLandmarkIds) {
      if (!configuredLandmarkPools[landmarkId]) {
        issues.push(`Map ${definition.map.id} event landmark ${landmarkId} has no dedicated event pool.`)
      }
    }
  }
  for (const [landmarkId, poolIds] of Object.entries(definition.map.landmarkEventPoolIds ?? {})) {
    if (!definition.map.landmarks.some((landmark) => landmark.id === landmarkId)) {
      issues.push(`Map ${definition.map.id} event pool references unknown landmark ${landmarkId}.`)
    }
    issues.push(...validateEventPool(
      `Map ${definition.map.id} landmark ${landmarkId} event pool`,
      poolIds,
      eventIds,
      rulesetEventIds,
      allowedEventIds,
    ))
  }
  for (const itemId of definition.ruleset.itemPoolIds) if (!itemIds.has(itemId)) issues.push(`Ruleset references unknown item ${itemId}.`)
  const blockedItemIds = new Set(definition.map.blockedItemIds ?? [])
  const startingItemPoolSize = definition.ruleset.itemPoolIds.filter((itemId) => itemIds.has(itemId) && !blockedItemIds.has(itemId)).length
  if (startingItemPoolSize < 3) issues.push(`Ruleset ${definition.ruleset.id} must provide at least three starting items allowed by map ${definition.map.id}.`)
  for (const skinId of definition.ruleset.skinIds) if (!skinIds.has(skinId)) issues.push(`Ruleset references unknown skin ${skinId}.`)
  for (const event of definition.events) {
    if (event.kind === '骰子检定' && (!event.threshold || event.threshold < 2 || event.threshold > 12)) {
      issues.push(`Event ${event.id} has an unreachable two-die threshold.`)
    }
    const effects = [...(event.effect ?? []), ...(event.success ?? []), ...(event.failure ?? [])]
    for (const effect of effects) issues.push(...validateEffect(effect, event.id))
  }
  for (const skin of definition.skins) {
    if (!skin.atlas || Object.values(skin.animations).some((animation) => !animation)) issues.push(`Skin ${skin.id} has an invalid animation manifest.`)
    if (skin.anchor.x < 0 || skin.anchor.x > 1 || skin.anchor.y < 0 || skin.anchor.y > 1 || skin.shadowScale <= 0) {
      issues.push(`Skin ${skin.id} has invalid presentation dimensions.`)
    }
  }
  return issues
}

export function assertValidGameDefinition(definition: GameDefinition) {
  const issues = validateGameDefinition(definition)
  if (issues.length) throw new Error(`Invalid game definition:\n${issues.join('\n')}`)
}
