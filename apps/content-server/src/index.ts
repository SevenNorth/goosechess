import {
  createAccountRecord,
  SqliteAccountRepository,
  type Role,
} from './auth.js'
import { SqliteContentStore } from './content-store.js'
import { createContentServer } from './server.js'

const port = Number(process.env.PORT ?? 8788)
const host = process.env.HOST ?? '127.0.0.1'
const databasePath =
  process.env.CONTENT_ACCOUNT_DB_PATH ?? 'data/goose-chess-content.sqlite'
const accounts = new SqliteAccountRepository(databasePath)
const contentStore = new SqliteContentStore(databasePath)
const bootstrapUsername = process.env.CONTENT_BOOTSTRAP_USERNAME?.trim()
const bootstrapPassword = process.env.CONTENT_BOOTSTRAP_PASSWORD

if ((bootstrapUsername && !bootstrapPassword) || (!bootstrapUsername && bootstrapPassword)) {
  throw new Error(
    'CONTENT_BOOTSTRAP_USERNAME and CONTENT_BOOTSTRAP_PASSWORD must be provided together.',
  )
}
if (bootstrapUsername && bootstrapPassword) {
  const existing = await accounts.findByUsername(bootstrapUsername)
  const role = (process.env.CONTENT_BOOTSTRAP_ROLE?.trim() || 'admin') as Role
  await accounts.upsert(
    createAccountRecord({
      id:
        existing?.id
        || process.env.CONTENT_BOOTSTRAP_ID?.trim()
        || `bootstrap-${bootstrapUsername.toLowerCase()}`,
      username: bootstrapUsername,
      displayName: process.env.CONTENT_BOOTSTRAP_DISPLAY_NAME?.trim() || bootstrapUsername,
      role,
      password: bootstrapPassword,
    }),
  )
}

const server = createContentServer({
  host,
  port,
  accounts,
  contentStore,
  cookieSecure: process.env.CONTENT_COOKIE_SECURE === 'true',
  allowedOrigin: process.env.ADMIN_ORIGIN?.trim() || undefined,
  assetDirectory: process.env.CONTENT_ASSET_DIR?.trim() || 'data/content-assets',
})
let shuttingDown = false

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  await server.close()
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())

server
  .listen()
  .then((address) => {
    console.log(
      `Goose Chess content server listening on http://${address.host}:${address.port}`,
    )
    console.log(`Content persistence: ${databasePath}`)
    console.log(
      `Admin origin: ${process.env.ADMIN_ORIGIN?.trim() || 'same-origin only'}`,
    )
  })
  .catch(async (error) => {
    console.error(error)
    await server.close().catch(() => undefined)
    process.exitCode = 1
  })
