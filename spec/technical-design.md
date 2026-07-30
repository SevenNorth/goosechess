# 技术设计

## 1. 架构目标

- 规则逻辑可以脱离画面进行单元测试和模拟对局。
- React UI 与 PixiJS 场景读取同一份客户端游戏状态。
- 动画只负责表现，不直接决定规则结果。
- 所有随机结果可以通过种子重放。
- 事件和道具通过配置扩展，不在渲染代码中写分支。
- 地图格子数量、路线、地标和胜利条件全部由地图配置提供，规则层不得硬编码 65。
- 参与者是可配置集合，规则层不得硬编码人类/电脑两个槽位。
- 同一个规则命令可以由本地 UI、电脑控制器或远程连接产生。
- 规则状态、命令、结果事件和随机游标均可序列化，以支持后续权威服务器、断线恢复和对局回放。
- 角色属性、技能和成长系统永久不进入领域模型；玩法扩展通过地图、内容和规则集完成。

## 2. 正式技术栈

| 领域 | 方案 | 原因 |
|---|---|---|
| Web 应用 | React + Vite + TypeScript | 适合客户端游戏、开发反馈快，并可部署为静态资源 |
| 客户端路由 | React Router | 管理模式准备、离线游戏和未来房间页面 |
| 场景渲染 | PixiJS v8 | 适合 2D 棋盘、精灵、镜头、滤镜和粒子 |
| 状态机 | XState v5 | 明确表达回合、动画等待、事件选择和结算阶段 |
| 动画 | PixiJS ticker + tween.js、Three.js | PixiJS 负责棋盘与棋子；Three.js 负责透明画布中的立体骰子，二者共享同一表现队列顺序 |
| 游戏服务端 | 独立 Node.js + TypeScript 服务 | 常驻承载房间、WebSocket、在线 AI 和权威结算 |
| 协议校验 | Zod | 从运行时 schema 推导 TypeScript 类型并校验网络/快照数据 |
| 音频 | 自定义 `AudioPort` | 第一阶段只建立接口与无声音实现，不引入播放库 |
| 单元测试 | Vitest | 复用现有测试环境，支持规则模拟 |
| 端到端测试 | Playwright | 验证 Vite SPA、Canvas、交互流程和桌面分辨率截图 |

首阶段不接入 WebSocket 库或部署游戏服务器，但协议数据结构和权威端接口属于技术基线，不得留到联机阶段再反推规则层。

不建议直接使用 `@pixi/react` 作为首选集成层。棋盘入口是普通 React 组件，在组件生命周期中创建和销毁 PixiJS `Application`，由场景控制器命令式管理显示对象。这样可以减少 React 生命周期和高频场景更新之间的耦合。

### 2.1 Vite 与后端边界

Vite 负责开发服务器和浏览器静态资源构建，不作为生产后端。正式职责如下：

- React/Vite 客户端负责路由、UI、PixiJS 场景、离线 `LocalAuthority` 和离线 AI。
- 独立 Node.js 服务负责账号/身份（启用后）、房间 HTTP API、WebSocket、在线 AI 和 `RoomAuthority`。
- 离线人机模式不依赖 Node.js 服务，可以作为纯静态站点运行。
- 在线模式由浏览器直接通过 HTTPS/WSS 连接游戏服务，不能在客户端保存第二份权威状态。

静态前端与游戏服务可以分别部署、缓存、扩缩容和回滚。React Router 的生产部署必须配置 SPA fallback，使 `/play` 和 `/room/:roomCode` 刷新时返回 `index.html`。

## 3. 模块边界

```text
React + Vite Web Client
  Controller (local / AI / remote)
       │ 提交可序列化 GameCommand
       ▼
  GameAuthorityPort
       ├─ 离线 ─► LocalAuthority ──────────┐
       └─ 在线 ─► WSS ─► Node RoomAuthority ┤
                                           ▼
                                    Shared Game Core
                                           │
                  GameSnapshot / DomainEvent / PresentationCue
                                           ▼
                                  Client Session Store
                         ┌─────────────────┴────────────────┐
                         ▼                                  ▼
                     React UI                 Pixi PresentationQueue
```

