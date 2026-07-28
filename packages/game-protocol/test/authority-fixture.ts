import type { GameDefinition, ParticipantSetup } from '@goose-chess/game-core'

export const AUTHORITY_DEFINITION: GameDefinition = {
  contentVersion: 'authority-test-1',
  map: {
    id: 'authority-map',
    name: 'Authority Map',
    logicalSize: { width: 300, height: 100 },
    spaces: Array.from({ length: 30 }, (_, index) => ({
      index,
      x: index * 10,
      y: 50,
      rotation: 0,
      kind: index === 0 ? 'start' as const : index === 29 ? 'finish' as const : 'normal' as const,
    })),
    winningSpaceIds: [29],
    landmarks: [],
    assets: { background: 'test.webp', landmarkAtlas: 'test.json' },
  },
  ruleset: {
    id: 'authority-rules',
    version: 1,
    playerCount: { min: 2, max: 4 },
    mapIds: ['authority-map'],
    eventPoolIds: ['event-a', 'event-b', 'event-c'],
    itemPoolIds: ['clover', 'boots'],
    skinIds: ['white', 'blue'],
  },
  events: [
    { id: 'event-a', title: 'A', flavor: '', kind: '常规事件', effect: [], aiValue: 1 },
    { id: 'event-b', title: 'B', flavor: '', kind: '常规事件', effect: [], aiValue: 1 },
    { id: 'event-c', title: 'C', flavor: '', kind: '常规事件', effect: [], aiValue: 1 },
  ],
  items: [
    { id: 'clover', title: 'Clover', mode: '被动', effect: 'check-pass' },
    { id: 'boots', title: 'Boots', mode: '主动', effect: 'move-plus-three' },
  ],
  skins: [
    { id: 'white', name: 'White', atlas: 'white.json', animations: { idle: 'idle', active: 'active', hop: 'hop', hit: 'hit' }, anchor: { x: 0.5, y: 0.9 }, shadowScale: 1 },
    { id: 'blue', name: 'Blue', atlas: 'blue.json', animations: { idle: 'idle', active: 'active', hop: 'hop', hit: 'hit' }, anchor: { x: 0.5, y: 0.9 }, shadowScale: 1 },
  ],
}

export const AUTHORITY_PARTICIPANTS: ParticipantSetup[] = [
  { playerId: 'p0', seatIndex: 0, controller: 'local', displayName: 'Player', colorId: 'pink', skinId: 'white', startingItemId: 'clover' },
  { playerId: 'p1', seatIndex: 1, controller: 'ai', displayName: 'AI', colorId: 'blue', skinId: 'blue', startingItemId: 'clover' },
]
