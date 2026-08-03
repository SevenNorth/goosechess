import type { EventCard, ItemCard } from './types.js'

export const FINISH = 65

export const LANDMARKS: Record<number, string> = {
  0: '维修室',
  6: '小吃摊',
  18: '拾荒沙滩',
  31: '水手之家',
  42: '大黄狗',
  52: '疯人院',
  58: '十全大煮',
  61: '调饮师',
  65: '喧声屋',
}

export const LEGACY_EVENT_SPACE_IDS = [6, 11, 18, 22, 27, 31, 34, 41, 42, 46, 52, 55, 58, 61] as const

export const ITEMS: ItemCard[] = [
  {
    id: 'clover',
    title: '四叶草',
    description: '下一次骰子检定必定成功。',
    quote: '好运总会在岸边出现。',
    mode: '被动',
    effect: 'check-pass',
    priority: 9,
  },
  {
    id: 'boots',
    title: '轻便靴子',
    description: '使用后，本次移动额外前进 3 格。',
    quote: '还能跑。',
    mode: '主动',
    effect: 'move-plus-three',
    priority: 6,
  },
  {
    id: 'barnacle',
    title: '坏藤壶',
    description: '让对手立即后退 2 格。',
    quote: '它可以出现在任何地方。',
    mode: '主动',
    effect: 'opponent-back-two',
    priority: 5,
  },
  {
    id: 'duckling',
    title: '嘎小鸭',
    description: '立即来到拾荒沙滩；领先时不能使用。',
    quote: '带它去找妈妈。',
    mode: '主动',
    effect: 'teleport-beach',
    priority: 4,
  },
  {
    id: 'compass',
    title: '歪指针',
    description: '本回合的移动点数固定为 8。',
    quote: '方向不对，距离倒是刚好。',
    mode: '主动',
    effect: 'fixed-eight',
    priority: 7,
  },
  {
    id: 'tea',
    title: '冷掉的茶',
    description: '对手下一回合每颗骰子最多为 3。',
    quote: '慢一点也没关系。',
    mode: '主动',
    effect: 'opponent-max-three',
    priority: 7,
  },
  {
    id: 'umbrella',
    title: '旧雨伞',
    description: '自动抵消下一次暂停回合效果。',
    quote: '至少这次没有淋湿。',
    mode: '被动',
    effect: 'skip-shield',
    priority: 8,
  },
  {
    id: 'cat',
    title: '橘色小猫',
    description: '自动抵消下一次被撞回效果。',
    quote: '它只是不喜欢被推来推去。',
    mode: '被动',
    effect: 'collision-shield',
    priority: 8,
  },
  {
    id: 'lucky-coin', title: '幸运硬币', description: '下一次骰子检定必定成功。', quote: '正面和反面都写着好运。',
    mode: '被动', effect: 'check-pass', priority: 8,
  },
  {
    id: 'spring-shoes', title: '弹簧鞋', description: '使用后，本次移动额外前进 3 格。', quote: '落地之前别往下看。',
    mode: '主动', effect: 'move-plus-three', priority: 6,
  },
  {
    id: 'driftwood-shield', title: '浮木盾牌', description: '自动抵消下一次被撞回效果。', quote: '至少比纸板结实。',
    mode: '被动', effect: 'collision-shield', priority: 7,
  },
  {
    id: 'warm-soup', title: '热汤保温壶', description: '自动抵消下一次暂停回合效果。', quote: '喝完再赶路。',
    mode: '被动', effect: 'skip-shield', priority: 7,
  },
]

