import { randomBytes, randomInt, randomUUID } from 'node:crypto'
import type { ParticipantSetup } from '@goose-chess/game-core'
import { TECHNICAL_SAMPLE_GAME_DEFINITION } from '@goose-chess/game-content'
import {
  LocalAuthority,
  PROTOCOL_SCHEMA_VERSION,
  RoomJoinResponseSchema,
  RoomStateSchema,
  createAuthorityError,
  type AuthorityUpdate,
  type CommandEnvelope,
  type CommandResult,
  type GameSnapshot,
  type RoomJoinResponse,
  type RoomState,
  type ServerRoomMessage,
} from '@goose-chess/game-protocol'

export interface RoomProfile {
  readonly displayName: string
  readonly skinId: string
}

interface RoomMember extends RoomProfile {
  readonly playerId: string
  readonly recoveryToken: string
  readonly seatIndex: number
  connections: number
}

type Subscriber = (message: ServerRoomMessage) => void

interface RoomSession {
  readonly roomCode: string
  readonly gameId: string
  readonly members: RoomMember[]
  readonly subscribers: Map<string, Set<Subscriber>>
  authority: LocalAuthority | null
  commandQueue: Promise<void>
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const COLOR_IDS = ['pink', 'blue'] as const

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

export class RoomStore {
  private readonly rooms = new Map<string, RoomSession>()

  createRoom(profile: RoomProfile): RoomJoinResponse {
    let roomCode = createRoomCode()
    while (this.rooms.has(roomCode)) roomCode = createRoomCode()
    const member = this.createMember(profile, 0)
    const room: RoomSession = {
      roomCode,
      gameId: `online-${roomCode.toLowerCase()}`,
      members: [member],
      subscribers: new Map(),
      authority: null,
      commandQueue: Promise.resolve(),
    }
    this.rooms.set(roomCode, room)
    return RoomJoinResponseSchema.parse({
      room: this.publicState(room),
      playerId: member.playerId,
      recoveryToken: member.recoveryToken,
    })
  }

  joinRoom(roomCodeInput: string, profile: RoomProfile, recoveryToken?: string): RoomJoinResponse {
    const room = this.requireRoom(roomCodeInput)
    const recovered = recoveryToken
      ? room.members.find((member) => member.recoveryToken === recoveryToken)
      : undefined
    if (recovered) {
      return RoomJoinResponseSchema.parse({
        room: this.publicState(room),
        playerId: recovered.playerId,
        recoveryToken: recovered.recoveryToken,
      })
    }
    if (room.members.length >= 2 || room.authority) throw new RoomStoreError('room_full', '房间已经满员或对局已经开始。')
    const member = this.createMember(profile, room.members.length)
    room.members.push(member)
    this.startGame(room)
    this.broadcastRoomState(room)
    return RoomJoinResponseSchema.parse({
      room: this.publicState(room),
      playerId: member.playerId,
      recoveryToken: member.recoveryToken,
    })
  }

  subscribe(roomCodeInput: string, recoveryToken: string, subscriber: Subscriber) {
    const room = this.requireRoom(roomCodeInput)
    const member = room.members.find((candidate) => candidate.recoveryToken === recoveryToken)
    if (!member) throw new RoomStoreError('invalid_recovery_token', '恢复凭证无效。')
    const memberSubscribers = room.subscribers.get(member.playerId) ?? new Set()
    memberSubscribers.add(subscriber)
    room.subscribers.set(member.playerId, memberSubscribers)
    member.connections += 1
    this.sendRoomState(room, member, subscriber)
    this.broadcastRoomState(room)

    return () => {
      memberSubscribers.delete(subscriber)
      member.connections = Math.max(0, member.connections - 1)
      if (!memberSubscribers.size) room.subscribers.delete(member.playerId)
      this.broadcastRoomState(room)
    }
  }

