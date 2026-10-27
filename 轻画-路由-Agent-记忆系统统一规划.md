# 轻画：路由、Agent Runtime、记忆与套件统一规划

> 状态：v1.5，2026-10-27。阶段 1 持久队列完成；阶段 2 生成路由闭环完成（策略 UI、
> Key 分组候选、三宿主接入、尝试审计与删除边界）；阶段 3 的 AgentJob/AgentEvent 核心
> 与轮数检查点续跑已完成。运行中 Steer/Interrupt、文本路由与记忆/套件仍待后续。
> 性质：专项设计。冲突时仍以《轻画-功能对账清单.md》为准。
> 目标：在保留三个独立工作台、现有 runEngine 和现有数据真相的前提下，建立共享路由、
> Agent Runtime、个人记忆与品牌套件的统一边界。

## 1. 结论

1. 不整体替换成 Harness，也不把现有 Agent 改写成多个自由聊天的 Agent。
2. 先建立“任务”这一层：一个会话同一时刻只允许一个活动任务，后续消息默认排队。
3. 路由、任务队列、记忆解析是公共能力；画布、电商、漫剧各自拥有业务 Planner 与
   Placement，不能共享业务大脑。
4. 主管 Agent 是唯一与用户对话和最终提交画布变更的角色。其余 Worker 默认只读，
   通过结构化提案交给主管。
5. 已提交给上游的付费请求不可修改；超时或结果不明时不自动重发。
6. 品牌/角色/产品套件必须版本化。旧项目固定旧版本，不自动跟随最新套件。
7. 不新增“记忆、路由、队列、Agent 管理”一级菜单。相关入口放进现有设置、素材库、
   Agent 浮窗和项目设置。

## 2. 产品 Agent 分工

这里的“Agent”分两类：需要模型推理的角色，以及确定性执行服务。不能把算法和队列也包装成
LLM，否则只会增加延迟和不确定性。

| 角色 | 类型 | 负责什么 | 不负责什么 |
| --- | --- | --- | --- |
| 主管 Agent | LLM | 与用户对话、读取 ContextBundle、拆任务、汇总、征求确认、提交最终变更 | 不直接读 Key、不直接调用渠道适配器、不进多个写出队列 |
| 业务规划 Agent | LLM，按工作台配置 Profile | 画布规划 / 电商套图规划 / 漫剧分镜与连续性 | 不写画布、不发付费请求、不拥有全局记忆 |
| 布局执行器 | 确定性服务 + 可选小模型 | 把 LayoutSpec 求成坐标，处理对齐、等距、网格、流程泳道、避障和评分 | 不生成图片、不删除节点、不直接提交写入 |
| 生成协调器 | 确定性服务 | 把已批准 RunPlan 交给 runEngine，关联 jobId / runPlanId / runRecordIds | 不自行选渠道、不改已提交请求、不绕过日志 |
| 视觉验收 Agent | 视觉模型 | 检查产品一致性、品牌色、Logo、文字、人物连续性、图片质量 | 不直接写画布、不自动重跑付费请求 |
| 记忆整理器 | 低成本 LLM + 纯规则 | 提取候选记忆、去重、找冲突、建议作用域 | 不静默覆盖长期记忆、不把一次性要求永久化 |

### 2.1 主管 Agent 需要的能力

- 读取当前工作台、项目、会话和当前任务状态。
- 读取经过预算裁剪的 `ContextBundle`，而不是全量个人记忆和所有套件。
- 支持 `queue / steer / interrupt` 三种用户消息语义。
- 生成结构化计划，调用业务 Planner 和确定性工具。
- 只接收 Worker 的结构化结果，不把 Worker 的内部聊天直接塞回用户上下文。
- 提交画布写入前检查 `baseRevision` 和写租约。
- 把确认、执行、暂停、失败、结果不明和取消说清楚。

### 2.2 业务规划 Agent 需要的能力

每个工作台复用同一个 Runtime，但配置不同：

| Profile | 必需能力 |
| --- | --- |
| 画布 | 读取图摘要、布局规则、节点工具、素材引用、动态画布尺寸与选区 |
| 电商 | 品牌/产品套件、平台规则、批量计划、跨图一致性、逐张生成与验收 |
| 漫剧 | 角色/场景套件、镜头连续性、分镜依赖、视频/配音任务 |

业务 Planner 只产出运行计划或差分提案，不持有可写 Store。

### 2.3 布局执行器需要的能力

