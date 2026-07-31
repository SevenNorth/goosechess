import { useEffect, useRef, useState } from 'react'
import type { MapDefinition } from '@goose-chess/game-core'
import type { AuthorityUpdate, GameSnapshot } from '@goose-chess/game-protocol'
import type { BoardSceneController, BoardPlaybackOptions } from './BoardScene'

interface PixiBoardProps {
  readonly snapshot?: GameSnapshot
  readonly map: MapDefinition
  readonly onReady: (controller: BoardSceneController) => void
  readonly onDispose?: () => void
}

function createTestController(): BoardSceneController {
  return {
    async playUpdate(update: AuthorityUpdate, _previous: GameSnapshot, options?: BoardPlaybackOptions) {
      for (const cue of update.cues) {
        if (cue.type === 'item-use') {
          await options?.playItemUse?.(cue.playerId, cue.itemId, cue.targetPlayerId, options.speed ?? 1)
        } else if (cue.type === 'dice-roll') {
          options?.onStageChange?.('rolling')
          await options?.playDice?.(cue, options.speed ?? 1)
        }
      }
      if (update.cues.some((cue) => cue.type === 'route-preview')) {
        options?.onStageChange?.('routePreview')
        options?.onStageChange?.('targetEmphasis')
        options?.onStageChange?.('routeFade')
        options?.onStageChange?.('moving')
      }
      options?.onStageChange?.('ready')
    },
    sync() {},
    setActivePlayer() {},
    diagnostics() { return { activeScenes: 0, tickerHandlers: 0, loadedTextures: 0, windowListeners: 0, activeTweens: 0, tokenCount: 0, pannable: false, cameraZoom: 1, cameraFocusX: 0, cameraFocusY: 0 } },
    destroy() {},
  }
}

export function PixiBoard({ snapshot, map, onReady, onDispose }: PixiBoardProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<BoardSceneController | null>(null)
  const snapshotRef = useRef(snapshot)
  const onReadyRef = useRef(onReady)
  const onDisposeRef = useRef(onDispose)
  const [attempt, setAttempt] = useState(0)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    snapshotRef.current = snapshot
    onReadyRef.current = onReady
    onDisposeRef.current = onDispose
  })

  useEffect(() => {
    setLoadState('loading')
    setProgress(0)
    if (import.meta.env.MODE === 'test') {
      const controller = createTestController()
      controllerRef.current = controller
      setProgress(1)
      setLoadState('ready')
      onReadyRef.current(controller)
      return () => {
        controller.destroy()
        controllerRef.current = null
        onDisposeRef.current?.()
      }
    }
    let cancelled = false
    const host = hostRef.current
    if (!host) return
    void Promise.all([import('./BoardScene'), import('../audio/audio-port')])
      .then(([{ BoardScene }, { NullAudioPort }]) => BoardScene.create(
        host,
        new NullAudioPort(),
        map,
        () => cancelled,
        (nextProgress) => !cancelled && setProgress(nextProgress),
      ))
      .then((controller) => {
      if (cancelled) {
        controller.destroy()
        return
      }
      controllerRef.current = controller
      if (snapshotRef.current) controller.sync(snapshotRef.current)
      setProgress(1)
      setLoadState('ready')
      if (import.meta.env.DEV) window.__GOOSE_CHESS_DIAGNOSTICS__ = () => controller.diagnostics()
      onReadyRef.current(controller)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error('Pixi board initialization failed.', error)
          setLoadState('error')
        }
      })
    return () => {
      cancelled = true
      if (import.meta.env.DEV) delete window.__GOOSE_CHESS_DIAGNOSTICS__
      controllerRef.current?.destroy()
      controllerRef.current = null
      onDisposeRef.current?.()
    }
  }, [attempt, map])

  useEffect(() => {
    if (snapshot) controllerRef.current?.setActivePlayer(snapshot.state.activePlayerId)
  }, [snapshot])

  return <>
    <div className="pixi-board-host" ref={hostRef} role="img" aria-label={`${map.spaces.length - 1} 格 PixiJS 竞速棋盘`} />
    {loadState !== 'ready' && (
      <section className="board-load-state" aria-live="polite" aria-busy={loadState === 'loading'}>
        {loadState === 'loading' ? <>
          <span>正在铺设奥普港棋盘</span>
          <strong>{Math.round(progress * 100)}%</strong>
          <div className="board-load-track"><i style={{ width: `${Math.max(4, progress * 100)}%` }} /></div>
        </> : <>
          <span role="alert">棋盘资源加载失败</span>
          <p>请检查本地资源后重试，本局尚未开始。</p>
          <button className="primary-command" type="button" onClick={() => setAttempt((value) => value + 1)}>重新加载</button>
        </>}
      </section>
    )}
  </>
}
