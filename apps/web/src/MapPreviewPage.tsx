import { ArrowLeft, Flag, MapPinned } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { DEFAULT_GAME_DEFINITION, DEFAULT_MAP_CONTENT, LANDMARK_DEFINITIONS } from '@goose-chess/game-content'
import { PixiBoard } from './scene/PixiBoard'

export function MapPreviewPage() {
  const { mapId } = useParams()

  if (mapId !== DEFAULT_MAP_CONTENT.id) {
    return (
      <main className="route-message-shell">
        <section className="route-message">
          <MapPinned />
          <span>棋盘地图</span>
          <h1>地图不可用</h1>
          <p>这个地图尚未加入当前内容版本。</p>
          <Link className="primary-button" to="/">返回准备</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="stage5-shell map-preview-shell">
      <header className="stage5-topbar map-preview-topbar">
        <div className="map-preview-title">
          <Link className="icon-command" to="/" title="返回准备" aria-label="返回准备"><ArrowLeft /></Link>
          <div className="stage5-brand">
            <span><MapPinned /></span>
            <div><strong>{DEFAULT_MAP_CONTENT.title}</strong><small>棋盘地图预览</small></div>
          </div>
        </div>
        <div className="map-preview-stats" aria-label="地图信息">
          <span><Flag />{DEFAULT_MAP_CONTENT.spaceCount - 1} 格路线</span>
          <span><MapPinned />{LANDMARK_DEFINITIONS.length} 处地标</span>
        </div>
      </header>
      <PixiBoard map={DEFAULT_GAME_DEFINITION.map} onReady={() => undefined} />
    </main>
  )
}