### 3.1 Rules Engine / Game Authority

负责：

- 座次、当前行动者和轮次。
- 所有参与者的位置、暂停状态与道具。
- 每个参与者选择的纯外观 `skinId`。
- 骰子结果和随机种子。
- 事件抽取、选择与效果计算。
- 碰撞、折返和胜负判断。
- 产生有序且可重放的领域事件与表现提示。

首个离线版本由 `LocalAuthority` 在浏览器内承担权威端职责；联机版本替换为服务端 authority。两者必须调用同一个纯规则内核。

不负责：

- PixiJS 显示对象。
- DOM 弹窗或按钮。
- 动画曲线和粒子数量。
- 音频文件路径。
- 网络连接、房间成员或账号资料。

权威规则推进不能等待某个客户端的动画回执。需要等待动画的只是该客户端的 `PresentationQueue`；在离线版中两者可以由同一个 XState actor system 编排，但仍必须保持状态和接口分离。

### 3.2 Pixi Scene

负责：

- 加载棋盘纹理与精灵图集。
- 创建地图、格子、地标、棋子和特效层。
- 逐格移动和镜头跟随。
- 绘制移动路线预览、目标格圆圈和棋子逐格跳跃动画。
- 路线、碰撞和终点演出；骰子提示交给 React 上层的 Three.js 骰子组件播放。
- 将鼠标命中结果转换为场景交互事件。

Pixi Scene 不得自行修改参与者位置。它只根据已提交的状态快照和表现提示播放动画。

### 3.3 React UI

负责：

- 根据对抗规模显示 2 至 4 名参与者状态栏。
- 开局道具和棋子皮肤选择。
- 当前回合提示。
- 道具槽与道具选择。
- 隐藏其他参与者的持有道具，并消费权威 `item-use` 提示播放玩家名、卡片入场和竖向撕裂演出。事件直接获得道具的确认由本地客户端从自己的 `event-resolved` 与 `item-changed` 结果派生，不新增 `PresentationCue` 或网络广播：已有道具时倒计时提交 `choose-item`，空道具栏时只关闭本地确认状态。
- 事件三选一卡牌。
- 检定结果、规则、设置、日志和结算。

### 3.4 运行位置

- 离线 `1v1`、`1v2`、`1v3`：`LocalAuthority`、AI 控制器和规则内核都在浏览器中运行，不调用 Node.js 后端。
- 在线真人座位：浏览器只提交命令，独立游戏服务器的 `RoomAuthority` 执行规则。
- 在线 AI 座位：共享 `game-ai` 代码在独立游戏服务器运行，由服务器提交 AI 命令。
- Vite 没有生产服务端；在线房间的权威快照只保存在独立游戏服务及其持久化层。

## 4. 规则阶段与客户端表现状态机

以下是客户端为了按顺序呈现一整个回合而使用的 XState 状态基线。权威规则使用同名规则阶段，但不等待 `routePreview`、`targetEmphasis` 或 `moving` 动画：

```text
setup.seats
  └─ setup.modeSelect
    └─ setup.skinSelect
      └─ setup.orderRoll
        └─ setup.startingItemDraw
          └─ setup.startingItemSelect
            └─ turn.start
          ├─ turn.skipped
          └─ turn.itemWindow
            └─ turn.rolling
              └─ turn.routePreview
                └─ turn.targetEmphasis
                  └─ turn.moving
                    └─ landing.winCheck
                      ├─ gameOver
                      └─ turn.collision
                        └─ landing.inspect
                          ├─ event.select
                          │  ├─ event.checkRolling
                          │  └─ event.resolving
                          └─ turn.finish
                            └─ turn.start
```

