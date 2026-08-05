import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, CheckCircle2, ChevronRight, CirclePlus, Clock3, FileImage, FilePlus2, Grid3X3, Hand, MapPinned, MousePointer2, Plus, Redo2, RefreshCw, Save, Send, ShieldCheck, Trash2, Undo2, X } from 'lucide-react'
import type { MapDefinition } from '@goose-chess/game-core'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError, contentApi } from './api'
import { useAuth } from './auth-context'
import './map-styles.css'
import { MapPreview, type MapCanvasMode } from './MapPreview'
import { appendLocationAt, appendSpaceAt, createDefaultMap, csvValues, integerCsvValues, localMapIssues, mapFromUnknown, moveMarkerTo, moveSpaceTo, simulateMapPath, transformMarker } from './map-model'
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
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function DraftList({ drafts, selectedId, loading, onRefresh, onDelete }: { readonly drafts: readonly ContentDraft[]; readonly selectedId?: string; readonly loading: boolean; readonly onRefresh: () => void; readonly onDelete: (draft: ContentDraft) => void }) {
  const navigate = useNavigate()
  return (
    <aside className="draft-browser" aria-label="地图草稿">
      <div className="panel-heading">
        <div>
          <small>MAP DRAFTS</small>
          <strong>地图草稿</strong>
        </div>
        <button type="button" title="刷新草稿" aria-label="刷新地图草稿" onClick={onRefresh}>
          <RefreshCw className={loading ? 'is-spinning' : ''} />
        </button>
      </div>
      <button className="new-draft-button" type="button" onClick={() => navigate('/maps/new')}>
        <FilePlus2 />
        新建地图
      </button>
      <div className="draft-list">
        {drafts.length === 0 && !loading ? (
          <div className="empty-list">
            <span className="empty-mark">图</span>
            <strong>还没有地图草稿</strong>
            <span>从奥普港模板创建第一版</span>
          </div>
        ) : null}
        {drafts.map((draft) => (
          <div key={draft.id} className={draft.id === selectedId ? 'draft-row-shell is-selected' : 'draft-row-shell'}>
            <button type="button" className="draft-row draft-row-open" onClick={() => navigate(`/maps/${draft.id}`)}>
              <span className={`status-dot status-${draft.status}`} />
              <span className="draft-row-copy">
                <strong>{draft.title}</strong>
                <small>
                  修订 {draft.currentRevision} · {formatTime(draft.updatedAt)}
                </small>
              </span>
              <span className={`status-label status-${draft.status}`}>{statusLabels[draft.status]}</span>
              <ChevronRight />
            </button>
            {['draft', 'rejected'].includes(draft.status) ? (
              <button type="button" className="draft-delete-button" title="删除草稿" aria-label={`删除草稿 ${draft.title}`} onClick={() => onDelete(draft)}>
                <Trash2 />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </aside>
  )
}

type Space = MapDefinition['spaces'][number]
type Marker = NonNullable<MapDefinition['markers']>[number]

function syncLegacyLandmarks(map: MapDefinition, nextMarkers: readonly Marker[]) {
  return map.landmarks.map((landmark) => {
    const marker = nextMarkers.find((candidate) => candidate.id === landmark.id)
    return marker
      ? {
          ...landmark,
          name: marker.name,
          spaceIds: marker.spaceIds,
          x: marker.transform.x,
          y: marker.transform.y,
          size: marker.transform.scale * 108,
        }
      : landmark
  })
}

function MapBasics({ map, disabled, onChange }: { readonly map: MapDefinition; readonly disabled: boolean; readonly onChange: (map: MapDefinition) => void }) {
  const patch = (values: Partial<MapDefinition>) => onChange({ ...map, ...values })
  return (
    <section className="map-basics">
      <div className="section-title">
        <span>01</span>
        <div>
          <strong>地图基础</strong>
          <small>内容标识与逻辑画布</small>
        </div>
      </div>
      <div className="form-grid map-basic-grid">
        <label>
          <span>地图 ID</span>
          <input
            value={map.id}
            disabled={disabled}
            onChange={(event) =>
              patch({
                id: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
              })
            }
          />
        </label>
        <label>
          <span>地图名称</span>
          <input value={map.name} disabled={disabled} onChange={(event) => patch({ name: event.target.value })} />
        </label>
        <label>
          <span>宽度</span>
          <input
            type="number"
            min="320"
            value={map.logicalSize.width}
            disabled={disabled}
            onChange={(event) =>
              patch({
                logicalSize: {
                  ...map.logicalSize,
                  width: Number(event.target.value),
                },
              })
            }
          />
        </label>
        <label>
          <span>高度</span>
          <input
            type="number"
            min="240"
            value={map.logicalSize.height}
            disabled={disabled}
            onChange={(event) =>
              patch({
                logicalSize: {
                  ...map.logicalSize,
                  height: Number(event.target.value),
                },
              })
            }
          />
        </label>
      </div>
    </section>
  )
}

function MapCanvasWorkspace({ map, selectedSpaceId, selectedMarkerId, path, editable, mode, pendingMarkerAsset, snapToGrid, canUndo, canRedo, onSelectSpace, onSelectMarker, onChooseMarkerAsset, onModeChange, onSnapChange, onUndo, onRedo, onMapChange }: { readonly map: MapDefinition; readonly selectedSpaceId: number | null; readonly selectedMarkerId: string | null; readonly path: readonly number[]; readonly editable: boolean; readonly mode: MapCanvasMode; readonly pendingMarkerAsset: string | null; readonly snapToGrid: boolean; readonly canUndo: boolean; readonly canRedo: boolean; readonly onModeChange: (mode: MapCanvasMode) => void; readonly onChooseMarkerAsset: (file: File) => void; readonly onSnapChange: (enabled: boolean) => void; readonly onUndo: () => void; readonly onRedo: () => void; readonly onSelectSpace: (id: number | null) => void; readonly onSelectMarker: (id: string | null) => void; readonly onMapChange: (map: MapDefinition) => void }) {
  const select = useCallback(
    (id: number) => {
      onSelectMarker(null)
      onSelectSpace(id)
    },
    [onSelectMarker, onSelectSpace],
  )
  const addSpace = useCallback(
    (point: { x: number; y: number }) => {
      const next = appendSpaceAt(map, point.x, point.y)
      onMapChange(next)
      onSelectSpace(next.spaces.length - 1)
    },
    [map, onMapChange, onSelectSpace],
  )
  const addLocation = useCallback(
    (point: { x: number; y: number }) => {
      if (!pendingMarkerAsset) return
      const next = appendLocationAt(map, point.x, point.y, pendingMarkerAsset)
      onMapChange(next)
      onSelectSpace(null)
      onSelectMarker(next.markers?.at(-1)?.id ?? null)
      onModeChange('select')
    },
    [map, onMapChange, onModeChange, onSelectMarker, onSelectSpace, pendingMarkerAsset],
  )
  const moveSpace = useCallback(
    (spaceId: number, point: { x: number; y: number }) => {
      onMapChange(moveSpaceTo(map, spaceId, point.x, point.y))
      onSelectSpace(spaceId)
    },
    [map, onMapChange, onSelectSpace],
  )
  const moveMarker = useCallback(
    (markerId: string, point: { x: number; y: number }) => {
      onMapChange(moveMarkerTo(map, markerId, point.x, point.y))
    },
    [map, onMapChange],
  )
  const changeMarkerTransform = useCallback(
    (markerId: string, values: { scale?: number; rotation?: number }) => {
      onMapChange(transformMarker(map, markerId, values))
    },
    [map, onMapChange],
  )

  const modes: Array<{
    id: MapCanvasMode
    label: string
    icon: typeof MousePointer2
  }> = [
    { id: 'select', label: '选择', icon: MousePointer2 },
    { id: 'add-space', label: '添加格子', icon: Plus },
    { id: 'pan', label: '平移', icon: Hand },
  ]

  return (
    <section className="map-canvas-workspace">
      <div className="panel-heading">
        <div>
          <small>PIXI CANVAS</small>
          <strong>地图画布</strong>
        </div>
        <MapPinned />
      </div>
      <div className="map-canvas-toolbar">
        <div className="canvas-mode-control" aria-label="画布工具">
          {modes.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.id} type="button" className={mode === item.id ? 'is-active' : ''} disabled={!editable && item.id !== 'pan'} title={item.label} aria-label={item.label} onClick={() => onModeChange(item.id)}>
                <Icon />
                <span>{item.label}</span>
              </button>
            )
          })}
          <label className={mode === 'add-marker' ? 'canvas-upload-button is-active' : 'canvas-upload-button'} title="添加贴图">
            <FileImage />
            <span>{mode === 'add-marker' ? '点击画布放置' : '添加贴图'}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" disabled={!editable} onChange={(event) => { const file = event.target.files?.[0]; if (file) onChooseMarkerAsset(file); event.target.value = '' }} />
          </label>
        </div>
        <div className="canvas-history-control">
          <button type="button" title="撤销" aria-label="撤销" disabled={!canUndo || !editable} onClick={onUndo}>
            <Undo2 />
          </button>
          <button type="button" title="重做" aria-label="重做" disabled={!canRedo || !editable} onClick={onRedo}>
            <Redo2 />
          </button>
          <label title="网格吸附">
            <input type="checkbox" checked={snapToGrid} onChange={(event) => onSnapChange(event.target.checked)} />
            <Grid3X3 />
            <span>吸附</span>
          </label>
        </div>
      </div>
      <MapPreview
        map={map}
        selectedSpaceId={selectedSpaceId}
        selectedMarkerId={selectedMarkerId}
        path={path}
        mode={editable ? mode : 'pan'}
        snapToGrid={snapToGrid}
        onSelectSpace={select}
        onSelectMarker={(id) => {
          onSelectSpace(null)
          onSelectMarker(id)
        }}
        onClearSelection={() => {
          onSelectSpace(null)
          onSelectMarker(null)
        }}
        onAddSpace={addSpace}
        onAddLocation={addLocation}
        onMoveSpace={moveSpace}
        onMoveMarker={moveMarker}
        onTransformMarker={changeMarkerTransform}
      />
    </section>
  )
}

function MapPropertyPanel({ map, selectedSpaceId, selectedMarkerId, validation, editable, fromSpaceId, distance, onFromSpaceChange, onDistanceChange, onChange, onClearMarker }: { readonly map: MapDefinition; readonly selectedSpaceId: number | null; readonly selectedMarkerId: string | null; readonly validation?: ContentDraft['validation']; readonly editable: boolean; readonly fromSpaceId: number; readonly distance: number; readonly onFromSpaceChange: (value: number) => void; readonly onDistanceChange: (value: number) => void; readonly onChange: (map: MapDefinition) => void; readonly onClearMarker: () => void }) {
  const markers = map.markers ?? []
  const eventPools = map.eventPools ?? []
  const selectedSpace = selectedSpaceId === null ? null : (map.spaces.find((space) => space.index === selectedSpaceId) ?? null)
  const selectedMarker = selectedMarkerId ? (markers.find((marker) => marker.id === selectedMarkerId) ?? null) : null
  const patch = (values: Partial<MapDefinition>) => onChange({ ...map, ...values })
  const patchMarker = (marker: Marker, values: Partial<Marker>) => {
    const nextMarkers = markers.map((candidate) => (candidate.id === marker.id ? { ...candidate, ...values } : candidate))
    let spaces = map.spaces
    if (values.spaceIds) spaces = map.spaces.map((space) => (values.spaceIds!.includes(space.index) ? { ...space, markerId: marker.id, landmarkId: marker.id } : (space.markerId ?? space.landmarkId) === marker.id ? { ...space, markerId: undefined, landmarkId: undefined } : space))
    patch({
      markers: nextMarkers,
      landmarks: syncLegacyLandmarks(map, nextMarkers),
      spaces,
    })
  }
  const assignSpaceMarker = (space: Space, markerId: string) => {
    const nextMarkers = markers.map((marker) => ({
      ...marker,
      spaceIds: marker.id === markerId ? [...marker.spaceIds.filter((id) => id !== space.index), space.index].sort((a, b) => a - b) : marker.spaceIds.filter((id) => id !== space.index),
    }))
    patch({
      spaces: map.spaces.map((candidate) =>
        candidate.index === space.index
          ? {
              ...candidate,
              markerId: markerId || undefined,
              landmarkId: markerId || undefined,
            }
          : candidate,
      ),
      markers: nextMarkers,
      landmarks: syncLegacyLandmarks(map, nextMarkers),
    })
  }
  const simulation = useMemo(() => {
    try {
      return simulateMapPath(map, fromSpaceId, distance)
    } catch {
      return null
    }
  }, [distance, fromSpaceId, map])
  const localIssues = useMemo(() => localMapIssues(map), [map])
  const removeMarker = (marker: Marker) => {
    patch({
      markers: markers.filter((item) => item.id !== marker.id),
      landmarks: map.landmarks.filter((item) => item.id !== marker.id),
      spaces: map.spaces.map((space) => ((space.markerId ?? space.landmarkId) === marker.id ? { ...space, markerId: undefined, landmarkId: undefined } : space)),
    })
    onClearMarker()
  }
  return (
    <aside className="map-property-panel">
      <div className="panel-heading">
        <div>
          <small>PROPERTIES</small>
          <strong>{selectedMarker ? '贴图属性' : selectedSpace ? `格子 #${selectedSpace.index}` : '地图属性'}</strong>
        </div>
      </div>
      <div className="property-scroll">
        {selectedSpace ? (
          <section className="property-section">
            <div className="property-grid">
              <label>
                <span>格号</span>
                <input value={selectedSpace.index} disabled />
              </label>
              <label>
                <span>类型</span>
                <select
                  value={selectedSpace.kind}
                  disabled={!editable}
                  onChange={(event) => {
                    const kind = event.target.value as Space['kind']
                    patch({
                      spaces: map.spaces.map((space) => (space.index === selectedSpace.index ? { ...space, kind } : space)),
                      winningSpaceIds:
                        kind === 'finish'
                          ? [...new Set([...map.winningSpaceIds, selectedSpace.index])].sort((a, b) => a - b)
                          : map.winningSpaceIds.filter((id) => id !== selectedSpace.index),
                    })
                  }}
                >
                  <option value="start">起点</option>
                  <option value="normal">普通</option>
                  <option value="event">事件</option>
                  <option value="finish">终点</option>
                </select>
              </label>
              <label>
                <span>X</span>
                <input type="number" value={selectedSpace.x} disabled={!editable} onChange={(event) => onChange(moveSpaceTo(map, selectedSpace.index, Number(event.target.value), selectedSpace.y))} />
              </label>
              <label>
                <span>Y</span>
                <input type="number" value={selectedSpace.y} disabled={!editable} onChange={(event) => onChange(moveSpaceTo(map, selectedSpace.index, selectedSpace.x, Number(event.target.value)))} />
              </label>
              <label>
                <span>旋转</span>
                <input
                  type="number"
                  value={selectedSpace.rotation}
                  disabled={!editable}
                  onChange={(event) =>
                    patch({
                      spaces: map.spaces.map((space) => (space.index === selectedSpace.index ? { ...space, rotation: Number(event.target.value) } : space)),
                    })
                  }
                />
              </label>
              <label>
                <span>地图标记</span>
                <select value={selectedSpace.markerId ?? selectedSpace.landmarkId ?? ''} disabled={!editable} onChange={(event) => assignSpaceMarker(selectedSpace, event.target.value)}>
                  <option value="">无</option>
                  {markers.map((marker) => (
                    <option key={marker.id} value={marker.id}>
                      {marker.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="property-wide">
                <span>事件池</span>
                <select
                  value={selectedSpace.eventPoolId ?? ''}
                  disabled={!editable || selectedSpace.kind !== 'event'}
                  onChange={(event) =>
                    patch({
                      spaces: map.spaces.map((space) =>
                        space.index === selectedSpace.index
                          ? {
                              ...space,
                              eventPoolId: event.target.value || undefined,
                            }
                          : space,
                      ),
                    })
                  }
                >
                  <option value="">继承地点 / 通用</option>
                  {eventPools.map((pool) => (
                    <option key={pool.id} value={pool.id}>
                      {pool.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        ) : selectedMarker ? (
          <section className="property-section">
            <div className="property-grid">
              <label className="property-wide">
                <span>标记 ID</span>
                <input value={selectedMarker.id} disabled />
              </label>
              <label>
                <span>类型</span>
                <select
                  value={selectedMarker.kind}
                  disabled={!editable}
                  onChange={(event) => {
                    const kind = event.target.value as Marker['kind']
                    patchMarker(selectedMarker, {
                      kind,
                      eventPoolId: kind === 'location' ? selectedMarker.eventPoolId : undefined,
                    })
                  }}
                >
                  <option value="start">起点</option>
                  <option value="location">地点</option>
                  <option value="finish">终点</option>
                </select>
              </label>
              <label>
                <span>名称</span>
                <input value={selectedMarker.name} disabled={!editable} onChange={(event) => patchMarker(selectedMarker, { name: event.target.value })} />
              </label>
              <label className="property-wide">
                <span>关联格子</span>
                <input
                  value={selectedMarker.spaceIds.join(', ')}
                  disabled={!editable}
                  onChange={(event) =>
                    patchMarker(selectedMarker, {
                      spaceIds: integerCsvValues(event.target.value),
                    })
                  }
                />
              </label>
              <label className="property-wide">
                <span>事件池</span>
                <select
                  value={selectedMarker.eventPoolId ?? ''}
                  disabled={!editable || selectedMarker.kind !== 'location'}
                  onChange={(event) =>
                    patchMarker(selectedMarker, {
                      eventPoolId: event.target.value || undefined,
                    })
                  }
                >
                  <option value="">请选择事件池</option>
                  {eventPools.map((pool) => (
                    <option key={pool.id} value={pool.id}>
                      {pool.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>X</span>
                <input
                  type="number"
                  value={selectedMarker.transform.x}
                  disabled={!editable}
                  onChange={(event) =>
                    onChange(
                      transformMarker(map, selectedMarker.id, {
                        x: Number(event.target.value),
                      }),
                    )
                  }
                />
              </label>
              <label>
                <span>Y</span>
                <input
                  type="number"
                  value={selectedMarker.transform.y}
                  disabled={!editable}
                  onChange={(event) =>
                    onChange(
                      transformMarker(map, selectedMarker.id, {
                        y: Number(event.target.value),
                      }),
                    )
                  }
                />
              </label>
              <label>
                <span>缩放</span>
                <input
                  type="number"
                  min="0.05"
                  step="0.05"
                  value={selectedMarker.transform.scale}
                  disabled={!editable}
                  onChange={(event) =>
                    onChange(
                      transformMarker(map, selectedMarker.id, {
                        scale: Number(event.target.value),
                      }),
                    )
                  }
                />
              </label>
              <label>
                <span>旋转</span>
                <input
                  type="number"
                  value={selectedMarker.transform.rotation}
                  disabled={!editable}
                  onChange={(event) =>
                    onChange(
                      transformMarker(map, selectedMarker.id, {
                        rotation: Number(event.target.value),
                      }),
                    )
                  }
                />
              </label>
              <label className="property-wide">
                <span>贴图</span>
                <input value={selectedMarker.asset} disabled={!editable} onChange={(event) => patchMarker(selectedMarker, { asset: event.target.value })} />
              </label>
            </div>
            <button type="button" className="property-delete" disabled={!editable} onClick={() => removeMarker(selectedMarker)}>
              <Trash2 />
              删除地图标记
            </button>
          </section>
        ) : (
          <section className="property-section">
            <label>
              <span>允许事件</span>
              <textarea rows={3} value={(map.allowedEventIds ?? []).join(', ')} disabled={!editable} onChange={(event) => patch({ allowedEventIds: csvValues(event.target.value) })} />
            </label>
            <label>
              <span>棋盘背景</span>
              <input
                value={map.assets.background}
                disabled={!editable}
                onChange={(event) =>
                  patch({
                    assets: { ...map.assets, background: event.target.value },
                  })
                }
              />
            </label>
            <label>
              <span>标记图集</span>
              <input
                value={map.assets.landmarkAtlas}
                disabled={!editable}
                onChange={(event) =>
                  patch({
                    assets: {
                      ...map.assets,
                      landmarkAtlas: event.target.value,
                    },
                  })
                }
              />
            </label>
            <div className="event-pool-compact">
              <div className="property-subheading">
                <strong>事件池</strong>
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() =>
                    patch({
                      eventPools: [
                        ...eventPools,
                        {
                          id: `pool-${eventPools.length + 1}`,
                          name: '新事件池',
                          eventIds: (map.allowedEventIds ?? []).slice(0, 3),
                        },
                      ],
                    })
                  }
                >
                  <Plus />
                  新增
                </button>
              </div>
              {eventPools.map((pool) => (
                <div key={pool.id} className="event-pool-compact-row">
                  <input
                    value={pool.name}
                    disabled={!editable}
                    onChange={(event) =>
                      patch({
                        eventPools: eventPools.map((item) => (item.id === pool.id ? { ...item, name: event.target.value } : item)),
                      })
                    }
                  />
                  <textarea
                    rows={2}
                    value={pool.eventIds.join(', ')}
                    disabled={!editable}
                    onChange={(event) =>
                      patch({
                        eventPools: eventPools.map((item) =>
                          item.id === pool.id
                            ? {
                                ...item,
                                eventIds: csvValues(event.target.value),
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </section>
        )}
        <section className="path-simulator">
          <strong>固定路径模拟</strong>
          <div>
            <label>
              <span>起点</span>
              <input type="number" min="0" max={map.spaces.length - 1} value={fromSpaceId} onChange={(event) => onFromSpaceChange(Number(event.target.value))} />
            </label>
            <label>
              <span>步数</span>
              <input type="number" value={distance} onChange={(event) => onDistanceChange(Number(event.target.value))} />
            </label>
          </div>
          {simulation ? (
            <p>
              <span>终点 #{simulation.toSpaceId}</span>
              <strong>{simulation.bounced ? '发生折返' : '未折返'}</strong>
              <small>{simulation.path.join(' → ') || '原地'}</small>
            </p>
          ) : (
            <p className="form-error">起点或路径参数无效。</p>
          )}
        </section>
        {!(validation?.valid ?? localIssues.length === 0) ? (
          <section className="validation-panel">
            <div>
              <AlertCircle />
              <strong>{validation ? `${validation.issues.length} 项待修正` : `${localIssues.length} 项本地问题`}</strong>
            </div>
            {(validation?.issues.map((issue) => `${issue.path || 'content'}: ${issue.message}`) ?? localIssues).map((message) => (
              <p key={message}>
                <span>{message}</span>
              </p>
            ))}
          </section>
        ) : null}
      </div>
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
  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(null)
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null)
  const [fromSpaceId, setFromSpaceId] = useState(0)
  const [distance, setDistance] = useState(6)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reviewReason, setReviewReason] = useState('')
  const [canvasMode, setCanvasMode] = useState<MapCanvasMode>('select')
  const [pendingMarkerAsset, setPendingMarkerAsset] = useState<string | null>(null)
  const [snapToGrid, setSnapToGrid] = useState(true)
  const [historyAvailability, setHistoryAvailability] = useState({
    canUndo: false,
    canRedo: false,
  })
  const undoStack = useRef<MapDefinition[]>([])
  const redoStack = useRef<MapDefinition[]>([])

  const loadDrafts = useCallback(async () => {
    setLoading(true)
    try {
      setDrafts((await contentApi.listDrafts()).drafts.filter((item) => item.kind === 'map'))
    } catch (cause) {
      setError(messageFrom(cause))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void loadDrafts()
  }, [loadDrafts])
  useEffect(() => {
    let active = true
    setError(null)
    setNotice(null)
    setSelectedSpaceId(null)
    setSelectedMarkerId(null)
    setPendingMarkerAsset(null)
    undoStack.current = []
    redoStack.current = []
    setHistoryAvailability({ canUndo: false, canRedo: false })
    if (!draftId || draftId === 'new') {
      setDraft(null)
      setMap(createDefaultMap())
      setDirty(false)
      return () => {
        active = false
      }
    }
    void contentApi
      .getDraft(draftId)
      .then(({ draft: loaded }) => {
        if (!active) return
        setDraft(loaded)
        setMap(mapFromUnknown(loaded.content))
        setDirty(false)
      })
      .catch((cause) => {
        if (active) setError(messageFrom(cause))
      })
    return () => {
      active = false
    }
  }, [draftId])

  function updateDraft(next: ContentDraft) {
    setDraft(next)
    setMap(mapFromUnknown(next.content))
    setDirty(false)
    undoStack.current = []
    redoStack.current = []
    setHistoryAvailability({ canUndo: false, canRedo: false })
    setDrafts((current) => [next, ...current.filter((item) => item.id !== next.id)])
  }
  async function save() {
    if (!map.id.trim() || !map.name.trim()) {
      setError('保存前必须填写地图 ID 和名称。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const response = draft ? await contentApi.updateMap(draft.id, draft.currentRevision, map.name, map) : await contentApi.createMap(map.name, map)
      updateDraft(response.draft)
      setNotice(`修订 ${response.draft.currentRevision} 已保存并完成自动校验。`)
      if (!draft) navigate(`/maps/${response.draft.id}`, { replace: true })
    } catch (cause) {
      setError(messageFrom(cause))
    } finally {
      setBusy(false)
    }
  }
  async function transition(action: 'submit' | 'approve' | 'reject' | 'publish') {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      if (action === 'submit') {
        updateDraft((await contentApi.submitDraft(draft.id)).draft)
        setNotice('地图草稿已提交管理员审核。')
      } else if (action === 'publish') {
        const { release } = await contentApi.publishDraft(draft.id)
        updateDraft((await contentApi.getDraft(draft.id)).draft)
        setNotice(`已发布不可变版本 ${release.version}。`)
      } else {
        updateDraft((await contentApi.reviewDraft(draft.id, action === 'approve' ? 'approve' : 'reject', reviewReason)).draft)
        setNotice(action === 'approve' ? '审核已通过，可以发布。' : '地图草稿已驳回编辑。')
        setReviewReason('')
      }
    } catch (cause) {
      setError(messageFrom(cause))
    } finally {
      setBusy(false)
    }
  }
  async function deleteDraft(target: ContentDraft) {
    if (!window.confirm(`确定删除地图草稿“${target.title}”吗？此操作不可撤销。`)) return
    setBusy(true)
    setError(null)
    try {
      await contentApi.deleteDraft(target.id)
      setDrafts((current) => current.filter((item) => item.id !== target.id))
      if (draftId === target.id) navigate('/maps', { replace: true })
      else setNotice(`已删除地图草稿“${target.title}”。`)
    } catch (cause) {
      setError(messageFrom(cause))
    } finally {
      setBusy(false)
    }
  }

  async function chooseMarkerAsset(file: File) {
    setBusy(true)
    setError(null)
    try {
      const { asset } = await contentApi.uploadAsset(file)
      setPendingMarkerAsset(asset.url)
      setCanvasMode('add-marker')
      setNotice('贴图已上传，请在画布上点击放置。')
    } catch (cause) {
      setError(messageFrom(cause))
    } finally {
      setBusy(false)
    }
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
    setMap((current) => {
      redoStack.current.push(current)
      return previous
    })
    setDirty(true)
    setHistoryAvailability({
      canUndo: undoStack.current.length > 0,
      canRedo: true,
    })
  }, [])
  const redo = useCallback(() => {
    const next = redoStack.current.pop()
    if (!next) return
    setMap((current) => {
      undoStack.current.push(current)
      return next
    })
    setDirty(true)
    setHistoryAvailability({
      canUndo: true,
      canRedo: redoStack.current.length > 0,
    })
  }, [])
  return (
    <div className="map-workspace">
      <DraftList drafts={drafts} selectedId={activeId} loading={loading} onRefresh={() => void loadDrafts()} onDelete={(target) => void deleteDraft(target)} />
      {!draftId ? (
        <main className="workspace-empty">
          <CirclePlus />
          <strong>选择或创建地图草稿</strong>
          <p>编辑路径、地点和事件池，并在发布前完成核心规则校验。</p>
          <button className="primary-button" type="button" onClick={() => navigate('/maps/new')}>
            <FilePlus2 />
            新建地图
          </button>
        </main>
      ) : (
        <main className="editor-panel map-editor-panel">
          <header className="editor-toolbar">
            <div>
              <small>{draft ? draft.contentKey : 'NEW MAP'}</small>
              <strong>{map.name || '新地图草稿'}</strong>
            </div>
            <div className="toolbar-meta">
              {draft ? (
                <>
                  <span className={`status-label status-${draft.status}`}>{statusLabels[draft.status]}</span>
                  <span>修订 {draft.currentRevision}</span>
                </>
              ) : (
                <span>基于奥普港模板</span>
              )}
            </div>
            <div className="toolbar-actions">
              {dirty ? (
                <span className="unsaved-indicator">
                  <Clock3 />
                  未保存
                </span>
              ) : null}
              {editable ? (
                <button className="primary-button" type="button" disabled={busy || (!dirty && Boolean(draft))} onClick={() => void save()}>
                  <Save />
                  保存修订
                </button>
              ) : null}
              {draft && (draft.status === 'draft' || draft.status === 'rejected') ? (
                <button className="secondary-button" type="button" disabled={busy || dirty || !draft.validation.valid} onClick={() => void transition('submit')}>
                  <Send />
                  提交审核
                </button>
              ) : null}
              {draft?.status === 'in-review' && user?.role === 'admin' ? (
                <>
                  <button className="secondary-button success-button" type="button" disabled={busy} onClick={() => void transition('approve')}>
                    <Check />
                    通过
                  </button>
                  <button className="secondary-button danger-button" type="button" disabled={busy || !reviewReason.trim()} onClick={() => void transition('reject')}>
                    <X />
                    驳回
                  </button>
                </>
              ) : null}
              {draft?.status === 'approved' && user?.role === 'admin' ? (
                <button className="primary-button" type="button" disabled={busy} onClick={() => void transition('publish')}>
                  <ShieldCheck />
                  发布版本
                </button>
              ) : null}
            </div>
          </header>
          {draft?.status === 'in-review' && user?.role === 'admin' ? (
            <label className="review-reason">
              <span>驳回原因</span>
              <input value={reviewReason} placeholder="驳回时必填" onChange={(event) => setReviewReason(event.target.value)} />
            </label>
          ) : null}
          {error ? (
            <div className="notice-banner is-error">
              <AlertCircle />
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="notice-banner is-success">
              <CheckCircle2 />
              {notice}
            </div>
          ) : null}
          <MapBasics map={map} disabled={!editable || busy} onChange={changeMap} />
          <MapCanvasWorkspace
            map={map}
            selectedSpaceId={selectedSpaceId}
            selectedMarkerId={selectedMarkerId}
            path={(() => {
              try {
                return simulateMapPath(map, fromSpaceId, distance).path
              } catch {
                return []
              }
            })()}
            editable={editable && !busy}
            mode={canvasMode}
            pendingMarkerAsset={pendingMarkerAsset}
            snapToGrid={snapToGrid}
            canUndo={historyAvailability.canUndo}
            canRedo={historyAvailability.canRedo}
            onSelectSpace={setSelectedSpaceId}
            onSelectMarker={setSelectedMarkerId}
            onChooseMarkerAsset={(file) => void chooseMarkerAsset(file)}
            onModeChange={setCanvasMode}
            onSnapChange={setSnapToGrid}
            onUndo={undo}
            onRedo={redo}
            onMapChange={changeMap}
          />
        </main>
      )}
      {draftId ? <MapPropertyPanel map={map} selectedSpaceId={selectedSpaceId} selectedMarkerId={selectedMarkerId} validation={draft?.validation} editable={editable && !busy} fromSpaceId={fromSpaceId} distance={distance} onFromSpaceChange={setFromSpaceId} onDistanceChange={setDistance} onChange={changeMap} onClearMarker={() => setSelectedMarkerId(null)} /> : null}
    </div>
  )
}
