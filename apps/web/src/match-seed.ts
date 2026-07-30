export function createMatchSeed() {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
}

export function parseSeedParameter(value: string | null) {
  if (value === null || value.trim() === '') return null
  const seed = Number(value)
  return Number.isInteger(seed) && seed >= 0 && seed <= 0xffff_ffff ? seed : null
}
