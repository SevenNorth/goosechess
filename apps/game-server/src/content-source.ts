import { assertValidGameDefinition } from '@goose-chess/game-core'
import {
  builtInRuntimeContentBundle,
  type RuntimeContentBundle,
} from '@goose-chess/content-tools/runtime-content'

export interface RuntimeContentSource {
  readonly publicAssetBaseUrl?: string
  load(version?: string): Promise<RuntimeContentBundle>
}

export class StaticRuntimeContentSource implements RuntimeContentSource {
  private readonly bundle = builtInRuntimeContentBundle()

  async load(version?: string) {
    if (version && version !== this.bundle.version) {
      throw new Error(`Unknown runtime content version: ${version}.`)
    }
    return structuredClone(this.bundle)
  }
}

export interface HttpRuntimeContentSourceOptions {
  readonly token?: string
  readonly publicAssetBaseUrl?: string
  readonly fetch?: typeof fetch
}

export class HttpRuntimeContentSource implements RuntimeContentSource {
  readonly publicAssetBaseUrl?: string
  private readonly fetchImplementation: typeof fetch
  private readonly historical = new Map<string, RuntimeContentBundle>()
  private readonly baseUrl: string

  constructor(baseUrl: string, private readonly options: HttpRuntimeContentSourceOptions = {}) {
    this.baseUrl = new URL(baseUrl).toString().replace(/\/$/, '')
    this.publicAssetBaseUrl = options.publicAssetBaseUrl
      ? normalizeHttpBaseUrl(options.publicAssetBaseUrl)
      : this.baseUrl
    this.fetchImplementation = options.fetch ?? fetch
  }

  async load(version?: string) {
    if (version && this.historical.has(version)) return structuredClone(this.historical.get(version)!)
    const key = version ?? 'current'
    const response = await this.fetchImplementation(`${this.baseUrl}/runtime/content/${encodeURIComponent(key)}`, {
      headers: this.options.token ? { Authorization: `Bearer ${this.options.token}` } : undefined,
    })
    if (!response.ok) throw new Error(`Content service returned ${response.status} for runtime version ${key}.`)
    const payload = await response.json() as { bundle?: unknown }
    const bundle = parseRuntimeContentBundle(payload.bundle)
    if (version && bundle.version !== version) {
      throw new Error(`Content service returned version ${bundle.version} while ${version} was requested.`)
    }
    this.historical.set(bundle.version, structuredClone(bundle))
    return bundle
  }
}

function normalizeHttpBaseUrl(value: string) {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Runtime content public URL must use HTTP or HTTPS.')
  }
  return url.toString().replace(/\/$/, '')
}

function parseRuntimeContentBundle(value: unknown): RuntimeContentBundle {
  if (!value || typeof value !== 'object') throw new Error('Content service returned an invalid runtime bundle.')
  const bundle = value as RuntimeContentBundle
  if (typeof bundle.version !== 'string' || !bundle.version || !Array.isArray(bundle.definitions) || bundle.definitions.length === 0) {
    throw new Error('Content service returned an invalid runtime bundle.')
  }
  if (!Array.isArray(bundle.releaseVersions) || bundle.releaseVersions.some((version) => typeof version !== 'string')) {
    throw new Error('Content service returned invalid runtime release versions.')
  }
  for (const entry of bundle.definitions) {
    if (!entry || typeof entry.mapId !== 'string' || typeof entry.mapVersion !== 'string' || !entry.definition) {
      throw new Error('Content service returned an invalid runtime game definition.')
    }
    if (entry.definition.contentVersion !== bundle.version || entry.definition.map.id !== entry.mapId) {
      throw new Error(`Runtime definition ${entry.mapId} does not match bundle ${bundle.version}.`)
    }
    assertValidGameDefinition(entry.definition)
  }
  return structuredClone(bundle)
}
