import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { createGooseAiStrategy } from '@goose-chess/game-ai'
import { DeterministicRandom, type ParticipantSetup } from '@goose-chess/game-core'
import { DEFAULT_GAME_DEFINITION } from '@goose-chess/game-content'
import type { RuntimeContentBundle, RuntimeGameDefinition } from '@goose-chess/content-tools/runtime-content'
import {
  GameCommandSchema,
  LocalAuthority,
  OFFLINE_AI_DISPLAY_NAMES,
  PROTOCOL_SCHEMA_VERSION,
  RoomJoinResponseSchema,
  RoomStateSchema,
  createAuthorityError,
  type AuthorityCheckpoint,
  type AuthorityUpdate,
  type CommandEnvelope,
  type CommandResult,
  type GameSnapshot,
  type LobbyCommand,
  type RoomJoinResponse,
  type RoomState,
  type ServerRoomMessage,
} from '@goose-chess/game-protocol'
import {
  ROOM_PERSISTENCE_VERSION,
  type PersistedRoom,
  type RoomLease,
  type RoomOwner,
  type RoomPersistence,
} from './room-persistence.js'
import { StaticRuntimeContentSource, type RuntimeContentSource } from './content-source.js'

export interface RoomProfile {
  readonly displayName: string
  readonly skinId: string
}

export interface RoomRuntimeContent {
  readonly schemaVersion: typeof PROTOCOL_SCHEMA_VERSION
  readonly contentVersion: string
  readonly mapVersion: string
  readonly assetBaseUrl: string | null
  readonly maps: readonly {
    readonly id: string
    readonly mapVersion: string
    readonly name: string
    readonly spaceCount: number
    readonly markerCount: number
    readonly backgroundAsset: string
  }[]
  readonly definition: RuntimeGameDefinition['definition']
}

interface RoomMember extends RoomProfile {
  readonly playerId: string
  readonly recoveryTokenHash: string | null
  readonly controller: 'remote' | 'ai'
  seatIndex: number
  ready: boolean
  connections: number
  reconnectDeadlineAt: number | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
}

type Subscriber = (message: ServerRoomMessage) => void

interface RoomSession {
  readonly roomCode: string
  readonly gameId: string
  readonly members: RoomMember[]
  readonly subscribers: Map<string, Set<Subscriber>>
  hostPlayerId: string
  mapId: string
  readonly content: RuntimeContentBundle
  maxPlayers: number
  authority: LocalAuthority | null
  commandQueue: Promise<void>
  pendingCommands: number
  aiCommandSequence: number
  lease: RoomLease | null
  readonly createdAt: number
  updatedAt: number
  expiresAt: number
}

export interface LobbyCommandResult {
  readonly ok: boolean
  readonly error?: { readonly code: string; readonly message: string }
}

export interface RoomOwnershipEvent {
  readonly type: 'acquired' | 'lost' | 'released' | 'renewed'
  readonly roomCode: string
  readonly fencingToken: number
  readonly ownerUrl?: string
}

type OwnershipListener = (event: RoomOwnershipEvent) => void

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const COLOR_IDS = ['pink', 'blue', 'gold', 'teal'] as const
const aiStrategy = createGooseAiStrategy()

export interface RoomStoreOptions {
  readonly disconnectGraceMs?: number
  readonly roomTtlMs?: number
  readonly finishedRoomTtlMs?: number
  readonly cleanupIntervalMs?: number
  readonly leaseDurationMs?: number
  readonly leaseRenewIntervalMs?: number
  readonly ownerId?: string
  readonly ownerUrl?: string
  readonly persistence?: RoomPersistence
  readonly contentSource?: RuntimeContentSource
  readonly now?: () => number
}

export interface RoomStoreDiagnostics {
  readonly totalRooms: number
  readonly waitingRooms: number
  readonly playingRooms: number
  readonly finishedRooms: number
  readonly remotePlayers: number
  readonly aiPlayers: number
  readonly reconnectingPlayers: number
  readonly connections: number
  readonly pendingCommands: number
  readonly leasedRooms: number
}

export interface MatchDiagnosticContext {
  readonly roomCode: string
  readonly gameId: string
  readonly status: 'waiting' | 'playing' | 'finished'
  readonly revision: number
  readonly phase: string | null
  readonly activePlayerId: string | null
  readonly playerCount: number
  readonly connections: number
  readonly pendingCommands: number
  readonly fencingToken: number | null
}

function hashRecoveryToken(recoveryToken: string) {
  return createHash('sha256').update(recoveryToken).digest('hex')
}

