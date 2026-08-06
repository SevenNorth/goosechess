import { jsonConsoleDiagnosticSink } from './observability.js'
import { PostgresRoomPersistence } from './postgres-room-persistence.js'
import { RoomStore } from './room-store.js'
import { createGameServer } from './server.js'
import { SqliteRoomPersistence } from './sqlite-room-persistence.js'
import { HttpRuntimeContentSource, StaticRuntimeContentSource } from './content-source.js'

const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '127.0.0.1'
const databaseUrl = process.env.DATABASE_URL?.trim()
const databasePath = process.env.ROOM_DB_PATH ?? 'data/goose-chess.sqlite'
const instanceUrl = process.env.INSTANCE_URL?.trim() ?? process.env.PUBLIC_SERVER_URL?.trim()
if (databaseUrl && !instanceUrl) {
  throw new Error('INSTANCE_URL or PUBLIC_SERVER_URL is required when DATABASE_URL is set.')
}
const ownerUrl = instanceUrl ?? `http://127.0.0.1:${port}`
const contentServiceUrl = process.env.CONTENT_SERVICE_URL?.trim()
const contentSource = contentServiceUrl
  ? new HttpRuntimeContentSource(contentServiceUrl, { token: process.env.CONTENT_RUNTIME_TOKEN?.trim() })
  : new StaticRuntimeContentSource()
const persistence = databaseUrl
  ? new PostgresRoomPersistence(databaseUrl)
  : new SqliteRoomPersistence(databasePath)
const store = new RoomStore({
  persistence,
  contentSource,
  ownerId: process.env.INSTANCE_ID?.trim(),
  ownerUrl,
  leaseDurationMs: Number(process.env.ROOM_LEASE_DURATION_MS ?? 15_000),
  leaseRenewIntervalMs: Number(process.env.ROOM_LEASE_RENEW_INTERVAL_MS ?? 5_000),
  disconnectGraceMs: Number(process.env.DISCONNECT_GRACE_MS ?? 30_000),
  roomTtlMs: Number(process.env.ROOM_TTL_MS ?? 24 * 60 * 60 * 1_000),
  finishedRoomTtlMs: Number(process.env.FINISHED_ROOM_TTL_MS ?? 6 * 60 * 60 * 1_000),
})
const server = createGameServer({
  host,
  port,
  store,
  diagnosticSink: jsonConsoleDiagnosticSink,
  trustProxy: process.env.TRUST_PROXY === 'true',
  rateLimits: {
    roomMutations: {
      capacity: Number(process.env.HTTP_RATE_LIMIT_CAPACITY ?? 20),
      refillWindowMs: Number(process.env.HTTP_RATE_LIMIT_WINDOW_MS ?? 60_000),
    },
    websocketUpgrades: {
      capacity: Number(process.env.WS_UPGRADE_RATE_LIMIT_CAPACITY ?? 30),
      refillWindowMs: Number(process.env.WS_UPGRADE_RATE_LIMIT_WINDOW_MS ?? 60_000),
    },
    websocketMessages: {
      capacity: Number(process.env.WS_MESSAGE_RATE_LIMIT_CAPACITY ?? 80),
      refillWindowMs: Number(process.env.WS_MESSAGE_RATE_LIMIT_WINDOW_MS ?? 10_000),
    },
  },
})
let shuttingDown = false

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  await server.close()
}

process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())

server.listen().then((address) => {
  console.log(`Goose Chess game server listening on http://${address.host}:${address.port}`)
  console.log(`Room persistence: ${databaseUrl ? 'postgresql shared' : databasePath}`)
  console.log(`Instance URL: ${ownerUrl}`)
  console.log(`Runtime content: ${contentServiceUrl ?? 'built-in bundle'}`)
  console.log('Monitoring endpoints: /health, /metrics')
}).catch((error) => {
  console.error(error)
  void store.close().catch(() => undefined)
  process.exitCode = 1
})
