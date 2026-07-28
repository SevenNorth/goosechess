import { EVENTS, ITEMS } from './legacy-content.js'
import type {
  ContentManifest,
  LandmarkContentDefinition,
  MapContentDefinition,
  RulesetContentDefinition,
  SkinContentDefinition,
} from './types.js'

export const CONTENT_VERSION = '2026.07.28.1'

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
  { id: 'goose-white', version: 1, title: '白鹅', assetKey: 'token.goose-white' },
  { id: 'goose-yellow', version: 1, title: '黄鹅', assetKey: 'token.goose-yellow' },
  { id: 'goose-blue', version: 1, title: '蓝鹅', assetKey: 'token.goose-blue' },
  { id: 'goose-pink', version: 1, title: '粉鹅', assetKey: 'token.goose-pink' },
] as const satisfies readonly SkinContentDefinition[]

export const DEFAULT_RULESET = {
  id: 'classic-race',
  version: 1,
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