function createRoomCode() {
  return Array.from({ length: 6 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join('')
}

function normalizeOwnerUrl(ownerUrl: string) {
  const url = new URL(ownerUrl)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('ownerUrl must use http or https.')
  }
  return url.toString().replace(/\/$/, '')
}

function projectSnapshot(snapshot: GameSnapshot, viewerPlayerId: string): GameSnapshot {
  const isActiveViewer = snapshot.state.activePlayerId === viewerPlayerId
  return {
    ...snapshot,
    rngSeed: 0,
    rngCursor: 0,
    state: {
      ...snapshot.state,
      players: snapshot.state.players.map((player) => ({
        ...player,
        itemId: player.playerId === viewerPlayerId ? player.itemId : null,
      })),
      startingItemOfferIds: snapshot.state.phase === 'choosing-starting-item' && isActiveViewer
        ? snapshot.state.startingItemOfferIds
        : [],
      pendingItemId: snapshot.state.phase === 'awaiting-item-choice' && isActiveViewer
        ? snapshot.state.pendingItemId
        : null,
    },
  }
}

function isPrivateEvent(event: AuthorityUpdate['events'][number], viewerPlayerId: string) {
  if (event.type === 'starting-items-offered' || event.type === 'starting-item-chosen' || event.type === 'item-offered') {
    return event.playerId !== viewerPlayerId
  }
  return event.type === 'item-changed' && event.playerId !== viewerPlayerId
}

function projectUpdate(update: AuthorityUpdate, viewerPlayerId: string): AuthorityUpdate {
  return {
    snapshot: projectSnapshot(update.snapshot, viewerPlayerId),
    events: update.events.filter((event) => !isPrivateEvent(event, viewerPlayerId)),
    cues: update.cues,
  }
}

function aiDecisionSeed(snapshot: GameSnapshot, playerId: string) {
  let hash = snapshot.rngSeed ^ snapshot.revision
  for (const character of playerId) {
    hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 0x01000193)
  }
  return hash >>> 0
}

export class RoomStore {
  private readonly rooms = new Map<string, RoomSession>()
  private readonly pendingRoomLoads = new Map<string, Promise<RoomSession>>()
  private readonly ownershipListeners = new Set<OwnershipListener>()
  private readonly maintenanceTasks = new Set<Promise<void>>()
  private readonly disconnectGraceMs: number
  private readonly roomTtlMs: number
  private readonly finishedRoomTtlMs: number
  private readonly leaseDurationMs: number
  private readonly owner: RoomOwner
  private readonly persistence: RoomPersistence | null
  private readonly contentSource: RuntimeContentSource
  private readonly now: () => number
  private readonly cleanupTimer: ReturnType<typeof setInterval> | null
  private readonly leaseRenewTimer: ReturnType<typeof setInterval> | null
  private readonly initialized: Promise<void>
  private renewingLeases = false
  private cleaningRooms = false
  private closed = false

