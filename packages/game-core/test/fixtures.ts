import type {
  EventDefinition,
  GameDefinition,
  MapDefinition,
  ParticipantSetup,
} from '../src/index.js'

export function makeMap(spaceCount = 20, winningSpaceIds: readonly number[] = [spaceCount - 1], eventSpaceIds: readonly number[] = []) {
  return {
    id: `map-${spaceCount}`,
    name: 'Test Map',
    logicalSize: { width: spaceCount * 10, height: 100 },
    spaces: Array.from({ length: spaceCount }, (_, index) => ({
      index,
      x: index * 10,
      y: 50,
      rotation: 0,
      kind: index === 0 ? 'start' as const : winningSpaceIds.includes(index) ? 'finish' as const : eventSpaceIds.includes(index) ? 'event' as const : 'normal' as const,
    })),
    winningSpaceIds,
    landmarks: [],
    assets: { background: 'test/background.webp', landmarkAtlas: 'test/landmarks.json' },
  } satisfies MapDefinition
}

const EVENTS = [
  { id: 'move-one', title: 'Move', flavor: '', kind: '常规事件', effect: [{ type: 'move', spaces: 1 }], aiValue: 1 },
  { id: 'extra', title: 'Extra', flavor: '', kind: '常规事件', effect: [{ type: 'extra-turn' }], aiValue: 1 },
  { id: 'gain', title: 'Gain', flavor: '', kind: '常规事件', effect: [{ type: 'gain-item' }], aiValue: 1 },
  { id: 'skip', title: 'Skip', flavor: '', kind: '常规事件', effect: [{ type: 'skip', turns: 1 }], aiValue: 1 },
  { id: 'swap', title: 'Swap', flavor: '', kind: '奇遇事件', effect: [{ type: 'swap' }], aiValue: 1 },
  { id: 'slow', title: 'Slow', flavor: '', kind: '常规事件', effect: [{ type: 'world-max-die', value: 3, rounds: 2 }], aiValue: 1 },
  { id: 'check', title: 'Check', flavor: '', kind: '骰子检定', threshold: 7, success: [{ type: 'move', spaces: 2 }], failure: [{ type: 'move', spaces: -1 }], aiValue: 1 },
] as const satisfies readonly EventDefinition[]

export function makeDefinition(map = makeMap()): GameDefinition {
  const items = [
    { id: 'clover', title: 'Clover', mode: '被动' as const, effect: 'check-pass' as const },
    { id: 'boots', title: 'Boots', mode: '主动' as const, effect: 'move-plus-three' as const },
    { id: 'barnacle', title: 'Barnacle', mode: '主动' as const, effect: 'opponent-back-two' as const },
    { id: 'duckling', title: 'Duckling', mode: '主动' as const, effect: 'teleport-beach' as const },
    { id: 'compass', title: 'Compass', mode: '主动' as const, effect: 'fixed-eight' as const },
    { id: 'tea', title: 'Tea', mode: '主动' as const, effect: 'opponent-max-three' as const },
    { id: 'umbrella', title: 'Umbrella', mode: '被动' as const, effect: 'skip-shield' as const },
    { id: 'cat', title: 'Cat', mode: '被动' as const, effect: 'collision-shield' as const },
  ]
  const skins = ['white', 'blue', 'pink', 'yellow'].map((id) => ({
    id,
    name: id,
    atlas: `${id}.json`,
    animations: { idle: 'idle', active: 'active', hop: 'hop', hit: 'hit' },
    anchor: { x: 0.5, y: 0.9 },
    shadowScale: 1,
  }))
  return {
    contentVersion: 'test-1',
    map,
    ruleset: {
      id: 'test-rules',
      version: 1,
      playerCount: { min: 2, max: 4 },
      mapIds: [map.id],
      eventPoolIds: EVENTS.map((event) => event.id),
      itemPoolIds: items.map((item) => item.id),
      skinIds: skins.map((skin) => skin.id),
    },
    events: EVENTS,
    items,
    skins,
  }
}

export function makeParticipants(count: number, positions: readonly number[] = [], firstSkin = 'white'): ParticipantSetup[] {
  return Array.from({ length: count }, (_, seatIndex) => ({
    playerId: `p${seatIndex}`,
    seatIndex,
    controller: seatIndex === 0 ? 'local' : 'ai',
    displayName: `Player ${seatIndex}`,
    colorId: `color-${seatIndex}`,
    skinId: seatIndex === 0 ? firstSkin : ['blue', 'pink', 'yellow'][seatIndex - 1],
    startingItemId: 'clover',
    spaceId: positions[seatIndex] ?? 0,
  }))
}
