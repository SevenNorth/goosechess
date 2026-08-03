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
import type { MapDefinition } from '@goose-chess/game-core'
import type { GameSnapshot, AuthorityUpdate, PresentationCue } from '@goose-chess/game-protocol'
import type { AudioPort } from '../audio/audio-port'
import { presentationMachine, type PresentationStage } from '../game-client/machine/presentation-machine'
import { settlePresentation } from '../game-client/presentation-recovery'
import { PLAYER_SKIN_OPTIONS, playerSkinOption } from '../player-profile'
import { tokenOffset } from './token-layout'
const SEAT_COLORS: Readonly<Record<string, number>> = {
  pink: 0xe82f73,
  blue: 0x3977c5,
  gold: 0xd4a43a,
  teal: 0x2baf9c,
}

interface TokenVisual {
  readonly root: Container
  readonly body: Container
  readonly shadow: Graphics
  animating: boolean
}

export interface BoardPlaybackOptions {
  readonly onStageChange?: (stage: PresentationStage) => void
  readonly speed?: number
  readonly cameraMotion?: boolean
  readonly playDice?: (cue: Extract<PresentationCue, { type: 'dice-roll' }>, speed: number) => Promise<void>
  readonly cancelDice?: () => void
  readonly playItemUse?: (playerId: string, itemId: string, targetPlayerId: string | undefined, speed: number) => Promise<void>
  readonly cancelItemUse?: () => void
}

export interface BoardSceneDiagnostics {
  readonly activeScenes: number
  readonly tickerHandlers: number
  readonly loadedTextures: number
  readonly windowListeners: number
  readonly activeTweens: number
  readonly tokenCount: number
  readonly pannable: boolean
  readonly cameraZoom: number
  readonly cameraFocusX: number
  readonly cameraFocusY: number
}

export interface BoardSceneController {
  playUpdate(update: AuthorityUpdate, previousSnapshot: GameSnapshot, options?: BoardPlaybackOptions): Promise<void>
  sync(snapshot: GameSnapshot): void
  setActivePlayer(playerId: string): void
  diagnostics(): BoardSceneDiagnostics
  destroy(): void
}

function spacePoint(map: MapDefinition, spaceId: number) {
  const space = map.spaces.find((candidate) => candidate.index === spaceId)
  if (!space) throw new Error(`Unknown board space: ${spaceId}.`)
  return { x: space.x, y: space.y }
}

export class BoardScene implements BoardSceneController {
  private static activeScenes = 0
  private readonly app = new Application()
  private readonly world = new Container()
  private readonly staticBoardLayer = new Container()
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
  private readonly tokenTextures = new Map<string, Texture>()
  private readonly machine: ActorRefFrom<typeof presentationMachine>
  private readonly resizeObserver: ResizeObserver
  private routeGraphic: Graphics | null = null
  private targetGraphic: Graphics | null = null
  private winGraphic: Graphics | null = null
  private playbackRevision = 0
  private activePlayerId = ''
  private loadedTextureCount = 0
  private windowListenerCount = 0
  private tickerAttached = false
  private appInitialized = false
  private sceneCounted = false
  private activePlaybackInterrupt: (() => void) | null = null
  private cameraFocusX: number
  private cameraFocusY: number
  private cameraZoom = 1
  private dragPointerId: number | null = null
  private dragClientX = 0
  private dragClientY = 0
  private destroyed = false

  private constructor(
    private readonly host: HTMLElement,
    private readonly audio: AudioPort,
    private readonly map: MapDefinition,
  ) {
    this.cameraFocusX = map.logicalSize.width / 2
    this.cameraFocusY = map.logicalSize.height / 2
    this.machine = createActor(presentationMachine).start()
    this.resizeObserver = new ResizeObserver(() => this.resizeWorld())
  }

