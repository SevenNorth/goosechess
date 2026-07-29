import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const baseline = JSON.parse(await readFile(resolve(root, 'spec/version-baseline.json'), 'utf8'))

async function sha256(relativePath) {
  const content = await readFile(resolve(root, relativePath))
  return createHash('sha256').update(content).digest('hex')
}

async function groupChanged(group) {
  const checks = await Promise.all(Object.entries(group.files).map(async ([file, expected]) => ({
    file,
    changed: await sha256(file) !== expected,
  })))
  return checks.filter((check) => check.changed).map((check) => check.file)
}

const protocolSource = await readFile(resolve(root, 'packages/game-protocol/src/schemas.ts'), 'utf8')
const contentSource = await readFile(resolve(root, 'packages/game-content/src/default-content.ts'), 'utf8')
const protocolVersion = Number(protocolSource.match(/PROTOCOL_SCHEMA_VERSION\s*=\s*(\d+)/)?.[1])
const rulesVersion = Number(contentSource.match(/DEFAULT_RULESET\s*=\s*\{[\s\S]*?version:\s*(\d+)/)?.[1])
const contentVersion = contentSource.match(/CONTENT_VERSION\s*=\s*'([^']+)'/)?.[1]

const groups = [
  { name: 'protocol schema', baseline: baseline.protocol, currentVersion: protocolVersion },
  { name: 'rules', baseline: baseline.rules, currentVersion: rulesVersion },
  { name: 'content', baseline: baseline.content, currentVersion: contentVersion },
]
const failures = []
for (const group of groups) {
  if (group.currentVersion === undefined || Number.isNaN(group.currentVersion)) {
    failures.push(`${group.name}: current version could not be read.`)
    continue
  }
  const changedFiles = await groupChanged(group.baseline)
  if (changedFiles.length && group.currentVersion === group.baseline.version) {
    failures.push(`${group.name}: ${changedFiles.join(', ')} changed without upgrading version ${group.currentVersion}.`)
  }
  console.log(`${group.name}: version ${group.currentVersion}; ${changedFiles.length ? `${changedFiles.length} tracked file(s) changed` : 'baseline unchanged'}.`)
}

if (failures.length) {
  failures.forEach((failure) => console.error(failure))
  process.exitCode = 1
} else {
  console.log('Protocol, rules and content version upgrade checks passed.')
}