  async submit(roomCodeInput: string, recoveryToken: string, envelope: CommandEnvelope): Promise<CommandResult> {
    const room = this.requireRoom(roomCodeInput)
    const member = room.members.find((candidate) => candidate.recoveryToken === recoveryToken)
    if (!member || envelope.playerId !== member.playerId) {
      return { ok: false, error: createAuthorityError('unauthorized_player', '命令提交者与当前房间座位不匹配。') }
    }
    if (!room.authority) {
      return { ok: false, error: createAuthorityError('illegal_command', '需要两名玩家到齐后才能开始。') }
    }

    const submitted = room.commandQueue.then(() => room.authority!.submit(envelope))
    room.commandQueue = submitted.then(() => undefined, () => undefined)
    const result: CommandResult = await submitted
    if (result.ok && result.update.snapshot.state.phase === 'game-over') this.broadcastRoomState(room)
    return result
  }

  sync(roomCodeInput: string, recoveryToken: string) {
    const room = this.requireRoom(roomCodeInput)
    const member = room.members.find((candidate) => candidate.recoveryToken === recoveryToken)
    if (!member) throw new RoomStoreError('invalid_recovery_token', '恢复凭证无效。')
    const subscribers = room.subscribers.get(member.playerId)
    subscribers?.forEach((subscriber) => this.sendRoomState(room, member, subscriber))
  }

  private createMember(profile: RoomProfile, seatIndex: number): RoomMember {
    if (!TECHNICAL_SAMPLE_GAME_DEFINITION.ruleset.skinIds.some((skinId) => skinId === profile.skinId)) {
      throw new RoomStoreError('invalid_profile', '未知的棋子外观。')
    }
    const displayName = profile.displayName.trim()
    if (!displayName || displayName.length > 48) throw new RoomStoreError('invalid_profile', '昵称不能为空且不能超过 48 个字符。')
    return {
      playerId: `remote-${randomUUID()}`,
      recoveryToken: randomBytes(24).toString('base64url'),
      displayName,
      skinId: profile.skinId,
      seatIndex,
      connections: 0,
    }
  }

  private startGame(room: RoomSession) {
    const participants: ParticipantSetup[] = room.members.map((member) => ({
      playerId: member.playerId,
      seatIndex: member.seatIndex,
      controller: 'remote',
      displayName: member.displayName,
      colorId: COLOR_IDS[member.seatIndex],
      skinId: member.skinId,
    }))
    room.authority = LocalAuthority.create({
      gameId: room.gameId,
      definition: TECHNICAL_SAMPLE_GAME_DEFINITION,
      participants,
      seed: randomInt(0x1_0000_0000),
    })
    room.authority.subscribe((update) => {
      room.members.forEach((member) => {
        const subscribers = room.subscribers.get(member.playerId)
        if (!subscribers) return
        const message: ServerRoomMessage = {
          type: 'authority-update',
          update: projectUpdate(update, member.playerId),
        }
        subscribers.forEach((subscriber) => subscriber(message))
      })
    })
  }

  private publicState(room: RoomSession): RoomState {
    const snapshot = room.authority?.getSnapshot()
    return RoomStateSchema.parse({
      schemaVersion: PROTOCOL_SCHEMA_VERSION,
      roomCode: room.roomCode,
      gameId: room.gameId,
      status: !snapshot ? 'waiting' : snapshot.state.phase === 'game-over' ? 'finished' : 'playing',
      players: room.members.map((member) => ({
        playerId: member.playerId,
        displayName: member.displayName,
        skinId: member.skinId,
        seatIndex: member.seatIndex,
        connected: member.connections > 0,
      })),
    })
  }

  private sendRoomState(room: RoomSession, member: RoomMember, subscriber: Subscriber) {
    const snapshot = room.authority?.getSnapshot()
    subscriber({
      type: 'room-state',
      room: this.publicState(room),
      ...(snapshot ? { snapshot: projectSnapshot(snapshot, member.playerId) } : {}),
    })
  }

  private broadcastRoomState(room: RoomSession) {
    room.members.forEach((member) => {
      const subscribers = room.subscribers.get(member.playerId)
      subscribers?.forEach((subscriber) => this.sendRoomState(room, member, subscriber))
    })
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