  static async create(
    host: HTMLElement,
    audio: AudioPort,
    map: MapDefinition,
    isCancelled: () => boolean = () => false,
    onProgress: (progress: number) => void = () => undefined,
  ) {
    const scene = new BoardScene(host, audio, map)
    try {
      await scene.initialize(isCancelled, onProgress)
      return scene
    } catch (error) {
      scene.destroy()
      throw error
    }
  }

  private async initialize(isCancelled: () => boolean, onProgress: (progress: number) => void) {
    onProgress(0.04)
    await this.app.init({
      resizeTo: this.host,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      backgroundColor: 0x171916,
      preference: 'webgl',
    })
    this.appInitialized = true
    if (isCancelled()) {
      this.destroy()
      return
    }
    BoardScene.activeScenes += 1
    this.sceneCounted = true
    onProgress(0.12)
    this.app.canvas.className = 'pixi-canvas'
    this.app.canvas.dataset.testid = 'pixi-canvas'
    this.host.appendChild(this.app.canvas)
    this.app.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.app.canvas.addEventListener('pointermove', this.onPointerMove)
    this.app.canvas.addEventListener('pointerup', this.onPointerUp)
    this.app.canvas.addEventListener('pointercancel', this.onPointerUp)
    this.app.stage.addChild(this.world)
    this.staticBoardLayer.addChild(
      this.tableLayer,
      this.boardLayer,
      this.spaceLayer,
      this.landmarkLayer,
    )
    this.world.addChild(
      this.staticBoardLayer,
      this.routeLayer,
      this.tokenLayer,
      this.effectsLayer,
      this.foregroundLayer,
    )
    this.app.ticker.add(this.updateTweens)
    this.tickerAttached = true
    this.resizeObserver.observe(this.host)
    await this.buildBoard(onProgress)
    if (isCancelled()) {
      this.destroy()
      return
    }
    this.resizeWorld()
    onProgress(1)
  }

  private readonly updateTweens = () => {
    const now = performance.now()
    this.tweens.update(now)
    for (const [playerId, token] of this.tokens) {
      if (token.animating) continue
      const active = playerId === this.activePlayerId
      const pulse = Math.sin(now / (active ? 180 : 420))
      token.body.y = pulse * (active ? 2.5 : 1.2)
      token.body.scale.set((active ? 1.07 : 1) + pulse * (active ? 0.025 : 0.01))
    }
  }

  private resizeWorld() {
    if (this.destroyed) return
    const width = this.app.screen.width
    const height = this.app.screen.height
    const fitScale = Math.min(width / this.map.logicalSize.width, height / this.map.logicalSize.height)
    const baseScale = fitScale >= 1 ? 1 : Math.max(fitScale, 0.9)
    const scale = baseScale * this.cameraZoom
    const visibleHalfWidth = width / scale / 2
    const visibleHalfHeight = height / scale / 2
    this.cameraFocusX = visibleHalfWidth >= this.map.logicalSize.width / 2
      ? this.map.logicalSize.width / 2
      : Math.min(this.map.logicalSize.width - visibleHalfWidth, Math.max(visibleHalfWidth, this.cameraFocusX))
    this.cameraFocusY = visibleHalfHeight >= this.map.logicalSize.height / 2
      ? this.map.logicalSize.height / 2
      : Math.min(this.map.logicalSize.height - visibleHalfHeight, Math.max(visibleHalfHeight, this.cameraFocusY))
    this.world.scale.set(scale)
    this.world.position.set(width / 2 - this.cameraFocusX * scale, height / 2 - this.cameraFocusY * scale)
    this.app.canvas.classList.toggle('is-pannable', this.requiresPanning())
  }

