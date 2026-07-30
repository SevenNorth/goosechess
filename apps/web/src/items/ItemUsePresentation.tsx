import { useEffect, type CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface ItemUsePresentationData {
  readonly id: number
  readonly playerName: string
  readonly targetPlayerName?: string
  readonly playerColor: string
  readonly itemTitle: string
  readonly itemMode: '主动' | '被动'
  readonly description: string
  readonly source: 'local' | 'remote'
  readonly durationMs: number
  readonly Icon: LucideIcon
}

interface ItemUsePresentationProps {
  readonly presentation: ItemUsePresentationData
  readonly onComplete: () => void
}

function ItemCardFace({ presentation }: { readonly presentation: ItemUsePresentationData }) {
  const Icon = presentation.Icon
  return (
    <div className="item-use-card-face">
      <span>{presentation.itemMode}道具</span>
      <Icon />
      <strong>{presentation.itemTitle}</strong>
      <small>{presentation.description}</small>
    </div>
  )
}

export function ItemUsePresentation({ presentation, onComplete }: ItemUsePresentationProps) {
  useEffect(() => {
    const fallback = window.setTimeout(onComplete, presentation.durationMs + 300)
    return () => window.clearTimeout(fallback)
  }, [onComplete, presentation.durationMs])

  const style = {
    '--item-use-duration': `${presentation.durationMs}ms`,
    '--item-use-color': presentation.playerColor,
  } as CSSProperties

  return (
    <div
      className="item-use-stage"
      role="status"
      aria-label={`${presentation.playerName}使用${presentation.itemTitle}`}
      style={style}
    >
      <div className="item-use-player">
        <i />
        <strong>{presentation.playerName}</strong>
        <span>使用了{presentation.itemMode}道具{presentation.targetPlayerName ? ` · 作用于${presentation.targetPlayerName}` : ''}</span>
      </div>
      <div
        className={`item-use-flight is-${presentation.source}`}
        onAnimationEnd={(event) => {
          if (event.currentTarget === event.target) onComplete()
        }}
      >
        <div className="item-use-card-half is-left" aria-hidden="true"><ItemCardFace presentation={presentation} /></div>
        <div className="item-use-card-half is-right" aria-hidden="true"><ItemCardFace presentation={presentation} /></div>
        <div className="item-use-tear" aria-hidden="true" />
      </div>
    </div>
  )
}
