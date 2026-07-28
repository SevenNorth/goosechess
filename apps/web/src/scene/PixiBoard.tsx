import { useEffect, useRef } from 'react'
import type { AuthorityUpdate, GameSnapshot } from '@goose-chess/game-protocol'
import type { BoardSceneController, BoardPlaybackOptions } from './BoardScene'

interface PixiBoardProps {
  readonly snapshot: GameSnapshot
  readonly onReady: (controller: BoardSceneController) => void
  readonly onDispose?: () => void
}

function createTestController(): BoardSceneController {
  return {
    async playUpdate(update: AuthorityUpdate, _previous: GameSnapshot, options?: BoardPlaybackOptions) {
      if (update.cues.some((cue) => cue.type === 'dice-roll')) options?.onStageChange?.('rolling')
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
    destroy() {},
  }
}

export function PixiBoard({ snapshot, onReady, onDispose }: PixiBoardProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<BoardSceneController | null>(null)
  const snapshotRef = useRef(snapshot)
  const onReadyRef = useRef(onReady)
  const onDisposeRef = useRef(onDispose)

  useEffect(() => {
    snapshotRef.current = snapshot
    onReadyRef.current = onReady
    onDisposeRef.current = onDispose
  })

  useEffect(() => {
    if (import.meta.env.MODE === 'test') {
      const controller = createTestController()
      controllerRef.current = controller
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
    void Promise.all([import('./BoardScene'), import('../audio/audio-port')]).then(([{ BoardScene }, { NullAudioPort }]) => BoardScene.create(host, new NullAudioPort(), () => cancelled)).then((controller) => {
      if (cancelled) {
        controller.destroy()
        return
      }
      controllerRef.current = controller
      controller.sync(snapshotRef.current)
      onReadyRef.current(controller)
    })
    return () => {
      cancelled = true
      controllerRef.current?.destroy()
      controllerRef.current = null
      onDisposeRef.current?.()
    }
  }, [])

  useEffect(() => {
    controllerRef.current?.setActivePlayer(snapshot.state.activePlayerId)
  }, [snapshot.state.activePlayerId])

  return <div className="pixi-board-host" ref={hostRef} role="img" aria-label="16 格 PixiJS 核心体验棋盘" />
}
