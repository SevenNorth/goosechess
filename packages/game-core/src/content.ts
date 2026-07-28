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

function validateEffect(effect: GameEffect, eventId: string): string[] {
  switch (effect.type) {
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
  const issues = [...duplicateIds(map.landmarks, 'landmark')]
  if (map.spaces.length < 2) issues.push(`Map ${map.id} must contain at least two spaces.`)
  map.spaces.forEach((space, index) => {
    if (space.index !== index) issues.push(`Map ${map.id} space order is invalid at index ${index}.`)
    if (!Number.isFinite(space.x) || !Number.isFinite(space.y) || !Number.isFinite(space.rotation)) {
      issues.push(`Map ${map.id} space ${space.index} has invalid coordinates.`)
    }
    if (space.landmarkId && !map.landmarks.some((landmark) => landmark.id === space.landmarkId)) {
      issues.push(`Map ${map.id} space ${space.index} references unknown landmark ${space.landmarkId}.`)
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
  const itemIds = new Set(definition.items.map((item) => item.id))
  const skinIds = new Set(definition.skins.map((skin) => skin.id))

  if (!definition.ruleset.mapIds.includes(definition.map.id)) issues.push(`Ruleset ${definition.ruleset.id} does not allow map ${definition.map.id}.`)
  for (const eventId of definition.ruleset.eventPoolIds) if (!eventIds.has(eventId)) issues.push(`Ruleset references unknown event ${eventId}.`)
  for (const itemId of definition.ruleset.itemPoolIds) if (!itemIds.has(itemId)) issues.push(`Ruleset references unknown item ${itemId}.`)
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