规则计算和动画需要分开：

1. 权威规则先计算骰子、目标位置和包含折返的完整移动路径。
2. 权威规则提交移动结果并附带有序 `PresentationCue`；客户端不能等动画后才写入权威位置。道具消耗使用协议 v4 的 `item-use` 提示，并插入在对应骰子、移动、暂停或碰撞效果之前。
3. PixiJS 沿路径从当前格向目标格绘制预览线，本地表现队列收到 `ROUTE_PREVIEW_DONE` 后播放目标圈并隐藏路线。
4. Three.js 先将权威骰面定格，随后 PixiJS 按路径播放逐格跳跃动画。
5. PixiJS 发出本地 `MOVE_ANIMATION_DONE`，只用于释放后续 UI 和表现。
6. 权威规则在提交移动时已经按最终落点完成胜负、碰撞和事件判断；客户端严格按结果事件顺序表现。

事件效果产生位置变化后也必须进入 `landing.winCheck`，不能等到回合结束才判断胜利。

任何动画失败或页面失焦都必须能通过超时回退、快进或由最新快照重建画面，不能永久阻塞客户端。远程玩家不会因为另一客户端仍在播放动画而被服务器阻塞。

## 5. 随机数、回放与权威性

- 每局游戏由权威端创建整数种子并维护 RNG 游标。
- 所有骰子、事件抽取和电脑随机偏差只在权威端使用同一随机数服务；远程客户端只能提交“请求投掷”，不能提交骰子点数。
- 日志按递增序号记录玩家命令、随机结果和领域事件。
- 开发模式允许输入种子重新开始同一局。
- 快照记录 `rulesetVersion`、`contentVersion`、随机游标和最后事件序号；录像回放和断线恢复都使用相同格式。

这样可以复现偶发错误，并为后续回放与联机同步保留基础。

## 6. 棋盘坐标

### 6.1 设计坐标系

- 默认棋盘使用固定逻辑尺寸 `1600 x 900`；其他地图可以在配置中声明自己的逻辑尺寸。
- PixiJS 根据浏览器可用空间等比缩放舞台。
- 第一阶段只支持桌面横向界面，并始终让完整棋盘保持可见。

### 6.2 格子位置

默认地图保存 66 个明确的落点坐标，包括第 0 格起点。其他地图的格子数量由各自配置决定。

路线可以先由曲线采样生成，但导出后应保存为固定坐标，避免修改曲线导致棋子、地标和特效整体漂移。

每个落点建议包含：

```ts
interface BoardSpace {
  index: number
  x: number
  y: number
  rotation: number
  kind: 'start' | 'normal' | 'event' | 'finish'
  landmarkId?: string
}
```

每张地图由独立清单描述：

```ts
interface MapDefinition {
  id: string
  name: string
  logicalSize: { width: number; height: number }
  spaces: BoardSpace[]
  winningSpaceIds: number[]
  landmarks: LandmarkDefinition[]
  allowedEventIds?: string[]
  blockedItemIds?: string[]
  assets: MapAssetManifest
}
```

规则引擎通过 `spaces` 的顺序计算移动和折返，不读取默认地图常量。地图切换发生在创建游戏会话之前；运行中的状态机只持有当前地图的只读定义。

第 63、64、65 格都应设置 `landmarkId: 'noise-house'`。规则配置同时明确设置 `winningSpaceIds: [63, 64, 65]`，移动和事件效果完成后根据最终落点进行胜利判断。

虽然当前喧声屋范围与胜利格集合相同，两个概念仍需分开建模，避免以后调整地标范围或胜利规则时修改场景数据。

## 7. 数据模型

事件与道具保留结构化配置，不包含可执行脚本。

