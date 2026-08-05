import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  CirclePlus,
  Clock3,
  FilePlus2,
  Grid3X3,
  Hand,
  MapPinPlus,
  MapPinned,
  MousePointer2,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import type { MapDefinition } from '@goose-chess/game-core'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError, contentApi } from './api'
import { useAuth } from './auth-context'
import './map-styles.css'
import { MapPreview, type MapCanvasMode } from './MapPreview'
import { appendLocationAt, appendSpaceAt, createDefaultMap, csvValues, integerCsvValues, localMapIssues, mapFromUnknown, moveMarkerTo, moveSpaceTo, simulateMapPath } from './map-model'
import type { ContentDraft, DraftStatus } from './types'

const statusLabels: Record<DraftStatus, string> = {
  draft: '草稿',
  'in-review': '待审核',
  approved: '已通过',
  rejected: '已驳回',
  published: '已发布',
}

function messageFrom(cause: unknown) {
  if (cause instanceof ApiError) return cause.message
  return cause instanceof Error ? cause.message : '内容服务请求失败。'
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(timestamp)
}

function DraftList({ drafts, selectedId, loading, onRefresh }: {
  readonly drafts: readonly ContentDraft[]
  readonly selectedId?: string
  readonly loading: boolean
  readonly onRefresh: () => void
}) {
  const navigate = useNavigate()
  return (
    <aside className="draft-browser" aria-label="地图草稿">
      <div className="panel-heading"><div><small>MAP DRAFTS</small><strong>地图草稿</strong></div><button type="button" title="刷新草稿" aria-label="刷新地图草稿" onClick={onRefresh}><RefreshCw className={loading ? 'is-spinning' : ''} /></button></div>
      <button className="new-draft-button" type="button" onClick={() => navigate('/maps/new')}><FilePlus2 />新建地图</button>
      <div className="draft-list">
        {drafts.length === 0 && !loading ? <div className="empty-list"><span className="empty-mark">图</span><strong>还没有地图草稿</strong><span>从奥普港模板创建第一版</span></div> : null}
        {drafts.map((draft) => <button type="button" key={draft.id} className={draft.id === selectedId ? 'draft-row is-selected' : 'draft-row'} onClick={() => navigate(`/maps/${draft.id}`)}><span className={`status-dot status-${draft.status}`} /><span className="draft-row-copy"><strong>{draft.title}</strong><small>修订 {draft.currentRevision} · {formatTime(draft.updatedAt)}</small></span><span className={`status-label status-${draft.status}`}>{statusLabels[draft.status]}</span><ChevronRight /></button>)}
      </div>
    </aside>
  )
}

type Space = MapDefinition['spaces'][number]
type Marker = NonNullable<MapDefinition['markers']>[number]
type EventPool = NonNullable<MapDefinition['eventPools']>[number]

