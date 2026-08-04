import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONTENT_MANIFEST,
  DEFAULT_MAP_DEFINITION,
  SKINS,
} from '@goose-chess/game-content'
import {
  canonicalizeJson,
  compileManagedContent,
  hashJsonContent,
  validateManagedContent,
} from '../src/index.js'

describe('content tools', () => {
  it('produces stable canonical JSON and hashes regardless of object key order', () => {
    const first = { title: 'Harbor', nested: { z: 2, a: 1 } }
    const second = { nested: { a: 1, z: 2 }, title: 'Harbor' }
    expect(canonicalizeJson(first)).toBe(canonicalizeJson(second))
    expect(hashJsonContent(first)).toBe(hashJsonContent(second))
  })

  it('validates and compiles supported content kinds', () => {
    const event = validateManagedContent('event', DEFAULT_CONTENT_MANIFEST.events[0])
    const map = validateManagedContent('map', DEFAULT_MAP_DEFINITION)
    const skin = validateManagedContent('skin', SKINS[0])
    expect(event.valid).toBe(true)
    expect(map.valid).toBe(true)
    expect(skin.valid).toBe(true)

    const compiled = compileManagedContent('map', DEFAULT_MAP_DEFINITION)
    expect(compiled.contentId).toBe(DEFAULT_MAP_DEFINITION.id)
    expect(compiled.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.parse(compiled.canonicalJson)).toEqual(DEFAULT_MAP_DEFINITION)
  })

  it('returns structured issues and refuses to compile invalid content', () => {
    const invalidEvent = {
      id: 'bad-event',
      title: 'Bad event',
      flavor: 'Invalid threshold.',
      kind: '骰子检定',
      threshold: 20,
      success: [{ type: 'move', spaces: 1 }],
      failure: [{ type: 'skip', turns: 1 }],
      successText: 'ok',
      failureText: 'no',
      accent: 'gold',
      aiValue: 1,
    }
    const result = validateManagedContent('event', invalidEvent)
    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(expect.objectContaining({
      path: 'threshold',
      code: 'unreachable_threshold',
    }))
    expect(() => compileManagedContent('event', invalidEvent)).toThrow('threshold')
  })

  it('rejects non-JSON values and executable data', () => {
    expect(validateManagedContent('event', {
      id: 'bad-function',
      title: 'Bad',
      run: () => undefined,
    })).toMatchObject({
      valid: false,
      issues: [expect.objectContaining({ code: 'not_json' })],
    })
  })
})