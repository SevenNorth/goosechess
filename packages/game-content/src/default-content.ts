import { EVENTS, ITEMS, LEGACY_EVENT_SPACE_IDS } from './legacy-content.js'
import type { GameDefinition, LandmarkDefinition, MapDefinition } from '@goose-chess/game-core'
import type {
  ContentManifest,
  LandmarkContentDefinition,
  MapContentDefinition,
  RulesetContentDefinition,
  SkinContentDefinition,
} from './types.js'

export const CONTENT_VERSION = '2026.07.29.2'

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
  { id: 'goose-white', version: 1, title: '白鹅', name: '白鹅', atlas: 'assets/tokens/goose-white.json', animations: { idle: 'idle', active: 'active', hop: 'hop', hit: 'hit' }, anchor: { x: 0.5, y: 0.9 }, shadowScale: 1 },
  { id: 'goose-yellow', version: 1, title: '黄鹅', name: '黄鹅', atlas: 'assets/tokens/goose-yellow.json', animations: { idle: 'idle', active: 'active', hop: 'hop', hit: 'hit' }, anchor: { x: 0.5, y: 0.9 }, shadowScale: 1 },
  { id: 'goose-blue', version: 1, title: '蓝鹅', name: '蓝鹅', atlas: 'assets/tokens/goose-blue.json', animations: { idle: 'idle', active: 'active', hop: 'hop', hit: 'hit' }, anchor: { x: 0.5, y: 0.9 }, shadowScale: 1 },
  { id: 'goose-pink', version: 1, title: '粉鹅', name: '粉鹅', atlas: 'assets/tokens/goose-pink.json', animations: { idle: 'idle', active: 'active', hop: 'hop', hit: 'hit' }, anchor: { x: 0.5, y: 0.9 }, shadowScale: 1 },
] as const satisfies readonly SkinContentDefinition[]

export const DEFAULT_RULESET = {
  id: 'classic-race',
  version: 2,
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
  const line = (start: number, end: number, from: number, to: number, fixed: number, horizontal = true) => {
    const progress = (index - from) / Math.max(1, to - from)
    return horizontal
      ? { x: start + (end - start) * progress, y: fixed }
      : { x: fixed, y: start + (end - start) * progress }
  }
  const percent = index === 0
    ? { x: 5.5, y: 86 }
    : index <= 15 ? line(11, 81, 1, 15, 86)
      : index <= 20 ? line(78, 46, 16, 20, 85, false)
        : index <= 34 ? line(80, 18, 21, 34, 17)
          : index <= 40 ? line(23, 52, 35, 40, 14, false)
            : index <= 52 ? line(19, 77, 41, 52, 57)
              : index <= 56 ? line(52, 34, 53, 56, 82, false)
                : line(76, 31, 57, 65, 35)
  if (index === 21) return { x: 1120, y: 139 }
  return { x: Math.round(percent.x * 12.8), y: Math.round(percent.y * 8.2) }
})

const LANDMARK_PLACEMENTS: Readonly<Record<string, { x: number; y: number; size: number }>> = {
  'repair-room': { x: 105, y: 660, size: 112 },
  'snack-stand': { x: 520, y: 650, size: 104 },
  'scavenger-beach': { x: 1160, y: 500, size: 108 },
  'sailors-home': { x: 360, y: 205, size: 108 },
  'yellow-dog': { x: 315, y: 450, size: 108 },
  madhouse: { x: 1050, y: 410, size: 108 },
  'grand-boil': { x: 930, y: 270, size: 108 },
  mixologist: { x: 715, y: 270, size: 104 },
  'noise-house': { x: 469, y: 330, size: 210 },
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
