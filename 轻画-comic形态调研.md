# 轻画 · comic 工作台形态调研与建议

> 用途：M6 动笔前的形态决策输入。**本文是建议稿，形态最终由产品决策拍板。**
> 调研方式：只读开源项目的数据模型与格式规范（不抄实现），一手来源附在文末。
> 对应文档：产品文档 §8 / §15，架构文档 §5.10 / §9.4。

---

## 1. 结论先行

**建议形态一句话**：

> **一「话」= 页序列；每页版式用「切割树」表达（切割顺序即阅读顺序）；每格 = 画面描述（喂生图）+ 镜头语言 + 对白层（贴纸，不烘进图）三层分离；角色卡跨格复用保证 AI 一致性；阅读方向为项目级设置。**

四条核心主张（每条都有开源先例，见 §3）：

| # | 主张 | 为什么 |
| --- | --- | --- |
| 1 | **对白层与图像层分离** | 我们是 AI 生图工具，图会被反复重生成。对白若烘进图，每次重生成都要重排对白。ACBF 规范把 text-layer 独立于 background image 的核心动机就是"可翻译 + 可单独编辑"。 |
| 2 | **页版式用「切割树」而非"存每个格子的矩形"** | 满页 → 反复切割，每次切割只需 {方向, 位置, 条数, 微倾}，切成任意复杂版式。内存极小、天然可嵌套、**切割顺序就是阅读顺序**，且"从满页切两半"这类高频操作是一等公民。 |
| 3 | **镜头语言是一等元数据** | 分镜工具的 board 数据结构里 `shot type` 是核心字段（Storyboarder）。景别/机位/格间转场决定画面，不该塞进提示词字符串里自然语言化。 |
| 4 | **角色卡实体** | 跨格外观一致性是 AI 漫画的头号痛点（多家 AI 漫画工具都以"角色一致性"为卖点）。Manga109 的元数据框架里 character 是独立实体。角色卡 = 名称 + 外观描述 + 参考图，与画布 generation 节点的"图生图"能力天然衔接。 |

---

## 2. 调研范围

分四类找参考，只取**数据模型/格式规范**层面的结论：

| 类别 | 代表 | 看什么 |
| --- | --- | --- |
| 数字漫画分发格式 | **ACBF**、ComicsML | 页/格/文本层如何组织，对白类型词表 |
| 学术标注框架 | **CBML**（TEI 扩展）、**Manga109** 元数据框架、**eBDtheque** | 领域实体划分、对白分类、阅读顺序 |
| 分镜/故事板工具 | **Wonder Unit Storyboarder** | 镜头语言的字段化、board 数据形状 |
| 画布类编辑器 / 生成器 | **comic-drawer**、**graphic-novel**、**comfyui_panels**、**comic_book_creator** | 版式交互流派、切割树算法、脚本→漫画的数据流 |

---

## 3. 开源参考对比表

| 项目 / 规范 | 类型 | 结构层级 | 对白组织 | 版式表达 | 可借鉴的关键点 |
| --- | --- | --- | --- | --- | --- |
| **ACBF**（Advanced Comic Book Format） | XML 分发格式 | document → page → frame(panel) + text-layer | `text-area` 带 `type` 词表；**独立于背景图的文本层** | `text-area@points` 多边形 + `frame` | ⭐ **文本层与图像层分离**；`text-area@type` 十档词表；`page@transition`（fade/blend/scroll/none） |
| **CBML**（基于 TEI P5） | XML 学术标注 | `cbml:panel` → `cbml:balloon` / `cbml:caption` / `sound`(SFX) | balloon / caption / sound 三类 | panel 顺序 + `@n` 编号 | ⭐ 对白三类划分（气球/旁白框/拟声）；`@characters` 指向角色实体；**格间转场用 McCloud 六类词表** |
| **ComicsML** | XML（已停更 0.3） | `comic` → `strip` → `panel` | 气球种类（thought / dialogue…）+ 排版属性 | panel | 早期 webcomic 的"条"概念；对白按种类区分 |
| **Manga109 元数据框架** | 标注框架 | 页 → frame(panel) / balloon / text / character / onomatopoeia | **dialog 分四类：speech / thought / narration / monologue** | panel 多边形（4 点） | ⭐ 实体划分三大类：**视觉对象**（角色/物品/场景文字）、**对话**、**符号**（线/拟声/记号）；character 是独立实体 |
| **eBDtheque** | 标注数据集 | 页 → panel / balloon / text-line / character | balloon 四类：**speech / thought / narration / illustrative** | panel 区域 | ⭐ 标注了**阅读顺序**与**气球尾巴方向**——说明"说话人指向"是一等领域数据 |
| **Storyboarder**（Wonder Unit，MIT） | 桌面分镜工具 | `.storyboarder` JSON：scene + board[] | 对白靠音频/剧本文本联动 | board 编号序列 | ⭐ board 数据 = `{frame number, shot type, duration, layer 信息}`；**shot type 字段化**；可导入 Fountain / Final Draft 剧本 |
| **comfyui_panels** | ComfyUI 节点包 | **Panel Layout = 抽象切割树** → shapely 多边形 panels | — | ⭐ **切割树**：从满页开始，每次切割 = {方向, 5 档相对位置, 微倾角度, 等分条数}，可嵌套；**切割顺序决定格顺序**；LTR/RTL 只是预览选项，不改数据 | 全篇最重要的借鉴：版式存"切割树"比存"每格坐标"更紧凑、更可组合 |
| **comic-drawer**（React + Fabric.js） | Web 漫画编辑器 | panels[]（可增删排序） | `Balloon` 对象（圆角矩形+尾巴），type registry 可扩展（thought/shout…） | "Customizable comic panel grids" + 自由对象层 | 对白用 **type registry** 支撑新气泡样式；栅格底层 + 矢量对象层分层 |
| **graphic-novel**（Svelte） | 页/跨页编辑器 | 单个页 JSON：`[{dialogueBoxes:[…]}]` | `dialogueBoxes[]` 带 `type`（speech / caption）+ **允许 HTML 富文本** | 自由拖动 + **吸附 + 等分参考线** | "自由拖动 + 智能吸附"流派；参考页并排（跨页对照） |
| **comic_book_creator**（Python + Gemini） | 脚本→漫画生成器 | PAGE → PANEL | 脚本行内 `CHARACTER: 对白` / `CAPTION:` / `SFX:` | 脚本驱动自动排版 | ⭐ **分镜是"生成指令"的载体**：panel 的画面描述 = 喂模型的 prompt；对白是文本层；强调跨 panel **角色视觉一致性** |

### 版式交互的两个流派（关键分歧）

| 流派 | 代表 | 优点 | 缺点 |
| --- | --- | --- | --- |
| **切割树** | comfyui_panels | 极快、天然整齐、可嵌套、数据极小、切割顺序=阅读顺序 | 只能"切"，不能把某一格自由拖到任意位置 |
| **自由拖动 + 吸附** | graphic-novel、comic-drawer | 完全自由，可做异形版式 | 手动对齐成本高，容易做歪 |
| **混合**（建议） | — | 默认切割树驱动（覆盖 90% 常见版式），**允许单格转为自由形状**作为逃生舱 | 需要两套坐标模型 + 转换 |

---

## 4. 从参考中提炼的共识

1. **Panel 是"容器 + 叙事指令"，不是一张图。** CBML/ACBF/Manga109 一致：格内含画面、对白、拟声三样东西，这三样分属不同数据。
2. **对白有稳定的类型词表。** ACBF 十档、Manga109 四档、eBDtheque 四档。**交集稳妥集 = speech / thought / narration / sfx**，先落这四类，词表留扩展位。
3. **阅读顺序是显式数据，不是隐含约定。** ACBF 规定 text-area 顺序即阅读顺序（为 TTS）；eBDtheque 专门标注。方向（LTR / RTL）是**可配置**项，且 comfyui_panels 证明方向可以只是"预览选项"而不进数据。
4. **"说话人指向"是一等领域概念。** eBDtheque 标注气球尾巴方向，Manga109 有 text↔character 的链接（Manga-Dialog）。所以 balloon 应带 `speakerId` + 尾巴指向。
5. **文本层与图像层分离是数字漫画格式的共识设计**（ACBF 的核心卖点）。对 AI 生图工具，这条从"锦上添花"升级为"必需"——因为图是生成物、会被重做。
6. **镜头语言可以字段化**（Storyboarder 的 shot type），且**格间转场有权威词表**（McCloud 六类：moment-to-moment / action-to-action / subject-to-subject / scene-to-scene / aspect-to-aspect / non-sequitur）。
7. **AI 漫画的新维度：格 = 生成指令。** 画面描述字段就是 model prompt，对白是文本层，角色卡保证一致性。这正是 CanvasFlow 画布工作台已有的能力（generation 节点 / 渠道 / 图生图），comic 只是换一种"组织方式"。

---

## 5. ⚠️ 关键发现：执行引擎的共享现状（影响 M6 架构）

调研中发现一个**必须先解决的地基问题**，否则 comic 无法干净地复用画布的执行能力。

### 5.1 事实

| 模块 | 位置 | 共享性 |
| --- | --- | --- |
| `runEngine` | `features/shared/execution/runEngine.ts` | ✅ 已在共享层 |
| `buildRunPlan` | `features/canvas/execution/buildRunPlan.ts` | ❌ canvas 私有 |
| `RunPlan` / `RunTask` / `RunScope` / `ExecutionMode` 类型 | 定义在 `features/canvas/execution/buildRunPlan.ts` | ❌ canvas 私有 |

而 `runEngine.ts` 第 1 行：

```ts
import type { RunPlan, RunTask } from '../../canvas/execution/buildRunPlan'
```

**即：共享层正在 import 工作台私有层。** 这是架构文档 §5.10 表格里明确写"禁止"的方向。

### 5.2 为什么工具链没拦住

`.dependency-cruiser.cjs` 现有 8 条规则，**没有一条**覆盖"共享层 → 工作台私有层"。现有规则只挡了：