- 输入为 LayoutSpec，不接受模型逐节点手算几十组坐标。
- 支持 `flow-lr / flow-tb / row / column / grid / pack`。
- 支持左/右/上/下对齐、水平/垂直等距、统一宽高、区域边界。
- 保持上下游相对关系，自动避开现有节点和容器。
- 输出 `LayoutPlan { baseRevision, moves[], collisions, score }`。
- 通过一个事务应用，可一次撤销；预览确认前不写画布。
- 只返回布局摘要，不把每段提示词和整张图重复塞进模型上下文。

### 2.4 视觉验收 Agent 需要的能力

- 接收真实图片、品牌套件版本、产品/角色套件版本和验收清单。
- 检查 Logo、主色、字体、产品结构、人物身份、错字、裁切、构图和整套一致性。
- 输出问题清单与可执行修改建议，不能只说“有点不好看”。
- 通过程序检查先处理尺寸、文件类型、空白图、颜色采样和 OCR 等确定性问题。
- 最终验收结果由用户终审；视觉 Agent 不自动花下一笔钱。

### 2.5 记忆整理器需要的能力

- 只从已完成且用户确认过的事实中提取候选。
- 建议作用域：仅当前会话、当前项目、所有电商项目、所有工作台。
- 区分事实、偏好、约束、项目决定和一次性要求。
- 支持冲突检测、修订历史、过期时间、删除和一键忘记。
- 密钥、Cookie、密码、令牌永不进入记忆。

## 3. 共享能力与工作台私有边界

```text
公共能力
  RouteResolver / RouteExecutor
  Agent Runtime / 持久任务队列 / 上下文组装
  ContextBundle / 个人记忆 / 套件存储
  runEngine / GenerationClient / RunRecord
  素材、技能、灵感、模型与渠道配置

工作台私有
  画布：节点图、Canvas Planner、Canvas Placement、画布写租约
  电商：套图方案、Ecommerce Planner、任务/结果、工作区投影
  漫剧：剧本、分集、镜头、Storyboard Planner、成片与音频
```

| 能力 | 唯一事实源 | 禁止事项 |
| --- | --- | --- |
| 执行 | `RunRecord` + 工作台业务结果表 | 每个工作台复制一套日志数据库 |
| 路由 | `RoutePlan` / `RouteAttempt` | 执行器二次随机换渠道 |
| Agent 任务 | `AgentJob` + `AgentEvent` | 用一个布尔 status 冒充完整生命周期 |
| 记忆 | `contextMemories` + revision | 把一次性对话自动升级为永久偏好 |
| 套件 | `contextKits` + immutable version | 编辑套件时静默改变旧项目 |
| 素材 | 内容寻址 `assets` | 每个套件复制一份图片字节 |
| 技能 | 全局 Skill Registry | 把品牌事实塞进技能正文当数据库 |

## 4. Agent Runtime

### 4.1 状态机

| 状态 | 含义 | 可进入 |
| --- | --- | --- |
| `queued` | 已接收，等待当前任务结束 | `planning` / `canceled` |
| `planning` | 模型正在理解、读取或规划 | `waiting_confirmation` / `waiting_generation` / `paused` / `failed` |
| `waiting_confirmation` | 等待用户确认 | `planning` / `paused` / `canceled` |
| `waiting_generation` | 已交给执行器 | `planning` / `completed` / `needs_attention` |
| `paused` | 安全停点，可继续 | `planning` / `canceled` |
| `needs_attention` | 可能已提交付费请求，但结果不确定 | 用户确认后 `completed` / `failed` |
| `completed / failed / canceled` | 终态 | 不可回退 |

### 4.2 Queue / Steer / Interrupt

- `queue`：默认行为。当前任务完成后才进入模型上下文。
- `steer`：只在下一次模型调用前或尚未提交的下一批生成前插入。
- `interrupt`：停止后续规划或未开始波次，但不宣称已提交的付费请求未发送。
- 一个会话同一时刻只有一个活动 Job 和一个消息写入者。
- 同一画布同一时刻只有一个写租约；其他 Worker 只能提交差分提案。
- 已提交请求只停止本地等待和后续调度，不修改参数、不自动换目标、不自动重发。

### 4.3 长任务与八轮上限

单个 `runAgentTurn` 的八轮保留为防打转的安全预算，但不再等于整个任务失败。

- 达到预算时保存检查点，状态进入 `paused`。
- 用户可点击继续；下一段沿用任务、图版本和同一路由计划。
- 无进展检测同时看重复工具、图版本未变化、Token/成本预算和墙钟时间。
- 队列、生成和验收不占用模型工具轮数。

### 4.4 恢复与幂等