  constructor(options: RoomStoreOptions = {}) {
    this.disconnectGraceMs = options.disconnectGraceMs ?? 30_000
    this.roomTtlMs = options.roomTtlMs ?? 24 * 60 * 60 * 1_000
    this.finishedRoomTtlMs = options.finishedRoomTtlMs ?? 6 * 60 * 60 * 1_000
    this.leaseDurationMs = options.leaseDurationMs ?? 15_000
    const leaseRenewIntervalMs = options.leaseRenewIntervalMs ?? 5_000
    this.owner = {
      ownerId: options.ownerId ?? randomUUID(),
      ownerUrl: normalizeOwnerUrl(options.ownerUrl ?? 'http://127.0.0.1:8787'),
    }
    this.persistence = options.persistence ?? null
    this.contentSource = options.contentSource ?? new StaticRuntimeContentSource()
    this.now = options.now ?? Date.now
    const cleanupIntervalMs = options.cleanupIntervalMs ?? 60_000
    for (const [name, value] of Object.entries({
      disconnectGraceMs: this.disconnectGraceMs,
      roomTtlMs: this.roomTtlMs,
      finishedRoomTtlMs: this.finishedRoomTtlMs,
      cleanupIntervalMs,
      leaseDurationMs: this.leaseDurationMs,
      leaseRenewIntervalMs,
    })) {
      if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`)
    }
    if (leaseRenewIntervalMs >= this.leaseDurationMs) {
      throw new Error('leaseRenewIntervalMs must be shorter than leaseDurationMs.')
    }
    this.initialized = this.initialize()
    this.cleanupTimer = setInterval(() => this.scheduleMaintenance(() => this.cleanupExpiredRooms()), cleanupIntervalMs)
    this.cleanupTimer.unref?.()
    this.leaseRenewTimer = this.persistence?.shared
      ? setInterval(() => this.scheduleMaintenance(() => this.renewLeases()), leaseRenewIntervalMs)
      : null
    this.leaseRenewTimer?.unref?.()
  }

  ready() {
    return this.initialized
  }

  subscribeOwnership(listener: OwnershipListener) {
    this.ownershipListeners.add(listener)
    return () => this.ownershipListeners.delete(listener)
  }

  async createRoom(profile: RoomProfile): Promise<RoomJoinResponse> {
    await this.initialized
    this.assertOpen()
    const content = await this.contentSource.load()
    const initialDefinition = content.definitions.find((entry) => entry.mapId === DEFAULT_GAME_DEFINITION.map.id)
      ?? content.definitions[0]
    if (!initialDefinition) throw new RoomStoreError('content_unavailable', '当前没有可用于创建房间的已发布内容。')
    const { member, recoveryToken } = this.createRemoteMember(profile, 0, content)
    for (let attempt = 0; attempt < 64; attempt += 1) {
      const roomCode = createRoomCode()
      if (this.rooms.has(roomCode)) continue
      const now = this.now()
      const room: RoomSession = {
        roomCode,
        gameId: `online-${roomCode.toLowerCase()}`,
        members: [member],
        subscribers: new Map(),
        hostPlayerId: member.playerId,
        mapId: initialDefinition.mapId,
        content,
        maxPlayers: 4,
        authority: null,
        commandQueue: Promise.resolve(),
        pendingCommands: 0,
        aiCommandSequence: 0,
        lease: null,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + this.roomTtlMs,
      }
      if (this.persistence) {
        const created = await this.persistence.create(
          this.toPersistedRoom(room, now),
          this.owner,
          now + this.leaseDurationMs,
        )
        if (created.status === 'conflict') continue
        room.lease = created.lease
        this.emitOwnership({ type: 'acquired', roomCode, fencingToken: created.lease.fencingToken })
      }
      this.rooms.set(roomCode, room)
      return this.joinResponse(room, member, recoveryToken)
    }
    throw new RoomStoreError('room_code_exhausted', '暂时无法分配房间码，请稍后重试。')
  }

  async joinRoom(roomCodeInput: string, profile: RoomProfile, recoveryToken?: string): Promise<RoomJoinResponse> {
    const room = await this.requireRoom(roomCodeInput)
    return this.enqueueRoom(room, async () => {
      const recovered = recoveryToken
        ? room.members.find((member) => member.recoveryTokenHash === hashRecoveryToken(recoveryToken))
        : undefined
      if (recovered) {
        await this.persistRoom(room)
        return this.joinResponse(room, recovered, recoveryToken!)
      }
      if (room.authority) throw new RoomStoreError('game_started', '对局已经开始，无法占用新座位。')
      if (room.members.length >= room.maxPlayers) throw new RoomStoreError('room_full', '房间已经满员。')
      const { member, recoveryToken: createdRecoveryToken } = this.createRemoteMember(profile, room.members.length, room.content)
      room.members.push(member)
      await this.persistRoom(room)
      this.broadcastRoomState(room)
      return this.joinResponse(room, member, createdRecoveryToken)
    })
  }

  async subscribe(roomCodeInput: string, recoveryToken: string, subscriber: Subscriber) {
    const room = await this.requireRoom(roomCodeInput)
    const member = this.requireRemoteMember(room, recoveryToken)
    await this.enqueueRoom(room, async () => {
      const memberSubscribers = room.subscribers.get(member.playerId) ?? new Set()
      memberSubscribers.add(subscriber)
      room.subscribers.set(member.playerId, memberSubscribers)
      member.connections += 1
      this.cancelDisconnectTimer(member)
      this.transferExpiredHost(room)
      await this.persistRoom(room)
      this.sendRoomState(room, member, subscriber)
      this.broadcastRoomState(room)
    })

    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      void this.enqueueRoom(room, async () => {
        const memberSubscribers = room.subscribers.get(member.playerId)
        memberSubscribers?.delete(subscriber)
        member.connections = Math.max(0, member.connections - 1)
        if (!memberSubscribers?.size) room.subscribers.delete(member.playerId)
        if (member.connections === 0) this.beginDisconnectGrace(room, member)
        await this.persistRoom(room)
        this.broadcastRoomState(room)
      }).catch(() => undefined)
    }
  }

  async submitLobby(roomCodeInput: string, recoveryToken: string, command: LobbyCommand): Promise<LobbyCommandResult> {
    try {
      const room = await this.requireRoom(roomCodeInput)
      return await this.enqueueRoom(room, async () => {
        const member = this.requireRemoteMember(room, recoveryToken)
        if (room.authority) throw new RoomStoreError('game_started', '对局已经开始，大厅配置已锁定。')

        switch (command.type) {
          case 'set-ready':
            member.ready = command.ready
            break
          case 'set-capacity':
            this.requireHost(room, member)
            if (command.maxPlayers < room.members.length) {
              throw new RoomStoreError('capacity_too_small', '房间容量不能小于当前座位数。')
            }
            room.maxPlayers = command.maxPlayers
            break
          case 'set-map':
            this.requireHost(room, member)
            if (!room.content.definitions.some((entry) => entry.mapId === command.mapId)) {
              throw new RoomStoreError('unsupported_map', '该地图尚未接入在线房间。')
            }
            room.mapId = command.mapId
            room.members.forEach((candidate) => {
              if (candidate.controller === 'remote') candidate.ready = false
            })
            break
          case 'add-ai':
            this.requireHost(room, member)
            if (room.members.length >= room.maxPlayers) throw new RoomStoreError('room_full', '房间已经满员。')
            room.members.push(this.createAiMember(room))
            break
          case 'remove-player': {
            this.requireHost(room, member)
            if (command.playerId === member.playerId) throw new RoomStoreError('cannot_remove_host', '房主不能移除自己。')
            const targetIndex = room.members.findIndex((candidate) => candidate.playerId === command.playerId)
            if (targetIndex < 0) throw new RoomStoreError('unknown_player', '找不到要移除的玩家。')
            const target = room.members[targetIndex]
            if (target.controller === 'remote' && target.ready) {
              throw new RoomStoreError('player_ready', '不能移除已经准备的玩家。')
            }
            this.notifyRemoved(room, target)
            room.members.splice(targetIndex, 1)
            this.reindexMembers(room)
            break
          }
          case 'start-game':
            this.requireHost(room, member)
            if (room.members.length < 2) throw new RoomStoreError('not_enough_players', '至少需要两名棋手。')
            if (room.members.some((candidate) => !candidate.ready)) {
              throw new RoomStoreError('players_not_ready', '所有真人玩家准备后才能开始。')
            }
            this.startGame(room)
            break
        }
        await this.persistRoom(room)
        this.broadcastRoomState(room)
        return { ok: true }
      })
    } catch (error) {
      if (error instanceof RoomStoreError && (error.code === 'room_owned_elsewhere' || error.code === 'room_lease_lost')) {
        throw error
      }
      const known = error instanceof RoomStoreError
      return {
        ok: false,
        error: {
          code: known ? error.code : 'lobby_error',
          message: known ? error.message : '大厅操作失败。',
        },
      }
    }
  }

  async submit(roomCodeInput: string, recoveryToken: string, envelope: CommandEnvelope): Promise<CommandResult> {
    const room = await this.requireRoom(roomCodeInput)
    const member = room.members.find((candidate) => candidate.recoveryTokenHash === hashRecoveryToken(recoveryToken))
    if (!member || envelope.playerId !== member.playerId) {
      return { ok: false, error: createAuthorityError('unauthorized_player', '命令提交者与当前房间座位不匹配。') }
    }
    if (!room.authority) {
      return { ok: false, error: createAuthorityError('illegal_command', '房主尚未开始对局。') }
    }

    room.pendingCommands += 1
    try {
      return await this.enqueueRoom(room, async () => {
        const result = await room.authority!.submit(envelope)
        if (!result.ok) return result
        await this.persistRoom(room)
        this.broadcastAuthorityUpdate(room, result.update)
        await this.runAiTurns(room)
        if (room.authority!.getSnapshot().state.phase === 'game-over') this.broadcastRoomState(room)
        return result
      })
    } finally {
      room.pendingCommands = Math.max(0, room.pendingCommands - 1)
    }
  }

  async sync(roomCodeInput: string, recoveryToken: string) {
    const room = await this.requireRoom(roomCodeInput)
    return this.enqueueRoom(room, async () => {
      if (this.rooms.get(room.roomCode) !== room) {
        throw new RoomStoreError('room_lease_lost', '房间所有权已转移，请重新连接。')
      }
      const member = this.requireRemoteMember(room, recoveryToken)
      const subscribers = room.subscribers.get(member.playerId)
      subscribers?.forEach((subscriber) => this.sendRoomState(room, member, subscriber))
    })
  }

  async getRoomContent(roomCodeInput: string, recoveryToken: string): Promise<RoomRuntimeContent> {
    const room = await this.requireRoom(roomCodeInput)
    this.requireRemoteMember(room, recoveryToken)
    const runtime = this.roomDefinition(room)
    return structuredClone({
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      contentVersion: room.content.version,
      mapVersion: runtime.mapVersion,
      assetBaseUrl: this.contentSource.publicAssetBaseUrl ?? null,
      maps: room.content.definitions.map((entry) => ({
        id: entry.mapId,
        mapVersion: entry.mapVersion,
        name: entry.definition.map.name,
        spaceCount: entry.definition.map.spaces.length,
        markerCount: (entry.definition.map.markers ?? entry.definition.map.landmarks).length,
        backgroundAsset: entry.definition.map.assets.background,
      })),
      definition: runtime.definition,
    })
  }

  private async initialize() {
    if (!this.persistence) return
    const now = this.now()
    await this.persistence.deleteExpired(now)
    if (this.persistence.shared) return
    const persistedRooms = await this.persistence.loadActive(now)
    for (const persisted of persistedRooms) {
      const claimed = await this.persistence.claim(
        persisted.roomCode,
        this.owner,
        now,
        now + this.leaseDurationMs,
      )
      if (claimed.status !== 'acquired') continue
      const room = await this.restoreRoom(claimed.room, claimed.lease)
      this.rooms.set(room.roomCode, room)
      room.members.forEach((member) => this.beginDisconnectGrace(room, member))
      this.emitOwnership({
        type: 'acquired',
        roomCode: room.roomCode,
        fencingToken: claimed.lease.fencingToken,
      })
    }
  }

  private async requireRoom(roomCodeInput: string) {
    await this.initialized
    this.assertOpen()
    const roomCode = roomCodeInput.trim().toUpperCase()
    const local = this.rooms.get(roomCode)
    if (local) return local
    if (!this.persistence?.shared) throw new RoomStoreError('room_not_found', '找不到这个房间。')

    const pending = this.pendingRoomLoads.get(roomCode)
    if (pending) return pending
    const loading = this.claimRoom(roomCode)
    this.pendingRoomLoads.set(roomCode, loading)
    try {
      return await loading
    } finally {
      if (this.pendingRoomLoads.get(roomCode) === loading) this.pendingRoomLoads.delete(roomCode)
    }
  }

  private async claimRoom(roomCode: string) {
    const now = this.now()
    const claimed = await this.persistence!.claim(roomCode, this.owner, now, now + this.leaseDurationMs)
    if (claimed.status === 'not_found') throw new RoomStoreError('room_not_found', '找不到这个房间。')
    if (claimed.status === 'owned_elsewhere') {
      throw new RoomStoreError(
        'room_owned_elsewhere',
        '房间由其他服务实例承载。',
        claimed.ownerUrl,
      )
    }
    if (this.closed) {
      await this.persistence!.release(roomCode, claimed.lease, this.now())
      throw new RoomStoreError('server_shutting_down', '游戏服务正在关闭。')
    }
    const existing = this.rooms.get(roomCode)
    if (existing) return existing
    const restored = await this.restoreRoom(claimed.room, claimed.lease)
    this.rooms.set(roomCode, restored)
    restored.members.forEach((member) => this.beginDisconnectGrace(restored, member))
    this.emitOwnership({
      type: 'acquired',
      roomCode,
      fencingToken: claimed.lease.fencingToken,
    })
    return restored
  }

  private enqueueRoom<T>(room: RoomSession, operation: () => Promise<T>): Promise<T> {
    const result = room.commandQueue.then(operation)
    room.commandQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private createRemoteMember(profile: RoomProfile, seatIndex: number, content: RuntimeContentBundle) {
    this.validateProfile(profile, content)
    const recoveryToken = randomBytes(24).toString('base64url')
    const member: RoomMember = {
      playerId: `remote-${randomUUID()}`,
      recoveryTokenHash: hashRecoveryToken(recoveryToken),
      controller: 'remote',
      displayName: profile.displayName.trim(),
      skinId: profile.skinId,
      seatIndex,
      ready: false,
      connections: 0,
      reconnectDeadlineAt: null,
      reconnectTimer: null,
    }
    return { member, recoveryToken }
  }

  private createAiMember(room: RoomSession): RoomMember {
    const usedNames = new Set(room.members.map((member) => member.displayName))
    const availableNames = OFFLINE_AI_DISPLAY_NAMES.filter((name) => !usedNames.has(name))
    const displayName = availableNames.length
      ? availableNames[randomInt(availableNames.length)]
      : `港口棋手${room.members.length + 1}`
    const skinIds = this.roomDefinition(room).definition.ruleset.skinIds
    const usedSkinIds = new Set(room.members.map((member) => member.skinId))
    const skinId = skinIds.find((candidate) => !usedSkinIds.has(candidate))
      ?? skinIds[room.members.length % skinIds.length]
    return {
      playerId: `ai-${randomUUID()}`,
      recoveryTokenHash: null,
      controller: 'ai',
      displayName,
      skinId,
      seatIndex: room.members.length,
      ready: true,
      connections: 0,
      reconnectDeadlineAt: null,
      reconnectTimer: null,
    }
  }

  private validateProfile(profile: RoomProfile, content: RuntimeContentBundle) {
    if (!content.definitions.some((entry) => entry.definition.ruleset.skinIds.includes(profile.skinId))) {
      throw new RoomStoreError('invalid_profile', '未知的棋子外观。')
    }
    const displayName = profile.displayName.trim()
    if (!displayName || displayName.length > 48) throw new RoomStoreError('invalid_profile', '昵称不能为空且不能超过 48 个字符。')
  }

  private startGame(room: RoomSession) {
    const definition = this.roomDefinition(room).definition
    const participants: ParticipantSetup[] = room.members.map((member) => ({
      playerId: member.playerId,
      seatIndex: member.seatIndex,
      controller: member.controller,
      displayName: member.displayName,
      colorId: COLOR_IDS[member.seatIndex],
      skinId: member.skinId,
    }))
    room.authority = LocalAuthority.create({
      gameId: room.gameId,
      definition,
      participants,
      seed: randomInt(0x1_0000_0000),
    })
  }

  private async restoreRoom(persisted: PersistedRoom, lease: RoomLease | null): Promise<RoomSession> {
    const content = await this.contentSource.load(persisted.contentVersion)
    const runtimeDefinition = content.definitions.find((entry) => entry.mapId === persisted.mapId)
    if (!runtimeDefinition) {
      throw new Error(`Cannot restore unsupported map ${persisted.mapId}.`)
    }
    if (runtimeDefinition.mapVersion !== persisted.mapVersion) {
      throw new Error(`Cannot restore map ${persisted.mapId} with mismatched version ${persisted.mapVersion}.`)
    }
    if (!persisted.members.some((member) => member.playerId === persisted.hostPlayerId)) {
      throw new Error(`Cannot restore room ${persisted.roomCode} without its host member.`)
    }
    const checkpoint: AuthorityCheckpoint | null = persisted.authorityCheckpoint
    const authority = checkpoint
      ? LocalAuthority.restore({ definition: runtimeDefinition.definition, checkpoint })
      : null
    if (authority && authority.getSnapshot().gameId !== persisted.gameId) {
      throw new Error(`Cannot restore room ${persisted.roomCode} with a mismatched gameId.`)
    }
    return {
      roomCode: persisted.roomCode,
      gameId: persisted.gameId,
      members: persisted.members.map((member) => ({
        ...member,
        connections: 0,
        reconnectDeadlineAt: null,
        reconnectTimer: null,
      })),
      subscribers: new Map(),
      hostPlayerId: persisted.hostPlayerId,
      mapId: persisted.mapId,
      content,
      maxPlayers: persisted.maxPlayers,
      authority,
      commandQueue: Promise.resolve(),
      pendingCommands: 0,
      aiCommandSequence: persisted.aiCommandSequence,
      lease,
      createdAt: persisted.createdAt,
      updatedAt: persisted.updatedAt,
      expiresAt: persisted.expiresAt,
    }
  }

  private toPersistedRoom(room: RoomSession, now: number): PersistedRoom {
    const finished = room.authority?.getSnapshot().state.phase === 'game-over'
    room.updatedAt = now
    room.expiresAt = now + (finished ? this.finishedRoomTtlMs : this.roomTtlMs)
    const runtimeDefinition = this.roomDefinition(room)
    return {
      persistenceVersion: ROOM_PERSISTENCE_VERSION,
      roomCode: room.roomCode,
      gameId: room.gameId,
      members: room.members.map((member) => ({
        playerId: member.playerId,
        recoveryTokenHash: member.recoveryTokenHash,
        controller: member.controller,
        displayName: member.displayName,
        skinId: member.skinId,
        seatIndex: member.seatIndex,
        ready: member.ready,
      })),
      hostPlayerId: room.hostPlayerId,
      mapId: room.mapId,
      mapVersion: runtimeDefinition.mapVersion,
      contentVersion: room.content.version,
      maxPlayers: room.maxPlayers,
      authorityCheckpoint: room.authority?.getCheckpoint() ?? null,
      aiCommandSequence: room.aiCommandSequence,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      expiresAt: room.expiresAt,
    }
  }

  private async persistRoom(room: RoomSession) {
    const now = this.now()
    const persisted = this.toPersistedRoom(room, now)
    if (!this.persistence) return
    const renewedLease = await this.persistence.save(
      persisted,
      room.lease,
      now,
      now + this.leaseDurationMs,
    )
    if (!renewedLease) {
      const ownerUrl = await this.findCurrentOwner(room.roomCode)
      this.loseOwnership(room, ownerUrl)
      throw new RoomStoreError('room_lease_lost', '房间所有权已转移，请重新连接。', ownerUrl)
    }
    room.lease = renewedLease
  }

  private async findCurrentOwner(roomCode: string) {
    if (!this.persistence?.shared || !this.persistence.lookupOwner) return undefined
    const now = this.now()
    return (await this.persistence.lookupOwner(roomCode, now))?.ownerUrl
  }

  private scheduleMaintenance(operation: () => Promise<void>) {
    const task = operation().catch(() => undefined)
    this.maintenanceTasks.add(task)
    void task.finally(() => this.maintenanceTasks.delete(task))
  }

  private async cleanupExpiredRooms() {
    if (this.cleaningRooms || this.closed) return
    this.cleaningRooms = true
    try {
      await this.initialized
      const now = this.now()
      for (const [roomCode, room] of this.rooms) {
        if (room.expiresAt > now) continue
        if (room.members.some((member) => member.controller === 'remote' && member.connections > 0)) {
          await this.enqueueRoom(room, () => this.persistRoom(room))
          continue
        }
        room.members.forEach((member) => this.cancelDisconnectTimer(member))
        this.rooms.delete(roomCode)
        await this.persistence?.delete(roomCode, room.lease)
      }
      await this.persistence?.deleteExpired(now)
    } finally {
      this.cleaningRooms = false
    }
  }

  private async renewLeases() {
    if (this.renewingLeases || this.closed || !this.persistence?.shared) return
    this.renewingLeases = true
    try {
      await this.initialized
      for (const room of [...this.rooms.values()]) {
        if (!room.lease) continue
        const now = this.now()
        const renewed = await this.persistence.renew(
          room.roomCode,
          room.lease,
          now,
          now + this.leaseDurationMs,
        )
        if (!renewed) {
          const ownerUrl = await this.findCurrentOwner(room.roomCode)
          this.loseOwnership(room, ownerUrl)
          continue
        }
        room.lease = renewed
        this.emitOwnership({
          type: 'renewed',
          roomCode: room.roomCode,
          fencingToken: renewed.fencingToken,
        })
      }
    } finally {
      this.renewingLeases = false
    }
  }

  private async runAiTurns(room: RoomSession) {
    if (!room.authority) return
    for (let step = 0; step < 64; step += 1) {
      const snapshot = room.authority.getSnapshot()
      if (snapshot.state.phase === 'game-over') return
      const activeMember = room.members.find((member) => member.playerId === snapshot.state.activePlayerId)
      if (activeMember?.controller !== 'ai') return
      const view = room.authority.getDecisionView(activeMember.playerId)
      const decision = aiStrategy.decide(view, new DeterministicRandom({
        seed: aiDecisionSeed(snapshot, activeMember.playerId),
        cursor: 0,
      }))
      if (!decision) return
      room.aiCommandSequence += 1
      const result = await room.authority.submit({
        schemaVersion: PROTOCOL_SCHEMA_VERSION,
        gameId: room.gameId,
        commandId: `${activeMember.playerId}-server-${room.aiCommandSequence}`,
        playerId: activeMember.playerId,
        expectedRevision: snapshot.revision,
        command: GameCommandSchema.parse(decision.command),
      })
      if (!result.ok) throw new Error(`AI command rejected: ${result.error.code} ${result.error.message}`)
      await this.persistRoom(room)
      this.broadcastAuthorityUpdate(room, result.update)
    }
    throw new Error('AI exceeded the per-turn command limit.')
  }

  private publicState(room: RoomSession): RoomState {
    const snapshot = room.authority?.getSnapshot()
    const runtimeDefinition = this.roomDefinition(room)
    return RoomStateSchema.parse({
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      roomCode: room.roomCode,
      gameId: room.gameId,
      hostPlayerId: room.hostPlayerId,
      mapId: room.mapId,
      mapVersion: runtimeDefinition.mapVersion,
      contentVersion: room.content.version,
      rulesetVersion: runtimeDefinition.definition.ruleset.version,
      maxPlayers: room.maxPlayers,
      reconnectGraceMs: this.disconnectGraceMs,
      status: !snapshot ? 'waiting' : snapshot.state.phase === 'game-over' ? 'finished' : 'playing',
      players: room.members.map((member) => ({
        playerId: member.playerId,
        displayName: member.displayName,
        skinId: member.skinId,
        seatIndex: member.seatIndex,
        controller: member.controller,
        connected: member.controller === 'ai' || member.connections > 0,
        reconnectDeadlineAt: member.controller === 'remote' ? member.reconnectDeadlineAt : null,
        ready: member.ready,
      })),
    })
  }

  private sendRoomState(room: RoomSession, member: RoomMember, subscriber: Subscriber) {
    const snapshot = room.authority?.getSnapshot()
    subscriber({
      type: 'room-state',
      room: this.publicState(room),
      ...(snapshot ? { snapshot: projectSnapshot(snapshot, member.playerId) } : {}),
      legalCommands: this.legalCommands(room, member),
    })
  }

  private legalCommands(room: RoomSession, member: RoomMember) {
    if (!room.authority) return []
    return room.authority.getDecisionView(member.playerId).legalCommands.map((command) => GameCommandSchema.parse(command))
  }

  private broadcastRoomState(room: RoomSession) {
    room.members.forEach((member) => {
      if (member.controller !== 'remote') return
      const subscribers = room.subscribers.get(member.playerId)
      subscribers?.forEach((subscriber) => this.sendRoomState(room, member, subscriber))
    })
  }

  private broadcastAuthorityUpdate(room: RoomSession, update: AuthorityUpdate) {
    room.members.forEach((member) => {
      if (member.controller !== 'remote') return
      const subscribers = room.subscribers.get(member.playerId)
      if (!subscribers) return
      const message: ServerRoomMessage = {
        type: 'authority-update',
        update: projectUpdate(update, member.playerId),
        legalCommands: this.legalCommands(room, member),
      }
      subscribers.forEach((subscriber) => subscriber(message))
    })
  }

  private notifyRemoved(room: RoomSession, member: RoomMember) {
    this.cancelDisconnectTimer(member)
    const subscribers = room.subscribers.get(member.playerId)
    subscribers?.forEach((subscriber) => subscriber({
      type: 'room-error',
      code: 'removed_from_room',
      message: '你已被房主移出房间。',
    }))
    room.subscribers.delete(member.playerId)
  }

  private loseOwnership(room: RoomSession, ownerUrl?: string) {
    if (!this.rooms.delete(room.roomCode)) return
    room.members.forEach((member) => this.cancelDisconnectTimer(member))
    room.subscribers.forEach((subscribers) => subscribers.forEach((subscriber) => subscriber({
      type: 'room-error',
      code: 'room_lease_lost',
      message: '房间已迁移到其他服务实例，正在重新连接。',
      ...(ownerUrl ? { ownerUrl } : {}),
    })))
    room.subscribers.clear()
    this.emitOwnership({
      type: 'lost',
      roomCode: room.roomCode,
      fencingToken: room.lease?.fencingToken ?? 0,
      ...(ownerUrl ? { ownerUrl } : {}),
    })
  }

  private reindexMembers(room: RoomSession) {
    room.members.forEach((member, index) => {
      member.seatIndex = index
    })
  }

  private beginDisconnectGrace(room: RoomSession, member: RoomMember) {
    if (member.controller !== 'remote' || member.reconnectTimer) return
    member.reconnectDeadlineAt = this.now() + this.disconnectGraceMs
    member.reconnectTimer = setTimeout(() => {
      member.reconnectTimer = null
      void this.enqueueRoom(room, async () => {
        if (member.connections > 0) return
        if (room.hostPlayerId === member.playerId) this.transferExpiredHost(room)
        else member.reconnectDeadlineAt = null
        await this.persistRoom(room)
        this.broadcastRoomState(room)
      }).catch(() => undefined)
    }, this.disconnectGraceMs)
  }

  private cancelDisconnectTimer(member: RoomMember) {
    if (member.reconnectTimer) clearTimeout(member.reconnectTimer)
    member.reconnectTimer = null
    member.reconnectDeadlineAt = null
  }

  private transferExpiredHost(room: RoomSession) {
    const host = room.members.find((member) => member.playerId === room.hostPlayerId)
    if (!host || host.connections > 0 || host.reconnectDeadlineAt === null || host.reconnectDeadlineAt > this.now()) return
    const successor = room.members
      .filter((member) => member.controller === 'remote' && member.connections > 0 && member.playerId !== host.playerId)
      .sort((left, right) => left.seatIndex - right.seatIndex)[0]
    if (!successor) return
    room.hostPlayerId = successor.playerId
    this.cancelDisconnectTimer(host)
  }

  getDiagnostics(): RoomStoreDiagnostics {
    const diagnostics = {
      totalRooms: this.rooms.size,
      waitingRooms: 0,
      playingRooms: 0,
      finishedRooms: 0,
      remotePlayers: 0,
      aiPlayers: 0,
      reconnectingPlayers: 0,
      connections: 0,
      pendingCommands: 0,
      leasedRooms: 0,
    }
    this.rooms.forEach((room) => {
      const snapshot = room.authority?.getSnapshot()
      if (!snapshot) diagnostics.waitingRooms += 1
      else if (snapshot.state.phase === 'game-over') diagnostics.finishedRooms += 1
      else diagnostics.playingRooms += 1
      diagnostics.remotePlayers += room.members.filter((member) => member.controller === 'remote').length
      diagnostics.aiPlayers += room.members.filter((member) => member.controller === 'ai').length
      diagnostics.reconnectingPlayers += room.members.filter((member) => (
        member.controller === 'remote' && member.connections === 0 && member.reconnectDeadlineAt !== null
      )).length
      diagnostics.connections += room.members.reduce((total, member) => total + member.connections, 0)
      diagnostics.pendingCommands += room.pendingCommands
      if (room.lease) diagnostics.leasedRooms += 1
    })
    return diagnostics
  }

  getMatchDiagnostic(roomCodeInput: string): MatchDiagnosticContext | null {
    const room = this.rooms.get(roomCodeInput.trim().toUpperCase())
    if (!room) return null
    const snapshot = room.authority?.getSnapshot()
    return {
      roomCode: room.roomCode,
      gameId: room.gameId,
      status: !snapshot ? 'waiting' : snapshot.state.phase === 'game-over' ? 'finished' : 'playing',
      revision: snapshot?.revision ?? 0,
      phase: snapshot?.state.phase ?? null,
      activePlayerId: snapshot?.state.activePlayerId ?? null,
      playerCount: room.members.length,
      connections: room.members.reduce((total, member) => total + member.connections, 0),
      pendingCommands: room.pendingCommands,
      fencingToken: room.lease?.fencingToken ?? null,
    }
  }

  async close() {
    if (this.closed) return
    this.closed = true
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
    if (this.leaseRenewTimer) clearInterval(this.leaseRenewTimer)
    try {
      await this.initialized
    } catch (error) {
      await this.persistence?.close().catch(() => undefined)
      throw error
    }
    await Promise.allSettled(this.pendingRoomLoads.values())
    await Promise.all(this.maintenanceTasks)
    const rooms = [...this.rooms.values()]
    rooms.forEach((room) => room.members.forEach((member) => this.cancelDisconnectTimer(member)))
    await Promise.all(rooms.map((room) => room.commandQueue))
    if (this.persistence) {
      const now = this.now()
      await Promise.all(rooms.flatMap((room) => room.lease
        ? [this.persistence!.release(room.roomCode, room.lease, now)]
        : []))
      rooms.forEach((room) => {
        if (room.lease) this.emitOwnership({
          type: 'released',
          roomCode: room.roomCode,
          fencingToken: room.lease.fencingToken,
        })
      })
      await this.persistence.close()
    }
    this.rooms.clear()
  }

  private joinResponse(room: RoomSession, member: RoomMember, recoveryToken: string) {
    if (!member.recoveryTokenHash) throw new Error('AI members cannot receive a join response.')
    return RoomJoinResponseSchema.parse({
      room: this.publicState(room),
      playerId: member.playerId,
      recoveryToken,
      serverUrl: this.owner.ownerUrl,
    })
  }

  private requireHost(room: RoomSession, member: RoomMember) {
    if (room.hostPlayerId !== member.playerId) throw new RoomStoreError('host_only', '只有房主可以执行这个操作。')
  }

  private roomDefinition(room: RoomSession): RuntimeGameDefinition {
    const definition = room.content.definitions.find((entry) => entry.mapId === room.mapId)
    if (!definition) throw new Error(`Room ${room.roomCode} references missing map ${room.mapId}.`)
    return definition
  }

  private requireRemoteMember(room: RoomSession, recoveryToken: string) {
    const member = room.members.find((candidate) => candidate.recoveryTokenHash === hashRecoveryToken(recoveryToken) && candidate.controller === 'remote')
    if (!member) throw new RoomStoreError('invalid_recovery_token', '恢复凭证无效。')
    return member
  }

  private emitOwnership(event: RoomOwnershipEvent) {
    this.ownershipListeners.forEach((listener) => listener(event))
  }

  private assertOpen() {
    if (this.closed) throw new RoomStoreError('server_shutting_down', '游戏服务正在关闭。')
  }
}

export class RoomStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly ownerUrl?: string,
  ) {
    super(message)
  }
}