- `no-workbench-cross-talk-canvas-to-comic` / `-comic-to-canvas`（工作台互引）
- `no-upward`（state → 上层）
- `domain-pure` / `ui-stateless` / `no-node-cross-talk` / `agent-only-through-commands` / `dev-preview-isolated`

所以 §5.10 那条"共享层不得依赖工作台私有层"目前是**纯约定、无工具强制**——正是 §5.10 自己警告过的"全靠约定，无法工具链强制"的失败模式。

### 5.3 后果

1. **comic 无法复用 `runEngine`**：它要构造 `RunPlan`，而该类型在 canvas 私有目录里，comic 去 import 就变成跨工作台互引（会被规则拦下）。
2. 更本质的：`RunPlan.origin` 里有一个 `{ subgraph: GraphSnapshot }` 变体，**是画布图结构专有的**。所以 `RunPlan` 并非纯粹通用——它是"通用的执行计划外壳 + 画布专属的 origin"。

### 5.4 完整违规清单（深入核对后）

补一句更正：上表只列了 `RunPlan` 一处。实际把 `features/shared` 全体扫了一遍，共享层的 canvas 耦合**远不止这一处**：

| 共享层文件 | 依赖的画布私有模块 | 性质 |
| --- | --- | --- |
| `features/shared/execution/runEngine.ts` | `features/canvas/execution/buildRunPlan`（`RunPlan`/`RunTask`）、`domain/canvas/model/runRecord`（`RunRecord`）、`domain/canvas/nodeSpecs/types`（`RunRequest`）、`domain/canvas/nodeSpecs/generation`、`domain/canvas/layout/constants` | 5 处 |
| `features/shared/execution/useExecution.ts` | `features/canvas/execution/buildRunPlan`、`domain/canvas/nodeSpecs/types` | 2 处 |
| `features/shared/agent/scopeGuard.ts` | `domain/canvas/model/node` | 1 处 |
| `features/shared/useViewport.ts` | `state/workbenches/canvas/store`、`domain/canvas/geometry/*` ×3 | 4 处 |
| `state/shared/persist.ts` | `domain/canvas/model/graph`（`GraphSnapshot`） | 1 处 |
| `domain/shared/` | — | ✅ 干净 |

**关键更正**：`runEngine` 不只是"import 了 canvas 的类型"，它的**落位与写回逻辑本身就是画布命令形状的**——它硬编码了 `node.create` / `node.updateData` / `node.runRecord.append` / `resultGroup.create` / `asset.put`，还调用了 `generationSpec.createDefaultData()` 与 `RESULT_CELL`。

所以 `RunPlan`/`RunTask` **无法简单地"提到共享层"**：`RunTask` 的三个字段都是画布类型——`nodeId: string`、`slot: SlotPlan`（`domain/canvas/layout/slotPlacement`）、`params: NodeData`（`domain/canvas/model/node`）。把 `RunTask` 上移会连带拖入三套画布类型系统。

### 5.5 两条修法路径

架构文档 §3 行 1029–1137 **明确设计**了三分：`buildRunPlan` 属 canvas、`runEngine` 与 `useExecution` 属 shared（"执行顺序与重试"表也把 `features/shared/execution/` 标为共享）。也就是说 **文档意图是共享，实现没做到**。这个张力有两条出路：

| 路径 | 做法 | 成本 / 风险 | 是否兑现文档意图 |
| --- | --- | --- | --- |
| **A · 如实归位**（推荐先做） | 承认 `execution/`、`useViewport`、`agent/scopeGuard`、`state/shared/persist` 实际是画布专用，**文件搬回 `features/canvas/` 与 `state/workbenches/canvas/`**；`features/shared/` 只留真正共享的 `promptTools/`、`textTarget.ts`；补 depcruise 规则让不变量**可强制** | 小；纯文件搬移 + import 路径更新，零行为变化，可安全 revert | ⚠️ 不兑现——等于承认现状，把"真正可共享的引擎"推迟 |
| **B · 真解耦** | `RunRecord`/`RunRequest` 上移共享 domain；`RunPlan`/`RunTask` 泛型化（`RunPlan<TTask>`）；把落位/写回抽成**注入式适配器** `TaskPlacementAdapter`（canvas 提供 `CanvasPlacement`，comic 提供 `ComicPlacement`）；补 depcruise 规则 | 中；改动 `runEngine`（370 行）核心 + 连带 domain/canvas 重构，**有回归风险**（执行引擎被测覆盖率高） | ✅ 兑现 |

**建议：A 先做，B 留到 M6-5 由"第二个消费者"驱动。**

理由（YAGNI + 项目自身的方法论）：B 的设计核心是"落位适配器接口该长什么样"，而**只有画布一个消费者时，这个接口是猜的**。等到 M6-5 comic 真的要出图，它会给出第二个真实实现，那时适配器的边界才清晰——这与项目一贯的"最小可见版本""探索 ≠ 没有架构"一致。A 不是"绕过问题"，它是**把不变量变成工具可强制的**（这一步本身就是 §5.10 承诺过却没落地的东西），并把"引擎该不该共享"变成一个由真实需求回答的问题，而不是现在拍脑袋。

> 无论走 A 还是 B，**补 depcruise 规则这一步都必须做**——否则同类违规还会继续悄悄长出来。

**✅ M6-1 已按路径 A 落地**：搬移清单

| 原位置 | 新位置 |
| --- | --- |
| `features/shared/execution/runEngine.ts` | `features/canvas/execution/runEngine.ts` |
| `features/shared/execution/useExecution.ts` | `features/canvas/execution/useExecution.ts` |
| `features/shared/useViewport.ts` | `features/canvas/useViewport.ts` |
| `features/shared/agent/{scopeGuard,types,agent.test}.ts` | `features/canvas/agent/` |
| `state/shared/persist.ts` | `state/workbenches/canvas/persist.ts` |

配套改动：`state/shared/types.ts` 去掉 canvas 默认泛型（`AppStore<TSnapshot, TCommand>` 两个参数改为必填，各工作台显式传入），使共享契约也彻底工作台中立；`.dependency-cruiser.cjs` 新增 **`no-shared-to-workbench`** 规则（探针验证可捕获违规后删除）。落地后 `features/shared/` 只剩 `promptTools/` 与 `textTarget.ts`——它们是唯一经核对确属真正共享的模块。

**尚未兑现的部分（如实记账）**：`features/shared/agent/` 在架构文档 §5.9 中被设计为「跨工作台共享（会话循环 / 权限校验 / React 绑定）」，本次归位把它一并划归画布——因为它当前的实际内容由画布类型构成（`ToolName` 的 `createNode/connectNodes/…` 词表、`scopeGuard` 依赖 `NodeType`、`types.ts` 的 `AgentStep.commands: Command[]`）。这与 `runEngine` 属同一类张力：**文档意图是共享、实现是画布耦合**。真共享 agent 内核的抽取**仍需第二个消费者**（comic 目前没有 agent 工具词表），不设里程碑，等需求出现再定。

**✅ M6-5 已按路径 B 落地**（comic 作为第二个消费者驱动，接口由两个真实实现共同定义）

| 步骤 | 落地内容 |
| --- | --- |
| 类型上移 | `RunScope`/`RunMode`/`RunStatus`/`NodeInput`/`RunRequest` → `domain/shared/execution/types.ts`；`RunRecord<TParams>` 泛型化 → `domain/shared/execution/runRecord.ts`（画布 `RunRecord = RunRecord<NodeData>` 作薄绑定层，10 处消费者零改动）；`RunTask` 中性化 + `RunPlan<TTask>` 泛型化 → `domain/shared/execution/plan.ts` |
| 引擎真解耦 | 落位/写回抽成注入式 **`ExecutionPlacement<TTask, TCommand>`**（`begin`/`commit`/`shouldCollect`/`record`/`finalize`）→ `features/shared/execution/placement.ts`；`runEngine` 泛型化、搬回 `features/shared/execution/`，彻底不认识画布命令 |
| 两个实现 | 画布侧 `features/canvas/execution/canvasPlacement.ts`（槽位复用 / 结果组 / 缩略图 / RunRecord 留痕，**逐行等价搬移**）；comic 侧 `features/comic/execution/comicPlacement.ts`（格自身即落点 / `panel.setAsset` / 素材直写 assets 表 / **留痕落格内 `runs`**——M6-15 起 `record` 不再返 `null`） |
| 差异即证据 | 两实现的分歧（是否聚合结果组、**留痕落另一张表还是落聚合体内**、素材走命令还是直写）恰好全部落在适配器里——**引擎本体无需说两种方言**，这正是路径 A 无法兑现文档意图的原因。**留痕这一处尤其能说明问题**：同一个 `record` 回调，画布必须产出一条「写 `runRecords` 表」的补丁命令，comic 只需产出一条「往聚合对象的 `runs` 数组追加」的命令——**存储形态的差异被适配器吸收，引擎只传一句 `RunRecord`** |

comic 的接线：`domain/comic/panel/panelRun.ts`（格 → `RunRequest`/`RunPlan` 的纯函数）→ `workbenches/comic/execution/ComicExecutionProvider.tsx`（复用 `useExecution` + 注入 `ComicPlacement`）→ `PanelEditor` 生成按钮 + `PageLayoutEditor` 格内底图。收口标准三条全部落锁：**格能生成出图**（冒烟 G30 20/20）、**重生成不丢对白**（`panel.setAsset` 只动 `assetHash`，对白层纹丝不动）、**canvas 冒烟不动**（G9 7/7、G21 6/6、G22 14/14）。


---

## 6. 建议的 comic 数据模型（v2）

在现有骨架 `ComicProject → ComicEpisode → ComicPage → ComicPanel` 之上扩展（骨架层级保留不动，只给 Panel 补内容、给 Project 补角色库与阅读方向）。

