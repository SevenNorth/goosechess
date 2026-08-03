import { EVENTS, ITEMS, LEGACY_EVENT_SPACE_IDS } from './legacy-content.js'
import type { GameDefinition, LandmarkDefinition, MapDefinition } from '@goose-chess/game-core'
import type {
  ContentManifest,
  LandmarkContentDefinition,
  MapContentDefinition,
  RulesetContentDefinition,
  SkinContentDefinition,
} from './types.js'

export const CONTENT_VERSION = '2026.08.03.1'

export const LANDMARK_DEFINITIONS = [
  { id: 'repair-room', title: '维修室', spaceIds: [0] },
  { id: 'snack-stand', title: '小吃摊', spaceIds: [6] },
  { id: 'scavenger-beach', title: '拾荒沙滩', spaceIds: [18] },
  { id: 'sailors-home', title: '水手之家', spaceIds: [31] },
  { id: 'yellow-dog', title: '大黄狗', spaceIds: [42] },
  { id: 'madhouse', title: '疯人院', spaceIds: [52] },
  { id: 'grand-boil', title: '十全大煮', spaceIds: [58] },
  { id: 'mixologist', title: '调饮师', spaceIds: [61] },
  { id: 'noise-house', title: '喧声屋', spaceIds: [63, 64, 65] },
] as const satisfies readonly LandmarkContentDefinition[]

export const DEFAULT_MAP_CONTENT = {
  id: 'aup-port-65',
  version: 1,
  title: '奥普港',
  spaceCount: 66,
  winningSpaceIds: [63, 64, 65],
  landmarkIds: LANDMARK_DEFINITIONS.map((landmark) => landmark.id),
} as const satisfies MapContentDefinition

export const SKINS = [
  { id: 'goose-white', version: 2, title: '妮露', name: '妮露', atlas: 'assets/tokens/characters/nilou.png', animations: { idle: 'idle', active: 'active', hop: 'hop', hit: 'hit' }, anchor: { x: 0.5, y: 1 }, shadowScale: 1 },
  { id: 'goose-yellow', version: 2, title: '魈', name: '魈', atlas: 'assets/tokens/characters/xiao.png', animations: { idle: 'idle', active: 'active', hop: 'hop', hit: 'hit' }, anchor: { x: 0.5, y: 1 }, shadowScale: 1 },
  { id: 'goose-blue', version: 2, title: '芙宁娜', name: '芙宁娜', atlas: 'assets/tokens/characters/furina.png', animations: { idle: 'idle', active: 'active', hop: 'hop', hit: 'hit' }, anchor: { x: 0.5, y: 1 }, shadowScale: 1 },
  { id: 'goose-pink', version: 2, title: '菲谢尔', name: '菲谢尔', atlas: 'assets/tokens/characters/fischl.png', animations: { idle: 'idle', active: 'active', hop: 'hop', hit: 'hit' }, anchor: { x: 0.5, y: 1 }, shadowScale: 1 },
] as const satisfies readonly SkinContentDefinition[]

export const DEFAULT_RULESET = {
  id: 'classic-race',
  version: 6,
  playerCount: { min: 2, max: 4 },
  mapIds: [DEFAULT_MAP_CONTENT.id],
  eventPoolIds: EVENTS.map((event) => event.id),
  itemPoolIds: ITEMS.map((item) => item.id),
  skinIds: SKINS.map((skin) => skin.id),
} as const satisfies RulesetContentDefinition

export const DEFAULT_CONTENT_MANIFEST = {
  contentVersion: CONTENT_VERSION,
  maps: [DEFAULT_MAP_CONTENT],
  landmarks: LANDMARK_DEFINITIONS,
  events: EVENTS,
  items: ITEMS,
  skins: SKINS,
  rulesets: [DEFAULT_RULESET],
} as const satisfies ContentManifest

const landmarkBySpaceId: ReadonlyMap<number, string> = new Map(
  LANDMARK_DEFINITIONS.flatMap((landmark) => landmark.spaceIds.map((spaceId) => [spaceId, landmark.id] as const)),
)

