import { createHash } from 'node:crypto'
import {
  isJsonValue,
  validateMapDefinition,
  type GameEffect,
  type JsonValue,
  type MapDefinition,
} from '@goose-chess/game-core'
import type {
  EventCard,
  SkinContentDefinition,
} from '@goose-chess/game-content'

export const MANAGED_CONTENT_KINDS = ['event', 'map', 'skin'] as const
export type ManagedContentKind = (typeof MANAGED_CONTENT_KINDS)[number]

export interface ContentValidationIssue {
  readonly path: string
  readonly code: string
  readonly message: string
}

export interface ContentValidationResult {
  readonly valid: boolean
  readonly issues: readonly ContentValidationIssue[]
}

export interface CompiledManagedContent {
  readonly kind: ManagedContentKind
  readonly contentId: string
  readonly canonicalJson: string
  readonly hash: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function issue(
  issues: ContentValidationIssue[],
  path: string,
  code: string,
  message: string,
) {
  issues.push({ path, code, message })
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  issues: ContentValidationIssue[],
) {
  const value = record[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    issue(issues, key, 'required_string', `${key} must be a non-empty string.`)
    return null
  }
  return value.trim()
}

function validateId(record: Record<string, unknown>, issues: ContentValidationIssue[]) {
  const id = requiredString(record, 'id', issues)
  if (id && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    issue(issues, 'id', 'invalid_id', 'id must use lowercase letters, numbers, and hyphens.')
  }
  return id
}

function validateEffect(
  value: unknown,
  path: string,
  issues: ContentValidationIssue[],
): value is GameEffect {
  if (!isRecord(value) || typeof value.type !== 'string') {
    issue(issues, path, 'invalid_effect', 'Effect must be a structured object with a type.')
    return false
  }
  switch (value.type) {
    case 'move':
    case 'opponent-move':
      if (!Number.isInteger(value.spaces)) {
        issue(issues, `${path}.spaces`, 'invalid_integer', 'Movement spaces must be an integer.')
        return false
      }
      return true
    case 'skip':
      if (!Number.isInteger(value.turns) || Number(value.turns) <= 0) {
        issue(issues, `${path}.turns`, 'invalid_duration', 'Skip turns must be a positive integer.')
        return false
      }
      return true
    case 'world-max-die':
      if (
        !Number.isInteger(value.value)
        || Number(value.value) < 1
        || Number(value.value) > 6
        || !Number.isInteger(value.rounds)
        || Number(value.rounds) <= 0
      ) {
        issue(issues, path, 'invalid_die_rule', 'Temporary die rules require value 1-6 and positive rounds.')
        return false
      }
      return true
    case 'extra-turn':
    case 'gain-item':
    case 'swap':
      return true
    default:
      issue(issues, `${path}.type`, 'unknown_effect', `Unknown effect type: ${value.type}.`)
      return false
  }
}

function validateEffectList(
  value: unknown,
  path: string,
  issues: ContentValidationIssue[],
  required: boolean,
) {
  if (value === undefined && !required) return
  if (!Array.isArray(value) || value.length === 0) {
    issue(issues, path, 'required_effects', `${path} must contain at least one effect.`)
    return
  }
  value.forEach((effect, index) => validateEffect(effect, `${path}[${index}]`, issues))
}

function validateEvent(content: Record<string, unknown>, issues: ContentValidationIssue[]) {
  validateId(content, issues)
  requiredString(content, 'title', issues)
  requiredString(content, 'flavor', issues)
  const kind = requiredString(content, 'kind', issues)
  if (kind && !['常规事件', '骰子检定', '奇遇事件'].includes(kind)) {
    issue(issues, 'kind', 'invalid_event_kind', 'Event kind is not supported.')
  }
  if (typeof content.aiValue !== 'number' || !Number.isFinite(content.aiValue)) {
    issue(issues, 'aiValue', 'invalid_number', 'aiValue must be a finite number.')
  }
  if (!['coral', 'teal', 'gold'].includes(String(content.accent))) {
    issue(issues, 'accent', 'invalid_accent', 'Event accent must be coral, teal, or gold.')
  }

  if (content.poolIds !== undefined) {
    if (!Array.isArray(content.poolIds) || content.poolIds.length === 0) {
      issue(issues, 'poolIds', 'required_event_pools', 'Managed events must belong to at least one event pool.')
    } else {
      content.poolIds.forEach((poolId, index) => {
        if (typeof poolId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(poolId)) {
          issue(issues, 'poolIds[' + index + ']', 'invalid_pool_id', 'Event pool ids must use lowercase letters, numbers, and hyphens.')
        }
      })
    }
  }

  if (kind === '骰子检定') {
    if (!Number.isInteger(content.threshold) || Number(content.threshold) < 2 || Number(content.threshold) > 12) {
      issue(issues, 'threshold', 'unreachable_threshold', 'Two-die thresholds must be integers from 2 to 12.')
    }
    validateEffectList(content.success, 'success', issues, true)
    validateEffectList(content.failure, 'failure', issues, true)
    requiredString(content, 'successText', issues)
    requiredString(content, 'failureText', issues)
  } else {
    validateEffectList(content.effect, 'effect', issues, true)
    requiredString(content, 'successText', issues)
  }

  return content as unknown as EventCard
}

function validateMap(content: Record<string, unknown>, issues: ContentValidationIssue[]) {
  validateId(content, issues)
  requiredString(content, 'name', issues)
  if (!isRecord(content.logicalSize)) {
    issue(issues, 'logicalSize', 'invalid_object', 'logicalSize must be an object.')
  }
  if (!Array.isArray(content.spaces)) {
    issue(issues, 'spaces', 'invalid_array', 'spaces must be an array.')
  }
  if (!Array.isArray(content.winningSpaceIds) || content.winningSpaceIds.length === 0) {
    issue(issues, 'winningSpaceIds', 'invalid_array', 'At least one winning space is required.')
  }
  if (!Array.isArray(content.landmarks)) {
    issue(issues, 'landmarks', 'invalid_array', 'landmarks must be an array.')
  }
  if (!isRecord(content.assets)) {
    issue(issues, 'assets', 'invalid_object', 'assets must be an object.')
  }
  if (issues.length > 0) return

  try {
    for (const message of validateMapDefinition(content as unknown as MapDefinition)) {
      issue(issues, '', 'invalid_map', message)
    }
  } catch {
    issue(issues, '', 'invalid_map', 'Map structure could not be validated.')
  }
}

function validateSkin(content: Record<string, unknown>, issues: ContentValidationIssue[]) {
  validateId(content, issues)
  requiredString(content, 'title', issues)
  requiredString(content, 'name', issues)
  requiredString(content, 'atlas', issues)
  if (!isRecord(content.animations)) {
    issue(issues, 'animations', 'invalid_object', 'animations must be an object.')
  } else {
    for (const name of ['idle', 'active', 'hop', 'hit']) {
      requiredString(content.animations, name, issues)
    }
  }
  if (!isRecord(content.anchor)) {
    issue(issues, 'anchor', 'invalid_object', 'anchor must be an object.')
  } else {
    for (const axis of ['x', 'y']) {
      const value = content.anchor[axis]
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        issue(issues, `anchor.${axis}`, 'invalid_anchor', 'Anchor values must be between 0 and 1.')
      }
    }
  }
  if (typeof content.shadowScale !== 'number' || !Number.isFinite(content.shadowScale) || content.shadowScale <= 0) {
    issue(issues, 'shadowScale', 'invalid_scale', 'shadowScale must be greater than zero.')
  }
  return content as unknown as SkinContentDefinition
}

