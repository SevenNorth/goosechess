# 阶段 7 桌面版发布质量报告

## 1. 发布体验

验证日期：2026-07-29。

- Pixi 棋盘在资源加载期间显示真实百分比和进度条；失败时保留 setup 状态并提供鼠标可用的重新加载入口，不显示无反馈的空白 Canvas。
- 表现设置提供 `0.75x`、`1x`、`1.5x`、`2x` 动画速度和镜头运动开关。镜头只改变 Pixi 表现，不进入规则、快照或 AI。
- 页面小于 `1180 x 680` 或处于竖屏时显示明确的桌面横屏提示，不实现竖屏布局。
- 图标命令具有 `title` 和 accessible name；玩家名使用省略和原文 tooltip，事件、道具和终局标题允许长词换行。
- 移除 Google Fonts 网络依赖。离线对局只加载同源静态资源，不发送游戏 API、XHR 或 WebSocket 请求。
- 动画 12 秒超时、页面失焦快进、失败快进和 restart 都回到最新 authority 快照。

## 2. 性能与资源

Pixi renderer 的 device pixel ratio 上限为 `2`。66 格、地标和纸面背景被烘焙为静态缓存纹理，棋子主体也使用缓存纹理；动态路线、目标圈、跳跃和终局效果仍独立绘制。

硬件加速 Chromium，NVIDIA GeForce GTX 1650 / D3D11：

| 视口 | 平均帧率 |
| --- | ---: |
| `1280 x 720` | 60.5 FPS |
| `1920 x 1080` | 60.3 FPS |

无头 CI 使用 SwiftShader 软件渲染，不作为目标设备帧率。自动化在该环境设置 10 FPS 的严重退化下限；硬件渲染仍要求至少 50 FPS。

生产构建资源：

| 范围 | Raw | Gzip |
| --- | ---: | ---: |
| 首屏 shell | 392.8 KiB | 118.6 KiB |
| 完整发布目录 | 2350.6 KiB | 1637.4 KiB |

`npm run check:release` 同时执行体积预算和文件禁入检查，拒绝参考截图、录屏、临时帧、调试种子资源及视频文件进入发布目录。

## 3. 稳定性

`npm run e2e:stability` 默认执行 30 分钟；`npm run e2e:stability:smoke` 执行 6 秒机制检查。长跑关闭 Playwright trace，避免数千次操作本身占用大量内存，关键 E2E 仍保留失败 trace。

最终 30 分钟结果：

- 同一浏览器上下文连续完成并重开 71 局 `1v3`。
- 每 10 秒采样，共 170 组 scene、ticker、资源、监听器和 tween 诊断。
- 强制 GC 后 JS heap 从 47.4 MB 增至 64.0 MB，增长 16.6 MB，低于 40 MB 门限。
- 收尾状态为 1 个 scene、1 个 ticker handler、11 个地图纹理、0 个窗口监听器、0 个 tween。

长跑在开发期间发现并修复已完成 tween 未从 Group 移除的问题，以及 Pixi 初始化失败时错误销毁未初始化 Application 的问题。

## 4. 自动化与 CI

`.github/workflows/release-quality.yml` 在 push 和 pull request 上执行：

```powershell
npm ci
npm run typecheck
npm run lint
npm run test
npm run validate:content
npm run check:versions
npm run build
npm run check:release
npm run e2e:ci
```

`spec/version-baseline.json` 保存协议 schema、规则实现和内容定义的版本与 SHA-256 基线。对应文件变化但 `PROTOCOL_SCHEMA_VERSION`、ruleset version 或 content version 未升级时，CI 失败。

Playwright 覆盖三个模式鼠标开局、固定种子终局、63/64/65 获胜、加载进度、资源失败重试、设置、最低尺寸提示、2x DPR、目标分辨率帧率、失焦快进、20 次 Pixi 重建和完整阶段 6 回归。
