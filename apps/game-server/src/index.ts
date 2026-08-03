import { createGameServer } from './server.js'

const port = Number(process.env.PORT ?? 8787)
const host = process.env.HOST ?? '127.0.0.1'
const server = createGameServer({ host, port })

server.listen().then((address) => {
  console.log(`Goose Chess game server listening on http://${address.host}:${address.port}`)
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
