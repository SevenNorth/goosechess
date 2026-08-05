import { useEffect, useRef, useState } from 'react'
import { Application, Container, Graphics, Text } from 'pixi.js'
import type { MapDefinition } from '@goose-chess/game-core'

export type MapCanvasMode = 'select' | 'add-space' | 'add-location' | 'pan'

interface CanvasPoint {
  readonly x: number
  readonly y: number
}

interface MapPreviewProps {
  readonly map: MapDefinition
  readonly selectedSpaceId: number
  readonly selectedMarkerId: string | null
  readonly path: readonly number[]
  readonly mode: MapCanvasMode
  readonly snapToGrid: boolean
  readonly onSelectSpace: (spaceId: number) => void
  readonly onSelectMarker: (markerId: string | null) => void
  readonly onAddSpace: (point: CanvasPoint) => void
  readonly onAddLocation: (point: CanvasPoint) => void
  readonly onMoveSpace: (spaceId: number, point: CanvasPoint) => void
  readonly onMoveMarker: (markerId: string, point: CanvasPoint) => void
  readonly onTransformMarker: (markerId: string, values: { scale?: number; rotation?: number }) => void
}
export function MapPreview({ map, selectedSpaceId, selectedMarkerId, path, mode, snapToGrid, onSelectSpace, onSelectMarker, onAddSpace, onAddLocation, onMoveSpace, onMoveMarker, onTransformMarker }: MapPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const panOffsetRef = useRef({ x: 0, y: 0 })
  const zoomRef = useRef(1)
  const [zoomPercent, setZoomPercent] = useState(100)
  useEffect(() => {
    panOffsetRef.current = { x: 0, y: 0 }
    zoomRef.current = 1
    setZoomPercent(100)
  }, [map.id])


  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const app = new Application()
    let cancelled = false
    let initialized = false
    let observer: ResizeObserver | undefined
    let removeWheelListener: (() => void) | undefined

    void app.init({
      resizeTo: host,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      backgroundColor: 0x252a25,
    }).then(() => {
      initialized = true
      if (cancelled) {
        app.destroy(true)
        return
      }
      app.canvas.className = 'map-preview-canvas'
      app.canvas.dataset.testid = 'map-preview-canvas'
      host.appendChild(app.canvas)
      const world = new Container()
      app.stage.addChild(world)
      const viewport = { scale: 1, x: 0, y: 0 }
      const fittedOrigin = { x: 0, y: 0 }
      let fittedScale = 1
      const snap = (value: number) => snapToGrid ? Math.round(value / 10) * 10 : Math.round(value)
      const toWorldPoint = (globalX: number, globalY: number) => ({
        x: snap((globalX - viewport.x) / viewport.scale),
        y: snap((globalY - viewport.y) / viewport.scale),
      })
      const toUnsappedWorldPoint = (globalX: number, globalY: number) => ({
        x: (globalX - viewport.x) / viewport.scale,
        y: (globalY - viewport.y) / viewport.scale,
      })
      let didDrag = false
      let panOrigin: { x: number; y: number; worldX: number; worldY: number } | null = null

      app.stage.eventMode = 'static'
      app.stage.hitArea = app.screen
      app.stage.on('pointerdown', (event) => {
        didDrag = false
        if (mode === 'select') onSelectMarker(null)
        if (mode === 'pan') panOrigin = { x: event.global.x, y: event.global.y, worldX: world.x, worldY: world.y }
      })
      app.stage.on('globalpointermove', (event) => {
        if (!panOrigin) return
        didDrag = true
        world.position.set(
          panOrigin.worldX + event.global.x - panOrigin.x,
          panOrigin.worldY + event.global.y - panOrigin.y,
        )
        viewport.x = world.x
        viewport.y = world.y
        panOffsetRef.current = {
          x: world.x - fittedOrigin.x,
          y: world.y - fittedOrigin.y,
        }
      })
      const endPan = () => { panOrigin = null }
      app.stage.on('pointerup', endPan)
      app.stage.on('pointerupoutside', endPan)
      app.stage.on('pointertap', (event) => {
        if (didDrag || mode === 'select' || mode === 'pan') return
        const point = toWorldPoint(event.global.x, event.global.y)
        if (mode === 'add-space') onAddSpace(point)
        else onAddLocation(point)
      })
      const handleWheel = (event: WheelEvent) => {
        event.preventDefault()
        const bounds = app.canvas.getBoundingClientRect()
        const cursor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
        const anchor = toUnsappedWorldPoint(cursor.x, cursor.y)
        const nextZoom = Math.min(3, Math.max(0.6, zoomRef.current * Math.exp(-event.deltaY * 0.0015)))
        if (nextZoom === zoomRef.current) return
        zoomRef.current = nextZoom
        setZoomPercent(Math.round(nextZoom * 100))
        const nextScale = fittedScale * nextZoom
        fittedOrigin.x = (app.screen.width - map.logicalSize.width * nextScale) / 2
        fittedOrigin.y = (app.screen.height - map.logicalSize.height * nextScale) / 2
        world.scale.set(nextScale)
        world.position.set(cursor.x - anchor.x * nextScale, cursor.y - anchor.y * nextScale)
        viewport.scale = nextScale
        viewport.x = world.x
        viewport.y = world.y
        panOffsetRef.current = { x: world.x - fittedOrigin.x, y: world.y - fittedOrigin.y }
      }
      app.canvas.addEventListener('wheel', handleWheel, { passive: false })
      removeWheelListener = () => app.canvas.removeEventListener('wheel', handleWheel)

      const paper = new Graphics()
        .roundRect(20, 20, map.logicalSize.width - 40, map.logicalSize.height - 40, 8)
        .fill({ color: 0xdad4bd })
        .stroke({ color: 0x68675d, width: 5 })
      world.addChild(paper)

      if (map.spaces.length > 1) {
        const route = new Graphics().moveTo(map.spaces[0].x, map.spaces[0].y)
        map.spaces.slice(1).forEach((space) => route.lineTo(space.x, space.y))
        route.stroke({ color: 0x897d5d, width: 28, alpha: 0.42 })
        world.addChild(route)
      }

      const pathIds = new Set(path)
      for (const space of map.spaces) {
        const selected = space.index === selectedSpaceId
        const inPath = pathIds.has(space.index)
        const fill = selected ? 0x1e8b7c : inPath ? 0xd9a938 : space.kind === 'event' ? 0xc96850 : space.kind === 'finish' ? 0x444a43 : 0xf0e4bf
        const cellContainer = new Container({ x: space.x, y: space.y })
        const cell = new Graphics()
          .circle(0, 0, selected ? 16 : 13)
          .fill({ color: fill })
          .stroke({ color: selected ? 0xffffff : 0x55584f, width: selected ? 4 : 2 })

        cellContainer.eventMode = 'static'
        cellContainer.cursor = mode === 'select' ? 'grab' : 'pointer'
        let dragging = false
        cellContainer.on('pointerdown', (event) => {
          event.stopPropagation()
          if (mode !== 'select') return
          dragging = true
          didDrag = false
          cellContainer.cursor = 'grabbing'
        })
        cellContainer.on('globalpointermove', (event) => {
          if (!dragging) return
          didDrag = true
          const point = toWorldPoint(event.global.x, event.global.y)
          cellContainer.position.set(point.x, point.y)
        })
        const finishSpaceDrag = (event: { global: { x: number; y: number } }) => {
          if (!dragging) return
          dragging = false
          cellContainer.cursor = 'grab'
          if (didDrag) onMoveSpace(space.index, toWorldPoint(event.global.x, event.global.y))
          else onSelectSpace(space.index)
        }
        cellContainer.on('pointerup', finishSpaceDrag)
        cellContainer.on('pointerupoutside', finishSpaceDrag)
        cellContainer.on('pointertap', (event) => event.stopPropagation())
        const label = new Text({
          text: space.kind === 'event' ? '!' : String(space.index),
          style: { fontFamily: 'Microsoft YaHei', fontSize: 11, fill: space.kind === 'normal' ? 0x45483f : 0xffffff, fontWeight: '700' },
        })
        label.anchor.set(0.5)
        cellContainer.addChild(cell, label)
        world.addChild(cellContainer)
      }

      const markerDefinitions = map.markers ?? map.landmarks.map((landmark) => ({
        id: landmark.id,
        kind: 'location' as const,
        name: landmark.name,
        spaceIds: landmark.spaceIds,
        asset: map.assets.landmarks?.[landmark.id] ?? '',
        transform: {
          x: landmark.x ?? map.spaces[landmark.spaceIds[0]]?.x ?? 0,
          y: landmark.y ?? map.spaces[landmark.spaceIds[0]]?.y ?? 0,
          scale: (landmark.size ?? 108) / 108,
          rotation: 0,
        },
      }))
      for (const definition of markerDefinitions) {
        const selected = definition.id === selectedMarkerId
        const visual = new Container({ x: definition.transform.x, y: definition.transform.y })
        visual.rotation = definition.transform.rotation * (Math.PI / 180)
        visual.scale.set(definition.transform.scale)
        const badge = new Graphics().roundRect(-44, -16, 88, 32, 3).fill({ color: 0x3f463e, alpha: 0.92 })
        const label = new Text({ text: definition.name, style: { fontFamily: 'Microsoft YaHei', fontSize: 14, fill: 0xffffff, fontWeight: '700' } })
        label.anchor.set(0.5)
        visual.addChild(badge, label)
        visual.eventMode = 'static'
        visual.cursor = mode === 'select' ? 'grab' : 'default'
        let dragging = false
        visual.on('pointerdown', (event) => {
          event.stopPropagation()
          if (mode !== 'select') return
          onSelectMarker(definition.id)
          if (!selected) return
          dragging = true
          didDrag = false
          visual.cursor = 'grabbing'
        })
        visual.on('globalpointermove', (event) => {
          if (!dragging) return
          didDrag = true
          const point = toWorldPoint(event.global.x, event.global.y)
          visual.position.set(point.x, point.y)
        })
        const finishMarkerDrag = (event: { global: { x: number; y: number } }) => {
          if (!dragging) return
          dragging = false
          visual.cursor = 'grab'
          if (didDrag) onMoveMarker(definition.id, toWorldPoint(event.global.x, event.global.y))
        }
        visual.on('pointerup', finishMarkerDrag)
        visual.on('pointerupoutside', finishMarkerDrag)
        visual.on('pointertap', (event) => event.stopPropagation())
        world.addChild(visual)

        if (selected && mode === 'select') {
          const overlay = new Container({ x: definition.transform.x, y: definition.transform.y })
          overlay.rotation = visual.rotation
          const halfWidth = 50 * definition.transform.scale
          const halfHeight = 23 * definition.transform.scale
          const outline = new Graphics()
          const stem = new Graphics()
          const scaleHandle = new Graphics()
            .circle(0, 0, 7)
            .fill({ color: 0x1e8b7c })
            .stroke({ color: 0xffffff, width: 2 })
          const rotateHandle = new Graphics()
            .circle(0, 0, 7)
            .fill({ color: 0xd9a938 })
            .stroke({ color: 0xffffff, width: 2 })
          const drawSelection = (scale: number) => {
            const width = 50 * scale
            const height = 23 * scale
            outline.clear().rect(-width, -height, width * 2, height * 2).stroke({ color: 0xffffff, width: 2 / viewport.scale })
            stem.clear().moveTo(0, -height).lineTo(0, -height - 28).stroke({ color: 0xffffff, width: 2 / viewport.scale })
            scaleHandle.position.set(width, height)
            rotateHandle.position.set(0, -height - 28)
          }
          drawSelection(definition.transform.scale)
          scaleHandle.eventMode = 'static'
          scaleHandle.cursor = 'nwse-resize'
          rotateHandle.eventMode = 'static'
          rotateHandle.cursor = 'grab'
          let scaling = false
          let rotating = false
          let previewScale = definition.transform.scale
          let previewRotation = definition.transform.rotation
          const center = definition.transform
          const startDistance = Math.hypot(halfWidth, halfHeight)
          scaleHandle.on('pointerdown', (event) => {
            event.stopPropagation()
            scaling = true
          })
          scaleHandle.on('globalpointermove', (event) => {
            if (!scaling) return
            const point = toUnsappedWorldPoint(event.global.x, event.global.y)
            previewScale = Math.min(8, Math.max(0.05, definition.transform.scale * Math.hypot(point.x - center.x, point.y - center.y) / startDistance))
            visual.scale.set(previewScale)
            drawSelection(previewScale)
          })
          const finishScale = () => {
            if (!scaling) return
            scaling = false
            if (Math.abs(previewScale - definition.transform.scale) > 0.001) onTransformMarker(definition.id, { scale: Number(previewScale.toFixed(3)) })
          }
          scaleHandle.on('pointerup', finishScale)
          scaleHandle.on('pointerupoutside', finishScale)
          rotateHandle.on('pointerdown', (event) => {
            event.stopPropagation()
            rotating = true
            rotateHandle.cursor = 'grabbing'
          })
          rotateHandle.on('globalpointermove', (event) => {
            if (!rotating) return
            const point = toUnsappedWorldPoint(event.global.x, event.global.y)
            previewRotation = Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI + 90
            if (snapToGrid) previewRotation = Math.round(previewRotation / 5) * 5
            visual.rotation = previewRotation * Math.PI / 180
            overlay.rotation = visual.rotation
          })
          const finishRotation = () => {
            if (!rotating) return
            rotating = false
            rotateHandle.cursor = 'grab'
            if (Math.abs(previewRotation - definition.transform.rotation) > 0.01) onTransformMarker(definition.id, { rotation: Number(previewRotation.toFixed(1)) })
          }
          rotateHandle.on('pointerup', finishRotation)
          rotateHandle.on('pointerupoutside', finishRotation)
          overlay.addChild(outline, stem, scaleHandle, rotateHandle)
          world.addChild(overlay)
        }
      }

      const resize = () => {
        fittedScale = Math.min(app.screen.width / map.logicalSize.width, app.screen.height / map.logicalSize.height)
        const scale = fittedScale * zoomRef.current
        world.scale.set(scale)
        fittedOrigin.x = (app.screen.width - map.logicalSize.width * scale) / 2
        fittedOrigin.y = (app.screen.height - map.logicalSize.height * scale) / 2
        world.position.set(
          fittedOrigin.x + panOffsetRef.current.x,
          fittedOrigin.y + panOffsetRef.current.y,
        )
        viewport.scale = scale
        viewport.x = world.x
        viewport.y = world.y
        app.stage.hitArea = app.screen
      }
      observer = new ResizeObserver(resize)
      observer.observe(host)
      resize()
    })

    return () => {
      cancelled = true
      observer?.disconnect()
      removeWheelListener?.()
      if (initialized && app.canvas.parentElement === host) host.removeChild(app.canvas)
      if (initialized) app.destroy(true, { children: true })
    }
  }, [map, mode, onAddLocation, onAddSpace, onMoveMarker, onMoveSpace, onSelectMarker, onSelectSpace, onTransformMarker, path, selectedMarkerId, selectedSpaceId, snapToGrid])

  return <div className="map-preview-host" ref={hostRef} aria-label="Pixi 地图预览"><div className="map-zoom-status"><span>{zoomPercent}%</span><small>滚轮缩放</small></div></div>
}
