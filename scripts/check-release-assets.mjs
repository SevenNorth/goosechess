import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { gzipSync } from 'node:zlib'

const root = resolve(import.meta.dirname, '..')
const dist = resolve(root, 'apps/web/dist')
const forbidden = /(example_screenshots|screenrecorder|screenshot_\d|temporary.frames|debug.seed|\.mp4$|\.mov$|\.webm$)/i

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  }))
  return nested.flat()
}

const files = await walk(dist)
const forbiddenFiles = files.map((file) => relative(dist, file).replaceAll('\\', '/')).filter((file) => forbidden.test(file))
if (forbiddenFiles.length) throw new Error(`Forbidden release files: ${forbiddenFiles.join(', ')}`)

const indexHtml = await readFile(resolve(dist, 'index.html'), 'utf8')
const initialNames = new Set(['index.html'])
for (const match of indexHtml.matchAll(/(?:src|href)="\/([^"?#]+)"/g)) initialNames.add(match[1])

let totalRaw = 0
let totalGzip = 0
let initialRaw = 0
let initialGzip = 0
for (const file of files) {
  const name = relative(dist, file).replaceAll('\\', '/')
  const size = (await stat(file)).size
  const gzipSize = gzipSync(await readFile(file)).byteLength
  totalRaw += size
  totalGzip += gzipSize
  if (initialNames.has(name)) {
    initialRaw += size
    initialGzip += gzipSize
  }
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`
console.log(`Initial shell: ${kb(initialRaw)} raw / ${kb(initialGzip)} gzip.`)
console.log(`Complete release: ${kb(totalRaw)} raw / ${kb(totalGzip)} gzip across ${files.length} files.`)

const budgets = { initialRaw: 700 * 1024, initialGzip: 220 * 1024, totalRaw: 4 * 1024 * 1024, totalGzip: 2 * 1024 * 1024 }
if (initialRaw > budgets.initialRaw || initialGzip > budgets.initialGzip || totalRaw > budgets.totalRaw || totalGzip > budgets.totalGzip) {
  throw new Error('Release size budget exceeded. Update the implementation or explicitly revise the documented budget.')
}
console.log('Release asset exclusion and size budgets passed.')
