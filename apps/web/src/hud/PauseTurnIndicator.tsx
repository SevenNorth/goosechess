import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Hourglass } from 'lucide-react'

export interface PauseTurnPresentation {
  readonly id: number
  readonly previousTurns: number
  readonly remainingTurns: number
  readonly durationMs: number
}

interface PauseTurnIndicatorProps {
  readonly playerName: string
  readonly turns: number
  readonly presentation?: PauseTurnPresentation
  readonly onCountChange?: (turns: number) => void
  readonly onComplete?: () => void
}

export function PauseTurnIndicator({
  playerName,
  turns,
  presentation,
  onCountChange,
  onComplete,
}: PauseTurnIndicatorProps) {
  const [displayedTurns, setDisplayedTurns] = useState(presentation?.previousTurns ?? turns)
  const [decremented, setDecremented] = useState(false)
  const onCountChangeRef = useRef(onCountChange)
  const onCompleteRef = useRef(onComplete)

  useEffect(() => {
    onCountChangeRef.current = onCountChange
    onCompleteRef.current = onComplete
  }, [onComplete, onCountChange])

  useEffect(() => {
    if (!presentation) {
      setDisplayedTurns(turns)
      setDecremented(false)
    }
  }, [presentation, turns])

  useEffect(() => {
    if (!presentation) return
    setDisplayedTurns(presentation.previousTurns)
    setDecremented(false)
    const spinDuration = Math.round(presentation.durationMs * 0.7)
    const decrementTimer = window.setTimeout(() => {
      setDisplayedTurns(presentation.remainingTurns)
      setDecremented(true)
      onCountChangeRef.current?.(presentation.remainingTurns)
    }, spinDuration)
    const completeTimer = window.setTimeout(() => onCompleteRef.current?.(), presentation.durationMs)
    return () => {
      window.clearTimeout(decrementTimer)
      window.clearTimeout(completeTimer)
    }
  }, [presentation])

  if (turns <= 0 && !presentation) return null

  const label = presentation
    ? `${playerName}暂停 ${displayedTurns} 回合，正在跳过本回合`
    : `${playerName}暂停 ${displayedTurns} 回合`
  const style = presentation
    ? ({ '--pause-spin-duration': `${Math.round(presentation.durationMs * 0.7)}ms` } as CSSProperties)
    : undefined

  return (
    <span
      className={`hud-pause${presentation ? ' is-consuming' : ''}${decremented ? ' is-decremented' : ''}`}
      style={style}
      role={presentation ? 'status' : undefined}
      aria-label={label}
    >
      <span className="hud-pause-icon" aria-hidden="true"><Hourglass /></span>
      <span>暂停</span>
      <strong key={displayedTurns}>{displayedTurns}</strong>
      <span>回合</span>
    </span>
  )
}