```ts
// ── 项目级 ───────────────────────────────────────────
interface ComicProject {
  id: string
  title: string
  /** 阅读方向：决定切割树默认走向 + 对白阅读顺序（ACBF/eBDtheque 共识） */
  readingDirection: 'ltr' | 'rtl'
  /** 角色卡库：跨格复用外观，保证 AI 生成一致性 */
  characters: ComicCharacter[]
  episodes: ComicEpisode[]
}

interface ComicCharacter {
  id: string
  name: string
  /** 外观描述：喂生图的角色 prompt 片段 */
  description: string
  /** 参考图素材哈希（复用现有 assets 表，不新建素材存储） */
  referenceHashes: string[]
}

// ── 话级 ─────────────────────────────────────────────
interface ComicEpisode { id: string; index: number; title: string; pages: ComicPage[] }

// ── 页级：版式 = 切割树 + 内容池 ──────────────────────
interface ComicPage {
  id: string
  index: number
  title: string
  /** 版式：切割树。空数组 = **尚未排版**（不是「满页单格」——见下方实况更正） */
  layout: LayoutNode[]
  /** 格内容池：叶子只持 panelId，内容存这里（删格不丢内容） */
  panels: ComicPanel[]
  /** 阅读顺序是**派生量**（见下方实况更正），不单独存 */
}

type LayoutNode = LayoutCut | LayoutLeaf
interface LayoutCut {
  kind: 'cut'
  direction: 'h' | 'v'      // 横切（上下分）/ 竖切（左右分）
  position: 'start' | 'center' | 'end' | 'equal'
  count: number             // 仅 'equal' 生效：等分条数
  skew?: number             // 微倾（0 = 正；美学用）
  children: LayoutNode[]
}
/** 叶子只持 panelId：版式与内容解耦，重排版式不丢内容 */
interface LayoutLeaf { kind: 'panel'; panelId: string }

// ── 格级：三层分离 ───────────────────────────────────
interface ComicPanel {
  id: string
  /** ① 画面描述：喂生图的 prompt（对应画布 generation 节点） */
  scene: string
  /** ② 镜头语言（字段化，不塞进提示词） */
  shot: {
    framing: ShotFraming
    angle: ShotAngle
    transition?: PanelTransition   // 与上一格的转场（McCloud 六类）
  }
  /** 参与画面的人物（角色卡 id；生成时把角色描述与参考图并入请求） */
  characterIds: string[]
  /** 生成结果：素材哈希（复用 assets 表） */
  assetHash?: string
  /** ③ 对白层：贴纸，不烘进图（重生成图不丢对白） */
  balloons: ComicBalloon[]
}

interface ComicBalloon {
  id: string
  type: BalloonType          // speech | thought | narration | sfx
  text: string
  /** 说话人（角色卡 id）；narration / sfx 为空 */
  speakerId?: string
  /** 格内相对坐标（0..1，与格尺寸解耦） */
  x: number; y: number; w: number; h: number
  /** 尾巴指向（speech / thought 用） */
  tail?: { x: number; y: number }
}

// ── 词表（先落稳交集，留扩展位） ──────────────────────
type BalloonType = 'speech' | 'thought' | 'narration' | 'sfx'
type ShotFraming = 'extreme-wide' | 'wide' | 'medium' | 'close-up' | 'extreme-close-up'
type ShotAngle = 'eye-level' | 'high' | 'low' | 'dutch' | 'birds-eye' | 'worms-eye'
type PanelTransition =
  | 'moment-to-moment' | 'action-to-action' | 'subject-to-subject'
  | 'scene-to-scene' | 'aspect-to-aspect' | 'non-sequitur'
```

**几个刻意的取舍**：

- **`LayoutLeaf` 只存 `panelId`**，内容在 `ComicPanel` 里另存。好处：改版式不动内容、删格不丢内容（可回收）、同一格内容可以在不同版式间搬。代价：需要一次 id 查找（与画板 M4-2 的"必须用 id→node 索引"是同类经验）。
- **对白坐标用 0..1 相对值**：格尺寸随版式变，绝对像素会全乱。
- **不引入"页尺寸"字段**：先固定页比例（如 A4 或 2:3），等真需要再加。避免过早锁死。
- **`skew` 只给切割级、不给格级**：微倾是版式美学，不是格的属性。

> **实况更正（M6-2 落地）**：实现时对上面草案做了三处**语义澄清**（结构不变，只把含糊处定死）：
>
> 1. **「空 version = 满页单格」→「空 version = 尚未排版」**。草案原写「空数组 = 满页单格」，但领域层无法回答「满页那一格对应池里的哪个 panel」——没有唯一答案。改为：空 `layout` 表示**尚未排版**；「满页单格」是**版式编辑器首次编辑时**把空 `layout` 实例化出来的结果（M6-3 的编辑器行为，非领域约定）。
> 2. **`ComicPage.panels` 内容池写进类型**。草案正文讲了「叶子只持 panelId、内容另存」（取舍第 1 条），但接口里漏了 `panels` 字段。落地补上：`layout` 持 id 序列，`panels` 持内容，二者靠 id 对齐。
> 3. **阅读顺序是「树 + 方向」的派生量，不是纯深度优先**。草案写「= layout 深度优先的叶子顺序」，但日漫式 RTL 排版需要列序翻转。落地规则（`domain/comic/layout/readingOrder.ts`）：
>    - `h`（横切，上下分行）→ 行序**恒为「上 → 下」**，不随方向翻转（中日漫画皆然）；
>    - `v`（竖切，左右分列）→ 列序在 `ltr` 下「左 → 右」、在 `rtl` 下「右 → 左」（递归翻转，整体镜像）。
>    这样编辑器只需按几何顺序追加子节点（`children[0]` 恒为最左/最上），不必为日漫额外调换 `children`。`readingOrderOf` **必须显式传方向**（不做默认），避免静默产出错序。
>
> 另：`countPanels` 的口径定为「**已排入版式的格数**」（= 版式叶子数），池中的孤儿格不计入（孤儿 = 删格后回收保留的内容备份，不在页面上）。

> **实况更正（M6-3 落地）**：版式编辑器落地时，把「几何」与「顺序」两条线**彻底解耦**（这是 M6-3 最重要的架构决定）：
>
> 1. **几何由树结构单独决定**（`domain/comic/layout/layoutEdit.ts › layoutRects`）：`h`（横切）把父矩形沿 **y 轴**分行、`v`（竖切）沿 **x 轴**分列，`children[0]` **恒为最上 / 最左**。几何只看 `children.length` 与 `position`，**不看 `count` 字段**（`count` 仅在 `equal` 等分时参与计算）。
> 2. **顺序由「树 + 方向」派生**（`readingOrderOf`）：**RTL 只翻序号、不改几何**——日漫的"右起"是阅读顺序的镜像，不是把格子左右挪位。因此 `layoutRects` 恒按几何序返回，`readingOrderOf` 负责把序号按方向重排。编辑器只按几何序追加子节点，无需为日漫调换 `children`。
> 3. **树编辑三件套**（纯函数，`layoutEdit.ts`）：
>    - `splitLeaf(nodes, targetPanelId, direction)`：把目标叶替换为一个二元切割，**原叶进 `children[0]`、新兄弟叶进 `children[1]`**（保证几何序稳定、序号可预测）；
>    - `removeLeaf(nodes, panelId)`：删叶并**回收退化切割**（只剩一个子节点的切割节点被提升合并，避免出现"单子切割"这种噪声结构）；
>    - `instantiateFullPage(panelId)`：把空 `layout` 实例化为「满页单格」——这是**编辑器的首次排版行为**，不是领域默认（域里空数组 = 尚未排版）。
> 4. **`divisionRatios`**：`start`/`center`/`end` = 1/3:2/3 / 1/2:1/2 / 2/3:1/3（**仅二元切割有意义**）；子节点数 ≠ 2 时回退为等分。浮点比较须用容差（`1 - 1/3 ≠ 2/3` 末位差异）。

---

## 7. 建议的交互形态（最小可见版）

| 区域 | 形态 | 说明 |
| --- | --- | --- |
| 左 | 话 / 页缩略图流 | 一话的页列表（可增删排序），当前页高亮 |
| 中 | 页编辑区 | 页面上直接操作：空白处拖 = 切割预览；点格 = 选中；双击格 = 进格内编辑 |
| 右 | 格属性面板 | 三段式（与画布生成节点同构）：① 画面描述文本 ② 镜头语言下拉（景别/机位/转场）③ 角色多选 + 生成按钮 |
| 底 | 对白层编辑 | 选中格后，格上叠加对白贴纸，可拖位置、拉尾巴、选类型（speech/thought/narration/sfx） |
| 顶 | 项目级设置 | 阅读方向切换（LTR/RTL）、角色卡入口 |

**与画布复用同一套极简规范**：无投影、1px 细描边、8px 圆角、参数文字 font-weight 600、选中态黑色边框、格内统一白底。

**切割交互草案**（最关键的一条）：鼠标悬停在页面的某个区域时显示切割高亮线，拖动即切；切割后续的切割线吸附到已有切割位置。**切割顺序即阅读顺序**，UI 上用淡色序号标在每格左上角（comfyui_panels 的序号印章做法）。

> **M6-3 落地情况**（先把"能切出常见版式 + 序号正确"跑通，交互形态用最小可见版）：
>
> - **已落地**：页版式编辑器（`workbenches/comic/surface/PageLayoutEditor.tsx`）——① 空版式时「排版」按钮实例化满页单格；② 选中某格后工具栏「横切 / 竖切 / 删格」；③ 「清空版式」回未排版；④ 每格左上角**淡色阅读序号印章**（`data-comic-reading-seal`）+ **RTL/LTR 实时联动**（切方向只改序号、几何不动）；⑤ 刷新读回版式与方向。
> - **刻意推迟**：**悬停拖拽切割**（草案的"鼠标划过即切"）→ 先用工具栏按钮把树编辑语义跑通、单测锁死，拖拽只是换一种输入方式；**`skew` 微倾**与**单格转自由形状逃生舱**（开放问题 #1 的 c 选项）→ 版式美学，等基础版式稳定后再加；这些推迟项记录在 §8 的 M6-3 备注里。
>
> 采用「按钮驱动树编辑」而非「拖拽」的原因：树编辑语义（切割/删格/回收退化节点/几何-顺序解耦）是**必须先钉死的核心逻辑**，它值得被纯函数单测覆盖；拖拽命中测试是易变的表现层，先不让自己被它绑住。