- 入队消息有稳定 `messageId`。
- 工具效果按 `(jobId, stepId, toolCallId)` 去重。
- 付费请求按 `(operationId, taskId, attempt)` 去重。
- 重启后：`queued` 保留；未提交任务恢复为 `paused`；已提交任务只查状态；
  结果不明进入 `needs_attention`，绝不自动重新生成。

## 5. 路由模块

### 5.1 职责

- `RouteResolver`：纯函数。展开候选、应用用户勾选、排序、轮询并产出不可变 RoutePlan。
- `RouteExecutor`：按 RoutePlan 执行，只依据发送阶段和错误分类决定是否换组。
- `GenerationClient`：接收明确渠道、Key 分组和上游模型，只发一次请求。
- Agent 文本调用和图片/视频生成共用 RouteResolver；只是能力类型不同。

### 5.2 候选与策略

候选单位：

```text
RouteCandidate = 渠道 × Key 分组 × 前端逻辑模型 × 能力类型
```

- 一个请求地址只建一个渠道，多把 Key 是同一渠道下的多个分组。
- 用户可勾选哪些 Key 分组参与路由；未勾选不能作为候选。
- 支持 `priority / roundRobin / weighted / performance`。
- `roundRobin` 使用按“逻辑模型 + 能力类型”持久化的游标，不再拿随机分摊冒充轮询。
- Agent 一轮开始时固定 RoutePlan，同一轮后续确认和执行不中途换 Key 分组。
- 节点显式锁定渠道时，只允许该渠道内换 Key 分组，绝不跨渠道。

### 5.3 安全降级

| 情况 | 是否允许换组 / 换渠道 |
| --- | --- |
| 明确未发送、401、403、正常 429 | 可以，按策略继续 |
| 提交前明确 5xx | 可以 |
| 超时、408、响应丢失、取消 | 不可以自动重发 |
| 已取得异步 taskId | 只轮询，不换目标 |
| 参数错误、内容审核失败 | 不换，交给用户修改 |

每次尝试都要记录渠道、分组、上游模型、阶段、HTTP 状态、耗时和降级原因。

## 6. 记忆与套件

### 6.1 五层边界

| 层 | 存什么 | 作用域 |
| --- | --- | --- |
| 个人记忆 | 稳定偏好、语言、审美、常用工作方式 | 用户全局，可按会话关闭 |
| 品牌/角色/产品/自定义套件 | 事实、规范、身份锚点、参考资产 | 用户全局定义，项目显式绑定 |
| 项目 | 本项目目标、文案、尺寸、锁定版本、验收要求 | 单项目 |
| 技能 | 这类任务按什么流程做 | 全局内容资产 |
| 会话记忆 | 当前对话已决定了什么、任务做到哪 | 单会话 |

### 6.2 数据模型

- `assets`：内容寻址字节与基础元数据。
- `assetLibrary`：用户收藏关系。
- `assetUsages`：素材被哪个工作台、项目和使用角色引用。
- `contextMemories`：记忆头和当前状态。
- `contextMemoryRevisions`：不可变修订、来源、置信度、确认人和替代关系。
- `contextKits`：统一承载品牌、角色、产品、自定义四类套件。
- `contextKitVersions`：不可变版本，保存 Markdown 指南、结构化 tokens、资产引用和校验。
- `projectContextBindings`：项目绑定套件版本、硬锁/软偏好和是否允许升级。
- Agent 任务和 RunRecord 只保存 `contextDigest / memoryRefs / kitVersionRefs`，
  不复制完整个人资料和素材字节。

### 6.3 ContextBundle

```ts
ContextBundle {
  request
  scope { workbench, projectId, sessionId, taskId }
  hardConstraints[]
  softPreferences[]
  procedures[]
  sessionDecisions[]
  exclusions[]
  budget
  digest
}
```

规则：

1. 安全、协议能力和平台规则最高。
2. 当前用户明确要求高于历史记忆。
3. 项目硬锁高于个人偏好。
4. 品牌/产品事实高于风格描述。
5. 同层级取更新、更具体、已确认的内容。
6. 硬约束冲突时在付费请求前停止并说明；软偏好冲突时丢弃低优先级项。
7. 技能只决定“怎么做”，不能覆盖品牌事实、产品事实和当前要求。

### 6.4 使用范围

- 画布：个人记忆 + 可选套件 + 当前引用，保留探索空间。
- 电商：品牌套件 + 产品套件 + 平台规则 + 本批文案，强调套内一致性。
- 漫剧：角色套件 + 画风/品牌套件 + 项目连续性，强调跨镜身份一致。

个人记忆可被三个工作台读取，但每次只注入本次必要片段。套件不自动套用，必须由项目或
本次任务显式选择。

## 7. 数据与迁移

