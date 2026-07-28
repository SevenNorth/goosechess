import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertValidGameDefinition } from '@goose-chess/game-core'
import { DEFAULT_GAME_DEFINITION } from '@goose-chess/game-content'

const definition = DEFAULT_GAME_DEFINITION
const publicDirectory = resolve(import.meta.dirname, '../apps/web/public')
const issues = []

assertValidGameDefinition(definition)

if (definition.events.length < 24) issues.push(`Expected at least 24 events, found ${definition.events.length}.`)
if (definition.items.length < 12) issues.push(`Expected at least 12 items, found ${definition.items.length}.`)
if (definition.skins.length < 4) issues.push(`Expected at least 4 skins, found ${definition.skins.length}.`)
if (definition.map.spaces.length !== 66) issues.push(`Default map must contain spaces 0 through 65, found ${definition.map.spaces.length}.`)
if (definition.map.winningSpaceIds.join(',') !== '63,64,65') issues.push('Default winning spaces must be 63,64,65.')
if (definition.map.landmarks.length !== 9) issues.push(`Expected 9 landmarks, found ${definition.map.landmarks.length}.`)

const assetPaths = [
  definition.map.assets.background,
  definition.map.assets.landmarkAtlas,
  ...Object.values(definition.map.assets.landmarks ?? {}),
  ...definition.skins.map((skin) => skin.atlas),
]
for (const assetPath of assetPaths) {
  if (!existsSync(resolve(publicDirectory, assetPath))) issues.push(`Missing public asset: ${assetPath}.`)
}

if (issues.length) {
  console.error(issues.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Content valid: ${definition.map.spaces.length} spaces, ${definition.map.landmarks.length} landmarks, ${definition.events.length} events, ${definition.items.length} items, ${definition.skins.length} skins, ${assetPaths.length} assets.`)
}