> **M6-4 落地情况**（格编辑 + 对白层，把调研稿 §7 的「右栏三段式」与「底对白层」跑通）：
>
> - **已落地**：① **格属性面板**（`workbenches/comic/surface/PanelEditor.tsx`，受控组件）——三段式「画面描述 textarea / 镜头语言三下拉（景别·机位·转场）/ 出场角色多选 chip」+ 生成按钮位预留；② **对白层**（`workbenches/comic/surface/BalloonLayer.tsx`）——选中格上叠一层贴纸，**可拖位置**（松手才提交一次，不逐帧写库）、**四类型可切**（speech/thought/narration/sfx，切类型同步尾巴存在性）；③ **双栏工作区**：左「页版式预览 + 对白贴纸层」、右「格属性面板」，未选格时右栏为引导空态；④ 刷新读回（画面描述/镜头/角色/对白类型·文本·坐标）。
> - **对白几何**：贴纸坐标是**格内 0..1 相对值**（`domain/comic/panel/balloonLayout.ts` 纯函数：默认叠放位、拖拽夹回格内、尾巴跟随平移、换类型同步尾巴）。**位置在左侧预览里拖**、**属性在右栏改**——与 §7「属性在这里、位置在那里」的分工一致。
> - **尾巴形状/指向不在此组**：只维护尾巴**锚点**（0..1）；~~「拖尾巴改指向」推迟（M6-4 判据只要求「贴纸可拖 + 四类型可切」）~~ → **已于 M6-14 落地**（见下）。
> - **类型靠形状区分、不靠颜色**（极简规范）：圆角气泡=speech、云朵=thought、方框=narration、斜体=sfx；`hasTail` 只有 speech/thought 为真（ACBF：caption / sound 无指向）。

> **M6-6 落地情况**（一话总览 + 翻页预览；**条漫经决策不纳入**，见 §9 开放问题 #4）：
>
> - **已落地**：① **一话总览**（`workbenches/comic/surface/EpisodeOverview.tsx`）——本话全部页铺成缩略网格，**缩略只画版式几何**（`layoutRects` 算出的格子方框），不渲染生成底图 / 不渲染对白贴纸 / 不带序号印章；未排版的页显示「未排版」占位；点选缩略即回到该页编辑。② **翻页预览**（`surface/ComicReader.tsx`）——全屏只读浮层：`← 上一页 / 下一页 →`（箭头朝向随阅读方向镜像）+ 键盘方向键（语义同源）+ Esc 关闭 + 「第 X / N 页」计数；到边界按钮禁用。③ `PageLayoutEditor` 加 `mode: 'edit' | 'read'`——只读态**复用同一套 `layoutRects` 几何与底图 / 贴纸渲染**（「预览里看到的」就是「编辑器里看到的」），但隐藏工具条与序号印章、格不可点选、贴纸不可拖；只读态走**专用 `data-comic-read-*` 选择器**，不与编辑态冲突。④ 刷新读回（总览页数 + 各页缩略格数）。
> - **翻页规则**（`domain/comic/reader/readerNav.ts`，纯函数）：**页序 = 叙事序，不随阅读方向翻转**——阅读方向只管「**格内**阅读顺序」（`readingOrder.ts`）与「翻页手感」（`rtl` 下 `←` 才是前进，日漫手感）；越界返 `null`，使末页按「下一页」是**无动作**而非原地假成功。
> - **本组不改数据、不加命令**：视图切换与翻页都是 **UI 态**，不进 store。
> - **刻意推迟**（M6-6 时）：缩略里的生成底图与页码角标、条漫（竖屏无限滚动，属另一套排版模型）、整套导出（一话 / 项目 → 图片包）。~~双页跨页排布、翻页动效~~ → **已于 M6-7 落地**（见下）。

> **M6-7 落地情况**（双页跨页阅读）：
>
> - **已落地**：① 阅读器加 **单页 / 双页** 分段切换（默认单页）；② 双页模式下**一次翻动 = 一组页**——**第 1 页按封面惯例单独成页**，其后两页并排，**末尾落单也单独成页**；③ 孤页**落在先读到的一侧**（`ltr` 靠左、`rtl` 靠右），并排时 `ltr` 较早页在左、`rtl` 镜像到右；④ 按钮与方向键按**跨页步进**（不是按页 ±1），边界禁用同源；⑤ 页码文案在成组时显示区间（如「第 2-3 / 4 页」，按钮措辞相应改为「上一跨页 / 下一跨页」）；⑥ 翻页动效（进场方向随阅读方向镜像，`prefers-reduced-motion` 下关闭）。
> - **规则是纯函数**（`domain/comic/reader/readerNav.ts`）：`spreadGroups`（封面单页 + 两页一组 + 末页落单；`loneFirst` 是**参数**不是写死，将来「无封面」直接传 `false`）/ `spreadOfPage`（定位所属组，组内任意页指向同一组首）/ `spreadNeighbor`（返回**组首页序**；越界 `null`）/ `spreadSlots`（视觉左右槽位，**定长 2**，`null` = 留空占位）。
> - **孤页对齐靠几何不靠目测**：只读舞台带 `padding` 与 1px 边，故占位元素用同款 `padding` + `1px 透明边`（默认 `content-box`），使孤页与并排时的首页**左边缘对齐**。
> - **不改数据、不加命令**：阅读版式与跨页索引都是本地 UI 态（与 M6-6 同一判断）；**刷新回落单页**（冒烟显式断言）。要「记住偏好」是另一个决定（新增项目级字段 + 读回迁移），不在本组偷偷做。
> - **比 M6-6 更省**：没有为双页另写一套边界判断（复用「越界返 `null`」口径），也没有引入动画库（动效只多一个「最近翻动方向」状态 + 一个 CSS 变量）。

> **M6-8 落地情况**（整套导出：一话 / 项目 → 图片包）：
>
> - **已落地**：① `ComicSurface` 加「导出图片包」区——**版式**（单页 / 跨页，复用 M6-7 分组口径）+ **范围**（导出本话 / 导出整个项目）+ 状态行（如实播报张数、页数与未排版页数）。② 产物是 **ZIP**：单页版式每页一张 PNG（`001.png`…）、跨页版式两页并作一张（`001.png` / `002-003.png`，命名即页区间）；一话导出目录为话名，整个项目导出多一层项目名目录（`项目/第 1 话/001.png`）。③ 整条链是**纯函数 + 一层接线**：图张计划（`domain/comic/export/exportPlan.ts`，复用 `spreadGroups`）→ 单张自包含 SVG（`domain/comic/export/sheetSvg.ts`，格子几何仍走 `layoutRects`）→ **SVG 光栅化为 PNG** → 组 ZIP → `platform.files.saveFile`（与画布 `.flow.json` 同一出口）。④ ZIP 是**自研最小 store 打包器**（`shared/zip.ts`，零依赖、同步、带 CRC32 与 UTF-8 文件名位）——不引第三方依赖，也不把纯函数染成异步。
> - **两条判断**：**① 底色写死不引 CSS 变量**——SVG 脱离页面后没有 `:root`，导出文档必须自包含；取值抄自 `ui/tokens.css` 并注明。**② 文字折行是「按字宽估算」的纯函数**（CJK 一字宽 / 拉丁半字宽），不引 canvas 度量——宁可轻微不完美，也要让折行可单测、不依赖浏览器。
> - **缺失素材不阻塞导出**：未生成 / 未落库的格跳过底图（保留白底 + 描边），「有 3 张还没生成完」不该挡住「把这 12 页导出来」。
> - **不加命令、不改数据**（导出的都是库存数据；`emptyPages` 如实提示而非拦下）。
> - **刻意推迟**：~~缩略里的底图与页码角标~~ → **已于 M6-9 落地**（见下）；~~翻页动效深化（真实翻页 / 拖拽翻页）~~ → **已于 M6-10 落地**（见下）、~~**导出时给画面打页码**~~ → **已于 M6-11 落地**（见下）。

> **M6-9 落地情况**（缩略里的底图与页码角标）：
>
> - **已落地**：① 总览缩略**不再是「纯几何」**——每格方框内叠生成底图（`object-fit: cover` 铺满），右下角带**页码角标**（叙事序 1 起，未排版的页也带）。② 「缩略要显示什么」收成一个可单测的视图模型 `domain/comic/overview/thumbnail.ts`：`overviewCells(page, direction)`（几何仍走 `layoutRects`、底图只给 `assetHash`、**按阅读顺序输出**）+ `pageBadgeText(index)` + `hasThumbArt(cells)`。③ **仍未翻掉的取舍**：对白贴纸不在缩略里渲染（只有百来像素宽，贴纸文字缩到不可读，是噪声）；缩略也不带格序号印章。
> - **为什么翻掉 M6-6 那条「不渲染底图」**：切到总览最想一眼看出的是「哪几页画完了、画成什么样」，而不只是「怎么切的」。M6-6 当时怕的是「几十页触发素材读回」——实际上**只有真的生成过（有 `assetHash`）的格才会发起查询**，未生成的格连查都不查，代价被天然限制在「已生成的格数」。
> - **页码不随阅读方向翻转**：角标是「页码」而不是阅读引导，固定右下、不镜像；**格**的 DOM 顺序才随方向镜像（= 阅读顺序，顺带让朗读器按阅读序走）。
> - **不加命令、不改数据**：`direction` 只是渲染入参（`EpisodeOverview` 新增可选 prop）。
> - **顺带修掉一个验证盲区**：`mock` 渠道原先吐 `mock-asset:<hash>` 文本却标 `image/png`——`<img>` 拿得到 `blob:` 地址但**解不出像素**，「图到底渲染出来没有」根本证明不了（M6-8 是靠另起一个机制级验证绕过的，代价很高）。现改为吐**真实 8×8 PNG**，于是 `naturalWidth > 0` 成了可信断言（G34 实测 `8×8`）。视频仍用假字节（造真 mp4 成本过高，且无依赖解码的断言）。
> - **刻意推迟**：~~翻页动效深化（真实翻页 / 拖拽翻页）~~ → **已于 M6-10 落地**（见下）；~~导出时给画面打页码~~ → **已于 M6-11 落地**（见下）。