第一阶段先复用 `agentSessions` 保存 `queuedTurns`，避免为了一个队列立即升级整库 schema。
字段只追加，旧会话读回为空数组。

后续统一升级时再引入：

- `agentJobs`
- `agentEvents`
- `routePolicies`
- `routeAttempts`
- `contextMemories`
- `contextMemoryRevisions`
- `contextKits`
- `contextKitVersions`
- `projectContextBindings`

迁移要求：

- 旧会话、旧项目、旧素材、旧技能均可读。
- 新增字段缺省不改变已有行为。
- 迁移失败可回滚，不能删除旧数据后再尝试。
- 旧项目默认不自动绑定任何品牌/角色套件。

## 8. UI 位置

- 队列：Agent 输入框上方，可折叠、显示数量、单项删除、空闲时手动继续。
- 个人记忆：全局设置里的“Agent 与记忆”，不新增一级菜单。
- 套件：现有“我的素材”内的二级切换，分类为品牌、角色、产品、自定义。
- 项目绑定：项目设置或 Agent 上下文入口。
- 路由：现有模型服务的“路由”子面板，直接勾选并排序已有渠道/Key 分组。
- Agent 团队：现有 Agent 设置里的高级项，普通用户仍只看到主管 Agent。

## 9. 分阶段实施

| 阶段 | 内容 | 退出条件 |
| --- | --- | --- |
| 0 | 统一规划、边界和对账登记 | 文档落盘，缺口入账 |
| 1 | 会话级持久队列、单回合门禁、消息写回防覆盖 | Enter 忙碌时只入队；重启队列不丢；旧测试全绿 |
| 2 | RouteResolver / RoutePlan、分组勾选、轮询与尝试日志 | 超时不重发；显式渠道不漂移；轮询可复现 |
| 3 | AgentJob / AgentEvent、Queue/Steer/Interrupt、检查点续跑 | 长任务可继续；同画布单写者；重启不重复付费 |
| 4 | 个人记忆、品牌/产品套件、ContextBundle | 版本固定；冲突可解释；旧项目不变 |
| 5 | 角色/自定义套件、视觉验收与只读子代理 | 子代理不能写画布；验收有真实图片证据 |
| 6 | 总日志扩展、完整 UI、迁移和发布门禁 | 四类日志不重复；单测、检查、构建、真实桌面验收通过 |

阶段 2 的路由纯函数和阶段 4 的领域模型可并行；Agent Runtime 必须等队列与 RoutePlan
契约稳定后再改。

2026-10-27 当前证据：全量 Vitest **3411 passed / 1 skipped**，Rust **34/34**；
`npm run check`、`npm run build` 通过；真实页面 G769 **13/13**，覆盖队列持久化、
AgentJob 取消、中断恢复、确认卡恢复、路由尝试日志、路由范围候选与全屏边界、轮数检查点，
并在 V1 JSON / V2 SQLite 隔离库各跑一遍。
这只证明生成路由闭环、任务状态机和轮数检查点可用，不证明 DirectRun 尝试转存、文本 Agent
同策略、运行中 Steer/Interrupt 或长期记忆完成。

## 10. 验收矩阵

- 同会话连续按两次 Enter，不启动两个模型回合。
- 生成中发送新要求，只进入队列，不修改当前请求。
- 队列关闭面板再打开仍在；已提交任务重启后不自动重发。
- 一个会话在后台完成时，切到别的会话不会串消息、清草稿或清素材。
- 显式渠道选择失败时只在该渠道内换 Key 分组，不跑到其他渠道。
- 轮询 N 次按游标分布；空 Key 分组不参与；删除分组后后续尝试不再选中。
- 超时、408、响应丢失只提交一次；401/403/429 才按策略降级。
- 布局一次预览、一次事务、可一次撤销；大图不重叠且不触发 O(N²) 重复扫描。
- 项目绑定品牌 v3 后，品牌 v4 发布不会改变旧项目结果。
- 硬约束冲突在付费请求前停止；RunRecord 能看到实际上下文引用。
- 视觉验收 Agent 只能提交问题清单，不能自动重跑或写画布。
- 旧项目、旧会话、旧素材、旧技能和三个工作台主流程无回归。

## 11. 明确不做

- 不因为参考 Harness 就整体替换现有 Agent。
- 不让多个 Agent 同时直接写同一画布。
- 不把渠道库存、路由策略和 Key 分组混成同一个布尔配置。
- 不把权重随机命名为轮询。
- 不把个人记忆当作品牌事实。
- 不把品牌 Markdown 当作精确色值/尺寸的唯一来源。
- 不自动跟随最新套件版本。
- 不在 UI 里新增记忆、路由、队列的一级菜单。
- 不把超时、408 或结果未知当作可安全重发。