const DEFAULT_SPACE_POINTS = Array.from({ length: 66 }, (_, index) => {
  const horizontal = (start: number, end: number, from: number, to: number, y: number) => ({
    x: Math.round(start + (end - start) * ((index - from) / Math.max(1, to - from))),
    y,
  })
  if (index === 0) return { x: 70, y: 640 }
  if (index <= 15) return horizontal(141, 1037, 1, 15, 640)
  const outerRight = [
    { x: 1085, y: 576 },
    { x: 1120, y: 512 },
    { x: 1140, y: 448 },
    { x: 1140, y: 384 },
    { x: 1115, y: 320 },
    { x: 1065, y: 255 },
  ]
  if (index <= 21) return outerRight[index - 16]
  if (index <= 34) return horizontal(1015, 230, 22, 34, 190)
  const outerLeft = [
    { x: 190, y: 225 },
    { x: 170, y: 275 },
    { x: 170, y: 330 },
    { x: 180, y: 385 },
    { x: 205, y: 440 },
    { x: 250, y: 485 },
  ]
  if (index <= 40) return outerLeft[index - 35]
  if (index <= 52) return horizontal(310, 986, 41, 52, 520)
  const innerRight = [
    { x: 1038, y: 492 },
    { x: 1065, y: 447 },
    { x: 1065, y: 397 },
    { x: 1035, y: 357 },
  ]
  if (index <= 56) return innerRight[index - 53]
  return horizontal(970, 430, 57, 65, 340)
})

const LANDMARK_PLACEMENTS: Readonly<Record<string, { x: number; y: number; size: number }>> = {
  'repair-room': { x: 70, y: 656, size: 112 },
  'snack-stand': { x: 461, y: 658, size: 104 },
  'scavenger-beach': { x: 1140, y: 458, size: 108 },
  'sailors-home': { x: 426, y: 207, size: 108 },
  'yellow-dog': { x: 371, y: 530, size: 108 },
  madhouse: { x: 986, y: 535, size: 108 },
  'grand-boil': { x: 903, y: 353, size: 108 },
  mixologist: { x: 700, y: 358, size: 104 },
  'noise-house': { x: 498, y: 383, size: 210 },
}

export const DEFAULT_MAP_DEFINITION = {
  id: DEFAULT_MAP_CONTENT.id,
  name: DEFAULT_MAP_CONTENT.title,
  logicalSize: { width: 1280, height: 820 },
  spaces: Array.from({ length: DEFAULT_MAP_CONTENT.spaceCount }, (_, index) => ({
    index,
    ...DEFAULT_SPACE_POINTS[index],
    rotation: [-3, 1, -1, 2, 0][index % 5],
    kind: index === 0
      ? 'start' as const
      : DEFAULT_MAP_CONTENT.winningSpaceIds.includes(index as 63 | 64 | 65)
        ? 'finish' as const
        : LEGACY_EVENT_SPACE_IDS.includes(index as typeof LEGACY_EVENT_SPACE_IDS[number])
          ? 'event' as const
          : 'normal' as const,
    ...(landmarkBySpaceId.has(index) ? { landmarkId: landmarkBySpaceId.get(index) } : {}),
  })),
  winningSpaceIds: DEFAULT_MAP_CONTENT.winningSpaceIds,
  landmarks: LANDMARK_DEFINITIONS.map((landmark) => ({
    id: landmark.id,
    name: landmark.title,
    spaceIds: landmark.spaceIds,
    pathIntegrated: landmark.id !== 'noise-house',
    ...LANDMARK_PLACEMENTS[landmark.id],
  })) satisfies readonly LandmarkDefinition[],
  allowedEventIds: DEFAULT_RULESET.eventPoolIds,
  blockedItemIds: [],
  assets: {
    background: 'assets/maps/aup-port/paper-board.png',
    landmarkAtlas: 'assets/maps/aup-port/landmarks.json',
    landmarks: Object.fromEntries(LANDMARK_DEFINITIONS.map((landmark) => [landmark.id, `assets/maps/aup-port/${landmark.id}.png`])),
  },
} as const satisfies MapDefinition

export const DEFAULT_GAME_DEFINITION = {
  contentVersion: CONTENT_VERSION,
  map: DEFAULT_MAP_DEFINITION,
  ruleset: DEFAULT_RULESET,
  events: EVENTS,
  items: ITEMS,
  skins: SKINS,
} as const satisfies GameDefinition

export const TEST_MAP_DEFINITION = {
  id: 'test-harbor-7',
  name: '测试港口',
  logicalSize: { width: 700, height: 120 },
  spaces: Array.from({ length: 8 }, (_, index) => ({
    index,
    x: index * 100,
    y: 60,
    rotation: 0,
    kind: index === 0 ? 'start' as const : index >= 6 ? 'finish' as const : index === 3 ? 'event' as const : 'normal' as const,
    ...(index >= 6 ? { landmarkId: 'test-finish' } : {}),
  })),
  winningSpaceIds: [6, 7],
  landmarks: [{ id: 'test-finish', name: '测试终点', spaceIds: [6, 7] }],
  allowedEventIds: DEFAULT_RULESET.eventPoolIds,
  blockedItemIds: [],
  assets: {
    background: 'assets/maps/test-harbor/background.webp',
    landmarkAtlas: 'assets/maps/test-harbor/landmarks.json',
  },
} as const satisfies MapDefinition