> **M6-10 落地情况**（翻页动效深化：拖拽翻页）：
>
> - **已落地**：阅读器可以直接**拖着翻**——按住页往旁边拖，页**跟手**位移；拖过阈值松手就翻、没拖够就回弹；**已到边界的方向只给一个明显更小的阻尼**（0.22 vs 0.55），手感上就是「拖不动」。
> - **判定全是纯函数**（`domain/comic/reader/dragNav.ts`）：`dragAxis`（**只接管横向手势**，纵向留给滚动）/ `dragIntent`（屏幕方向 → 叙事位移 ±1）/ `dragTurnOffset`（跟手位移，统一夹在 ±72）/ `dragTurnVerdict`（松手：翻 or 回弹；越界返 `null`）。**阈值随舞台宽度**（28%，夹在 48..120）——窄屏不至于一碰就翻、宽屏不至于要拖半屏。
> - **与按钮 / 键盘同源**：屏幕方向 → 叙事位移的换算和 `readerNav` 是同一套口径（`ltr` 往左拖 = 下一页，等价于「`rtl` 下 `←` 才是前进」），所以**拖不出第二种翻法**；按钮与方向键**保持可用**——拖拽是增强，不是替代。
> - **不加命令、不改数据**（拖拽位移是本地 UI 态，与页序 / 版式同级）。
> - **reduced-motion**：翻页动画与「松手回弹」的过渡都关掉；**拖拽跟手保留**——它是直接操作的反馈，不是装饰动效。
> - **刻意不做**：「真实翻页」那种卷页 / 3D 翻折——纯装饰，需要离屏渲染或 3D 折面，成本高，且在 reduced-motion 下必然退化。
> - ~~**仍推迟**：导出时给画面打页码~~ → **已于 M6-11 落地**（见下）。

> **M6-11 落地情况**（导出时给画面打页码）：
>
> - **已落地**：导出区加「页码」开关（**默认关**）。开启后每张导出图在页下方多出一条**页脚带**（页高的 4.5% ≈ 73px @1620），页码落在带子里——**完全不压画面**（压在格子上会挡内容，投稿 / 印刷时不可接受）。
> - **三个此前悬而未决的问题，本次拍板**：① **打在哪** → 每页下方的独立页脚带，而非画面内角标；② **是否随跨页版式变** → 不变——跨页时两页**各有一条带**（被中缝断开，像摊开的书），页码还是各自的；③ **是否可关** → 可关且**默认关**（页码是阅读辅助不是画面内容，误开要重导才能去，代价不可逆）。
> - **页码帖「外侧」（切口侧）**：跨页时左槽靠左、右槽靠右；单页没有中缝可参照，退化为阅读终点侧（`ltr` 右下 / `rtl` 左下）。**锚点由视觉槽位决定、与页序无关**——`rtl` 下槽 0 放的是较晚的页，但它的页码仍在左。
> - **页码只算一份**：`pageBadgeText` 从 `overview/thumbnail` 上移到 `model/pageNumber`（叙事页码是模型概念，不是缩略概念），缩略角标与导出页脚**共用同一个函数**——「总览看到的第 3 页」与「导出图上写的 3」从定义上不可能不一致。导出的页码是**每话内**从 1 起（单行本也是分话编号）。
> - **未排版页也打页码**：页存在就有号，与总览角标同口径。
> - **不加命令、未改数据**：开关与导出版式同级，是导出参数，不进 store。
> - **成本收敛**：关（默认）时 `sheetDimensions` 高度不变（1080×1620），与 M6-8 成品完全一致——不开启就是零变化。

---

## 8. M6 拆分建议

| 组 | 内容 | 判据 |
| --- | --- | --- |
| **M6-1**（前置） ✅ 已完成 | 共享边界收口：按 §5.5 **路径 A** 把画布专用的共享层文件如实归位（`features/shared/execution/` → `features/canvas/execution/`；`useViewport` → `features/canvas/`；`agent/*` 归位；`state/shared/persist` → `state/workbenches/canvas/`；`state/shared/types.ts` 去 canvas 默认泛型）+ **补 `no-shared-to-workbench` depcruise 规则**（把不变量变成工具可强制） | 门禁全绿（含新规则 0 违规）；canvas 行为零回归（全量冒烟 g1–g26 不动） |
| **M6-2** ✅ 已完成 | comic 数据模型 v2（§6）+ 读回迁移。**未做** `comics` 表结构升级——Dexie 表是「整对象一行」，模型升级=行内字段变更，无需改表；旧行靠 `normalizeComicProject` 读回时补默认（只补不删）。落地：`domain/comic/model/comicProject.ts`（v2 模型 + 词表 + 工厂 + 归一化）、`domain/comic/layout/readingOrder.ts`（切割树遍历 + 方向感知阅读顺序）、`state/workbenches/comic/reducer.ts`（纯 reducer + 角色卡 CRUD）、`ComicSurface` 项目级最小可见 UI（阅读方向 + 角色卡） | 单测覆盖 layout 树 → 阅读顺序派生、角色卡 CRUD ✅；冒烟 G27（角色卡 CRUD + 阅读方向 + 刷新读回）✅ |
| **M6-3** ✅ 已完成 | 页版式编辑器：领域层几何/树编辑纯函数（`domain/comic/layout/layoutEdit.ts` —— `layoutRects` 几何、`splitLeaf` / `removeLeaf` / `instantiateFullPage` 树编辑、`divisionRatios` 分割比）+ state 私有命令（`page.add` / `page.instantiate` / `page.splitLeaf` / `page.removeLeaf` / `page.layoutReset`）+ `PageLayoutEditor` 最小可见 UI（排版 / 横切 / 竖切 / 删格 / 清空 + 阅读序号印章 + RTL 联动）。**未做**（推迟，见 §7 备注）：悬停拖拽切割、`skew` 微倾、单格转自由形状逃生舱 | 单测覆盖几何坐标、切/删/回收退化节点、几何-顺序解耦 ✅；冒烟 G28（加页 → 排版 → 竖切 → 横切 → 断言格数与 LTR/RTL 序号 → 刷新读回 → 删格 → 清空）✅ |
| **M6-4** ✅ 已完成 | 格编辑 + 对白层。**domain**：`domain/comic/model/labels.ts`（对白类型 / 景别 / 机位 / 转场中文标签，与词表 1:1）+ `domain/comic/panel/balloonLayout.ts`（贴纸默认叠放位、拖拽夹回、尾巴跟随、换类型同步尾巴）；**state**：comic 私有命令 `panel.update` / `panel.toggleCharacter` / `balloon.add` / `balloon.update` / `balloon.move` / `balloon.remove`（按 `panelId` 定位，id 全局唯一）+ 纯 reducer；**UI**：`PanelEditor`（右栏三段式 + 对白列表）+ `BalloonLayer`（格内贴纸层，可拖）+ `ComicSurface` 双栏接线。**未做**（推迟）：~~拖尾巴改指向、贴纸尺寸手柄微调~~ → **已于 M6-14 落地** | 单测覆盖标签 1:1、贴纸几何（叠放/夹回/尾巴跟随/换类型）✅、reducer 六命令与「无变化返回同引用」✅；冒烟 G29（选格 → 填描述 → 设镜头 → 勾角色 → 加对白 → 切四类型 → 填文本 → 拖贴纸 → 刷新逐项读回）✅ |
| **M6-5** ✅ 已完成 | AI 接线：格 → 生成。按 §5.5 **路径 B** 做引擎真解耦（详见 §5.5 末表）：执行类型上移共享 domain、`RunPlan`/`RunTask` 泛型化、落位/写回抽成注入式 `ExecutionPlacement`；comic 提供第二个实现（`ComicPlacement`）来定义接口。**domain**：`domain/shared/execution/{types,runRecord,plan}.ts`、`domain/comic/panel/panelRun.ts`；**state**：`panel.setAsset` 命令；**features**：`features/shared/execution/{runEngine,useExecution,placement}.ts`（真共享）、`features/canvas/execution/canvasPlacement.ts`、`features/comic/execution/comicPlacement.ts`；**UI**：`ComicExecutionProvider` + `PanelEditor` 生成按钮 + `PageLayoutEditor` 格内底图。**未做**（推迟）：~~comic 版本历史/留痕~~ → **已于 M6-15 落地**（见 §8「M6-15 落地情况」）；~~角色参考图作为渠道实际输入（渠道层尚未消费 `inputs`）~~ → **已于 M6-12 落地**（见 §8「M6-12 落地情况」） | 端到端单测（引擎 + `ComicPlacement`，6 项）✅；冒烟 **G30 20/20**（配渠道 → 排版 → 选格 → 生成出图 → 重生成换图不丢对白 → 刷新读回）；canvas 零回归（G9 7/7、G21 6/6、G22 14/14）✅ |
| **M6-6** ✅ 已完成 | 一话总览 + 翻页预览。**domain**：`domain/comic/reader/readerNav.ts`（`clampPageIndex` / `pageNeighbor` / `pageStepForKey` / `nextSide`——**页序 = 叙事序、不随方向翻转**，方向只管格内顺序与翻页手感）；**UI**：`EpisodeOverview`（本话全部页的**纯几何**缩略网格）+ `ComicReader`（全屏只读翻页浮层）+ `PageLayoutEditor` 加 `mode:'read'`（专用 `data-comic-read-*` 选择器）；**未加命令、未改数据**（视图切换与翻页是 UI 态）。**未做**（推迟）：双页跨页（spread）排布、缩略里的生成底图与页码角标、翻页动效；**条漫经决策不纳入** | 单测覆盖夹回 / 邻居 / 键位映射 ✅；冒烟 **G31 35/35**（一话三页 → 总览缩略含「未排版」占位 → 点选缩略回编辑并定位该页 → 翻页按钮 + 键盘 → LTR 边界禁用 → Esc 关闭 → 切 RTL 断言箭头朝向与键盘语义镜像 → 刷新读回）✅ |
| **M6-7** ✅ 已完成 | 双页跨页阅读。**domain**：`domain/comic/reader/readerNav.ts` 加 `spreadGroups` / `spreadOfPage` / `spreadNeighbor` / `spreadSlots`（**封面单页 + 两页一组 + 末页落单**；跨页步进返回组首页序；越界 `null`；槽位定长 2、方向镜像）。**UI**：`ComicReader` 加 单页/双页 分段（**UI 态、不进 store**，刷新回落单页）+ 跨页并排渲染（孤页按「先读侧」对齐，占位与页槽同宽）+ 页码区间文案 + 翻页动效（`--read-enter-x` 随方向镜像、reduced-motion 关闭）；`PageLayoutEditor` 只读页补 `data-comic-read-page-id`。**未加命令、未改数据**。**未做**（推迟）：整套导出（一话 / 项目 → 图片包）、缩略里的底图与页码角标、翻页动效深化（真实翻页 / 拖拽翻页） | 单测覆盖分组 / 定位 / 跨页步进 / 槽位镜像 ✅；冒烟 **G32 40/40**（4 页格数 1/2/3/4 → 单页逐页记录页 id → 切双页断言封面孤页与占位 → 跨页步进非按页 → 边界禁用 → 键盘跨页 → 末页落单 → 切 RTL 断言槽位与并排顺序镜像 → 切回单页 → 刷新回落单页）✅ |
| **M6-8** ✅ 已完成 | 整套导出（一话 / 项目 → 图片包）。**domain**：`domain/comic/export/exportPlan.ts`（图张计划——选中哪几话 → 每话切几张 → 每张的包内路径与文件名；跨页布局**复用 `spreadGroups`**；命名净化与三位零填）+ `domain/comic/export/sheetSvg.ts`（单张**自包含 SVG**，纯函数：格子几何走 `layoutRects`、底图 `data:` 内联并裁进圆角、对白贴纸四形态、按字宽估算折行与截断、`sheetDimensions` 给出光栅化尺寸）。**shared**：`shared/zip.ts`（自研最小 **store 版 ZIP 打包器**：CRC32 + UTF-8 文件名位 + 中央目录/EOCD，零依赖、同步、可单测）。**workbenches**：`workbenches/comic/export/comicExport.ts`（素材按 hash 去重批查 → `panelId → dataURL` → 渲染 SVG → `Image`+canvas 光栅化为 PNG → 组 ZIP → `FilePort.saveFile`）。**UI**：`ComicSurface` 加「导出图片包」区（版式 单页/跨页 + 导出本话 / 整个项目 + 状态行）。**未加命令、未改数据**。**未做**（推迟）：~~缩略里的底图与页码角标~~ → **已于 M6-9 落地**；~~翻页动效深化~~ → **已于 M6-10 落地**、~~导出时给画面打页码~~ → **已于 M6-11 落地** | 单测 39 项（ZIP 结构/CRC/中文路径 ✅、计划分组与命名 ✅、SVG 几何/折行/镜像/转义 ✅）；冒烟 **G33 28/28**（三页格数 1/2/1 → 导出本话单页断言 ZIP 3 张 + 命名 001/002/003 + PNG 签名与 1080×1620 → 切跨页断言 2 张 + 命名 001/002-003 + 并排 2184×1620 → 导出整个项目断言项目名目录前缀 → **机制级验证：真实 `sheetSvg` 模块内联真 PNG 后光栅化，红色像素 159 万落地、对白文字暗色像素落地、`toBlob` 成功即 canvas 未被污染**）✅ |

