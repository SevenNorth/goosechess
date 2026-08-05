import { DeterministicRandom, rollDice } from '@goose-chess/game-core'
import type { EventEffect, ManagedEventContent } from './types'

export const DEFAULT_EVENT: ManagedEventContent = {
  id: '', title: '', flavor: '', kind: '常规事件', accent: 'teal', aiValue: 5,
  weight: 1, poolIds: ['general'], effect: [{ type: 'move', spaces: 1 }], successText: '',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function effectFromUnknown(value: unknown): EventEffect | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  switch (value.type) {
    case 'move':
    case 'opponent-move': return { type: value.type, spaces: Number(value.spaces) || 0 }
    case 'skip': return { type: 'skip', turns: Number(value.turns) || 1 }
    case 'world-max-die': return { type: 'world-max-die', value: Number(value.value) || 4, rounds: Number(value.rounds) || 1 }
    case 'move-to-next-landmark':
    case 'extra-turn':
    case 'gain-item':
    case 'swap': return { type: value.type }
    default: return null
  }
}

function effectList(value: unknown, fallback: EventEffect[]) {
  if (!Array.isArray(value)) return fallback
  const effects = value.map(effectFromUnknown).filter((effect): effect is EventEffect => effect !== null)
  return effects.length ? effects : fallback
}

export function eventFromUnknown(value: unknown): ManagedEventContent {
  if (!isRecord(value)) return structuredClone(DEFAULT_EVENT)
  const kind = value.kind === '骰子检定' || value.kind === '奇遇事件' ? value.kind : '常规事件'
  const accent = value.accent === 'coral' || value.accent === 'gold' ? value.accent : 'teal'
  const event: ManagedEventContent = {
    id: typeof value.id === 'string' ? value.id : '',
    title: typeof value.title === 'string' ? value.title : '',
    flavor: typeof value.flavor === 'string' ? value.flavor : '',
    kind, accent, aiValue: Number(value.aiValue) || 0, weight: Number(value.weight) || 1,
    poolIds: Array.isArray(value.poolIds) ? value.poolIds.filter((pool): pool is string => typeof pool === 'string') : ['general'],
    successText: typeof value.successText === 'string' ? value.successText : '',
  }
  if (kind === '骰子检定') {
    event.threshold = Number(value.threshold) || 7
    event.success = effectList(value.success, [{ type: 'move', spaces: 1 }])
    event.failure = effectList(value.failure, [{ type: 'skip', turns: 1 }])
    event.failureText = typeof value.failureText === 'string' ? value.failureText : ''
  } else {
    event.effect = effectList(value.effect, [{ type: 'move', spaces: 1 }])
  }
  return event
}

export function effectForType(type: EventEffect['type']): EventEffect {
  switch (type) {
    case 'move':
    case 'opponent-move': return { type, spaces: 1 }
    case 'skip': return { type, turns: 1 }
    case 'world-max-die': return { type, value: 4, rounds: 1 }
    case 'move-to-next-landmark':
    case 'extra-turn':
    case 'gain-item':
    case 'swap': return { type }
  }
}

export function simulateCheck(seed: number, threshold: number, count = 1) {
  const random = new DeterministicRandom({ seed: seed >>> 0, cursor: 0 })
  let passed = 0
  let first: readonly [number, number] = [1, 1]
  for (let index = 0; index < count; index += 1) {
    const dice = rollDice(random)
    if (index === 0) first = dice
    if (dice[0] + dice[1] >= threshold) passed += 1
  }
  return { dice: first, passed, count, rate: passed / count }
}
