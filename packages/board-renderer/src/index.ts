import type { MapDefinition, MapMarkerDefinition } from '@goose-chess/game-core'
import { Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js'

export interface SmoothRouteSegment {
  readonly from: { readonly x: number; readonly y: number }
  readonly control1: { readonly x: number; readonly y: number }
  readonly control2: { readonly x: number; readonly y: number }
  readonly to: { readonly x: number; readonly y: number }
}

export interface StaticBoardOptions {
  readonly tableAsset?: string
  readonly resolveAsset?: (asset: string) => string
  readonly onAssetLoaded?: () => void
  readonly showTitle?: boolean
  readonly strictAssets?: boolean
}

export interface MarkerVisual {
  readonly container: Container
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}

export interface StaticBoard {
  readonly root: Container
  readonly tableLayer: Container
  readonly boardLayer: Container
  readonly spaceLayer: Container
  readonly markerLayer: Container
  readonly titleLayer: Container
  readonly spaces: ReadonlyMap<number, Container>
  readonly markers: ReadonlyMap<string, MarkerVisual>
  readonly loadedTextureCount: number
}

const DEFAULT_MARKER_SIZE = 108

export function mapMarkers(map: MapDefinition): readonly MapMarkerDefinition[] {
  if (map.markers) return map.markers
  return map.landmarks.map((landmark) => {
    const anchor = map.spaces.find((space) => space.index === landmark.spaceIds[0])
    return {
      id: landmark.id,
      kind: 'location',
      name: landmark.name,
      spaceIds: landmark.spaceIds,
      asset: map.assets.landmarks?.[landmark.id] ?? '',
      transform: {
        x: landmark.x ?? anchor?.x ?? 0,
        y: landmark.y ?? (anchor?.y ?? 45) - 45,
        scale: (landmark.size ?? DEFAULT_MARKER_SIZE) / DEFAULT_MARKER_SIZE,
        rotation: 0,
        opacity: 1,
      },
    }
  })
}

export function smoothRouteSegments(points: readonly { readonly x: number; readonly y: number }[]): readonly SmoothRouteSegment[] {
  return points.slice(0, -1).map((from, index) => {
    const before = points[Math.max(0, index - 1)]
    const to = points[index + 1]
    const after = points[Math.min(points.length - 1, index + 2)]
    return {
      from,
      control1: {
        x: from.x + (to.x - before.x) * 0.12,
        y: from.y + (to.y - before.y) * 0.12,
      },
      control2: {
        x: to.x - (after.x - from.x) * 0.12,
        y: to.y - (after.y - from.y) * 0.12,
      },
      to,
    }
  })
}

export function traceSmoothRoute(graphic: Graphics, points: readonly { readonly x: number; readonly y: number }[]) {
  if (points.length === 0) return graphic
  graphic.moveTo(points[0].x, points[0].y)
  for (const segment of smoothRouteSegments(points)) {
    graphic.bezierCurveTo(
      segment.control1.x,
      segment.control1.y,
      segment.control2.x,
      segment.control2.y,
      segment.to.x,
      segment.to.y,
    )
  }
  return graphic
}

function assetUrl(asset: string, resolveAsset?: (asset: string) => string) {
  if (resolveAsset) return resolveAsset(asset)
  return asset.startsWith('/') ? asset : `/${asset}`
}

async function loadTexture(asset: string, options: StaticBoardOptions) {
  if (!asset) {
    options.onAssetLoaded?.()
    return { texture: Texture.EMPTY, loaded: false }
  }
  try {
    return { texture: await Assets.load<Texture>(assetUrl(asset, options.resolveAsset)), loaded: true }
  } catch (error) {
    if (options.strictAssets) throw error
    return { texture: Texture.EMPTY, loaded: false }
  } finally {
    options.onAssetLoaded?.()
  }
}

function createSpaceVisual(map: MapDefinition, space: MapDefinition['spaces'][number], compact: boolean) {
  const container = new Container({ x: space.x, y: space.y })
  const cell = new Graphics()
  const previous = map.spaces[Math.max(0, space.index - 1)]
  const next = map.spaces[Math.min(map.spaces.length - 1, space.index + 1)]
  const width = compact ? 61 : (space.kind === 'start' || space.kind === 'finish' ? 58 : 48)
  const height = compact ? (space.kind === 'finish' ? 42 : 39) : width
  const paperColors = [0xd9c38b, 0xe1ce9e, 0xcfb77e]
  const fill = space.kind === 'event' ? 0xc96850 : space.kind === 'finish' ? 0x4b4f46 : paperColors[space.index % paperColors.length]
  if (compact) {
    cell.poly([
      -width / 2, -height / 2 + ((space.index * 7) % 5) - 2,
      width / 2, -height / 2 + ((space.index * 3) % 5) - 2,
      width / 2 - 2, height / 2 + ((space.index * 5) % 5) - 2,
      -width / 2 + 2, height / 2 + ((space.index * 11) % 5) - 2,
    ])
  } else {
    cell.roundRect(-width / 2, -height / 2, width, height, 5)
  }
  cell.fill({ color: fill, alpha: 0.97 }).stroke({
    color: space.kind === 'event' ? 0x713d34 : space.kind === 'finish' ? 0xd5ad43 : 0x5e594b,
    width: compact ? 2.5 : 3,
    alpha: 0.9,
  })
  const incomingX = space.index === 0 ? next.x - space.x : space.x - previous.x
  const incomingY = space.index === 0 ? next.y - space.y : space.y - previous.y
  const outgoingX = space.index === map.spaces.length - 1 ? incomingX : next.x - space.x
  const outgoingY = space.index === map.spaces.length - 1 ? incomingY : next.y - space.y
  const incomingLength = Math.hypot(incomingX, incomingY) || 1
  const outgoingLength = Math.hypot(outgoingX, outgoingY) || 1
  const routeAngle = compact
    ? Math.atan2(incomingY / incomingLength + outgoingY / outgoingLength, incomingX / incomingLength + outgoingX / outgoingLength)
    : 0
  container.rotation = routeAngle + space.rotation * Math.PI / 720
  const label = new Text({
    text: space.kind === 'event' ? '!' : String(space.index),
    style: {
      fontFamily: 'Microsoft YaHei',
      fontSize: compact ? 14 : space.kind === 'event' ? 15 : 14,
      fill: space.kind === 'event' ? 0xfff4df : space.kind === 'finish' ? 0xffe39a : 0x54574e,
      fontWeight: '700',
    },
  })
  label.anchor.set(0.5)
  label.rotation = -container.rotation
  container.addChild(cell, label)
  return container
}

async function createMarkerVisual(definition: MapMarkerDefinition, options: StaticBoardOptions): Promise<{ visual: MarkerVisual; loaded: boolean }> {
  const container = new Container({ x: definition.transform.x, y: definition.transform.y })
  container.rotation = definition.transform.rotation * Math.PI / 180
  container.scale.set(definition.transform.scale)
  container.alpha = definition.transform.opacity ?? 1
  const result = await loadTexture(definition.asset, options)
  let width = DEFAULT_MARKER_SIZE
  let height: number
  if (result.texture !== Texture.EMPTY) {
    const longestSide = Math.max(result.texture.width, result.texture.height)
    const fitScale = longestSide > 0 ? DEFAULT_MARKER_SIZE / longestSide : 1
    width = result.texture.width * fitScale
    height = result.texture.height * fitScale
    const sprite = new Sprite(result.texture)
    sprite.anchor.set(0.5, 1)
    sprite.width = width
    sprite.height = height
    container.addChild(sprite)
  } else {
    height = 44
    const badge = new Graphics().roundRect(-width / 2, -height / 2, width, height, 3).fill({ color: 0x743f38, alpha: 0.94 })
    const label = new Text({ text: definition.name, style: { fontFamily: 'Microsoft YaHei', fontSize: 14, fill: 0xffffff, fontWeight: '700' } })
    label.anchor.set(0.5)
    container.addChild(badge, label)
  }
  return {
    visual: {
      container,
      bounds: { x: -width / 2, y: result.texture === Texture.EMPTY ? -height / 2 : -height, width, height },
    },
    loaded: result.loaded,
  }
}

export async function createStaticBoard(map: MapDefinition, options: StaticBoardOptions = {}): Promise<StaticBoard> {
  const root = new Container()
  const tableLayer = new Container()
  const boardLayer = new Container()
  const spaceLayer = new Container()
  const markerLayer = new Container()
  const titleLayer = new Container()
  root.addChild(tableLayer, boardLayer, spaceLayer, markerLayer, titleLayer)

  const markers = mapMarkers(map)
  const [tableResult, paperResult, ...markerResults] = await Promise.all([
    loadTexture(options.tableAsset ?? 'assets/sample/tabletop.png', options),
    loadTexture(map.assets.background, options),
    ...markers.map((marker) => createMarkerVisual(marker, options)),
  ])
  const worldWidth = map.logicalSize.width
  const worldHeight = map.logicalSize.height
  const table = new Sprite({ texture: tableResult.texture, width: worldWidth, height: worldHeight })
  const paper = new Sprite({ texture: paperResult.texture, width: worldWidth - 70, height: worldHeight - 54, x: 35, y: 27 })
  tableLayer.addChild(table)
  boardLayer.addChild(paper)
  boardLayer.addChild(new Graphics().rect(35, 27, worldWidth - 70, worldHeight - 54).stroke({ color: 0x5c5a50, width: 7, alpha: 0.55 }))
  const routePoints = map.spaces.map(({ x, y }) => ({ x, y }))
  const routeOutline = traceSmoothRoute(new Graphics(), routePoints).stroke({ color: 0x555449, width: 47, alpha: 0.24 })
  const routePaper = traceSmoothRoute(new Graphics(), routePoints).stroke({ color: 0xc9b783, width: 39, alpha: 0.72 })
  boardLayer.addChild(routeOutline, routePaper)

  const compact = map.spaces.length > 24
  const spaceVisuals = new Map<number, Container>()
  for (const space of map.spaces) {
    const visual = createSpaceVisual(map, space, compact)
    spaceVisuals.set(space.index, visual)
    spaceLayer.addChild(visual)
  }
  const markerVisuals = new Map<string, MarkerVisual>()
  markers.forEach((marker, index) => {
    const visual = markerResults[index].visual
    markerVisuals.set(marker.id, visual)
    markerLayer.addChild(visual.container)
  })
  if (options.showTitle !== false) {
    const title = new Text({
      text: `${map.name} · ${Math.max(0, map.spaces.length - 1)} 格竞速`,
      style: { fontFamily: 'Microsoft YaHei', fontSize: 22, fill: 0x55584f, fontWeight: '700', letterSpacing: 0 },
    })
    title.position.set(worldWidth * 0.406, worldHeight * 0.518)
    title.rotation = -0.02
    titleLayer.addChild(title)
  }
  return {
    root,
    tableLayer,
    boardLayer,
    spaceLayer,
    markerLayer,
    titleLayer,
    spaces: spaceVisuals,
    markers: markerVisuals,
    loadedTextureCount: Number(tableResult.loaded) + Number(paperResult.loaded) + markerResults.filter((result) => result.loaded).length,
  }
}