| **M6-9** ✅ 已完成 | 缩略里的底图与页码角标。**domain**：`domain/comic/overview/thumbnail.ts`（`overviewCells(page, direction)`——几何走 `layoutRects`、底图只给 `assetHash`、**按阅读顺序输出**；`pageBadgeText(index)` 页码角标；`hasThumbArt(cells)`）。**UI**：`EpisodeOverview` 缩略从「纯几何」升级为「方框 + 生成底图 + 右下页码角标」（新增可选 `direction` prop；`.thumbFrame` 负责 2:3 比例与角标定位；**对白贴纸仍不渲染**）。**platform**：`mock` 渠道改吐**真实 8×8 PNG**（原先是假文本字节，`<img>` 拿得到 `blob:` 却解不出像素，「图渲染出来没有」无法证明）。**未加命令、未改数据**。**未做**（推迟）：~~翻页动效深化~~ → **已于 M6-10 落地**；~~导出时给画面打页码~~ → **已于 M6-11 落地** | 单测 13 项（几何 / 阅读序镜像 / hash 缺席 / 角标夹回 ✅）；冒烟 **G34 19/19**（页1 生成、页2 不生成、页3 未排版 → 角标 1/2/3 含未排版页 → 底图只出现在生成过的页且 **`naturalWidth = 8×8` 证明真的解码出像素** → 缩略无对白层（编辑器里有 1 条作对照）→ RTL 下格 DOM 顺序镜像、页码不翻转 → 刷新读回）✅ |
| **M6-10** ✅ 已完成 | 翻页动效深化：**拖拽翻页**。**domain**：`domain/comic/reader/dragNav.ts`（`dragAxis` 只接管横向手势 / `dragIntent` 屏幕方向 → 叙事位移 ±1 / `dragTurnOffset` 跟手位移夹 ±72、越界阻尼 0.22 vs 0.55 / `dragTurnVerdict` 松手翻 or 回弹、越界 `null`；阈值 = 舞台宽 28% 夹 48..120）。**UI**：`ComicReader` 舞台接 pointer 事件（`setPointerCapture`）+ `--read-drag-x` 跟手 + 松手回弹过渡（拖拽中不加过渡才跟手）+ 底部一句可用性提示。**reduced-motion** 下关掉翻页动画与回弹过渡、但**保留拖拽跟手**（直接操作的反馈不是装饰）。**未加命令、未改数据**。**刻意不做**：卷页 / 3D 翻折式「真实翻页」（纯装饰、成本高、reduced-motion 下必退化）。**未做**（推迟）：~~导出时给画面打页码~~ → **已于 M6-11 落地** | 单测 22 项（主轴 / 阈值夹取 / 方向镜像 / 阻尼对比 / 越界不翻 ✅）；冒烟 **G35 27/27**（拖 140 跟手 -72 → 松手翻页 → 拖 20 跟手 -11 → 回弹不翻 → 首页往前拖阻尼 31 → 不翻 → 纵向手势位移恒 0 → 末页往后拖不翻 → 按钮/键盘仍可用 → RTL 下往右拖才是前进）✅ |
| **M6-12** ✅ 已完成 | **渠道层消费 `inputs`**（打通图生图 / 角色参考图）。**domain**：`domain/shared/execution/inputs.ts`（`flattenInputs` 摊平集合 + `imageInputsOf`：只留图像、按 hash 去重、上限 `MAX_IMAGE_INPUTS=4`）。**platform**：新增 `AssetPort`（`platform/assets.ts`，`hash → 字节`，进 `PlatformKit`，web/memory 共用一份实现）+ `ChannelDeps` 扩为 `Pick<PlatformKit,'network'\|'assets'>`（装配处直接传 `platform`）+ `fetchNetwork` 放行 `FormData`/`Blob` **原样上传**（并清掉手写 `Content-Type`，boundary 只能由 fetch 生成）。**渠道**：`openaiImages` 有图像输入时走 `/v1/images/edits`（multipart，重复 `image` 字段）、无输入时**原样**走 `/v1/images/generations`；素材读不到才回落；端点不支持**如实报错不静默降级**。`mock` 带图像输入时改吐**品红真 PNG**（hash 规则不变）。**canvas**：`generationSpec.collectInputs` 补收上游生成节点的产物（此前连线合法却收不到图）；新增「图生图」模板 `img2img`。**未加命令、未改数据** | 单测 30 项（输入提纯 9 / 素材读回 4 / mock 可观测 5 / openai 双端点 7 / 规格收图 4 ✅）；冒烟 **G37 11/11**（图生图模板两节点连线 → 底图生成 → 下游生成 → **取样像素：底图灰度 `154,154,154`、下游品红 `230,46,139`**——inputs 确实被消费）✅ |
| **M6-11** ✅ 已完成 | **导出时给画面打页码**。**domain**：`model/pageNumber.ts`（`pageBadgeText` **从缩略层上移**——叙事页码唯一定义，缩略角标与导出页脚共用，不可能算出两个号；`thumbnail.ts` re-export 兼容既有调用）+ `export/sheetSvg.ts` 加页码渲染（`SheetSvgInput.pageNumbers`——**调用方传文案数组**、长度不匹配**整体不打**；`pageNumberAnchor` 页码帖外侧：跨页按**槽位**、单页按阅读终点侧；`pageNumberBand` 页脚带 = 页高 4.5%；`sheetDimensions` 开页码时加高）。**workbenches**：`comicExport.ts` 加 `pageNumbers` 选项（页码与页**绑在一起**取，长度恒一致；每话内从 1 起）。**UI**：`ComicSurface` 导出区加「页码」开关（**默认关**、UI 态）。**关键取舍**：页码画在**页脚带**（页下延伸的留白）而非画面内——零遮挡；带子与页同底色，视觉就是页边。**未加命令、未改数据** | 单测 15 项（页码定义夹回 ✅、锚点槽位/方向 ✅、尺寸加高 ✅、默认不打 / 长度不匹配整体不打 / 未排版页也打 / 文本转义 / RTL 位置不镜像 ✅）；冒烟 **G36 26/26**（默认关且无页脚带 1620 → 勾选后 1693 → 跨页带页码 2184×1693 两页各一条带 → 刷新回落关闭 → **机制级验证**：真实 `sheetSvg` 模块光栅化后带内有墨迹 138 px、**画面区域零墨迹**——页码没压画面）✅ |
| **M6-14** ✅ 已完成 | **对白贴纸的尺寸手柄与拖尾巴改指向**（补齐 M6-4 欠下的两条直接操作）。**domain**：`balloonLayout.ts` 加 `resizedBalloonRect`（**左上角固定**、尺寸夹 `[下限,1]`、尾巴按**相对比例**跟随）与 `movedTail`（夹进 `[0,1]`；无尾巴返 `null`）。**state**：comic 私有命令加 `balloon.resize` / `balloon.moveTail`（与 `balloon.move` **三条正交**，不塞进同一个 patch）+ reducer 抽 `withBalloonRect` 供 move / resize 共用。**UI**：`BalloonLayer` 拖拽状态机扩为 `move \| resize \| tail`（都存**起点快照** + 抓取偏移，预览用 domain 的同一批纯函数 ⇒ **预览 = 提交**）；选中格内每张贴纸右下角渲染尺寸手柄、带尾巴的贴纸把尾巴菱形改成可拖（命中区 13px、可交互时画在气泡**之上**）。`PageLayoutEditor` / `ComicSurface` / `ComicReader` 透传两个新回调。**未加数据字段、无迁移**（`x/y/w/h/tail` 都在模型里）。**新增不变量**：气泡与尾巴作为**一体**参与平移与缩放，因此**只有**拖尾巴能改变尾巴相对位置 | 单测 15 项（几何 9：左上角固定 / 下缘中点按比例跟随 / 拖过的尾巴按比例跟随 / 下限抬升 / 出格封顶 / 无尾巴仍无尾巴 ✅、`movedTail` 夹回与无尾巴返 `null` ✅；reducer 6：改尺寸不动左上角 / 下限与无尾巴 / 未变返原引用 / 只改尾巴不动气泡 / 夹回 / 无尾巴与未命中返原引用 ✅）；冒烟 **G39 17/17**（贴纸三件套齐 → 拖右下角手柄：w/h 变大、**左上角不动**、且尾巴跟到新的下缘中点 → 拖尾巴：锚点变而**尺寸与位置一个都不动**（A/B）→ 加旁白：无尾巴手柄但仍有尺寸手柄 → 刷新读回尺寸与尾巴锚点）✅ |
| **M6-13** ✅ 已完成 | **角色卡参考图上传**（补上「有模型、没入口」的最后一格）。**domain**：`comicProject.ts` 加参考图列表语义 `addCharacterReference` / `removeCharacterReference`——**已在列表里 / 本来就不在时返回原数组引用**，让「无变化」可被上层识别（避免重复添加白写一次项目文档）。**workbenches**：新 `surface/characterRefUpload.ts`（依赖注入的选图器——`pickFile` + `putAsset` 两件口，**无需浏览器即可单测**）：选图 → `blob.arrayBuffer()` → `fingerprintBytes`（**内容哈希**，与生成产物同表同约定「id 即 hash」）→ 写 `assets` 表。**UI**：`ComicSurface` 角色卡加「参考图」行（缩略 `CharacterRefThumb` 复用 `useAsset` + 移除按钮 + 「＋ 上传」），角色 `<li>` 改为纵向两行（上：名字/描述/删除；下：参考图行）。**未加命令、未改数据**（`character.update` 早已支持 `referenceHashes` patch） | 单测 15 项（列表语义 7：追加/去重/不可变/原引用 ✅；上传器 8：内容哈希 / 固定向量 `sha1("abc")` 前 16 位 / 幂等同 id / 换名不改 hash / 取消不写库 / 0 字节不写库 / mime 回退 / accept 固定 ✅）；冒烟 **G38 16/16**（真·选文件注入一张灰度 PNG → 缩略 `naturalWidth=8` 且采样 `154,154,154` → 刷新后参考图与素材行都在 → 勾角色生成出**品红 `230,46,139`** → **A/B**：取消勾选再生成回落灰度 `154,154,154` → 移除后归零）✅ |
| **M6-15** ✅ 已完成 | **生成留痕与版本回退**（补 M6-5 里 `record` 返 `null` 的洞）。**domain**：`comicProject.ts` 加 `PanelRunStatus`（= 共享 `RunStatus` 别名）/ `ComicPanelRun` / `ComicPanel.runs` + `normalizePanelRun`（只补不删）；`panel/panelRunRecord.ts`（`nextPanelRunVersion` 版本号自推 / `appendPanelRun` 同 id 幂等 / `canRestorePanelRun` 守门 / `livePanelRun` / `restorePanelRun` **回退也追加为新版本** / `panelRunFromRecord` 沿用引擎 record.id）；`panel/panelRun.ts` 加 `asComicPanelParams`（逐字段回落）；`model/labels.ts` 加 `PANEL_RUN_STATUS_LABELS`；共享 `RUN_STATUSES` 加到 `domain/shared/execution/types.ts`。**state**：`panel.runRecord.append`（载荷**不含 version**）与 `panel.runRecord.restore`（带 `runId`/`newRunId`/`createdAt`，reducer 保持纯）两条命令；**不可回退 / 未命中返原引用**。**features**：`ComicPlacement.record` 改为返回 append 命令（**不再返 `null`**）。**UI**：`PanelEditor` 新增第 ⑥ 段「版本历史」（倒序列表 + 缩略 + 状态徽标 + 「当前」黑描边标记 + 回退按钮 + 点缩略看大图浮层）。**未改表结构、无迁移**（留痕住在聚合对象内部）。**未做**（推迟）：留痕裁剪 / 两版并排对比 / 复制输入到别的格 | 单测 36 项（域 30：版本号自推 3 / 追加 4 / 可回退守门 3 / 当前版本 4 / 回退 10 / `panelRunFromRecord` 6 ✅；reducer 7：写入与版本号 / 顺延 / 幂等返原引用 / 未命中返原引用 / 回退写回与追加 / 失败版不可回退 / 源与面板未命中 ✅；端到端断言扩充 4 处）；冒烟 **G40 32/32**（生成 → 历史 1 条 v1 且标「当前」→ 改描述再生成 → 历史 2 条、当前移到 v2、v1 可回退 → 点缩略开/关大图浮层 → **点 v1 回退：描述回到 v1、底图仍渲染、历史变 3 条（v1/v2 都还在）** → 刷新后 3 条与当前指向均读回）✅ |

