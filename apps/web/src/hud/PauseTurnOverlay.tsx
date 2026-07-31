import type { CSSProperties } from 'react'
import { Hourglass } from 'lucide-react'
import type { PauseTurnPresentation } from './PauseTurnIndicator'

interface PauseTurnOverlayProps {
  readonly playerName: string
  readonly playerColor: string
  readonly turns: number
  readonly presentation: PauseTurnPresentation
}

export function PauseTurnOverlay({ playerName, playerColor, turns, presentation }: PauseTurnOverlayProps) {
  const decremented = turns <= presentation.remainingTurns
  const style = {
    '--pause-player-color': playerColor,
    '--pause-presentation-duration': `${presentation.durationMs}ms`,
    '--pause-spin-duration': `${Math.round(presentation.durationMs * 0.7)}ms`,
  } as CSSProperties

  return (
    <section className="pause-turn-stage" style={style} aria-hidden="true">
      <div className="pause-turn-center">
        <div className="pause-turn-player"><i /><strong>{playerName}</strong></div>
        <span className="pause-turn-hourglass"><Hourglass /></span>
        <span className={`pause-turn-message${decremented ? ' is-decremented' : ''}`} key={turns}>
          {decremented ? `剩余 ${turns} 回合` : '暂停本回合'}
        </span>
      </div>
    </section>
  )
}