## 12. 代码落点

| 模块 | 目标位置 |
| --- | --- |
| Agent 队列纯领域规则 | `src/domain/agent/queuedTurn.ts` |
| Agent 会话持久化 | `src/state/agent/sessionStore.ts` |
| Agent 浮窗与队列 UI | `src/workbenches/canvas/panels/AgentPanel/` |
| 路由纯函数 | `src/domain/project/modelRouting.ts` 及后续 `routePlan.ts` |
| 路由执行与日志 | `src/features/shared/execution/` / `src/platform/generation/` |
| 共享 Agent Runtime | 后续 `src/features/shared/agent/` |
| 记忆与套件领域 | 后续 `src/domain/shared/context/` |
| 记忆、套件与任务存储 | 后续 `src/state/shared/context/` / StoragePort |

现有实现证据：

- `src/workbenches/canvas/agent/agentLoop.ts`：8 轮上限与工具循环。
- `src/workbenches/canvas/panels/AgentPanel/AgentPanel.tsx`：单回合同步等待和会话状态。
- `src/state/agent/sessionStore.ts`：会话历史、窗口与新建队列表。
- `src/domain/project/modelRouting.ts`：现有渠道、分组与候选选路。
- `src/features/shared/execution/runEngine.ts`：公共执行、重试与 RunRecord。
- `src/domain/shared/assetLibrary.ts`：素材收藏关系。
- `src/domain/prompt/skill.ts`：技能正文契约。

## 13. 第一批已开始制作

阶段 1 先交付会话级持久队列。2026-10-27 已完成的基础件：

- `QueuedAgentTurn` 固化文字、模型、技能、图片/视频模型和素材引用。
- 旧会话没有队列字段时安全回落空数组。
- 队列最多 20 条，FIFO。
- 回合结束只更新 `messages`，不再用旧 session 整行覆盖后入队任务。
- 队列随会话落库，关闭面板或切会话后不丢。
- 忙碌时输入框仍可发送；默认加入队列，不启动第二个回合。
- 队列卡显示数量、展开项、单项移出和手动继续。
- 队首先标记为活动、完成后才移出；进程中断恢复保留队首。
- 活动锁跨画布页卸载重挂保留；待确认工具调用随会话恢复。

阶段 2 已完成的路由内核：

- `RoutePlan` 以“渠道 × Key 分组 × 逻辑模型 × 能力”为候选。
- 支持 priority / performance / balanced / round_robin。
- 用户允许候选为空时保持旧行为，非空时严格限制，不会静默回落。
- 轮询游标按“逻辑模型 + 能力”持久化，返回可复现的下一游标。
- `RunRecord.routeAttempts` 记录每次分组、实际模型、错误类型、HTTP 状态、发送阶段和耗时。
- 画布日志显示“路由 N 次”，悬停可读每次尝试；旧记录不显示该胶囊。
- 模型服务可直接切换四种策略、最大尝试次数，并逐渠道 Key 分组勾选参与路由的候选。
- 画布、电商、漫剧在规划期附带有序真实候选，执行器按候选渠道、分组和各自上游模型尝试。
- 只对 401 / 403 / 429 / 5xx 继续候选；超时、408、响应丢失和结果未知不重发。
- 删除任一在用候选渠道会停止相关运行，不能继续落到已删除 Key。

阶段 3 已完成的检查点：

- 单回合达到 8 步预算时返回 `checkpoint: max_steps`，不再把正常长任务显示成错误。
- 工具结果和完整消息已经落库；`continuation` 只存恢复意图、步数和原队列项 id。
- 页面关闭重开后恢复“继续任务”卡；继续会复用已有历史，不重放已完成工具。
- 队列任务暂停时保留 `activeTurn` 领取和队首项；最终完成或用户停止后才释放。
- `agentJobs` 保存任务状态、revision、operationId、checkpoint 与 pending call；
  `agentEvents` 按 jobId + seq 原子追加 created / status / confirmation / generation /
  recovered / terminal 事件。
- 会话内只允许一个活动 Job；queued Job 可排队。重启恢复时 planning → paused，
  waiting_generation → needs_attention，已提交结果不明不会自动重发。
- 移出排队项会把对应 Job 标为 canceled；删除会话或项目会级联清理 Job 与事件。

仍待完成：运行中 Steer/Interrupt 的模型调用级中断、DirectRun 尝试转存、文本 Agent 使用
同一轮询策略、个人记忆与品牌/角色/产品套件。