> **M6-12 落地情况**（渠道层消费 `inputs`：图生图 / 角色参考图）：
>
> - **已落地**：`RunRequest.inputs` 从此**真的被送进渠道**。此前数据模型侧一切就绪（canvas 分组/批量、comic 角色参考图都在组装 `asset` 输入），但 `openaiImages.generateImage` 只把 `prompt` 发给 `/v1/images/generations`——图生图与角色参考图在链路里从未生效。现在：有图像输入 → 走 `/v1/images/edits`（multipart 上传），没有 → 仍走 `/v1/images/generations`（**零回归**）。
> - **规则收口成纯函数** `domain/shared/execution/inputs.ts`：`flattenInputs`（摊平集合）/ `imageInputsOf`（只要图像、按 hash 去重、上限 `MAX_IMAGE_INPUTS=4`）。渠道层只消费结果，不再各写一套过滤——否则「哪张图会被传」会随渠道漂移。
> - **新端口 `AssetPort`**（`platform/assets.ts`）：`hash → 字节`。渠道不再直接查 `assets` 表，表结构变化被挡在 platform 内。它进 `PlatformKit`，两个平台的装配各加一行即可。
> - **canvas 侧补上「图生图」的最后一段**：`generationSpec.collectInputs` 此前只收提示词与集合，把上游生成节点的**产物**漏掉了——连线合法（`accepts` 早含 `generation`）却收不到图。补齐后上游重生成 → `assetHash` 变 → 下游指纹变 → 自动判定陈旧。
> - **新增「图生图」模板**（`img2img`：底图 → 图生图），让这条路在 UI 上可达；`img2video` 顺带也吃到同一条链路。
> - **刻意不做的静默降级**：端点不支持 `edits` 时**如实报 404/405**，不悄悄改回文生图——否则用户以为参考图生效了，实际被丢掉（与 M6-9「假字节」同类教训）。素材**读不到**（未落库/已清理）才回落到文生图，因为那时确实无图可传。
> - **可观测性**：mock 渠道在带图像输入时改吐**品红 8×8 PNG**（无输入仍是灰度）。hash 规则不变，既有按 hash 断言的测试零改动；但「inputs 到底有没有被消费」从此**可被断言**。
> - **未加命令、未改数据**：全是渠道调用期行为。

> **M6-13 落地情况**（角色卡参考图上传：补上「有模型、没入口」）：
>
> - **已落地**：`referenceHashes` 自 M6-2 就在模型里、reducer 也一直支持改它，M6-12 更让渠道真的会读它——但**界面上没有任何地方能把一张图放进角色卡**。字段齐全却填不进去，等于没有。本组只做这个入口。
> - **一次上传 = 选图 → 内容哈希 → 写素材库**：上传的图与生成产物**共用同一张 `assets` 表、同一约定「id 即内容哈希」**。于是「同一张图重复上传」天然幂等（覆盖写同一行）；「换个文件名再传」也不会被当成新图——**「同一张图」由字节决定，不由文件名决定**。
> - **去重语义收在模型层**（`addCharacterReference` / `removeCharacterReference`）：命中「已在列表里 / 本来就不在」时**返回原数组引用**。这不是省内存的小聪明——reducer 靠数组**引用**判断「有没有真变化」，无条件新建数组会让重复添加被当成真改动、白写一次项目文档。
> - **上传与角色卡分属两层、在界面接线**：上传器只管「一张图 → 素材库一行」（依赖注入 `pickFile` / `putAsset`，**无需浏览器即可单测**）；把 hash 追加进 `referenceHashes` 由 `character.update` 命令完成。**命令层不认识 `Blob`，素材层也不认识角色卡。**
> - **素材落库不走命令、直写 `assets` 表**——与 `ComicExecutionProvider` 写生成产物同一条路径（comic 的 reducer 只产出项目聚合对象，不含素材；素材与项目文档分离落库）。
> - **参考图可见、可删**：缩略与格底图 / 一话总览共用同一条读素材路径（`useAsset`），未落库时先占位、到位后自动补上。
> - **未加命令、未改数据**：`character.update` 早已支持 `referenceHashes` patch。

