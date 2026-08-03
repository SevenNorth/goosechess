import { RoomStore } from './room-store.js'
import { createGameServer } from './server.js'
import { SqliteRoomPersistence } from './sqlite-room-persistence.js'

const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '127.0.0.1'
const databasePath = process.env.ROOM_DB_PATH ?? 'data/goose-chess.sqlite'
const persistence = new SqliteRoomPersistence(databasePath)
const store = new RoomStore({
  persistence,
  disconnectGraceMs: Number(process.env.DISCONNECT_GRACE_MS ?? 30_000),
  roomTtlMs: Number(process.env.ROOM_TTL_MS ?? 24 * 60 * 60 * 1_000),
  finishedRoomTtlMs: Number(process.env.FINISHED_ROOM_TTL_MS ?? 6 * 60 * 60 * 1_000),
})
const server = createGameServer({ host, port, store })
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
  console.log(`Room persistence: ${databasePath}`)
}).catch((error) => {
  console.error(error)
  store.close()
  process.exitCode = 1
})