export function getManagedContentId(content: unknown) {
  if (!isRecord(content) || typeof content.id !== 'string' || content.id.trim().length === 0) {
    return null
  }
  return content.id.trim()
}

export function validateManagedContent(
  kind: ManagedContentKind,
  content: unknown,
): ContentValidationResult {
  const issues: ContentValidationIssue[] = []
  if (!isJsonValue(content)) {
    issue(issues, '', 'not_json', 'Managed content must be finite, acyclic JSON data.')
    return { valid: false, issues }
  }
  if (!isRecord(content)) {
    issue(issues, '', 'invalid_object', 'Managed content must be an object.')
    return { valid: false, issues }
  }

  switch (kind) {
    case 'event':
      validateEvent(content, issues)
      break
    case 'map':
      validateMap(content, issues)
      break
    case 'skin':
      validateSkin(content, issues)
      break
  }
  return { valid: issues.length === 0, issues }
}

function normalizeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(normalizeJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeJson(value[key])]),
    )
  }
  return value
}

export function canonicalizeJson(value: unknown) {
  if (!isJsonValue(value)) throw new Error('Content must be finite, acyclic JSON data.')
  return JSON.stringify(normalizeJson(value))
}

export function hashJsonContent(value: unknown) {
  return createHash('sha256').update(canonicalizeJson(value)).digest('hex')
}

export function compileManagedContent(
  kind: ManagedContentKind,
  content: unknown,
): CompiledManagedContent {
  const validation = validateManagedContent(kind, content)
  if (!validation.valid) {
    throw new Error(validation.issues.map((entry) => `${entry.path || '<root>'}: ${entry.message}`).join('\n'))
  }
  const contentId = getManagedContentId(content)
  if (!contentId) throw new Error('Managed content requires an id.')
  const canonicalJson = canonicalizeJson(content)
  return {
    kind,
    contentId,
    canonicalJson,
    hash: createHash('sha256').update(canonicalJson).digest('hex'),
  }
}