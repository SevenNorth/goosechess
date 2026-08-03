import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import { createGooseAiStrategy } from '@goose-chess/game-ai'
import { DeterministicRandom, type ParticipantSetup } from '@goose-chess/game-core'
import { DEFAULT_GAME_DEFINITION } from '@goose-chess/game-content'
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
  type RoomPersistence,
} from './room-persistence.js'

export interface RoomProfile {
  readonly displayName: string
  readonly skinId: string
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
  maxPlayers: number
  authority: LocalAuthority | null
  commandQueue: Promise<void>
  aiCommandSequence: number
  readonly createdAt: number
  updatedAt: number
  expiresAt: number
}

export interface LobbyCommandResult {
  readonly ok: boolean
  readonly error?: { readonly code: string; readonly message: string }
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const COLOR_IDS = ['pink', 'blue', 'gold', 'teal'] as const
const SUPPORTED_MAP_IDS = [DEFAULT_GAME_DEFINITION.map.id] as const
const aiStrategy = createGooseAiStrategy()

export interface RoomStoreOptions {
  readonly disconnectGraceMs?: number
  readonly roomTtlMs?: number
  readonly finishedRoomTtlMs?: number
  readonly cleanupIntervalMs?: number
  readonly persistence?: RoomPersistence
  readonly now?: () => number
}

function hashRecoveryToken(recoveryToken: string) {
  return createHash('sha256').update(recoveryToken).digest('hex')
}

function createRoomCode() {
  return Array.from({ length: 6 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join('')
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
  private readonly disconnectGraceMs: number
  private readonly roomTtlMs: number
  private readonly finishedRoomTtlMs: number
  private readonly persistence: RoomPersistence | null
  private readonly now: () => number
  private readonly cleanupTimer: ReturnType<typeof setInterval> | null
  private closed = false

  constructor(options: RoomStoreOptions = {}) {
    this.disconnectGraceMs = options.disconnectGraceMs ?? 30_000
    this.roomTtlMs = options.roomTtlMs ?? 24 * 60 * 60 * 1_000
    this.finishedRoomTtlMs = options.finishedRoomTtlMs ?? 6 * 60 * 60 * 1_000
    this.persistence = options.persistence ?? null
    this.now = options.now ?? Date.now
    const cleanupIntervalMs = options.cleanupIntervalMs ?? 60_000
    for (const [name, value] of Object.entries({
      disconnectGraceMs: this.disconnectGraceMs,
      roomTtlMs: this.roomTtlMs,
      finishedRoomTtlMs: this.finishedRoomTtlMs,
      cleanupIntervalMs,
    })) {
      if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer.`)
    }
    this.persistence?.deleteExpired(this.now())
    this.persistence?.loadActive(this.now()).forEach((persisted) => {
      const room = this.restoreRoom(persisted)
      this.rooms.set(room.roomCode, room)
      this.attachAuthority(room)
      room.members.forEach((member) => this.beginDisconnectGrace(room, member))
    })
    this.cleanupTimer = setInterval(() => this.cleanupExpiredRooms(), cleanupIntervalMs)
    this.cleanupTimer.unref?.()
  }

  createRoom(profile: RoomProfile): RoomJoinResponse {
    let roomCode = createRoomCode()
    while (this.rooms.has(roomCode)) roomCode = createRoomCode()
    const { member, recoveryToken } = this.createRemoteMember(profile, 0)
    const now = this.now()
    const room: RoomSession = {
      roomCode,
      gameId: `online-${roomCode.toLowerCase()}`,
      members: [member],
      subscribers: new Map(),
      hostPlayerId: member.playerId,
      mapId: DEFAULT_GAME_DEFINITION.map.id,
      maxPlayers: 4,
      authority: null,
      commandQueue: Promise.resolve(),
      aiCommandSequence: 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + this.roomTtlMs,
    }
    this.rooms.set(roomCode, room)
    this.persistRoom(room)
    return this.joinResponse(room, member, recoveryToken)
  }

  joinRoom(roomCodeInput: string, profile: RoomProfile, recoveryToken?: string): RoomJoinResponse {
    const room = this.requireRoom(roomCodeInput)
    const recovered = recoveryToken
      ? room.members.find((member) => member.recoveryTokenHash === hashRecoveryToken(recoveryToken))
      : undefined
    if (recovered) {
      this.persistRoom(room)
      return this.joinResponse(room, recovered, recoveryToken!)
    }
    if (room.authority) throw new RoomStoreError('game_started', '对局已经开始，无法占用新座位。')
    if (room.members.length >= room.maxPlayers) throw new RoomStoreError('room_full', '房间已经满员。')
    const { member, recoveryToken: createdRecoveryToken } = this.createRemoteMember(profile, room.members.length)
    room.members.push(member)
    this.persistRoom(room)
    this.broadcastRoomState(room)
    return this.joinResponse(room, member, createdRecoveryToken)
  }

  subscribe(roomCodeInput: string, recoveryToken: string, subscriber: Subscriber) {
    const room = this.requireRoom(roomCodeInput)
    const member = room.members.find((candidate) => candidate.recoveryTokenHash === hashRecoveryToken(recoveryToken) && candidate.controller === 'remote')
    if (!member) throw new RoomStoreError('invalid_recovery_token', '恢复凭证无效。')
    const memberSubscribers = room.subscribers.get(member.playerId) ?? new Set()
    memberSubscribers.add(subscriber)
    room.subscribers.set(member.playerId, memberSubscribers)
    member.connections += 1
    this.cancelDisconnectTimer(member)
    this.transferExpiredHost(room)
    this.persistRoom(room)
    this.sendRoomState(room, member, subscriber)
    this.broadcastRoomState(room)

    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      memberSubscribers.delete(subscriber)
      member.connections = Math.max(0, member.connections - 1)
      if (!memberSubscribers.size) room.subscribers.delete(member.playerId)
      if (member.connections === 0) this.beginDisconnectGrace(room, member)
      this.persistRoom(room)
      this.broadcastRoomState(room)
    }
  }

  submitLobby(roomCodeInput: string, recoveryToken: string, command: LobbyCommand): LobbyCommandResult {
    try {
      const room = this.requireRoom(roomCodeInput)
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
          if (!SUPPORTED_MAP_IDS.some((mapId) => mapId === command.mapId)) {
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
      this.persistRoom(room)
      this.broadcastRoomState(room)
      return { ok: true }
    } catch (error) {
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
    const room = this.requireRoom(roomCodeInput)
    const member = room.members.find((candidate) => candidate.recoveryTokenHash === hashRecoveryToken(recoveryToken))
    if (!member || envelope.playerId !== member.playerId) {
      return { ok: false, error: createAuthorityError('unauthorized_player', '命令提交者与当前房间座位不匹配。') }
    }
    if (!room.authority) {
      return { ok: false, error: createAuthorityError('illegal_command', '房主尚未开始对局。') }
    }

    let result: CommandResult | undefined
    const submitted = room.commandQueue.then(async () => {
      result = await room.authority!.submit(envelope)
      if (result.ok) await this.runAiTurns(room)
    })
    room.commandQueue = submitted.then(() => undefined, () => undefined)
    await submitted
    if (!result) throw new Error('Room command finished without a result.')
    if (result.ok && room.authority.getSnapshot().state.phase === 'game-over') this.broadcastRoomState(room)
    return result
  }

  sync(roomCodeInput: string, recoveryToken: string) {
    const room = this.requireRoom(roomCodeInput)
    const member = this.requireRemoteMember(room, recoveryToken)
    const subscribers = room.subscribers.get(member.playerId)
    subscribers?.forEach((subscriber) => this.sendRoomState(room, member, subscriber))
  }

  private createRemoteMember(profile: RoomProfile, seatIndex: number) {
    this.validateProfile(profile)
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
    const skinIds = DEFAULT_GAME_DEFINITION.ruleset.skinIds
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

  private validateProfile(profile: RoomProfile) {
    if (!DEFAULT_GAME_DEFINITION.ruleset.skinIds.some((skinId) => skinId === profile.skinId)) {
      throw new RoomStoreError('invalid_profile', '未知的棋子外观。')
    }
    const displayName = profile.displayName.trim()
    if (!displayName || displayName.length > 48) throw new RoomStoreError('invalid_profile', '昵称不能为空且不能超过 48 个字符。')
  }

  private startGame(room: RoomSession) {
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
      definition: DEFAULT_GAME_DEFINITION,
      participants,
      seed: randomInt(0x1_0000_0000),
    })
    this.attachAuthority(room)
  }

  private restoreRoom(persisted: PersistedRoom): RoomSession {
    if (!SUPPORTED_MAP_IDS.some((mapId) => mapId === persisted.mapId)) {
      throw new Error(`Cannot restore unsupported map ${persisted.mapId}.`)
    }
    if (!persisted.members.some((member) => member.playerId === persisted.hostPlayerId)) {
      throw new Error(`Cannot restore room ${persisted.roomCode} without its host member.`)
    }
    const checkpoint: AuthorityCheckpoint | null = persisted.authorityCheckpoint
    const authority = checkpoint
      ? LocalAuthority.restore({ definition: DEFAULT_GAME_DEFINITION, checkpoint })
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
      maxPlayers: persisted.maxPlayers,
      authority,
      commandQueue: Promise.resolve(),
      aiCommandSequence: persisted.aiCommandSequence,
      createdAt: persisted.createdAt,
      updatedAt: persisted.updatedAt,
      expiresAt: persisted.expiresAt,
    }
  }

  private attachAuthority(room: RoomSession) {
    room.authority?.subscribe((update) => {
      this.persistRoom(room)
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
    })
  }

  private persistRoom(room: RoomSession) {
    const now = this.now()
    const finished = room.authority?.getSnapshot().state.phase === 'game-over'
    room.updatedAt = now
    room.expiresAt = now + (finished ? this.finishedRoomTtlMs : this.roomTtlMs)
    this.persistence?.save({
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
      maxPlayers: room.maxPlayers,
      authorityCheckpoint: room.authority?.getCheckpoint() ?? null,
      aiCommandSequence: room.aiCommandSequence,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      expiresAt: room.expiresAt,
    })
  }

  private cleanupExpiredRooms() {
    const now = this.now()
    this.rooms.forEach((room, roomCode) => {
      if (room.expiresAt > now) return
      if (room.members.some((member) => member.controller === 'remote' && member.connections > 0)) {
        this.persistRoom(room)
        return
      }
      room.members.forEach((member) => this.cancelDisconnectTimer(member))
      this.rooms.delete(roomCode)
      this.persistence?.delete(roomCode)
    })
    this.persistence?.deleteExpired(now)
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
    }
    throw new Error('AI exceeded the per-turn command limit.')
  }

  private publicState(room: RoomSession): RoomState {
    const snapshot = room.authority?.getSnapshot()
    return RoomStateSchema.parse({
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      roomCode: room.roomCode,
      gameId: room.gameId,
      hostPlayerId: room.hostPlayerId,
      mapId: room.mapId,
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
      if (member.connections > 0) return
      if (room.hostPlayerId === member.playerId) {
        this.transferExpiredHost(room)
      } else {
        member.reconnectDeadlineAt = null
      }
      this.persistRoom(room)
      this.broadcastRoomState(room)
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

  close() {
    if (this.closed) return
    this.closed = true
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
    this.rooms.forEach((room) => room.members.forEach((member) => this.cancelDisconnectTimer(member)))
    this.persistence?.close()
  }

  private joinResponse(room: RoomSession, member: RoomMember, recoveryToken: string) {
    if (!member.recoveryTokenHash) throw new Error('AI members cannot receive a join response.')
    return RoomJoinResponseSchema.parse({
      room: this.publicState(room),
      playerId: member.playerId,
      recoveryToken,
    })
  }

  private requireHost(room: RoomSession, member: RoomMember) {
    if (room.hostPlayerId !== member.playerId) throw new RoomStoreError('host_only', '只有房主可以执行这个操作。')
  }

  private requireRemoteMember(room: RoomSession, recoveryToken: string) {
    const member = room.members.find((candidate) => candidate.recoveryTokenHash === hashRecoveryToken(recoveryToken) && candidate.controller === 'remote')
    if (!member) throw new RoomStoreError('invalid_recovery_token', '恢复凭证无效。')
    return member
  }

  private requireRoom(roomCodeInput: string) {
    const roomCode = roomCodeInput.trim().toUpperCase()
    const room = this.rooms.get(roomCode)
    if (!room) throw new RoomStoreError('room_not_found', '找不到这个房间。')
    return room
  }
}

export class RoomStoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}
