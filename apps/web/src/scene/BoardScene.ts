import { Easing, Group, Tween } from '@tweenjs/tween.js'
import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  Text,
  Texture,
} from 'pixi.js'
import { createActor, type ActorRefFrom } from 'xstate'
import type { GameSnapshot, AuthorityUpdate, PresentationCue } from '@goose-chess/game-protocol'
import type { AudioPort } from '../audio/audio-port'
import { presentationMachine, type PresentationStage } from '../game-client/machine/presentation-machine'
import { SAMPLE_MAP_DEFINITION } from '../game-client/sample-content'

const WORLD_WIDTH = SAMPLE_MAP_DEFINITION.logicalSize.width
const WORLD_HEIGHT = SAMPLE_MAP_DEFINITION.logicalSize.height
const SEAT_COLORS: Readonly<Record<string, number>> = {
  pink: 0xe82f73,
  blue: 0x3977c5,
  gold: 0xd4a43a,
  teal: 0x2baf9c,
}
const SKIN_COLORS: Readonly<Record<string, number>> = {
  'goose-white': 0xf0eee4,
  'goose-yellow': 0xe0ae3d,
  'goose-blue': 0x80aed8,
  'goose-pink': 0xdf829f,
}

interface TokenVisual {
  readonly root: Container
  readonly body: Container
  readonly shadow: Graphics
}

export interface BoardPlaybackOptions {
  readonly onStageChange?: (stage: PresentationStage) => void
  readonly speed?: number
}

export interface BoardSceneController {
  playUpdate(update: AuthorityUpdate, previousSnapshot: GameSnapshot, options?: BoardPlaybackOptions): Promise<void>
  sync(snapshot: GameSnapshot): void
  setActivePlayer(playerId: string): void
  destroy(): void
}

function spacePoint(spaceId: number) {
  const space = SAMPLE_MAP_DEFINITION.spaces.find((candidate) => candidate.index === spaceId)
  if (!space) throw new Error(`Unknown sample board space: ${spaceId}.`)
  return { x: space.x, y: space.y }
}

function tokenOffset(seatIndex: number, playerCount: number) {
  if (playerCount <= 2) return { x: seatIndex === 0 ? -24 : 24, y: 0 }
  return { x: (seatIndex % 2) * 72 - 36, y: Math.floor(seatIndex / 2) * 44 - 22 }
}

export class BoardScene implements BoardSceneController {
  private readonly app = new Application()
  private readonly world = new Container()
  private readonly tableLayer = new Container()
  private readonly boardLayer = new Container()
  private readonly spaceLayer = new Container()
  private readonly routeLayer = new Container()
  private readonly landmarkLayer = new Container()
  private readonly tokenLayer = new Container()
  private readonly effectsLayer = new Container()
  private readonly foregroundLayer = new Container()
  private readonly tweens = new Group()
  private readonly tokens = new Map<string, TokenVisual>()
  private readonly machine: ActorRefFrom<typeof presentationMachine>
  private readonly resizeObserver: ResizeObserver
  private routeGraphic: Graphics | null = null
  private targetGraphic: Graphics | null = null
  private diceContainer: Container | null = null
  private playbackRevision = 0
  private destroyed = false

  private constructor(
    private readonly host: HTMLElement,
    private readonly audio: AudioPort,
  ) {
    this.machine = createActor(presentationMachine).start()
    this.resizeObserver = new ResizeObserver(() => this.resizeWorld())
  }

  static async create(host: HTMLElement, audio: AudioPort, isCancelled: () => boolean = () => false) {
    const scene = new BoardScene(host, audio)
    await scene.initialize(isCancelled)
    return scene
  }

  private async initialize(isCancelled: () => boolean) {
    await this.app.init({
      resizeTo: this.host,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      backgroundColor: 0x171916,
      preference: 'webgl',
    })
    if (isCancelled()) {
      this.destroy()
      return
    }
    this.app.canvas.className = 'pixi-canvas'
    this.app.canvas.dataset.testid = 'pixi-canvas'
    this.host.appendChild(this.app.canvas)
    this.app.stage.addChild(this.world)
    this.world.addChild(
      this.tableLayer,
      this.boardLayer,
      this.spaceLayer,
      this.landmarkLayer,
      this.routeLayer,
      this.tokenLayer,
      this.effectsLayer,
      this.foregroundLayer,
    )
    this.app.ticker.add(this.updateTweens)
    this.resizeObserver.observe(this.host)
    await this.buildBoard()
    if (isCancelled()) {
      this.destroy()
      return
    }
    this.resizeWorld()
  }