> **M6-14 落地情况**（对白贴纸的尺寸手柄与拖尾巴改指向：补齐 M6-4 的两条直接操作）：
>
> - **补的是什么**：贴纸的**位置** M6-4 起就能拖，但**尺寸**从建出来那一刻就定死了（`defaultBalloonRect` 给 60%×16%），文字一长就溢出且无解；尾巴也只能跟着气泡平移，**指不了说话人**。两条都属 M6-4 同一条推迟记录，同一交互模型，故捆成一组。
> - **尺寸手柄**：选中格内每张贴纸右下角一个小方块，拖它改 `w`/`h`，**左上角固定**（手柄在右下角，锚点自然在左上），尺寸夹在「下限 ~ 整格」之间。手柄用 `translate(-100%,-100%)` **完全落在贴纸内侧**——格子上有 `overflow:hidden`，骑在角上的手柄会被裁掉一半、按不稳。
> - **拖尾巴改指向**：语音 / 心理的尾巴菱形**本身可拖**，命中区放大到 13px；旁白 / 拟声没有尾巴，也就不长这个手柄（「面版 / 音效」本来就没有指向）。尾巴的堆叠分两态：只读时画在气泡**下面**（只露尖角），可交互时改画在**上面**——否则尾巴一旦被拖进气泡里就再也抓不到（顺带把可交互态底色换成略深一档，不然白底白框在气泡上等于隐身）。
> - **新增的不变量（本组最重要的产出）**：气泡与尾巴**作为一体**参与平移与缩放——平移保持尾巴的*相对偏移*（M6-4 已有的 `movedBalloonRect`），缩放保持尾巴的*相对比例*（新的 `resizedBalloonRect`）。于是**唯一**能改变「尾巴指向」的操作就是显式拖尾巴。少了这条，会同时出现「拖走气泡、尾巴留在原地」和「放大气泡、尾巴被吞进气泡里」两种坏手感。
> - **三条直接操作拆成三条命令**：`balloon.move`（位置）/ `balloon.resize`（尺寸）/ `balloon.moveTail`（尾巴指向）。「位置 / 尺寸 / 尾巴」是一组正交自由度，硬塞进同一个 `patch` 只会让语义变浑。
> - **预览与提交走同一批纯函数**：拖动过程中的即时几何由 `movedBalloonRect` / `resizedBalloonRect` / `movedTail` 算出，松手提交时 reducer 调的是**同样这三个函数**——不会出现「手指底下是一个样、松手落库是另一个样」。拖动仍只在松手提交一次（不逐帧写库）。
> - **不改数据、无迁移**：`x/y/w/h/tail` 都是 M6-4 就有的字段，本组只是终于能从界面上改它们。

> **M6-15 落地情况**（生成留痕与版本回退：补上 M6-5 里 `record` 返 `null` 的洞）：
>
> - **补的是什么**：M6-5 让格能生成图，但引擎产出的 `RunRecord` 在 comic 侧**被整个丢弃**（适配器 `record` 返 `null`），于是「点一下重生成就丢一版图」——旧 `assetHash` 被覆盖，画过的画面**再也回不去**（素材字节还在 `assets` 表里，却再没有指针指向它）。这是**不可逆的数据丢失**，不是缺功能。
> - **留痕住在格内，不另开表**：画布是「图 + 补丁流」双存储，留痕必须另落 `runRecords` 表；comic 是**单聚合对象、单写通道**（整对象防抖落 `comics` 一行），留痕天然属于聚合体内部字段 `ComicPanel.runs`，随项目一起读回 / 导出 / 归一化。**持久化选型按数据形态走**（同 comic 与 canvas 的整体差异）：代价是文档变大，但生成是低频操作，交换划算。
> - **三条不变量**：
>   1. **只增不减** —— 任何操作都不删留痕（产品文档 §6.21）。删一条 = 那一版产物变孤儿。
>   2. **版本号由历史自身推出**（`nextPanelRunVersion` 取 max+1），**不由调用方给**。载荷类型 `PanelRunInput = Omit<ComicPanelRun,'version'>` 把这条不变量变成**类型约束**——调用方构造不出「两条 v3」或跳号，而这类错误**在界面上看不出来**（行数对得上），要等「回退到 v3 结果回到另一版」才暴露。
>   3. **回退本身追加为新版本** —— 写回目标版本的输入与产物后 append 一条新留痕，而不是把指针拨回去。历史永远是一条只增的时间线，没有「重写历史」这种状态，也就不需要 undo 栈兜底（comic `canUndo()` 恒 false）。
> - **快照口径只记影响画面的字段**：画面描述 / 景别 / 机位 / 出场角色 / 渠道 / 模型 / 参考图 / 指纹 / 产物。**刻意不含**对白贴纸（不烘进图，回退画面不该动对白）与**转场**（「与上一格的叙事关系」，不是画面输入）——回退时保留面板当前的转场。
> - **失败也留痕，但不给回退入口**（`canRestorePanelRun` 只放行「成功且有产物」）：失败那次没有画面，把它写回 `assetHash` 等于「回退到一张不存在的图」；而「恢复配置 ≠ 恢复画面」又是另一种语义。混在一条路径里会让「回退」一次表示两件事，故界面上**灰掉并写明原因**。
> - **「画面真相」与「历史真相」分工**：`assetHash` 是画面真相（渲染只看它），`livePanelRun` 是历史真相（列表给哪行打「当前」）。正常一致；唯一分叉是「某次成功但渠道没回图」——画面为空而历史仍指向上一个真正出过图的版本。
> - **时间与 id 由调用方给**，domain 保持纯：`append` 的时间来自引擎 `RunRecord.createdAt`；`restore` 的 `newRunId`/`createdAt` 由 UI 派发时给（`createId('run')` + `Date.now()`）。所以 comic reducer 仍是纯函数，单测可直接断言版本号序列。
> - **收口后的口径**：`ComicPlacement` 的 `record` 不再是 `null`——`ExecutionPlacement.record` 里「返回 `null` 表示该工作台暂不落留痕」这条**逃生舱**如今两个工作台都不用了，但**接口保留**（它是「能力可选」的表达，不是临时补丁）。

> M6 各组（含 M6-7 双页跨页、M6-8 整套导出、M6-9 缩略底图与角标、M6-10 拖拽翻页、M6-11 导出页码、M6-14 对白直接操作、M6-15 生成留痕与版本回退）**全部落地，comic 形态的规划方向与推迟项均已清零**。M6-5 的引擎解耦**刻意推迟到有第二个消费者时**才做——接口边界由两个真实实现共同定义，而不是提前猜；事后这条判断成立：`ExecutionPlacement` 的形状正是被 `ComicPlacement` 逼出来的。**M6-12 补齐了唯一一条跨层洞**（渠道层消费 `inputs`），comic 角色参考图与画布图生图同时打通；**M6-13 补上了角色卡参考图的上传入口**——「传参考图 → 勾角色 → 生成时带上它」在界面上**从头到尾可走通**；**M6-14 补齐了对白贴纸的三条直接操作**（位置 / 尺寸 / 尾巴指向）；**M6-15 补齐了生成留痕与版本回退**——「生成过什么、能不能回去」从此有据可依，comic 侧**已无推迟项**。**条漫经决策不纳入**（见 §9 开放问题 #4）。


---

## 9. 待你决策的开放问题

| # | 问题 | 选项 |
| --- | --- | --- |
| 1 | **版式交互** | (a) 纯切割树　(b) 纯自由拖动+吸附　(c) 混合：默认切割树 + 单格可转自由形状（本文建议 c） |
| 2 | **对白是否与图分离** | (a) 分离（贴纸层，本文建议）　(b) 烘进图（简单但重生成即丢对白） |
| 3 | **是否需要角色卡实体** | (a) 需要（名称+描述+参考图，本文建议）　(b) 先只用提示词文本，后续再加 |
| 4 | ~~**形态范围是否包含"条漫"（竖屏无限滚动）**~~ ✅ **已决策（M6-6）** | ✅ 采纳 **(a)：只做翻页漫画**——页 / 格模型天然支持，M6-6 的翻页预览即按页翻。条漫没有「页」概念，是另一套排版模型；将来若要做须**另立形态**，不塞进 comic 现有模型 |
| 5 | **comic 复用画布执行引擎的边界** | (a) 先做 M6-1 清理再复用（本文建议）　(b) comic 自建执行路径 |
| 6 | **默认阅读方向** | ✅ 已采纳 **(c)**：项目级可切，默认 LTR（`DEFAULT_READING_DIRECTION`），M6-2 落地 |

---

## 10. 一手来源

- ACBF（Advanced Comic Book Format）规范 · 正文与文本层类型词表：https://acbf.fandom.com/wiki/Body_Section_Definition ；总览：https://acbf.fandom.com/wiki/ACBF_Specifications
- CBML（Comic Book Markup Language，TEI P5 扩展）· 元素与 McCloud 转场词表：https://www.digitalhumanities.org/dhq/vol/6/1/000117.xml ；仓库：http://cbml.org/schema/schema/cbml.html
- Manga109 元数据框架与标注格式 · https://ar5iv.labs.arxiv.org/html/2005.04425 ；格式规范：https://github.com/RichardScottOZ/CoMix/blob/main/FORMAT.md
- eBDtheque 标注数据集（阅读顺序、气球类型、尾巴方向）· https://arxiv.org/html/2409.09502v1
- Scott McCloud 六类格间转场（原始出处 *Understanding Comics* pp.70–72）· 转述与出处：https://openaccess.city.ac.uk/id/eprint/2817/1/DYB-%20VIS2013-%20submitted%208th%20August.pdf
- Wonder Unit Storyboarder · 数据模型（`.storyboarder` JSON、shot type）：https://deepwiki.com/wonderunit/storyboarder/1-overview ；仓库：https://github.com/wonderunit/storyboarder
- comfyui_panels · 切割树版式模型：https://github.com/bmad4ever/comfyui_panels
- comic-drawer · 气球 type registry 与分层画布：http://onlybits.org/pedrinho/comic-drawer
- graphic-novel · 页 JSON 与对话框类型：https://github.com/David-Saperstein/graphic-novel
- comic_book_creator · 脚本格式（PAGE/PANEL/CHARACTER:/CAPTION:/SFX:）与角色一致性：https://github.com/keithballinger/comic_book_creator