  private requiresPanning() {
    if (!this.appInitialized) return false
    const fitScale = Math.min(
      this.app.screen.width / this.map.logicalSize.width,
      this.app.screen.height / this.map.logicalSize.height,
    )
    const baseScale = fitScale >= 1 ? 1 : Math.max(fitScale, 0.9)
    return this.app.screen.width / baseScale < this.map.logicalSize.width - 0.5
      || this.app.screen.height / baseScale < this.map.logicalSize.height - 0.5
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !this.requiresPanning()) return
    this.dragPointerId = event.pointerId
    this.dragClientX = event.clientX
    this.dragClientY = event.clientY
    this.app.canvas.setPointerCapture(event.pointerId)
    this.app.canvas.classList.add('is-dragging')
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.dragPointerId) return
    const scale = this.world.scale.x || 1
    this.cameraFocusX -= (event.clientX - this.dragClientX) / scale
    this.cameraFocusY -= (event.clientY - this.dragClientY) / scale
    this.dragClientX = event.clientX
    this.dragClientY = event.clientY
    this.resizeWorld()
  }

  private readonly onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.dragPointerId) return
    this.dragPointerId = null
    if (this.app.canvas.hasPointerCapture(event.pointerId)) this.app.canvas.releasePointerCapture(event.pointerId)
    this.app.canvas.classList.remove('is-dragging')
  }

  private async buildBoard(onProgress: (progress: number) => void) {
    const landmarkAssets = this.map.assets.landmarks ?? {}
    const landmarkTextures = new Map<string, Texture>()
    const tokenAssetCount = PLAYER_SKIN_OPTIONS.length
    const totalAssetCount = this.map.landmarks.length + 2 + tokenAssetCount
    const assetPromises = [
      '/assets/sample/tabletop.png',
      `/${this.map.assets.background}`,
      ...this.map.landmarks.map((landmark) => landmarkAssets[landmark.id] ? `/${landmarkAssets[landmark.id]}` : null),
      ...PLAYER_SKIN_OPTIONS.map((skin) => skin.imageSrc),
    ].map(async (url) => {
      const texture = url ? await Assets.load<Texture>(url) : Texture.WHITE
      this.loadedTextureCount += url ? 1 : 0
      onProgress(0.12 + this.loadedTextureCount / totalAssetCount * 0.8)
      return texture
    })
    const loadedAssets = await Promise.all(assetPromises)
    const [tableTexture, paperTexture] = loadedAssets
    const loadedLandmarks = loadedAssets.slice(2, 2 + this.map.landmarks.length)
    const loadedTokens = loadedAssets.slice(2 + this.map.landmarks.length)
    this.map.landmarks.forEach((landmark, index) => landmarkTextures.set(landmark.id, loadedLandmarks[index]))
    PLAYER_SKIN_OPTIONS.forEach((skin, index) => this.tokenTextures.set(skin.id, loadedTokens[index]))
    const worldWidth = this.map.logicalSize.width
    const worldHeight = this.map.logicalSize.height
    const table = new Sprite({ texture: tableTexture, width: worldWidth, height: worldHeight })
    const paper = new Sprite({ texture: paperTexture, width: worldWidth - 70, height: worldHeight - 54, x: 35, y: 27 })
    this.tableLayer.addChild(table)
    this.boardLayer.addChild(paper)

    const border = new Graphics()
      .rect(35, 27, worldWidth - 70, worldHeight - 54)
      .stroke({ color: 0x5c5a50, width: 7, alpha: 0.55 })
    const routeOutline = new Graphics()
    const routePaper = new Graphics()
    const routePoints = this.map.spaces.map(({ x, y }) => ({ x, y }))
    const traceSmoothRoute = (graphic: Graphics) => {
      graphic.moveTo(routePoints[0].x, routePoints[0].y)
      for (let index = 0; index < routePoints.length - 1; index += 1) {
        const before = routePoints[Math.max(0, index - 1)]
        const from = routePoints[index]
        const to = routePoints[index + 1]
        const after = routePoints[Math.min(routePoints.length - 1, index + 2)]
        graphic.bezierCurveTo(
          from.x + (to.x - before.x) * 0.12,
          from.y + (to.y - before.y) * 0.12,
          to.x - (after.x - from.x) * 0.12,
          to.y - (after.y - from.y) * 0.12,
          to.x,
          to.y,
        )
      }
    }
    traceSmoothRoute(routeOutline)
    traceSmoothRoute(routePaper)
    routeOutline.stroke({ color: 0x555449, width: 47, alpha: 0.24 })
    routePaper.stroke({ color: 0xc9b783, width: 39, alpha: 0.72 })
    this.boardLayer.addChild(border, routeOutline, routePaper)

    const compact = this.map.spaces.length > 24
    for (const space of this.map.spaces) {
      const landmark = space.landmarkId
        ? this.map.landmarks.find((candidate) => candidate.id === space.landmarkId)
        : undefined
      if (landmark?.pathIntegrated) continue

      const cellContainer = new Container()
      const cell = new Graphics()
      const previous = this.map.spaces[Math.max(0, space.index - 1)]
      const next = this.map.spaces[Math.min(this.map.spaces.length - 1, space.index + 1)]
      const width = compact ? 61 : (space.kind === 'start' || space.kind === 'finish' ? 58 : 48)
      const height = compact ? (space.kind === 'finish' ? 42 : 39) : width
      const paperColors = [0xd9c38b, 0xe1ce9e, 0xcfb77e]
      const fill = space.kind === 'event'
        ? 0xc96850
        : space.kind === 'finish'
          ? 0x4b4f46
          : paperColors[space.index % paperColors.length]
      if (compact) {
        const topLeft = ((space.index * 7) % 5) - 2
        const topRight = ((space.index * 3) % 5) - 2
        const bottomRight = ((space.index * 5) % 5) - 2
        const bottomLeft = ((space.index * 11) % 5) - 2
        cell.poly([
          -width / 2, -height / 2 + topLeft,
          width / 2, -height / 2 + topRight,
          width / 2 - 2, height / 2 + bottomRight,
          -width / 2 + 2, height / 2 + bottomLeft,
        ])
      } else {
        cell.roundRect(-width / 2, -height / 2, width, height, 5)
      }
      cell.fill({ color: fill, alpha: 0.97 })
        .stroke({ color: space.kind === 'event' ? 0x713d34 : space.kind === 'finish' ? 0xd5ad43 : 0x5e594b, width: compact ? 2.5 : 3, alpha: 0.9 })
      cellContainer.position.set(space.x, space.y)
      const incomingX = space.index === 0 ? next.x - space.x : space.x - previous.x
      const incomingY = space.index === 0 ? next.y - space.y : space.y - previous.y
      const outgoingX = space.index === this.map.spaces.length - 1 ? incomingX : next.x - space.x
      const outgoingY = space.index === this.map.spaces.length - 1 ? incomingY : next.y - space.y
      const incomingLength = Math.hypot(incomingX, incomingY) || 1
      const outgoingLength = Math.hypot(outgoingX, outgoingY) || 1
      const routeAngle = compact
        ? Math.atan2(incomingY / incomingLength + outgoingY / outgoingLength, incomingX / incomingLength + outgoingX / outgoingLength)
        : 0
      cellContainer.rotation = routeAngle + space.rotation * Math.PI / 720
      const number = new Text({
        text: space.kind === 'event' ? '!' : String(space.index),
        style: {
          fontFamily: 'Microsoft YaHei',
          fontSize: compact ? 14 : space.kind === 'event' ? 15 : 14,
          fill: space.kind === 'event' ? 0xfff4df : space.kind === 'finish' ? 0xffe39a : 0x54574e,
          fontWeight: '700',
        },
      })
      number.anchor.set(0.5)
      number.rotation = -cellContainer.rotation
      cellContainer.addChild(cell, number)
      this.spaceLayer.addChild(cellContainer)
    }

    for (const landmark of this.map.landmarks) {
      const anchor = spacePoint(this.map, landmark.spaceIds[0])
      this.addLandmark(
        landmarkTextures.get(landmark.id) ?? Texture.WHITE,
        landmark.x ?? anchor.x,
        landmark.y ?? anchor.y - 45,
        landmark.size ?? (compact ? 96 : 150),
        landmark.name,
        landmark.id === 'noise-house',
      )
    }

    const title = new Text({
      text: `${this.map.name} · 65 格竞速`,
      style: { fontFamily: 'Microsoft YaHei', fontSize: 22, fill: 0x55584f, fontWeight: '700', letterSpacing: 0 },
    })
    title.position.set(520, 425)
    title.rotation = -0.02
    this.foregroundLayer.addChild(title)
    this.staticBoardLayer.cacheAsTexture({ resolution: Math.min(window.devicePixelRatio || 1, 2), antialias: true })
  }

  private addLandmark(texture: Texture, x: number, y: number, size: number, label: string, isFinish = false) {
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
    const labelPaper = new Graphics().roundRect(-text.width / 2 - 8, 1, text.width + 16, 27, 3).fill({ color: isFinish ? 0xd5ad43 : 0xe4deca, alpha: 0.9 })
    if (isFinish) {
      container.addChild(sprite)
      this.boardLayer.addChild(container)
      const finishLabel = new Container({ x, y })
      finishLabel.addChild(labelPaper, text)
      this.landmarkLayer.addChild(finishLabel)
    } else {
      container.addChild(sprite, labelPaper, text)
      this.landmarkLayer.addChild(container)
    }
  }

  private makeToken(player: GameSnapshot['state']['players'][number], players: GameSnapshot['state']['players']) {
    const root = new Container()
    const shadow = new Graphics().ellipse(0, 2, 32, 10).fill({ color: 0x181914, alpha: 0.3 })
    const body = new Container()
    const outline = SEAT_COLORS[player.colorId] ?? 0xe82f73
    const base = new Graphics()
      .ellipse(0, -2, 33, 10).fill({ color: outline })
      .ellipse(0, -4, 27, 7).fill({ color: 0x383a34 })
    const texture = this.tokenTextures.get(player.skinId)
      ?? this.tokenTextures.get(playerSkinOption(player.skinId).id)
      ?? Texture.WHITE
    const model = new Sprite(texture)
    model.anchor.set(0.5, 1)
    const modelScale = Math.min(78 / Math.max(1, texture.width), 112 / Math.max(1, texture.height))
    model.scale.set(modelScale)
    model.position.y = -5
    body.addChild(base, model)
    root.addChild(shadow, body)
    const offset = tokenOffset(player, players)
    const point = spacePoint(this.map, player.spaceId)
    if (this.map.spaces.length > 24) root.scale.set(0.68)
    root.position.set(point.x + offset.x, point.y + offset.y)
    this.tokenLayer.addChild(root)
    const visual = { root, body, shadow, animating: false }
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
      const token = this.tokens.get(player.playerId) ?? this.makeToken(player, snapshot.state.players)
      const point = spacePoint(this.map, player.spaceId)
      const offset = tokenOffset(player, snapshot.state.players)
      token.root.position.set(point.x + offset.x, point.y + offset.y)
      token.body.position.y = 0
      token.body.scale.set(1)
      token.shadow.scale.set(1)
      token.animating = false
    }
    this.setActivePlayer(snapshot.state.activePlayerId)
  }

  setActivePlayer(playerId: string) {
    this.activePlayerId = playerId
    for (const [id, token] of this.tokens) {
      token.root.alpha = id === playerId ? 1 : 0.88
      token.body.scale.set(id === playerId ? 1.07 : 1)
    }
  }

  private animate(duration: number, update: (progress: number) => void, easing = Easing.Quadratic.InOut) {
    if (this.destroyed) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const state = { progress: 0 }
      const tween = new Tween(state, this.tweens)
        .to({ progress: 1 }, Math.max(1, duration))
        .easing(easing)
        .onUpdate(() => update(state.progress))
        .onComplete(() => {
          this.tweens.remove(tween)
          resolve()
        })
        .start(performance.now())
    })
  }

  private resetCamera() {
    this.cameraFocusX = this.map.logicalSize.width / 2
    this.cameraFocusY = this.map.logicalSize.height / 2
    this.cameraZoom = 1
    this.resizeWorld()
  }

  private updateCamera(focusX: number, focusY: number, zoom: number) {
    this.cameraFocusX = focusX
    this.cameraFocusY = focusY
    this.cameraZoom = zoom
    this.resizeWorld()
  }

  private async playDice(cue: Extract<PresentationCue, { type: 'dice-roll' }>, speed: number, options?: BoardPlaybackOptions) {
    this.audio.play('dice.roll')
    if (options?.playDice) await options.playDice(cue, speed)
    else await this.animate(780 / speed, () => undefined, Easing.Cubic.Out)
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
    const points = [spacePoint(this.map, player.spaceId), ...cue.path.map((spaceId) => spacePoint(this.map, spaceId))]
    this.routeGraphic?.destroy()
    this.routeGraphic = null
    await this.animate(1_400 / speed, (progress) => this.drawPartialRoute(points, progress, color), Easing.Quadratic.Out)
  }

  private async emphasizeTarget(cue: Extract<PresentationCue, { type: 'target-highlight' }>, speed: number, cameraMotion: boolean) {
    const point = spacePoint(this.map, cue.spaceId)
    this.targetGraphic?.destroy()
    const targetRadius = this.map.spaces.length > 24 ? 25 : 38
    const target = new Graphics().circle(0, 0, targetRadius).stroke({ color: 0xe82f73, width: 6, alpha: 1 })
    target.position.set(point.x, point.y)
    this.effectsLayer.addChild(target)
    this.targetGraphic = target
    const cameraStart = { x: this.cameraFocusX, y: this.cameraFocusY, zoom: this.cameraZoom }
    await this.animate(220 / speed, (progress) => {
      target.scale.set(0.8 + Math.sin(progress * Math.PI) * 0.28)
      target.alpha = 0.65 + Math.sin(progress * Math.PI) * 0.35
      if (cameraMotion && this.requiresPanning()) this.updateCamera(
        cameraStart.x + (point.x - cameraStart.x) * progress,
        cameraStart.y + (point.y - cameraStart.y) * progress,
        cameraStart.zoom + (1.06 - cameraStart.zoom) * progress,
      )
    }, Easing.Quadratic.Out)
  }

  private async fadeRoute(speed: number) {
    const route = this.routeGraphic
    if (!route) return
    await this.animate(130 / speed, (progress) => { route.alpha = 1 - progress })
    route.destroy()
    this.routeGraphic = null
  }

  private async hopToken(cue: Extract<PresentationCue, { type: 'token-hop' }>, snapshot: GameSnapshot, speed: number, cameraMotion: boolean) {
    const player = snapshot.state.players.find((candidate) => candidate.playerId === cue.playerId)
    const token = this.tokens.get(cue.playerId)
    if (!player || !token) return
    token.animating = true
    const offset = tokenOffset(player, snapshot.state.players)
    let facing = 1
    for (let index = 0; index < cue.path.length; index += 1) {
      if (index > 0) facing = Math.sign(cue.path[index] - cue.path[index - 1]) || facing
      const from = { x: token.root.x, y: token.root.y }
      const destination = spacePoint(this.map, cue.path[index])
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
    token.animating = false
    if (cameraMotion && this.requiresPanning()) {
      const cameraStart = { x: this.cameraFocusX, y: this.cameraFocusY, zoom: this.cameraZoom }
      const center = { x: this.map.logicalSize.width / 2, y: this.map.logicalSize.height / 2 }
      await this.animate(180 / speed, (progress) => this.updateCamera(
        cameraStart.x + (center.x - cameraStart.x) * progress,
        cameraStart.y + (center.y - cameraStart.y) * progress,
        cameraStart.zoom + (1 - cameraStart.zoom) * progress,
      ), Easing.Quadratic.Out)
    }
    this.resetCamera()
  }

  private async relocateToken(cue: Extract<PresentationCue, { type: 'token-relocate' }>, snapshot: GameSnapshot, speed: number) {
    const token = this.tokens.get(cue.playerId)
    const player = snapshot.state.players.find((candidate) => candidate.playerId === cue.playerId)
    if (!token || !player) return
    token.animating = true
    if (cue.blocked) {
      const originX = token.root.x
      this.audio.play('collision.blocked')
      await this.animate(320 / speed, (progress) => {
        token.root.x = originX + Math.sin(progress * Math.PI * 6) * (1 - progress) * 12
        token.body.rotation = Math.sin(progress * Math.PI * 5) * 0.08
      })
      token.root.x = originX
      token.body.rotation = 0
      token.animating = false
      return
    }
    const destination = spacePoint(this.map, cue.toSpaceId)
    const offset = tokenOffset(player, snapshot.state.players)
    const from = { x: token.root.x, y: token.root.y }
    this.audio.play(cue.reason === 'swap' ? 'token.swap' : 'collision.hit')
    await this.animate(420 / speed, (progress) => {
      const height = Math.sin(progress * Math.PI)
      token.root.position.set(
        from.x + (destination.x + offset.x - from.x) * progress,
        from.y + (destination.y + offset.y - from.y) * progress,
      )
      token.body.y = -height * (cue.reason === 'swap' ? 54 : 30)
      token.body.rotation = Math.sin(progress * Math.PI * 2) * 0.12
      token.shadow.scale.set(1 - height * 0.35)
    }, Easing.Cubic.InOut)
    token.body.y = 0
    token.body.rotation = 0
    token.shadow.scale.set(1)
    token.animating = false
  }

  private async playWin(cue: Extract<PresentationCue, { type: 'game-over' }>, speed: number) {
    this.audio.play('game.win')
    this.winGraphic?.destroy()
    const graphic = new Graphics()
    graphic.rect(0, 0, this.map.logicalSize.width, this.map.logicalSize.height).fill({ color: 0x11130f, alpha: 0.62 })
    for (const spaceId of this.map.winningSpaceIds) {
      const point = spacePoint(this.map, spaceId)
      graphic.circle(point.x, point.y, 32).stroke({ color: 0xe5b83f, width: 7, alpha: 0.95 })
    }
    this.effectsLayer.addChild(graphic)
    this.winGraphic = graphic
    const winner = this.tokens.get(cue.winnerPlayerId)
    await this.animate(620 / speed, (progress) => {
      graphic.alpha = progress
      if (winner) {
        const pulse = 1 + Math.sin(progress * Math.PI * 3) * 0.12
        winner.body.scale.set(pulse)
      }
    }, Easing.Cubic.Out)
  }

  private stage(options: BoardPlaybackOptions | undefined, stage: PresentationStage) {
    options?.onStageChange?.(stage)
  }

  private async runUpdate(update: AuthorityUpdate, previousSnapshot: GameSnapshot, playbackRevision: number, options?: BoardPlaybackOptions) {
    const speed = options?.speed ?? 1
    const cameraMotion = options?.cameraMotion ?? true
    if (!cameraMotion) this.resetCamera()
    for (let index = 0; index < update.cues.length; index += 1) {
      if (playbackRevision !== this.playbackRevision) return
      const cue = update.cues[index]
      if (cue.type === 'item-use') {
        await options?.playItemUse?.(cue.playerId, cue.itemId, cue.targetPlayerId, speed)
      } else if (cue.type === 'dice-roll') {
        this.machine.send({ type: 'ROLL_STARTED' })
        this.stage(options, 'rolling')
        await this.playDice(cue, speed, options)
        if (playbackRevision !== this.playbackRevision) return
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
        await this.emphasizeTarget(cue, speed, cameraMotion)
        this.machine.send({ type: 'TARGET_DONE' })
        this.stage(options, 'routeFade')
        await this.fadeRoute(speed)
        this.machine.send({ type: 'ROUTE_HIDDEN' })
        this.stage(options, 'moving')
      } else if (cue.type === 'token-hop') {
        await this.hopToken(cue, update.snapshot, speed, cameraMotion)
        this.machine.send({ type: 'MOVE_DONE' })
        this.stage(options, 'ready')
      } else if (cue.type === 'token-relocate') {
        await this.relocateToken(cue, update.snapshot, speed)
      } else if (cue.type === 'game-over') {
        await this.playWin(cue, speed)
      }
    }
  }

  async playUpdate(update: AuthorityUpdate, previousSnapshot: GameSnapshot, options?: BoardPlaybackOptions) {
    const playbackRevision = ++this.playbackRevision
    const playback = this.runUpdate(update, previousSnapshot, playbackRevision, options)
    const outcome = await settlePresentation(playback, {
      timeoutMs: 12_000,
      subscribeInterrupt: (interrupt) => {
        this.activePlaybackInterrupt = interrupt
        const onBlur = () => interrupt()
        window.addEventListener('blur', onBlur, { once: true })
        this.windowListenerCount += 1
        return () => {
          this.activePlaybackInterrupt = null
          window.removeEventListener('blur', onBlur)
          this.windowListenerCount = Math.max(0, this.windowListenerCount - 1)
        }
      },
    })
    if (this.destroyed) return
    if (outcome !== 'complete') {
      options?.cancelDice?.()
      options?.cancelItemUse?.()
      this.playbackRevision += 1
      this.tweens.removeAll()
    }
    this.resetCamera()
    this.machine.send({ type: 'RESET' })
    this.routeGraphic?.destroy()
    this.routeGraphic = null
    this.targetGraphic?.destroy()
    this.targetGraphic = null
    this.sync(update.snapshot)
    this.stage(options, 'ready')
  }

  diagnostics(): BoardSceneDiagnostics {
    return {
      activeScenes: BoardScene.activeScenes,
      tickerHandlers: this.tickerAttached ? 1 : 0,
      loadedTextures: this.loadedTextureCount,
      windowListeners: this.windowListenerCount,
      activeTweens: this.tweens.getAll().length,
      tokenCount: this.tokens.size,
      pannable: this.requiresPanning(),
      cameraZoom: this.cameraZoom,
      cameraFocusX: this.cameraFocusX,
      cameraFocusY: this.cameraFocusY,
    }
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.activePlaybackInterrupt?.()
    this.activePlaybackInterrupt = null
    this.playbackRevision += 1
    this.resizeObserver.disconnect()
    this.machine.stop()
    this.tweens.removeAll()
    if (this.tickerAttached) {
      this.app.ticker.remove(this.updateTweens)
      this.tickerAttached = false
    }
    if (this.appInitialized) {
      this.app.canvas.removeEventListener('pointerdown', this.onPointerDown)
      this.app.canvas.removeEventListener('pointermove', this.onPointerMove)
      this.app.canvas.removeEventListener('pointerup', this.onPointerUp)
      this.app.canvas.removeEventListener('pointercancel', this.onPointerUp)
      this.app.destroy({ removeView: true }, { children: true })
      this.appInitialized = false
    }
    if (this.sceneCounted) {
      BoardScene.activeScenes = Math.max(0, BoardScene.activeScenes - 1)
      this.sceneCounted = false
    }
    this.tokens.clear()
    this.audio.dispose()
  }
}
