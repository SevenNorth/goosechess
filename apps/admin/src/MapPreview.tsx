import { useEffect, useRef } from 'react'
import { Application, Container, Graphics, Text } from 'pixi.js'
import type { MapDefinition } from '@goose-chess/game-core'

interface MapPreviewProps {
  readonly map: MapDefinition
  readonly selectedSpaceId: number
  readonly path: readonly number[]
  readonly onSelectSpace: (spaceId: number) => void
}

export function MapPreview({ map, selectedSpaceId, path, onSelectSpace }: MapPreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const app = new Application()
    let cancelled = false
    let initialized = false
    let observer: ResizeObserver | undefined

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
        cellContainer.cursor = 'pointer'
        cellContainer.on('pointertap', () => onSelectSpace(space.index))
        const label = new Text({
          text: space.kind === 'event' ? '!' : String(space.index),
          style: { fontFamily: 'Microsoft YaHei', fontSize: 11, fill: space.kind === 'normal' ? 0x45483f : 0xffffff, fontWeight: '700' },
        })
        label.anchor.set(0.5)
        cellContainer.addChild(cell, label)
        world.addChild(cellContainer)
      }

      for (const landmark of map.landmarks) {
        const anchor = map.spaces.find((space) => space.index === landmark.spaceIds[0])
        if (!anchor) continue
        const x = landmark.x ?? anchor.x
        const y = landmark.y ?? anchor.y - 36
        const marker = new Container({ x, y })
        const badge = new Graphics().roundRect(-38, -14, 76, 28, 3).fill({ color: 0x3f463e, alpha: 0.92 })
        const label = new Text({ text: landmark.name, style: { fontFamily: 'Microsoft YaHei', fontSize: 12, fill: 0xffffff, fontWeight: '700' } })
        label.anchor.set(0.5)
        marker.addChild(badge, label)
        world.addChild(marker)
      }

      const resize = () => {
        const scale = Math.min(app.screen.width / map.logicalSize.width, app.screen.height / map.logicalSize.height)
        world.scale.set(scale)
        world.position.set((app.screen.width - map.logicalSize.width * scale) / 2, (app.screen.height - map.logicalSize.height * scale) / 2)
      }
      observer = new ResizeObserver(resize)
      observer.observe(host)
      resize()
    })

    return () => {
      cancelled = true
      observer?.disconnect()
      if (initialized && app.canvas.parentElement === host) host.removeChild(app.canvas)
      if (initialized) app.destroy(true, { children: true })
    }
  }, [map, onSelectSpace, path, selectedSpaceId])

  return <div className="map-preview-host" ref={hostRef} aria-label="Pixi 地图预览" />
}
