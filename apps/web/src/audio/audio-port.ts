export interface AudioPort {
  preload(cues: readonly string[]): Promise<void>
  play(cue: string, options?: { readonly volume?: number; readonly loop?: boolean }): void
  stop(cue?: string): void
  setMuted(muted: boolean): void
  dispose(): void
}

export class NullAudioPort implements AudioPort {
  async preload() {}
  play() {}
  stop() {}
  setMuted() {}
  dispose() {}
}
