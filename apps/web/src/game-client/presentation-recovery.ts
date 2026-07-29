export type PresentationOutcome = 'complete' | 'failed' | 'interrupted'

export interface PresentationRecoveryOptions {
  readonly timeoutMs: number
  readonly subscribeInterrupt: (interrupt: () => void) => () => void
}

export async function settlePresentation(playback: Promise<void>, options: PresentationRecoveryOptions): Promise<PresentationOutcome> {
  let timeoutId = 0
  let interruptPlayback: () => void = () => undefined
  const interrupted = new Promise<'interrupted'>((resolve) => {
    interruptPlayback = () => resolve('interrupted')
    timeoutId = window.setTimeout(interruptPlayback, options.timeoutMs)
  })
  const unsubscribe = options.subscribeInterrupt(interruptPlayback)
  try {
    return await Promise.race([
      playback.then(() => 'complete' as const).catch(() => 'failed' as const),
      interrupted,
    ])
  } finally {
    window.clearTimeout(timeoutId)
    unsubscribe()
  }
}