  private readonly updateTweens = () => {
    this.tweens.update(performance.now())
  }

  private resizeWorld() {
    if (this.destroyed) return
    const width = this.app.screen.width
    const height = this.app.screen.height
    const scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT)
    this.world.scale.set(scale)
    this.world.position.set((width - WORLD_WIDTH * scale) / 2, (height - WORLD_HEIGHT * scale) / 2)
  }

  private async buildBoard() {
    const [tableTexture, paperTexture, repairTexture, dogTexture, beachTexture, finishTexture] = await Promise.all([
      Assets.load<Texture>('/assets/sample/tabletop.png'),
      Assets.load<Texture>('/assets/sample/paper-board.png'),
      Assets.load<Texture>('/assets/sample/repair-room.png'),
      Assets.load<Texture>('/assets/sample/yellow-dog.png'),
      Assets.load<Texture>('/assets/sample/scavenger-beach.png'),
      Assets.load<Texture>('/assets/sample/sample-finish.png'),
    ])
    const table = new Sprite({ texture: tableTexture, width: WORLD_WIDTH, height: WORLD_HEIGHT })
    const paper = new Sprite({ texture: paperTexture, width: WORLD_WIDTH - 70, height: WORLD_HEIGHT - 54, x: 35, y: 27 })
    this.tableLayer.addChild(table)
    this.boardLayer.addChild(paper)

    const border = new Graphics()
      .rect(35, 27, WORLD_WIDTH - 70, WORLD_HEIGHT - 54)
      .stroke({ color: 0x5c5a50, width: 7, alpha: 0.55 })
    const baseRoute = new Graphics()
    const first = SAMPLE_MAP_DEFINITION.spaces[0]
    baseRoute.moveTo(first.x, first.y)
    SAMPLE_MAP_DEFINITION.spaces.slice(1).forEach((space) => baseRoute.lineTo(space.x, space.y))
    baseRoute.stroke({ color: 0x77766c, width: 4, alpha: 0.28 })
    this.boardLayer.addChild(border, baseRoute)

    for (const space of SAMPLE_MAP_DEFINITION.spaces) {
      const cellContainer = new Container()
      const cell = new Graphics()
      const size = space.kind === 'start' || space.kind === 'finish' ? 58 : 48
      const fill = space.kind === 'event' ? 0xc96850 : space.kind === 'finish' ? 0x4b4f46 : 0xe2ddcb
      cell.roundRect(-size / 2, -size / 2, size, size, 5)
        .fill({ color: fill, alpha: 0.96 })
        .stroke({ color: space.kind === 'event' ? 0x713d34 : 0x55584e, width: 3, alpha: 0.85 })
      cellContainer.position.set(space.x, space.y)
      cellContainer.rotation = space.rotation * Math.PI / 180
      const number = new Text({
        text: space.kind === 'event' ? '鹅' : String(space.index),
        style: { fontFamily: 'Microsoft YaHei', fontSize: space.kind === 'event' ? 15 : 13, fill: space.kind === 'event' ? 0xfff4df : 0x54574e, fontWeight: '700' },
      })
      number.anchor.set(0.5)
      cellContainer.addChild(cell, number)
      this.spaceLayer.addChild(cellContainer)
    }

    this.addLandmark(repairTexture, 128, 603, 150, '维修室')
    this.addLandmark(dogTexture, 770, 505, 150, '大黄狗')
    this.addLandmark(beachTexture, 930, 266, 142, '拾荒沙滩')
    this.addLandmark(finishTexture, 425, 170, 164, '试航终点')

    const title = new Text({
      text: '奥普港 · 核心体验样片',
      style: { fontFamily: 'Microsoft YaHei', fontSize: 22, fill: 0x55584f, fontWeight: '700', letterSpacing: 0 },
    })
    title.position.set(280, 280)
    title.rotation = -0.02
    this.foregroundLayer.addChild(title)
  }

  private addLandmark(texture: Texture, x: number, y: number, size: number, label: string) {
    const container = new Container({ x, y })
    const sprite = new Sprite(texture)
    sprite.anchor.set(0.5, 1)
    sprite.width = size
    sprite.height = size
    const text = new Text({
      text: label,
      style: { fontFamily: 'Microsoft YaHei', fontSize: 15, fill: 0x41443d, fontWeight: '700' },
    })
    text.anchor.set(0.5)
    text.position.set(0, 14)
    const labelPaper = new Graphics().roundRect(-text.width / 2 - 8, 1, text.width + 16, 27, 3).fill({ color: 0xe4deca, alpha: 0.88 })
    container.addChild(sprite, labelPaper, text)
    this.landmarkLayer.addChild(container)
  }

  private makeToken(player: GameSnapshot['state']['players'][number], playerCount: number) {
    const root = new Container()
    const shadow = new Graphics().ellipse(0, 1, 29, 10).fill({ color: 0x181914, alpha: 0.3 })
    const body = new Container()
    const skin = SKIN_COLORS[player.skinId] ?? 0xf0eee4
    const outline = SEAT_COLORS[player.colorId] ?? 0xe82f73
    const model = new Graphics()
      .ellipse(0, -31, 25, 30).fill({ color: outline })
      .ellipse(0, -33, 20, 25).fill({ color: skin })
      .roundRect(-9, -69, 18, 35, 9).fill({ color: outline })
      .roundRect(-6, -66, 12, 32, 6).fill({ color: skin })
      .circle(2, -75, 15).fill({ color: outline })
      .circle(2, -75, 11).fill({ color: skin })
      .poly([12, -77, 29, -71, 12, -66], true).fill({ color: 0xd39f35 })
      .circle(6, -79, 2).fill({ color: 0x272925 })
      .roundRect(-27, -9, 54, 11, 4).fill({ color: outline })
      .roundRect(-22, -7, 44, 7, 3).fill({ color: 0x6b6251 })
    body.addChild(model)
    root.addChild(shadow, body)
    const offset = tokenOffset(player.seatIndex, playerCount)
    const point = spacePoint(player.spaceId)
    root.position.set(point.x + offset.x, point.y + offset.y)
    this.tokenLayer.addChild(root)
    const visual = { root, body, shadow }
    this.tokens.set(player.playerId, visual)
    return visual
  }

  sync(snapshot: GameSnapshot) {
    const playerIds = new Set(snapshot.state.players.map((player) => player.playerId))
    for (const [playerId, token] of this.tokens) {
      if (!playerIds.has(playerId)) {
        token.root.destroy({ children: true })
        this.tokens.delete(playerId)
      }
    }
    for (const player of snapshot.state.players) {
      const token = this.tokens.get(player.playerId) ?? this.makeToken(player, snapshot.state.players.length)
      const point = spacePoint(player.spaceId)
      const offset = tokenOffset(player.seatIndex, snapshot.state.players.length)
      token.root.position.set(point.x + offset.x, point.y + offset.y)
      token.body.position.y = 0
      token.body.scale.set(1)
      token.shadow.scale.set(1)
    }
    this.setActivePlayer(snapshot.state.activePlayerId)
  }

  setActivePlayer(playerId: string) {
    for (const [id, token] of this.tokens) {
      token.root.alpha = id === playerId ? 1 : 0.88
      token.body.scale.set(id === playerId ? 1.07 : 1)
    }
  }

  private animate(duration: number, update: (progress: number) => void, easing = Easing.Quadratic.InOut) {
    if (this.destroyed) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const state = { progress: 0 }
      new Tween(state, this.tweens)
        .to({ progress: 1 }, Math.max(1, duration))
        .easing(easing)
        .onUpdate(() => update(state.progress))
        .onComplete(() => resolve())
        .start(performance.now())
    })
  }

  private async playDice(cue: Extract<PresentationCue, { type: 'dice-roll' }>, speed: number) {
    this.audio.play('dice.roll')
    this.diceContainer?.destroy({ children: true })
    const container = new Container({ x: 1085, y: 700 })
    const values = [...cue.dice]
    values.forEach((value, index) => {
      const die = new Container({ x: index * 76 })
      const face = new Graphics().roundRect(-28, -28, 56, 56, 8)
        .fill({ color: index === 0 ? 0xeee9d9 : 0x343730 })
        .stroke({ color: 0x242720, width: 3, alpha: 0.7 })
      const label = new Text({ text: String(value), style: { fontFamily: 'Arial', fontSize: 30, fontWeight: '700', fill: index === 0 ? 0x292c27 : 0xf3f1e7 } })
      label.anchor.set(0.5)
      die.addChild(face, label)
      container.addChild(die)
    })
    this.effectsLayer.addChild(container)
    this.diceContainer = container
    await this.animate(780 / speed, (progress) => {
      container.children.forEach((child, index) => {
        child.rotation = (1 - progress) * (index ? -5 : 4) * Math.PI
        child.y = -Math.sin(progress * Math.PI * 3) * (1 - progress * 0.7) * 52
      })
    }, Easing.Cubic.Out)
  }

  private drawPartialRoute(points: readonly { x: number; y: number }[], progress: number, color: number) {
    if (!this.routeGraphic) {
      this.routeGraphic = new Graphics()
      this.routeLayer.addChild(this.routeGraphic)
    }
    const graphic = this.routeGraphic
    graphic.clear()
    const segmentProgress = progress * (points.length - 1)
    const completed = Math.floor(segmentProgress)
    graphic.moveTo(points[0].x, points[0].y)
    for (let index = 1; index <= Math.min(completed, points.length - 1); index += 1) graphic.lineTo(points[index].x, points[index].y)
    if (completed < points.length - 1) {
      const from = points[completed]
      const to = points[completed + 1]
      const partial = segmentProgress - completed
      graphic.lineTo(from.x + (to.x - from.x) * partial, from.y + (to.y - from.y) * partial)
    }
    graphic.stroke({ color: 0xffffff, width: 11, alpha: 0.82, cap: 'round', join: 'round' })
    graphic.stroke({ color, width: 6, alpha: 1, cap: 'round', join: 'round' })
  }

  private async playRoute(cue: Extract<PresentationCue, { type: 'route-preview' }>, previousSnapshot: GameSnapshot, speed: number) {
    const player = previousSnapshot.state.players.find((candidate) => candidate.playerId === cue.playerId)
    if (!player) return
    const color = SEAT_COLORS[player.colorId] ?? 0xe82f73
    const points = [spacePoint(player.spaceId), ...cue.path.map(spacePoint)]
    this.routeGraphic?.destroy()
    this.routeGraphic = null
    await this.animate(390 / speed, (progress) => this.drawPartialRoute(points, progress, color), Easing.Quadratic.Out)
  }

  private async emphasizeTarget(cue: Extract<PresentationCue, { type: 'target-highlight' }>, speed: number) {
    const point = spacePoint(cue.spaceId)
    this.targetGraphic?.destroy()
    const target = new Graphics().circle(0, 0, 38).stroke({ color: 0xe82f73, width: 7, alpha: 1 })
    target.position.set(point.x, point.y)
    this.effectsLayer.addChild(target)
    this.targetGraphic = target
    await this.animate(220 / speed, (progress) => {
      target.scale.set(0.8 + Math.sin(progress * Math.PI) * 0.28)
      target.alpha = 0.65 + Math.sin(progress * Math.PI) * 0.35
    }, Easing.Quadratic.Out)
  }

  private async fadeRoute(speed: number) {
    const route = this.routeGraphic
    if (!route) return
    await this.animate(130 / speed, (progress) => { route.alpha = 1 - progress })
    route.destroy()
    this.routeGraphic = null
  }

  private async hopToken(cue: Extract<PresentationCue, { type: 'token-hop' }>, snapshot: GameSnapshot, speed: number) {
    const player = snapshot.state.players.find((candidate) => candidate.playerId === cue.playerId)
    const token = this.tokens.get(cue.playerId)
    if (!player || !token) return
    const offset = tokenOffset(player.seatIndex, snapshot.state.players.length)
    let facing = 1
    for (let index = 0; index < cue.path.length; index += 1) {
      if (index > 0) facing = Math.sign(cue.path[index] - cue.path[index - 1]) || facing
      const from = { x: token.root.x, y: token.root.y }
      const destination = spacePoint(cue.path[index])
      const duration = (index === cue.path.length - 1 ? 135 : 100) / speed
      await this.animate(duration, (progress) => {
        token.root.position.set(
          from.x + (destination.x + offset.x - from.x) * progress,
          from.y + (destination.y + offset.y - from.y) * progress,
        )
        const height = Math.sin(progress * Math.PI)
        token.body.y = -height * 38
        token.body.scale.set(facing * (1 + (progress < 0.18 ? (0.18 - progress) * -0.35 : height * 0.04)), 1 + height * 0.08)
        token.shadow.scale.set(1 - height * 0.35)
        token.shadow.alpha = 0.3 - height * 0.16
      }, Easing.Quadratic.InOut)
      token.body.y = 0
      token.body.scale.set(facing, 1)
      token.shadow.scale.set(1)
      token.shadow.alpha = 1
      const nextDirection = index < cue.path.length - 1 ? Math.sign(cue.path[index + 1] - cue.path[index]) : facing
      if (nextDirection !== facing) {
        await this.animate(220 / speed, (progress) => {
          token.body.scale.set(facing * Math.cos(progress * Math.PI), 1 + Math.sin(progress * Math.PI) * 0.1)
        }, Easing.Quadratic.InOut)
        facing = nextDirection
        token.body.scale.set(facing, 1)
      }
    }
    this.audio.play('token.land')
  }

  private stage(options: BoardPlaybackOptions | undefined, stage: PresentationStage) {
    options?.onStageChange?.(stage)
  }

  private async runUpdate(update: AuthorityUpdate, previousSnapshot: GameSnapshot, playbackRevision: number, options?: BoardPlaybackOptions) {
    const speed = options?.speed ?? 1
    for (let index = 0; index < update.cues.length; index += 1) {
      if (playbackRevision !== this.playbackRevision) return
      const cue = update.cues[index]
      if (cue.type === 'dice-roll') {
        this.machine.send({ type: 'ROLL_STARTED' })
        this.stage(options, 'rolling')
        await this.playDice(cue, speed)
        const hasRoute = update.cues.slice(index + 1).some((candidate) => candidate.type === 'route-preview')
        this.machine.send({ type: 'DICE_DONE', hasRoute })
        this.stage(options, hasRoute ? 'routePreview' : 'ready')
      } else if (cue.type === 'route-preview') {
        if (this.machine.getSnapshot().value === 'ready') this.machine.send({ type: 'ROUTE_STARTED' })
        this.stage(options, 'routePreview')
        await this.playRoute(cue, previousSnapshot, speed)
        this.machine.send({ type: 'ROUTE_DONE' })
        this.stage(options, 'targetEmphasis')
      } else if (cue.type === 'target-highlight') {
        await this.emphasizeTarget(cue, speed)
        this.machine.send({ type: 'TARGET_DONE' })
        this.stage(options, 'routeFade')
        await this.fadeRoute(speed)
        this.machine.send({ type: 'ROUTE_HIDDEN' })
        this.stage(options, 'moving')
      } else if (cue.type === 'token-hop') {
        await this.hopToken(cue, update.snapshot, speed)
        this.machine.send({ type: 'MOVE_DONE' })
        this.stage(options, 'ready')
      }
    }
  }

  async playUpdate(update: AuthorityUpdate, previousSnapshot: GameSnapshot, options?: BoardPlaybackOptions) {
    const playbackRevision = ++this.playbackRevision
    const playback = this.runUpdate(update, previousSnapshot, playbackRevision, options)
    let timeoutId = 0
    let interruptPlayback: (() => void) | undefined
    const interrupted = new Promise<'interrupted'>((resolve) => {
      interruptPlayback = () => resolve('interrupted')
      timeoutId = window.setTimeout(interruptPlayback, 12_000)
    })
    const onBlur = () => interruptPlayback?.()
    window.addEventListener('blur', onBlur, { once: true })
    const outcome = await Promise.race([
      playback.then(() => 'complete' as const).catch(() => 'failed' as const),
      interrupted,
    ])
    window.clearTimeout(timeoutId)
    window.removeEventListener('blur', onBlur)
    if (outcome !== 'complete') {
      this.playbackRevision += 1
      this.tweens.removeAll()
    }
    this.machine.send({ type: 'RESET' })
    this.routeGraphic?.destroy()
    this.routeGraphic = null
    this.targetGraphic?.destroy()
    this.targetGraphic = null
    this.sync(update.snapshot)
    this.stage(options, 'ready')
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.playbackRevision += 1
    this.resizeObserver.disconnect()
    this.machine.stop()
    this.tweens.removeAll()
    this.app.ticker.remove(this.updateTweens)
    this.app.destroy({ removeView: true }, { children: true })
    this.tokens.clear()
    this.audio.dispose()
  }
}
