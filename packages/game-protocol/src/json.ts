export interface JsonCompatibilityIssue {
  readonly path: string
  readonly reason: string
}

export function findJsonCompatibilityIssue(value: unknown): JsonCompatibilityIssue | null {
  const active = new Set<object>()

  function visit(candidate: unknown, path: string): JsonCompatibilityIssue | null {
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') return null
    if (typeof candidate === 'number') return Number.isFinite(candidate) ? null : { path, reason: 'number must be finite' }
    if (typeof candidate !== 'object') return { path, reason: `${typeof candidate} is not JSON-compatible` }
    if (active.has(candidate)) return { path, reason: 'cyclic references are not JSON-compatible' }

    const prototype = Object.getPrototypeOf(candidate)
    if (!Array.isArray(candidate) && prototype !== Object.prototype && prototype !== null) {
      return { path, reason: 'class instances and runtime objects are not JSON-compatible' }
    }

    active.add(candidate)
    if (Array.isArray(candidate)) {
      for (let index = 0; index < candidate.length; index += 1) {
        if (!(index in candidate)) return { path: `${path}.${index}`, reason: 'sparse arrays do not round-trip through JSON' }
      }
    } else if (Object.getOwnPropertySymbols(candidate).length > 0) {
      return { path, reason: 'symbol keys are not JSON-compatible' }
    }

    const entries = Array.isArray(candidate)
      ? Array.from(candidate, (entry, index) => [String(index), entry] as const)
      : Object.entries(candidate)

    for (const [key, entry] of entries) {
      const issue = visit(entry, `${path}.${key}`)
      if (issue) return issue
    }
    active.delete(candidate)
    return null
  }

  return visit(value, '$')
}