function MapForm({ map, selectedSpaceId, disabled, onSelectSpace, onChange }: {
  readonly map: MapDefinition
  readonly selectedSpaceId: number
  readonly disabled: boolean
  readonly onSelectSpace: (id: number) => void
  readonly onChange: (map: MapDefinition) => void
}) {
  const selected = map.spaces.find((space) => space.index === selectedSpaceId) ?? map.spaces[0]
  const markers = map.markers ?? []
  const eventPools = map.eventPools ?? []
  const patch = (values: Partial<MapDefinition>) => onChange({ ...map, ...values })
  const patchSpace = (values: Partial<Space>) => patch({ spaces: map.spaces.map((space) => space.index === selected.index ? { ...space, ...values } : space) })

  const syncLegacyLandmarks = (nextMarkers: readonly Marker[]) => map.landmarks.map((landmark) => {
    const marker = nextMarkers.find((candidate) => candidate.id === landmark.id)
    return marker ? {
      ...landmark,
      name: marker.name,
      spaceIds: marker.spaceIds,
      x: marker.transform.x,
      y: marker.transform.y,
      size: marker.transform.scale * 108,
    } : landmark
  })

  const patchMarker = (id: string, values: Partial<Marker>) => {
    const nextMarkers = markers.map((marker) => marker.id === id ? { ...marker, ...values } : marker)
    let spaces = map.spaces
    if (values.spaceIds) {
      spaces = map.spaces.map((space) => {
        if (values.spaceIds!.includes(space.index)) return { ...space, markerId: id, landmarkId: id }
        if ((space.markerId ?? space.landmarkId) === id) return { ...space, markerId: undefined, landmarkId: undefined }
        return space
      })
    }
    patch({ markers: nextMarkers, landmarks: syncLegacyLandmarks(nextMarkers), spaces })
  }

  const patchEventPool = (id: string, values: Partial<EventPool>) => patch({
    eventPools: eventPools.map((pool) => pool.id === id ? { ...pool, ...values } : pool),
  })

  function assignSpaceMarker(markerId: string) {
    const nextMarkers = markers.map((marker) => {
      const withoutSelected = marker.spaceIds.filter((spaceId) => spaceId !== selected.index)
      return marker.id === markerId
        ? { ...marker, spaceIds: [...withoutSelected, selected.index].sort((left, right) => left - right) }
        : { ...marker, spaceIds: withoutSelected }
    })
    patch({
      spaces: map.spaces.map((space) => space.index === selected.index
        ? { ...space, markerId: markerId || undefined, landmarkId: markerId || undefined }
        : space),
      markers: nextMarkers,
      landmarks: syncLegacyLandmarks(nextMarkers),
    })
  }

  function addSpace() {
    const previous = map.spaces.at(-1)
    const index = map.spaces.length
    patch({ spaces: [...map.spaces, { index, x: (previous?.x ?? 40) + 50, y: previous?.y ?? 80, rotation: 0, kind: 'normal' }] })
    onSelectSpace(index)
  }

  function removeLastSpace() {
    if (map.spaces.length <= 2) return
    const removed = map.spaces.length - 1
    const nextMarkers = markers.map((marker) => ({ ...marker, spaceIds: marker.spaceIds.filter((id) => id !== removed) }))
    patch({
      spaces: map.spaces.slice(0, -1),
      winningSpaceIds: map.winningSpaceIds.filter((id) => id !== removed),
      markers: nextMarkers,
      landmarks: syncLegacyLandmarks(nextMarkers),
    })
    onSelectSpace(Math.min(selectedSpaceId, removed - 1))
  }

  function addMarker() {
    const id = `location-${markers.length + 1}`
    const marker: Marker = {
      id,
      kind: 'location',
      name: '新地点',
      spaceIds: [],
      asset: '',
      transform: { x: selected.x, y: selected.y, scale: 1, rotation: 0 },
    }
    patch({
      markers: [...markers, marker],
      landmarks: [...map.landmarks, {
        id,
        name: marker.name,
        spaceIds: [],
        x: marker.transform.x,
        y: marker.transform.y,
        size: 108,
        pathIntegrated: true,
      }],
    })
  }

  function removeMarker(id: string) {
    const nextMarkers = markers.filter((marker) => marker.id !== id)
    patch({
      markers: nextMarkers,
      landmarks: map.landmarks.filter((landmark) => landmark.id !== id),
      spaces: map.spaces.map((space) => (space.markerId ?? space.landmarkId) === id
        ? { ...space, markerId: undefined, landmarkId: undefined }
        : space),
    })
  }

  function addEventPool() {
    const id = `pool-${eventPools.length + 1}`
    patch({ eventPools: [...eventPools, { id, name: '新事件池', eventIds: (map.allowedEventIds ?? []).slice(0, 3) }] })
  }

  function removeEventPool(id: string) {
    const referenced = markers.some((marker) => marker.eventPoolId === id)
      || map.spaces.some((space) => space.eventPoolId === id)
    if (referenced) return
    patch({ eventPools: eventPools.filter((pool) => pool.id !== id) })
  }

  return (
    <div className="map-form">
      <section className="form-section">
        <div className="section-title"><span>01</span><div><strong>地图基础</strong><small>内容标识与逻辑画布</small></div></div>
        <div className="form-grid map-basic-grid">
          <label><span>地图 ID</span><input value={map.id} disabled={disabled} onChange={(event) => patch({ id: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} /></label>
          <label><span>地图名称</span><input value={map.name} disabled={disabled} onChange={(event) => patch({ name: event.target.value })} /></label>
          <label><span>宽度</span><input type="number" min="320" value={map.logicalSize.width} disabled={disabled} onChange={(event) => patch({ logicalSize: { ...map.logicalSize, width: Number(event.target.value) } })} /></label>
          <label><span>高度</span><input type="number" min="240" value={map.logicalSize.height} disabled={disabled} onChange={(event) => patch({ logicalSize: { ...map.logicalSize, height: Number(event.target.value) } })} /></label>
        </div>
        <label><span>胜利格 ID</span><input value={map.winningSpaceIds.join(', ')} disabled={disabled} onChange={(event) => patch({ winningSpaceIds: integerCsvValues(event.target.value) })} /><small>使用英文逗号分隔；路径模拟会按核心折返规则处理终点。</small></label>
      </section>

      <section className="form-section">
        <div className="section-title"><span>02</span><div><strong>格子路径</strong><small>{map.spaces.length} 个连续格子</small></div></div>
        <div className="space-toolbar"><select value={selected.index} onChange={(event) => onSelectSpace(Number(event.target.value))}>{map.spaces.map((space) => <option key={space.index} value={space.index}>#{space.index} · {space.kind}</option>)}</select><button type="button" className="secondary-button" disabled={disabled} onClick={addSpace}><Plus />追加格子</button><button type="button" className="icon-danger" title="删除末格" aria-label="删除末格" disabled={disabled || map.spaces.length <= 2} onClick={removeLastSpace}><Trash2 /></button></div>
        <div className="form-grid space-property-grid">
          <label><span>X</span><input type="number" value={selected.x} disabled={disabled} onChange={(event) => patchSpace({ x: Number(event.target.value) })} /></label>
          <label><span>Y</span><input type="number" value={selected.y} disabled={disabled} onChange={(event) => patchSpace({ y: Number(event.target.value) })} /></label>
          <label><span>旋转</span><input type="number" value={selected.rotation} disabled={disabled} onChange={(event) => patchSpace({ rotation: Number(event.target.value) })} /></label>
          <label><span>类型</span><select value={selected.kind} disabled={disabled} onChange={(event) => patchSpace({ kind: event.target.value as Space['kind'] })}><option value="start">起点</option><option value="normal">普通</option><option value="event">事件</option><option value="finish">终点</option></select></label>
          <label><span>地图标记</span><select value={selected.markerId ?? selected.landmarkId ?? ''} disabled={disabled} onChange={(event) => assignSpaceMarker(event.target.value)}><option value="">无</option>{markers.map((marker) => <option key={marker.id} value={marker.id}>{marker.name}</option>)}</select></label>
          <label><span>事件池</span><select value={selected.eventPoolId ?? ''} disabled={disabled || selected.kind !== 'event'} onChange={(event) => patchSpace({ eventPoolId: event.target.value || undefined })}><option value="">继承地点 / 通用</option>{eventPools.map((pool) => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select></label>
        </div>
      </section>

      <section className="form-section">
        <div className="section-title"><span>03</span><div><strong>地图标记</strong><small>起点和终点不可关联事件池</small></div></div>
        <div className="space-toolbar"><button type="button" className="secondary-button" disabled={disabled} onClick={addMarker}><Plus />新增地点</button></div>
        <div className="landmark-editor-list">
          {markers.map((marker) => <div className="landmark-editor-row" key={marker.id}>
            <input aria-label={`${marker.name} ID`} value={marker.id} disabled />
            <select aria-label={`${marker.id} 类型`} value={marker.kind} disabled={disabled} onChange={(event) => {
              const kind = event.target.value as Marker['kind']
              patchMarker(marker.id, { kind, eventPoolId: kind === 'location' ? marker.eventPoolId : undefined })
            }}><option value="start">起点</option><option value="location">地点</option><option value="finish">终点</option></select>
            <input aria-label={`${marker.id} 名称`} value={marker.name} disabled={disabled} onChange={(event) => patchMarker(marker.id, { name: event.target.value })} />
            <input aria-label={`${marker.id} 格子`} value={marker.spaceIds.join(', ')} disabled={disabled} onChange={(event) => patchMarker(marker.id, { spaceIds: integerCsvValues(event.target.value) })} />
            <select aria-label={`${marker.id} 事件池`} value={marker.eventPoolId ?? ''} disabled={disabled || marker.kind !== 'location'} onChange={(event) => patchMarker(marker.id, { eventPoolId: event.target.value || undefined })}><option value="">请选择事件池</option>{eventPools.map((pool) => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select>
            <input aria-label={`${marker.id} X`} type="number" value={marker.transform.x} disabled={disabled} onChange={(event) => patchMarker(marker.id, { transform: { ...marker.transform, x: Number(event.target.value) } })} />
            <input aria-label={`${marker.id} Y`} type="number" value={marker.transform.y} disabled={disabled} onChange={(event) => patchMarker(marker.id, { transform: { ...marker.transform, y: Number(event.target.value) } })} />
            <input aria-label={`${marker.id} 缩放`} type="number" min="0.05" step="0.05" value={marker.transform.scale} disabled={disabled} onChange={(event) => patchMarker(marker.id, { transform: { ...marker.transform, scale: Number(event.target.value) } })} />
            <input aria-label={`${marker.id} 旋转`} type="number" value={marker.transform.rotation} disabled={disabled} onChange={(event) => patchMarker(marker.id, { transform: { ...marker.transform, rotation: Number(event.target.value) } })} />
            <input aria-label={`${marker.id} 贴图`} value={marker.asset} disabled={disabled} onChange={(event) => patchMarker(marker.id, { asset: event.target.value })} />
            <button type="button" className="icon-danger" title="删除地图标记" aria-label={`删除 ${marker.name}`} disabled={disabled} onClick={() => removeMarker(marker.id)}><Trash2 /></button>
          </div>)}
        </div>
      </section>

      <section className="form-section">
        <div className="section-title"><span>04</span><div><strong>语义事件池与资源</strong><small>事件池独立于地点，可被多个地点复用</small></div></div>
        <label><span>允许事件</span><textarea rows={2} value={(map.allowedEventIds ?? []).join(', ')} disabled={disabled} onChange={(event) => patch({ allowedEventIds: csvValues(event.target.value) })} /></label>
        <div className="space-toolbar"><button type="button" className="secondary-button" disabled={disabled} onClick={addEventPool}><Plus />新增事件池</button></div>
        <div className="event-pool-editor-list">{eventPools.map((pool) => {
          const referenced = markers.some((marker) => marker.eventPoolId === pool.id) || map.spaces.some((space) => space.eventPoolId === pool.id)
          return <div className="event-pool-editor-row" key={pool.id}>
            <input aria-label={`${pool.name} ID`} value={pool.id} disabled />
            <input aria-label={`${pool.id} 名称`} value={pool.name} disabled={disabled} onChange={(event) => patchEventPool(pool.id, { name: event.target.value })} />
            <textarea aria-label={`${pool.id} 事件`} rows={2} value={pool.eventIds.join(', ')} disabled={disabled} onChange={(event) => patchEventPool(pool.id, { eventIds: csvValues(event.target.value) })} />
            <button type="button" className="icon-danger" title={referenced ? '事件池仍被引用' : '删除事件池'} aria-label={`删除 ${pool.name}`} disabled={disabled || referenced} onClick={() => removeEventPool(pool.id)}><Trash2 /></button>
          </div>
        })}</div>
        <div className="form-grid two-columns"><label><span>棋盘背景</span><input value={map.assets.background} disabled={disabled} onChange={(event) => patch({ assets: { ...map.assets, background: event.target.value } })} /></label><label><span>标记图集</span><input value={map.assets.landmarkAtlas} disabled={disabled} onChange={(event) => patch({ assets: { ...map.assets, landmarkAtlas: event.target.value } })} /></label></div>
      </section>
    </div>
  )
}
function MapInspector({ map, selectedSpaceId, onSelectSpace, validation, editable, mode, snapToGrid, canUndo, canRedo, onModeChange, onSnapChange, onUndo, onRedo, onMapChange }: {
  readonly map: MapDefinition
  readonly selectedSpaceId: number
  readonly onSelectSpace: (id: number) => void
  readonly validation?: ContentDraft['validation']
  readonly editable: boolean
  readonly mode: MapCanvasMode
  readonly snapToGrid: boolean
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly onModeChange: (mode: MapCanvasMode) => void
  readonly onSnapChange: (enabled: boolean) => void
  readonly onUndo: () => void
  readonly onRedo: () => void
  readonly onMapChange: (map: MapDefinition) => void
}) {
  const [fromSpaceId, setFromSpaceId] = useState(0)
  const [distance, setDistance] = useState(6)
  const simulation = useMemo(() => {
    try { return simulateMapPath(map, fromSpaceId, distance) } catch { return null }
  }, [distance, fromSpaceId, map])
  const localIssues = useMemo(() => localMapIssues(map), [map])
  const select = useCallback((id: number) => onSelectSpace(id), [onSelectSpace])
  const addSpace = useCallback((point: { x: number; y: number }) => {
    const next = appendSpaceAt(map, point.x, point.y)
    onMapChange(next)
    onSelectSpace(next.spaces.length - 1)
  }, [map, onMapChange, onSelectSpace])
  const addLocation = useCallback((point: { x: number; y: number }) => {
    onMapChange(appendLocationAt(map, point.x, point.y))
  }, [map, onMapChange])
  const moveSpace = useCallback((spaceId: number, point: { x: number; y: number }) => {
    onMapChange(moveSpaceTo(map, spaceId, point.x, point.y))
    onSelectSpace(spaceId)
  }, [map, onMapChange, onSelectSpace])
  const moveMarker = useCallback((markerId: string, point: { x: number; y: number }) => {
    onMapChange(moveMarkerTo(map, markerId, point.x, point.y))
  }, [map, onMapChange])

  const modes: Array<{ id: MapCanvasMode; label: string; icon: typeof MousePointer2 }> = [
    { id: 'select', label: '选择', icon: MousePointer2 },
    { id: 'add-space', label: '添加格子', icon: Plus },
    { id: 'add-location', label: '添加地点', icon: MapPinPlus },
    { id: 'pan', label: '平移', icon: Hand },
  ]

  return (
    <aside className="map-inspector">
      <div className="panel-heading"><div><small>PIXI CANVAS</small><strong>地图画布</strong></div><MapPinned /></div>
      <div className="map-canvas-toolbar">
        <div className="canvas-mode-control" aria-label="画布工具">{modes.map((item) => {
          const Icon = item.icon
          return <button key={item.id} type="button" className={mode === item.id ? 'is-active' : ''} disabled={!editable && item.id !== 'pan'} title={item.label} aria-label={item.label} onClick={() => onModeChange(item.id)}><Icon /><span>{item.label}</span></button>
        })}</div>
        <div className="canvas-history-control">
          <button type="button" title="撤销" aria-label="撤销" disabled={!canUndo || !editable} onClick={onUndo}><Undo2 /></button>
          <button type="button" title="重做" aria-label="重做" disabled={!canRedo || !editable} onClick={onRedo}><Redo2 /></button>
          <label title="网格吸附"><input type="checkbox" checked={snapToGrid} onChange={(event) => onSnapChange(event.target.checked)} /><Grid3X3 /><span>吸附</span></label>
        </div>
      </div>
      <MapPreview map={map} selectedSpaceId={selectedSpaceId} path={simulation?.path ?? []} mode={editable ? mode : 'pan'} snapToGrid={snapToGrid} onSelectSpace={select} onAddSpace={addSpace} onAddLocation={addLocation} onMoveSpace={moveSpace} onMoveMarker={moveMarker} />
      <section className="path-simulator"><strong>固定路径模拟</strong><div><label><span>起点</span><input type="number" min="0" max={map.spaces.length - 1} value={fromSpaceId} onChange={(event) => setFromSpaceId(Number(event.target.value))} /></label><label><span>步数</span><input type="number" value={distance} onChange={(event) => setDistance(Number(event.target.value))} /></label></div>{simulation ? <p><span>终点 #{simulation.toSpaceId}</span><strong>{simulation.bounced ? '发生折返' : '未折返'}</strong><small>{simulation.path.join(' → ') || '原地'}</small></p> : <p className="form-error">起点或路径参数无效。</p>}</section>
      <section className={(validation?.valid ?? localIssues.length === 0) ? 'validation-panel is-valid' : 'validation-panel'}><div>{(validation?.valid ?? localIssues.length === 0) ? <CheckCircle2 /> : <AlertCircle />}<strong>{validation ? (validation.valid ? '服务端校验通过' : `${validation.issues.length} 项待修正`) : (localIssues.length ? `${localIssues.length} 项本地问题` : '核心地图校验通过')}</strong></div>{(validation?.issues.map((issue) => `${issue.path || 'content'}: ${issue.message}`) ?? localIssues).map((message) => <p key={message}><span>{message}</span></p>)}</section>
    </aside>
  )
}
export function MapWorkspace() {
  const { draftId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [drafts, setDrafts] = useState<ContentDraft[]>([])
  const [draft, setDraft] = useState<ContentDraft | null>(null)
  const [map, setMap] = useState<MapDefinition>(() => createDefaultMap())
  const [selectedSpaceId, setSelectedSpaceId] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reviewReason, setReviewReason] = useState('')
  const [canvasMode, setCanvasMode] = useState<MapCanvasMode>('select')
  const [snapToGrid, setSnapToGrid] = useState(true)
  const [historyAvailability, setHistoryAvailability] = useState({ canUndo: false, canRedo: false })
  const undoStack = useRef<MapDefinition[]>([])
  const redoStack = useRef<MapDefinition[]>([])

  const loadDrafts = useCallback(async () => {
    setLoading(true)
    try { setDrafts((await contentApi.listDrafts()).drafts.filter((item) => item.kind === 'map')) } catch (cause) { setError(messageFrom(cause)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void loadDrafts() }, [loadDrafts])
  useEffect(() => {
    let active = true
    setError(null); setNotice(null); setSelectedSpaceId(0); undoStack.current = []; redoStack.current = []; setHistoryAvailability({ canUndo: false, canRedo: false })
    if (!draftId || draftId === 'new') { setDraft(null); setMap(createDefaultMap()); setDirty(false); return () => { active = false } }
    void contentApi.getDraft(draftId).then(({ draft: loaded }) => { if (!active) return; setDraft(loaded); setMap(mapFromUnknown(loaded.content)); setDirty(false) }).catch((cause) => { if (active) setError(messageFrom(cause)) })
    return () => { active = false }
  }, [draftId])

  function updateDraft(next: ContentDraft) {
    setDraft(next); setMap(mapFromUnknown(next.content)); setDirty(false); undoStack.current = []; redoStack.current = []; setHistoryAvailability({ canUndo: false, canRedo: false })
    setDrafts((current) => [next, ...current.filter((item) => item.id !== next.id)])
  }
  async function save() {
    if (!map.id.trim() || !map.name.trim()) { setError('保存前必须填写地图 ID 和名称。'); return }
    setBusy(true); setError(null)
    try {
      const response = draft ? await contentApi.updateMap(draft.id, draft.currentRevision, map.name, map) : await contentApi.createMap(map.name, map)
      updateDraft(response.draft); setNotice(`修订 ${response.draft.currentRevision} 已保存并完成自动校验。`)
      if (!draft) navigate(`/maps/${response.draft.id}`, { replace: true })
    } catch (cause) { setError(messageFrom(cause)) } finally { setBusy(false) }
  }
  async function transition(action: 'submit' | 'approve' | 'reject' | 'publish') {
    if (!draft) return
    setBusy(true); setError(null)
    try {
      if (action === 'submit') { updateDraft((await contentApi.submitDraft(draft.id)).draft); setNotice('地图草稿已提交管理员审核。') }
      else if (action === 'publish') { const { release } = await contentApi.publishDraft(draft.id); updateDraft((await contentApi.getDraft(draft.id)).draft); setNotice(`已发布不可变版本 ${release.version}。`) }
      else { updateDraft((await contentApi.reviewDraft(draft.id, action === 'approve' ? 'approve' : 'reject', reviewReason)).draft); setNotice(action === 'approve' ? '审核已通过，可以发布。' : '地图草稿已驳回编辑。'); setReviewReason('') }
    } catch (cause) { setError(messageFrom(cause)) } finally { setBusy(false) }
  }

  const editable = !draft || draft.status === 'draft' || draft.status === 'rejected'
  const activeId = draftId === 'new' ? undefined : draftId
  const changeMap = useCallback((next: MapDefinition) => {
    setMap((current) => {
      undoStack.current.push(current)
      if (undoStack.current.length > 50) undoStack.current.shift()
      redoStack.current = []
      return next
    })
    setDirty(true)
    setNotice(null)
    setHistoryAvailability({ canUndo: true, canRedo: false })
  }, [])
  const undo = useCallback(() => {
    const previous = undoStack.current.pop()
    if (!previous) return
    setMap((current) => { redoStack.current.push(current); return previous })
    setDirty(true)
    setHistoryAvailability({ canUndo: undoStack.current.length > 0, canRedo: true })
  }, [])
  const redo = useCallback(() => {
    const next = redoStack.current.pop()
    if (!next) return
    setMap((current) => { undoStack.current.push(current); return next })
    setDirty(true)
    setHistoryAvailability({ canUndo: true, canRedo: redoStack.current.length > 0 })
  }, [])
  return (
    <div className="map-workspace">
      <DraftList drafts={drafts} selectedId={activeId} loading={loading} onRefresh={() => void loadDrafts()} />
      {!draftId ? <main className="workspace-empty"><CirclePlus /><strong>选择或创建地图草稿</strong><p>编辑路径、地标和事件池，并在发布前完成核心规则校验与游戏内预览。</p><button className="primary-button" type="button" onClick={() => navigate('/maps/new')}><FilePlus2 />新建地图</button></main> : <main className="editor-panel map-editor-panel"><header className="editor-toolbar"><div><small>{draft ? draft.contentKey : 'NEW MAP'}</small><strong>{map.name || '新地图草稿'}</strong></div><div className="toolbar-meta">{draft ? <><span className={`status-label status-${draft.status}`}>{statusLabels[draft.status]}</span><span>修订 {draft.currentRevision}</span></> : <span>基于奥普港模板</span>}</div><div className="toolbar-actions">{dirty ? <span className="unsaved-indicator"><Clock3 />未保存</span> : null}{editable ? <button className="primary-button" type="button" disabled={busy || (!dirty && Boolean(draft))} onClick={() => void save()}><Save />保存修订</button> : null}{draft && (draft.status === 'draft' || draft.status === 'rejected') ? <button className="secondary-button" type="button" disabled={busy || dirty || !draft.validation.valid} onClick={() => void transition('submit')}><Send />提交审核</button> : null}{draft?.status === 'in-review' && user?.role === 'admin' ? <><button className="secondary-button success-button" type="button" disabled={busy} onClick={() => void transition('approve')}><Check />通过</button><button className="secondary-button danger-button" type="button" disabled={busy || !reviewReason.trim()} onClick={() => void transition('reject')}><X />驳回</button></> : null}{draft?.status === 'approved' && user?.role === 'admin' ? <button className="primary-button" type="button" disabled={busy} onClick={() => void transition('publish')}><ShieldCheck />发布版本</button> : null}</div></header>{draft?.status === 'in-review' && user?.role === 'admin' ? <label className="review-reason"><span>驳回原因</span><input value={reviewReason} placeholder="驳回时必填" onChange={(event) => setReviewReason(event.target.value)} /></label> : null}{error ? <div className="notice-banner is-error"><AlertCircle />{error}</div> : null}{notice ? <div className="notice-banner is-success"><CheckCircle2 />{notice}</div> : null}<div className="editor-scroll"><MapForm map={map} selectedSpaceId={selectedSpaceId} disabled={!editable || busy} onSelectSpace={setSelectedSpaceId} onChange={changeMap} /></div></main>}
      {draftId ? <MapInspector map={map} selectedSpaceId={selectedSpaceId} onSelectSpace={setSelectedSpaceId} validation={draft?.validation} editable={editable && !busy} mode={canvasMode} snapToGrid={snapToGrid} canUndo={historyAvailability.canUndo} canRedo={historyAvailability.canRedo} onModeChange={setCanvasMode} onSnapChange={setSnapToGrid} onUndo={undo} onRedo={redo} onMapChange={changeMap} /> : null}
    </div>
  )
}
