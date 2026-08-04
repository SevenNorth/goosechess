# 下次对话初始 Prompt

将下面代码块中的内容作为下一次 Codex 对话的第一条消息。开始前如果本文件中的提交号、完成状态与仓库实际状态冲突，以 `git status`、`git log` 和最新规格文档为准。

```text
继续开发 E:\MyProject\GooseChess（鹅了个棋网页版）。

先完成交接检查，不要凭聊天记忆直接修改代码：

1. 查看 `git status --short --branch`、最近提交记录和当前分支，确认工作区是否干净；保留所有已有改动，不要回退不属于你的内容。
2. 阅读 `spec/README.md`、`spec/implementation-plan.md`、`spec/feedback.md`、`spec/online-multiplayer-plan.md` 和 `spec/admin-content-platform.md`。涉及玩法、视觉或架构时，再阅读对应的 `game-design.md`、`visual-design.md` 和 `technical-design.md`。
3. 检查实际代码、测试和文档是否一致；规格文档是需求基线，但已完成状态必须以代码和验证结果为证据。
4. 先用简短中文向我说明：当前完成到哪里、仍有哪些未完成项、你建议本次优先做什么，以及理由。除非确实存在会改变产品方向的选择，否则不要停留在计划阶段，继续完成建议的下一项。

当前交接基线：

- `main` 在编写本交接前最新业务提交为 `62eda47 feat: 完成在线对局生产化发布门禁`；开始工作时必须重新核对实际 HEAD 和远端同步状态。
- 离线桌面版的核心玩法、65 格奥普港地图、事件和道具表现、开局座次与道具选择、地图预览、棋子皮肤、本地档案以及发布门禁已经基本完成。
- 在线对局已经具备独立 `apps/game-server`、私人房间、完整地图、服务端权威随机与 AI、断线恢复、房主转移、SQLite 持久化及服务重启恢复。
- 在线阶段已经完成可观测性、限流、协议指标、异常对局诊断、PostgreSQL 多实例共享租约、房间 owner 路由和 fencing token，以及 Chromium、Firefox、WebKit 跨浏览器/高延迟 E2E 与邀请制发布验收。
- 管理员内容平台已经开始实施：独立 `apps/content-server` 已具备 SQLite 账号仓储、scrypt 密码哈希、HttpOnly 会话、bootstrap 管理账号和服务端 RBAC；`apps/admin`、`packages/content-tools` 以及内容生命周期尚未实现。
- 管理角色最小集合为 `player`、`content-editor`、`admin`。所有权限必须由服务端强制校验。
- 内容采用“草稿 → 自动校验 → 游戏内预览 → 审核 → 不可变版本发布”的流程；进行中房间锁定开局时的 `contentVersion`、规则集版本和地图版本。
- 普通玩家自制内容、角色属性、角色技能和养成系统不在范围内；棋子皮肤只能改变外观。

默认优先级：

- 如果我没有给出新的功能方向，在线生产化阶段完成后进入账号与管理员内容平台。
- 下一实施优先级：草稿、修订、校验、审核、发布、回滚和审计模型 → 事件编辑器 → 地图编辑器 → 皮肤制作页面。
- 管理员平台下一阶段先建立草稿、校验、审核、发布、回滚和审计模型；不要直接从三个编辑页面之一开始堆界面。

工程约束：

- 这是 npm workspaces 项目，Node.js 要求 `>=22 <25`。
- React + Vite 负责 Web UI，PixiJS 负责棋盘，XState 负责流程状态机；规则逻辑不能写入 React 或 PixiJS 组件。
- 权威随机、规则状态和内容版本必须可序列化、可回放；客户端不能自行决定骰子或结算结果。
- 静态可读文字不得小于 14px；桌面横屏基准为 1600×900，最低支持 1180×680。
- 保持修改范围聚焦，沿用仓库现有模式；新增共享行为要补测试，修改规格时同步相关文档。
- 需要启动 Web 开发服务时使用 5173；启动前先检查端口，任务结束或我要求时停止由你启动的服务。
- 不要把 `example_screenshots`、测试报告、临时截图、构建产物或本地密钥提交到仓库。

常用验证命令：

`npm run typecheck`
`npm run lint`
`npm run test`
`npm run validate:content`
`npm run build`
`npm run e2e`

验证范围应与改动风险匹配。完成后说明修改内容、验证结果、尚存风险和 Git 状态；除非我明确要求，否则不要自行推送远程。
```
