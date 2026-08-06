import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { composeRuntimeContentBundle, type RuntimeContentBundle } from '@goose-chess/content-tools/runtime-content'
import type { RuntimeContentSource } from '../src/content-source.js'
import { HttpRuntimeContentSource } from '../src/content-source.js'
import { SqliteRoomPersistence } from '../src/sqlite-room-persistence.js'
import { RoomStore } from '../src/room-store.js'

class MutableContentSource implements RuntimeContentSource {
  private readonly versions = new Map<string, RuntimeContentBundle>()

  constructor(private current: RuntimeContentBundle) {
    this.versions.set(current.version, current)
  }

  publish(bundle: RuntimeContentBundle) {
    this.current = bundle
    this.versions.set(bundle.version, bundle)
  }

  async load(version?: string) {
    const bundle = version ? this.versions.get(version) : this.current
    if (!bundle) throw new Error(`Unknown content version ${version}.`)
    return structuredClone(bundle)
  }
}

describe('room content version locking', () => {
  const directories: string[] = []

  afterEach(() => {
    directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
  })

  it('uses the current bundle only for rooms created after publication', async () => {
    const v1 = composeRuntimeContentBundle('content-v1', [])
    const v2 = composeRuntimeContentBundle('content-v2', [])
    const source = new MutableContentSource(v1)
    const store = new RoomStore({ contentSource: source })
    const first = await store.createRoom({ displayName: '一号房主', skinId: 'goose-white' })
    source.publish(v2)
    const second = await store.createRoom({ displayName: '二号房主', skinId: 'goose-white' })

    expect(first.room.contentVersion).toBe('content-v1')
    expect(second.room.contentVersion).toBe('content-v2')
    expect(first.room.rulesetVersion).not.toBe(second.room.rulesetVersion)
    await store.close()
  })

  it('loads immutable historical bundles from the content service with machine authentication', async () => {
    const bundle = composeRuntimeContentBundle('content-v1', [])
    const requests: Array<{ url: string; authorization: string | null }> = []
    const source = new HttpRuntimeContentSource('https://content.example.com/', {
      token: 'runtime-secret',
      publicAssetBaseUrl: 'https://cdn.example.com/game/',
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers)
        requests.push({ url: String(input), authorization: headers.get('authorization') })
        return new Response(JSON.stringify({ bundle }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })

    expect((await source.load('content-v1')).version).toBe('content-v1')
    expect(source.publicAssetBaseUrl).toBe('https://cdn.example.com/game')
    expect((await source.load('content-v1')).version).toBe('content-v1')
    expect(requests).toEqual([{
      url: 'https://content.example.com/runtime/content/content-v1',
      authorization: 'Bearer runtime-secret',
    }])
  })

  it('restores a started room with its original immutable bundle after restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'goose-content-lock-'))
    directories.push(directory)
    const databasePath = join(directory, 'rooms.sqlite')
    const v1 = composeRuntimeContentBundle('content-v1', [])
    const v2 = composeRuntimeContentBundle('content-v2', [])
    const source = new MutableContentSource(v1)
    const firstStore = new RoomStore({
      contentSource: source,
      persistence: new SqliteRoomPersistence(databasePath),
    })
    const host = await firstStore.createRoom({ displayName: '房主', skinId: 'goose-white' })
    const guest = await firstStore.joinRoom(host.room.roomCode, { displayName: '客人', skinId: 'goose-blue' })
    await firstStore.submitLobby(host.room.roomCode, host.recoveryToken, { type: 'set-ready', ready: true })
    await firstStore.submitLobby(host.room.roomCode, guest.recoveryToken, { type: 'set-ready', ready: true })
    expect(await firstStore.submitLobby(host.room.roomCode, host.recoveryToken, { type: 'start-game' })).toEqual({ ok: true })
    await firstStore.close()

    source.publish(v2)
    const restoredStore = new RoomStore({
      contentSource: source,
      persistence: new SqliteRoomPersistence(databasePath),
    })
    const recovered = await restoredStore.joinRoom(
      host.room.roomCode,
      { displayName: '房主', skinId: 'goose-white' },
      host.recoveryToken,
    )
    expect(recovered.room.contentVersion).toBe('content-v1')
    expect(recovered.room.mapVersion).toBe(`builtin:${host.room.mapId}`)
    await restoredStore.close()
  })
})