export const EVENTS: EventCard[] = [
  {
    id: 'crab', title: '螃蟹！', flavor: '刚坐下一小会儿，一只螃蟹便钳住了你的鼻子。',
    kind: '常规事件', effect: [{ type: 'extra-turn' }], successText: '疼得跳了起来，再行动一次。', accent: 'coral', aiValue: 9,
  },
  {
    id: 'fishing', title: '钓鱼', flavor: '你预感能钓上些好东西，谁知道呢？',
    kind: '骰子检定', threshold: 9, success: [{ type: 'gain-item' }], failure: [{ type: 'skip', turns: 1 }],
    successText: '鱼线一沉，你捞到了一件道具。', failureText: '鱼线缠成了死结，暂停一回合。', accent: 'gold', aiValue: 5,
  },
  {
    id: 'lost-cat', title: '走失的猫', flavor: '它不喜欢脚下的沙子，却愿意跟着你走。',
    kind: '常规事件', effect: [{ type: 'skip', turns: 1 }, { type: 'gain-item' }], successText: '陪它等了一会儿，也得到一件道具。', accent: 'teal', aiValue: 4,
  },
  {
    id: 'snack', title: '最后一份烤鱼', flavor: '摊主说，掷得够大就送给你。',
    kind: '骰子检定', threshold: 8, success: [{ type: 'move', spaces: 4 }], failure: [{ type: 'move', spaces: -2 }],
    successText: '香味让你精神一振，前进 4 格。', failureText: '追着香味走错了路，后退 2 格。', accent: 'gold', aiValue: 6,
  },
  {
    id: 'tailwind', title: '顺风而行', flavor: '一阵风把棋子吹得贴着纸面滑行。',
    kind: '奇遇事件', effect: [{ type: 'move', spaces: 5 }], successText: '借着风势前进 5 格。', accent: 'teal', aiValue: 8,
  },
  {
    id: 'wrong-way', title: '禁止通行', flavor: '前方正在修路，箭头似乎指向身后。',
    kind: '常规事件', effect: [{ type: 'move', spaces: -4 }], successText: '不得不绕行，后退 4 格。', accent: 'coral', aiValue: 1,
  },
  {
    id: 'sailor', title: '老船长的箱子', flavor: '锁扣生锈了，骰子或许比钥匙更管用。',
    kind: '骰子检定', threshold: 10, success: [{ type: 'gain-item' }, { type: 'move', spaces: 2 }], failure: [{ type: 'skip', turns: 1 }],
    successText: '箱子打开了：获得道具并前进 2 格。', failureText: '折腾到天黑，暂停一回合。', accent: 'gold', aiValue: 5,
  },
  {
    id: 'echo', title: '大黄狗的吠声', flavor: '大黄狗突然叫了一声，对手的棋子被吓得后退。',
    kind: '奇遇事件', effect: [{ type: 'opponent-move', spaces: -3 }], successText: '对手后退 3 格。', accent: 'coral', aiValue: 7,
  },
  {
    id: 'shortcut', title: '纸背捷径', flavor: '掀起棋盘一角，下面竟然藏着一条虚线。',
    kind: '骰子检定', threshold: 7, success: [{ type: 'move', spaces: 6 }], failure: [{ type: 'move', spaces: -1 }],
    successText: '捷径是真的，前进 6 格。', failureText: '只是画歪了，后退 1 格。', accent: 'teal', aiValue: 8,
  },
  {
    id: 'madhouse', title: '谁坐错了位置', flavor: '门里伸出一只手，重新摆放了两枚棋子。',
    kind: '奇遇事件', effect: [{ type: 'swap' }], successText: '你和对手交换了位置。', accent: 'coral', aiValue: 5,
  },
  {
    id: 'slow-goose', title: '慢鹅Ⅱ', flavor: '接下来的每一步都应该额外小心。',
    kind: '常规事件', effect: [{ type: 'world-max-die', value: 4, rounds: 2 }], successText: '未来 2 轮，每颗骰子最多掷出 4 点。', accent: 'gold', aiValue: 3,
  },
  {
    id: 'cook', title: '十全大煮', flavor: '锅里翻滚着不可名状但香气扑鼻的东西。',
    kind: '骰子检定', threshold: 11, success: [{ type: 'extra-turn' }, { type: 'move', spaces: 2 }], failure: [{ type: 'opponent-move', spaces: 2 }],
    successText: '吃完浑身有劲：前进 2 格并再行动一次。', failureText: '把好东西留给了对手，对手前进 2 格。', accent: 'gold', aiValue: 6,
  },
  {
    id: 'quiet', title: '别出声', flavor: '只要骰子足够轻，或许没人会注意到你。',
    kind: '骰子检定', threshold: 6, success: [{ type: 'move', spaces: 3 }], failure: [{ type: 'opponent-move', spaces: 3 }],
    successText: '悄悄前进 3 格。', failureText: '响声给对手指了路，对手前进 3 格。', accent: 'teal', aiValue: 6,
  },
  {
    id: 'argument', title: '争论方向', flavor: '两个人都坚信自己看懂了地图。',
    kind: '骰子检定', threshold: 8, success: [{ type: 'opponent-move', spaces: -4 }], failure: [{ type: 'move', spaces: -3 }],
    successText: '对手被说服了，后退 4 格。', failureText: '地图拿反了，自己后退 3 格。', accent: 'coral', aiValue: 5,
  },
  {
    id: 'same-boat', title: '同舟共济', flavor: '这次谁也别想把谁落下。',
    kind: '奇遇事件', effect: [{ type: 'move', spaces: 3 }, { type: 'opponent-move', spaces: 3 }], successText: '双方都前进 3 格。', accent: 'teal', aiValue: 4,
  },
  {
    id: 'harbor-bell', title: '港口钟声', flavor: '钟声响起，今天的航班似乎还赶得上。',
    kind: '奇遇事件', effect: [{ type: 'extra-turn' }], successText: '立即再行动一次。', accent: 'gold', aiValue: 8,
  },
  {
    id: 'slippery-deck', title: '湿滑甲板', flavor: '刚迈出一步，鞋底就在木板上打滑。',
    kind: '常规事件', effect: [{ type: 'move', spaces: -2 }], successText: '滑回了 2 格。', accent: 'coral', aiValue: 2,
  },
  {
    id: 'ferry-ticket', title: '末班船票', flavor: '口袋里竟然还有一张没有过期的船票。',
    kind: '奇遇事件', effect: [{ type: 'move', spaces: 7 }], successText: '搭上渡船，前进 7 格。', accent: 'teal', aiValue: 9,
  },
  {
    id: 'storm-lantern', title: '暴风灯', flavor: '风把灯吹得东倒西歪，先看看能不能护住火苗。',
    kind: '骰子检定', threshold: 8, success: [{ type: 'move', spaces: 3 }], failure: [{ type: 'skip', turns: 1 }],
    successText: '灯火未灭，前进 3 格。', failureText: '忙着重新点灯，暂停一回合。', accent: 'gold', aiValue: 5,
  },
  {
    id: 'lost-map', title: '泡水的地图', flavor: '墨迹晕成一团，只能猜哪条线还通往前方。',
    kind: '骰子检定', threshold: 6, success: [{ type: 'gain-item' }], failure: [{ type: 'move', spaces: -2 }],
    successText: '在夹层里找到一件道具。', failureText: '看反了方向，后退 2 格。', accent: 'teal', aiValue: 5,
  },
  {
    id: 'friendly-cook', title: '多盛的一碗', flavor: '掌勺的人说最后一碗不能浪费。',
    kind: '常规事件', effect: [{ type: 'gain-item' }], successText: '碗底藏着一件道具。', accent: 'gold', aiValue: 6,
  },
  {
    id: 'dock-crane', title: '失控吊机', flavor: '吊钩横扫码头，把前面的棋子拨了回去。',
    kind: '奇遇事件', effect: [{ type: 'opponent-move', spaces: -2 }], successText: '下一位对手后退 2 格。', accent: 'coral', aiValue: 6,
  },
  {
    id: 'turning-tide', title: '潮水换向', flavor: '退潮和涨潮交换了所有人的方向感。',
    kind: '奇遇事件', effect: [{ type: 'swap' }], successText: '与下一位对手交换位置。', accent: 'teal', aiValue: 5,
  },
  {
    id: 'heavy-fog', title: '浓雾封港', flavor: '所有人都只能摸着栏杆慢慢前进。',
    kind: '常规事件', effect: [{ type: 'world-max-die', value: 3, rounds: 1 }], successText: '未来 1 轮，每颗骰子最多掷出 3 点。', accent: 'coral', aiValue: 3,
  },
  {
    id: 'mixologist-special', title: '调饮师特调', flavor: '杯子里冒着细密气泡，调饮师示意你一口喝完。',
    kind: '骰子检定', threshold: 8, success: [{ type: 'extra-turn' }], failure: [{ type: 'move', spaces: -2 }],
    successText: '精神一振，立即再行动一次。', failureText: '脚步发飘，后退 2 格。', accent: 'gold', aiValue: 6,
  },
  {
    id: 'wrong-glass', title: '拿错杯子', flavor: '两只杯子长得一模一样，喝完才发现对方也拿错了。',
    kind: '奇遇事件', effect: [{ type: 'swap' }], successText: '与下一位对手交换位置。', accent: 'coral', aiValue: 5,
  },
  {
    id: 'sparkling-tonic', title: '气泡补剂', flavor: '酸甜气泡一路冲到鼻尖，腿脚忽然轻快起来。',
    kind: '常规事件', effect: [{ type: 'move', spaces: 4 }], successText: '前进 4 格。', accent: 'teal', aiValue: 7,
  },
]
