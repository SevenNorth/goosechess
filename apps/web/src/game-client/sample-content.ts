import type { GameDefinition, MapDefinition } from '@goose-chess/game-core'
import { DEFAULT_GAME_DEFINITION } from '@goose-chess/game-content'

const SAMPLE_SPACES = [
  [170, 700], [265, 720], [365, 704], [465, 730],
  [565, 690], [670, 710], [775, 665], [885, 680],
  [1000, 640], [1100, 570], [1050, 465], [930, 430],
  [810, 455], [695, 420], [575, 445], [465, 385],
] as const

const EVENT_SPACE_IDS = new Set([6, 11, 14])

export const SAMPLE_MAP_DEFINITION: MapDefinition = {
  id: 'aup-port-sample-15',
  name: '奥普港试航线',
  logicalSize: { width: 1280, height: 820 },
  spaces: SAMPLE_SPACES.map(([x, y], index) => ({
    index,
    x,
    y,
    rotation: [-3, 2, -1, 3][index % 4],
    kind: index === 0 ? 'start' : index === SAMPLE_SPACES.length - 1 ? 'finish' : EVENT_SPACE_IDS.has(index) ? 'event' : 'normal',
    ...(index === 0 ? { landmarkId: 'repair-room' } : {}),
    ...(index === 6 ? { landmarkId: 'yellow-dog' } : {}),
    ...(index === 11 ? { landmarkId: 'scavenger-beach' } : {}),
    ...(index === 15 ? { landmarkId: 'sample-finish' } : {}),
  })),
  winningSpaceIds: [15],
  landmarks: [
    { id: 'repair-room', name: '维修室', spaceIds: [0] },
    { id: 'yellow-dog', name: '大黄狗', spaceIds: [6] },
    { id: 'scavenger-beach', name: '拾荒沙滩', spaceIds: [11] },
    { id: 'sample-finish', name: '试航终点', spaceIds: [15] },
  ],
  allowedEventIds: DEFAULT_GAME_DEFINITION.ruleset.eventPoolIds,
  blockedItemIds: [],
  assets: {
    background: 'assets/sample/paper-board.png',
    landmarkAtlas: 'assets/sample/landmarks.png',
  },
}

export const SAMPLE_GAME_DEFINITION: GameDefinition = {
  ...DEFAULT_GAME_DEFINITION,
  contentVersion: `${DEFAULT_GAME_DEFINITION.contentVersion}-stage5`,
  map: SAMPLE_MAP_DEFINITION,
  ruleset: {
    ...DEFAULT_GAME_DEFINITION.ruleset,
    id: 'core-slice-race',
    version: 1,
    mapIds: [SAMPLE_MAP_DEFINITION.id],
  },
}

export const STARTING_ITEM_IDS = ['boots', 'clover', 'cat'] as const