座次投掷属于权威规则状态。快照保存当前有序分组、当前小组已经公开的单骰结果和历史投掷轮次；权威端每次只接受当前待投参与者的 `request-order-roll` 命令。一个小组投完后按点数降序拆成若干子组，单人组视为已确定，同点子组继续进入下一轮。所有分组均为单人后，将扁平顺序锁定为本局行动顺序，然后按该顺序进入起始道具选择，而不是直接进入第一回合。客户端不得自行打乱参与者数组或提交骰子点数。

起始道具候选同样属于权威规则状态。权威端轮到一名参与者时，从规则集道具池扣除地图禁用项后进行无放回抽样，将恰好三个 `startingItemOfferIds` 写入快照，并仅接受该参与者从候选集合中提交的 `choose-starting-item`。选择后清空当前候选并为下一名参与者独立抽样；不同参与者的候选不要求互斥。所有参与者选择完成后，才把 `activePlayerId` 重置为最终座次第一名并进入 `awaiting-action`。

```ts
interface EventDefinition {
  id: string
  title: string
  category: 'normal' | 'check' | 'encounter'
  description: string
  check?: {
    dice: { count: number; sides: number }
    threshold: number
    comparison: 'gte' | 'lte'
  }
  successEffects?: GameEffect[]
  failureEffects?: GameEffect[]
  directEffects?: GameEffect[]
  weight: number
  aiTags: string[]
  presentation: {
    illustration: string
    animation?: string
    sound?: string
  }
}
```

检定定义只能引用骰组和公开结果，不允许出现 `strength`、`intelligence`、角色等级或皮肤加成。内容加载时必须验证门槛在骰组可达范围内。

`GameEffect` 使用可穷举联合类型，例如移动、暂停、获得道具、交换位置和修改规则。未知效果必须在开发环境抛出错误，不能静默忽略。

棋子皮肤使用独立的纯表现定义：

```ts
interface TokenSkinDefinition {
  id: string
  name: string
  atlas: string
  animations: {
    idle: string
    active: string
    hop: string
    hit: string
  }
  anchor: { x: number; y: number }
  shadowScale: number
}
```

规则层只保存 `skinId`，不能根据皮肤 ID 修改骰子、事件、道具、移动或电脑决策。

参与者和规则集使用可扩展但无角色数值的结构：

```ts
interface ParticipantState {
  playerId: string
  seat: number
  controller: 'local' | 'ai' | 'remote'
  displayName: string
  colorId: string
  skinId: string
  spaceId: number
  itemId?: string
  statuses: TemporaryStatus[]
}

interface OrderRollRound {
  playerIds: string[]
  results: Array<{ playerId: string; face: number }>
}

interface RulesetDefinition {
  id: string
  version: number
  playerCount: { min: number; max: number }
  mapIds: string[]
  eventPoolIds: string[]
  itemPoolIds: string[]
  victoryRule: VictoryRule
}

interface OfflineMatchConfig {
  mode: '1v1' | '1v2' | '1v3'
  localPlayerCount: 1
  aiPlayerCount: 1 | 2 | 3
}
```

离线模式选择只负责生成参与者清单，不产生另一套规则分支。三个模式共享同一个 `RulesetDefinition`、地图、事件池、道具池和回合推进逻辑。

### 7.1 联机协议边界

首阶段需要定义并测试协议类型，即使暂时只由 `LocalAuthority` 调用：

```ts
interface CommandEnvelope {
  gameId: string
  commandId: string
  playerId: string
  expectedRevision: number
  command: GameCommand
}

interface GameSnapshot {
  schemaVersion: number
  gameId: string
  revision: number
  rulesetId: string
  rulesetVersion: number
  contentVersion: string
  rngCursor: number
  state: SerializableGameState
}
```

