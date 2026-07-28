# 阶段 5 PixiJS 核心体验样片报告

## 1. 实现范围

验证日期：2026-07-28。

`/play` 已从旧 DOM 棋盘切换为基于 PixiJS 8 的 16 格横屏样片。该地图是独立 `MapDefinition`，不替换或修改正式 65 格地图，用于证明渲染和交互没有硬编码格子数量。页面支持 `1v1`、`1v2`、`1v3`，并可通过 `?seed=<整数>` 重放固定局面。

样片使用正式 `LocalAuthority` 和 `LocalGameController` 推进规则。React 负责 HUD、准备、事件、道具和结果层；Pixi 场景只读取快照与 `PresentationCue`。皮肤只改变棋子颜色，不进入骰子、AI 或效果计算。

## 2. 核心表现

- Pixi 场景包含桌面、纸张、路线、格子、地标、棋子、特效和前景分层，并以 `1280 x 820` 逻辑坐标等比缩放。
- XState 表现状态机约束 `骰子 -> 路线 -> 目标圈 -> 路线消失 -> 跳跃移动` 的顺序。
- 棋子逐格执行压缩、抛物线、阴影变化与落地回弹；折返时在方向变化点停顿并翻转。
- React 在表现队列执行期间锁定重复命令，事件层和结果层等待棋盘播放完成后再显示。
- `PixiBoard` 延迟导入 Pixi，卸载时销毁 Application、ticker、tween、ResizeObserver 和音频端口。
- 已建立 `AudioPort` 与无操作实现 `NullAudioPort`。阶段 5 不包含声音文件或播放库。

## 3. 样片资源

原始程序化 PNG 由 `scripts/generate-sample-assets.mjs` 确定性生成，输出到 `apps/web/public/assets/sample/`：

- 桌面纹理与棋盘纸张。
- 维修室、拾荒沙滩和试航终点地标。
- 明确表现为黄色犬类的“大黄狗”地标。

这些资源不使用或打包 `example_screenshots/` 中的参考素材。内置图像生成工具在本次环境中不可用，因此没有调用外部图像 API。

## 4. 自动化验收

执行命令：

```powershell
npm run typecheck
npm run lint
npm run test
npm run build
npm run e2e
```

结果：类型检查、lint、包依赖边界和正式构建通过；11 个单元测试文件共 61 项测试通过；5 项 Playwright 测试通过。

Playwright 覆盖：

- `1280 x 720`、`1600 x 900`、`1920 x 1080` 下 Canvas 非空、像素有变化且棋盘完整可见。
- 固定种子 `3` 下，六个表现状态按规定顺序出现。
- 固定种子 `3` 下，选择骰子检定事件后显示对应的成功或失败结果层。
- 骰子动画期间触发窗口失焦后，表现队列在 2 秒内快进到权威快照并显示事件层。
- 连续重新创建并销毁 Pixi Application 20 次，DOM 中始终只有一个 Canvas。

项目自带 Playwright Chromium 完成了浏览器验收；应用内浏览器在本次环境中不可用。生成的测试截图和报告位于 Git 忽略的 `test-results/` 与 `playwright-report/`，不会进入发布资源。

## 5. 阶段边界

阶段 5 的退出条件已满足。样片只包含 16 格核心流程；完整 65 格坐标、九个地标、全部事件和道具、胜利舞台及完整碰撞演出仍属于阶段 6。