- `GameCommand` 使用可穷举联合类型，包括请求座次投掷、从权威候选中选择起始道具、使用道具、请求移动投骰、选择事件和确认继续等意图；不包含骰子点数或抽取结果。
- 权威端校验 `playerId`、行动权和 `expectedRevision`，拒绝重复或过期命令。
- 每次规则提交产生递增 `revision`、领域事件和新的快照；所有字段必须通过 JSON 往返测试。
- 断线恢复使用“最近快照 + 之后的事件”，重新连接后客户端跳过已确认的表现提示。
- XState actor、Pixi 对象、DOM 引用、计时器和音频句柄都不得进入快照。
- 房间、登录和传输协议后续实现；规则层只依赖 `GameAuthorityPort`，不直接依赖 WebSocket。

## 8. Monorepo 目录

```text
apps/
  web/
    src/
      main.tsx
      routes/
        HomeRoute.tsx
        PlayRoute.tsx
        RoomRoute.tsx
      game-client/
        GameShell.tsx
        authority/
        controllers/
        machine/
        presentation/
      scene/
        PixiBoard.tsx
        BoardScene.ts
        layers/
        actors/
        animations/
      ui/
        hud/
        cards/
        dialogs/
      audio/
    public/assets/
  game-server/
    src/
      http/
      websocket/
      rooms/
      persistence/
packages/
  game-core/
  game-ai/
  game-protocol/
  game-content/
```

## 9. 声音接口

第一阶段只建立调用边界，不包含声音文件、背景音乐或具体播放库。

```ts
interface AudioPort {
  preload(cues: string[]): Promise<void>
  play(cue: string, options?: { volume?: number; loop?: boolean }): void
  stop(cue?: string): void
  setMuted(muted: boolean): void
  dispose(): void
}
```

开发和首版运行时使用 `NullAudioPort`。游戏逻辑只发出诸如 `dice.roll`、`token.hit`、`card.flip` 的声音提示，不感知提示是否实际播放。

## 10. 性能基线

- 在 1280 x 720 和 1920 x 1080 下目标为稳定 60 FPS。
- 设备像素比最高按 2 渲染，避免高分屏无意义增加显存消耗。
- 静止场景允许降低动画频率，但不能让 UI 输入产生延迟。
- 棋盘纹理、地标和卡牌图应使用纹理图集或合理分组加载。
- 首屏加载资源建议控制在 8 MB 内，完整对局资源建议控制在 20 MB 内。

## 11. 测试策略

- 规则测试：折返、碰撞、暂停、额外行动和终点判断。
- 状态机测试：每个状态都能进入和退出，不存在重复回合。
- 内容测试：事件 ID 唯一、效果合法、资源路径存在。
- 模拟测试：使用固定种子自动运行至少 1,000 局，确保没有死局。
- 组件测试：道具替换、事件选择、日志与重新开始。
- 场景测试：检查棋盘成功渲染、棋子坐标有效、表现队列可以完成、超时和由快照快进。
- 地图测试：使用一张不同格数的测试地图验证移动、折返、胜利判断和场景创建均未硬编码默认地图。
- 皮肤测试：所有皮肤动画键和资源存在，并验证更换 `skinId` 不改变任何规则结果。
- 表现顺序测试：路线完成、目标圈完成、路线消失后才能开始棋子跳跃，不能跳过或重复移动状态。
- 人数组合测试：`1v1`、`1v2`、`1v3` 都能按实际座位数推进，跳过暂停者，且轮次只在整轮完成后增加。
- 座次测试：2 至 4 人单骰结果按降序排列；只重掷同点小组；连续同点可继续拆组；固定种子可重放相同座次和投掷历史。
- 协议测试：命令与快照可 JSON 往返、重复命令幂等、过期 revision 被拒绝。
- 控制器一致性测试：本地、AI 和模拟远程控制器提交相同命令时产生完全相同的规则结果。
- 恢复测试：从任意回合快照恢复后，后续固定命令与随机结果和不中断的对局一致。
- Vite/React 边界测试：路由切换和组件卸载后 PixiJS Application、ticker 与监听器正常销毁。
- 服务边界测试：在线阶段验证静态前端重新部署不影响现有权威房间，游戏服务器重连由快照协议恢复。
