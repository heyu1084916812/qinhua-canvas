/**
 * 漫画剧领域模型（M5 骨架 → M6-2 v2）。
 *
 * 容器层级（M5 骨架确立，M6 不推翻）：
 *   ComicProject（漫画剧） → ComicEpisode（话） → ComicPage（页） → ComicPanel（格）
 *
 * M6-2 在其上补齐形态（决策见 `轻画-comic形态调研.md` §6）：
 *   - 项目级：阅读方向（LTR / RTL）+ 角色卡库（跨格复用外观，保 AI 生成一致性）
 *   - 页级：版式 = 切割树（**切割顺序 = 阅读顺序**，阅读顺序是派生量不单独存）
 *   - 格级：三层分离 —— ① 画面描述（喂生图）② 镜头语言（字段化）③ 对白层（贴纸）
 *
 * 三条关键取舍（调研稿 §6，都在类型上有所体现）：
 *   1. `LayoutLeaf` 只持 `panelId`，内容另存 `page.panels` **池**——改版式不动内容、
 *      删格不丢内容（可回收）、同一格内容可在不同版式间搬。代价是取内容要一次 id 查找。
 *   2. 对白坐标用 **0..1 相对值**——格尺寸随版式变，绝对像素会全乱。
 *   3. **不引入「页尺寸」字段**——先固定页比例，等真需要再加，避免过早锁死。
 *
 * `layout` 为空数组 = **尚未排版**（不是「满页单格」）。「满页单格」是版式编辑器首次
 * 编辑时把空 layout 实例化出来的结果（M6-3），属于编辑器行为而非领域约定——这样
 * 领域层不必回答「满页那一格对应池里的哪个 panel」这个没有唯一答案的问题。
 *
 * 纯数据结构 + 纯函数，不含 React / platform / 持久化（架构 §2.2 domain 纯度约束）。
 */

import type { RunStatus } from '../../shared/execution/types'
import { RUN_STATUSES } from '../../shared/execution/types'
import { createId } from '../../../shared/id'
import { countLayoutPanels } from '../layout/readingOrder'

// ─────────────────────────────────────────────────────────────
// 词表（先落稳各方交集，留扩展位；来源见调研稿 §3/§4）
// ─────────────────────────────────────────────────────────────

/** 阅读方向（ACBF / eBDtheque 共识：项目级） */
export type ReadingDirection = 'ltr' | 'rtl'

/** 对白类型：四类交集（ACBF `text-area@type` × CBML `balloon`/`caption`/`sound`） */
export type BalloonType = 'speech' | 'thought' | 'narration' | 'sfx'

/** 景别（Storyboarder 把 `shot type` 字段化） */
export type ShotFraming = 'extreme-wide' | 'wide' | 'medium' | 'close-up' | 'extreme-close-up'

/** 机位角度 */
export type ShotAngle = 'eye-level' | 'high' | 'low' | 'dutch' | 'birds-eye' | 'worms-eye'

/** 与上一格的转场（McCloud 六类，CBML 亦采用） */
export type PanelTransition =
  | 'moment-to-moment'
  | 'action-to-action'
  | 'subject-to-subject'
  | 'scene-to-scene'
  | 'aspect-to-aspect'
  | 'non-sequitur'

/** 切割方向：`h` = 横切（上下分），`v` = 竖切（左右分） */
export type CutDirection = 'h' | 'v'

/** 切割位置：`equal` 时由 `count` 等分，其余为单刀（相对位置五档取三） */
export type CutPosition = 'start' | 'center' | 'end' | 'equal'

/** 词表常量：供归一化校验与 UI 选项（M6-4）遍历，避免两处各写一份 */
export const READING_DIRECTIONS: readonly ReadingDirection[] = ['ltr', 'rtl']
export const BALLOON_TYPES: readonly BalloonType[] = ['speech', 'thought', 'narration', 'sfx']
export const SHOT_FRAMINGS: readonly ShotFraming[] = [
  'extreme-wide',
  'wide',
  'medium',
  'close-up',
  'extreme-close-up',
]
export const SHOT_ANGLES: readonly ShotAngle[] = [
  'eye-level',
  'high',
  'low',
  'dutch',
  'birds-eye',
  'worms-eye',
]
export const PANEL_TRANSITIONS: readonly PanelTransition[] = [
  'moment-to-moment',
  'action-to-action',
  'subject-to-subject',
  'scene-to-scene',
  'aspect-to-aspect',
  'non-sequitur',
]
export const CUT_DIRECTIONS: readonly CutDirection[] = ['h', 'v']
export const CUT_POSITIONS: readonly CutPosition[] = ['start', 'center', 'end', 'equal']

/** 缺省值（归一化与工厂共用，避免两处各写一份字面量） */
export const DEFAULT_READING_DIRECTION: ReadingDirection = 'ltr'
export const DEFAULT_FRAMING: ShotFraming = 'medium'
export const DEFAULT_ANGLE: ShotAngle = 'eye-level'

// ─────────────────────────────────────────────────────────────
// 版式：切割树
// ─────────────────────────────────────────────────────────────

/** 切割：满页反复切，每次切 = { 方向, 相对位置, 等分条数, 微倾 }（comfyui_panels 模型） */
export interface LayoutCut {
  kind: 'cut'
  direction: CutDirection
  position: CutPosition
  /** 仅 `position === 'equal'` 生效：等分条数（≥2） */
  count: number
  /** 微倾角（度，0 = 正）——版式美学，只给切割级不给格级 */
  skew?: number
  children: LayoutNode[]
}

/** 叶子：只持 `panelId`，内容在 `page.panels` 池里 */
export interface LayoutLeaf {
  kind: 'panel'
  panelId: string
}

export type LayoutNode = LayoutCut | LayoutLeaf

// ─────────────────────────────────────────────────────────────
// 格：三层分离
// ─────────────────────────────────────────────────────────────

/** 对白贴纸——**不烘进图**，重生成画面不丢对白（ACBF「文本层独立于图」洞见） */
export interface ComicBalloon {
  id: string
  type: BalloonType
  text: string
  /** 说话人（角色卡 id）；`narration` / `sfx` 为空 */
  speakerId?: string
  /** 格内相对坐标（0..1，与格尺寸解耦） */
  x: number
  y: number
  w: number
  h: number
  /** 尾巴指向（`speech` / `thought` 用），同样 0..1 相对坐标 */
  tail?: { x: number; y: number }
}

/** 镜头语言（字段化，不塞进提示词） */
export interface ComicShot {
  framing: ShotFraming
  angle: ShotAngle
  /** 与上一格的转场（McCloud 六类）；首页缺省 */
  transition?: PanelTransition
}

/**
 * 留痕状态（M6-15）：与共享执行词的 `RunStatus` **同词表**，不新造状态。
 * 只做别名，好让「格的留痕」在自己的模型里读起来是一等概念。
 */
export type PanelRunStatus = RunStatus

/**
 * 格的生成留痕（M6-15）——一次生成 = 一条，**只增不删**（产品文档 §6.21）。
 *
 * 为什么必须有它：M6-5 起「重生成」就是拿新产物**覆盖** `panel.assetHash`，
 * 而 `assets` 表里那张旧图虽然还在，却已经**没有任何指针指向它**——用户点一下
 * 「重生成」，上一版就此失联且无从找回。这不是「缺一个面板」，是**不可逆的数据丢失**。
 * 共享执行引擎的 `ExecutionPlacement.record` 从一开始就为这件事留了位置
 * （「返回 null 表示该工作台暂不落留痕」），comic 侧一直是那个 null —— 本字段补上它。
 *
 * **为什么存在格上、而不是像画布那样单开一张表**：画布是「图 + 补丁流」模型，
 * 图快照（`graph` 切片）与生成记录（`runRecords` 表）分属两套存储、两条写通道，
 * 因此画布必须把记录**写进另一张表**；comic 的数据是**单个聚合对象**、只有一个写
 * 通道（整对象落 `comics` 一行），留痕天然属于这个聚合对象的一部分——于是它跟着
 * 项目一起被读回、一起被导出、一起被归一化，不需要第二套存储机制。
 * 代价是文档变大：一条留痕是十几个小字段（无二进制），而生成是**低频**操作，
 * 相对「重生成一次就丢一版图」的代价，这个交换是划算的。
 *
 * 快照的口径（与 `ComicPanelParams` 同源）：只记**影响画面产出**的东西——
 * 画面描述 / 景别 / 机位 / 出场角色 / 渠道 / 模型 / 参考图。刻意**不含**：
 * ① 对白贴纸（不烘进图，回退画面不该动对白）；
 * ② 转场 `transition`（那是「与上一格的叙事关系」，不是画面输入）。
 */
export interface ComicPanelRun {
  id: string
  /** 版本号（每格内从 1 起，由自身历史推出，见 `nextPanelRunVersion`） */
  version: number
  createdAt: number
  status: PanelRunStatus
  /** 该版本的产物：回退即把这里写回 `assetHash`；失败 / 取消为空数组 */
  outputHashes: string[]
  /** 画面描述（回退时写回 `panel.scene`） */
  scene: string
  /** 景别（回退时写回 `shot.framing`） */
  framing: ShotFraming
  /** 机位（回退时写回 `shot.angle`） */
  angle: ShotAngle
  /** 出场角色 id（回退时写回） */
  characterIds: string[]
  channelId: string
  model: string
  /**
   * 该版本实际随请求上传的参考图（去重、截断后的口径，与渠道层一致）。
   * 展示用「参考图 ×n」，也是「这一版到底参考了什么」的凭据。
   */
  referenceHashes: string[]
  /** 生成指纹（与 `panelFingerprintOf` 同源）：判定「这一版是不是当前配置的产物」 */
  fingerprint: string
  durationMs: number
}

/** 分镜格：画面描述 + 镜头语言 + 对白层 + 生成留痕 */
export interface ComicPanel {
  id: string
  /** ① 画面描述：喂生图的 prompt（对应画布的 generation 节点） */
  scene: string
  /** ② 镜头语言 */
  shot: ComicShot
  /** 参与画面的人物（角色卡 id；生成时把角色描述与参考图并入请求） */
  characterIds: string[]
  /** 生成结果：素材哈希（复用现有 `assets` 表，不新建素材存储） */
  assetHash?: string
  /**
   * 生成配置（M6-5）：渠道 id。
   * 与画布提示词节点的可选 `channelId` 同构——未配置即不参与生成。
   * 选择放在**格级**（而非项目级）：与画布把 channelId/model 放在节点数据上一致，
   * 且「看一格就能知道它用什么模型出图」，不依赖外部上下文。
   */
  channelId?: string
  /** 生成配置（M6-5）：模型 id */
  model?: string
  /** ③ 对白层：贴纸 */
  balloons: ComicBalloon[]
  /**
   * ④ 生成留痕（M6-15）：本格每一次生成一条，只增不删。
   * 当前生效的那一版 = `assetHash` 指向的产物所属的记录（见 `livePanelRun`）。
   */
  runs: ComicPanelRun[]
}

// ─────────────────────────────────────────────────────────────
// 页 / 话 / 角色卡 / 项目
// ─────────────────────────────────────────────────────────────

export interface ComicPage {
  id: string
  /** 在所属话内的顺序（0 起） */
  index: number
  /** 页标题（用户可改，缺省为空） */
  title: string
  /** 版式切割树；空数组 = 尚未排版（见文件头说明） */
  layout: LayoutNode[]
  /** 格内容池：版式叶子只持 id，内容存这里（删格不丢内容） */
  panels: ComicPanel[]
}

/** 话（漫画剧的一话） */
export interface ComicEpisode {
  id: string
  /** 在所属漫画剧内的顺序（0 起） */
  index: number
  title: string
  pages: ComicPage[]
}

/** 角色卡：跨格复用外观，保证 AI 生成一致性（Manga109 元数据框架的 character 实体） */
export interface ComicCharacter {
  id: string
  name: string
  /** 外观描述：喂生图的角色 prompt 片段 */
  description: string
  /** 参考图素材哈希（复用现有 `assets` 表，不新建素材存储） */
  referenceHashes: string[]
}

/** 漫画剧聚合根：一个 comic 项目的全部创作数据 */
export interface ComicProject {
  /** 与 projects 表主键一致 */
  id: string
  title: string
  readingDirection: ReadingDirection
  /** 角色卡库 */
  characters: ComicCharacter[]
  episodes: ComicEpisode[]
}

// ─────────────────────────────────────────────────────────────
// 工厂
// ─────────────────────────────────────────────────────────────

/** 空漫画剧（新建项目时的初始数据；`comics` 表一行一个） */
export function emptyComicProject(id: string, title = '未命名漫画剧'): ComicProject {
  return {
    id,
    title,
    readingDirection: DEFAULT_READING_DIRECTION,
    characters: [],
    episodes: [],
  }
}

/** 新格（三层皆空，留痕从零起） */
export function newComicPanel(): ComicPanel {
  return {
    id: createId('panel'),
    scene: '',
    shot: { framing: DEFAULT_FRAMING, angle: DEFAULT_ANGLE },
    characterIds: [],
    balloons: [],
    runs: [],
  }
}

/**
 * 新对白贴纸（M6-4）。
 *
 * 坐标由调用方给定——**格内 0..1 相对值**，而不是在这里算：初始位置取决于该格
 * 已有几个贴纸（叠放），是版式问题，落在 `domain/comic/panel/balloonLayout.ts`。
 * 这里只组装对象，保持工厂轻。
 */
export function newComicBalloon(
  type: BalloonType,
  rect: { x: number; y: number; w: number; h: number; tail?: { x: number; y: number } },
): ComicBalloon {
  const balloon: ComicBalloon = {
    id: createId('balloon'),
    type,
    text: '',
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
  }
  if (rect.tail) balloon.tail = { ...rect.tail }
  return balloon
}

/** 新角色卡（只有名字时描述留空，等用户补外观描述） */
export function newComicCharacter(input: {
  name?: string
  description?: string
  referenceHashes?: string[]
} = {}): ComicCharacter {
  return {
    id: createId('char'),
    name: input.name?.trim() || '新角色',
    description: input.description ?? '',
    referenceHashes: input.referenceHashes ?? [],
  }
}

/**
 * 追加一张参考图（M6-13）。
 *
 * **已在列表里则返回原数组引用**——这不是省内存的小聪明，而是让「无变化」可被
 * 上层识别：命令 reducer 靠 `next.referenceHashes !== prev.referenceHashes` 判断
 * 是否要重写项目文档，若这里无条件新建数组，重复添加同一张图会被当成一次真改动、
 * 白白触发一次落库（并可能把「已存在」的语义悄悄变成「加了两遍」）。
 *
 * 去重口径是**内容哈希**（`assets` 表的 id）：同一张图换名再传，hash 相同即同一张，
 * 这正是内容寻址的红利——「同一张图」的定义不由文件名/上传次数决定。
 */
export function addCharacterReference(hashes: string[], hash: string): string[] {
  return hashes.includes(hash) ? hashes : [...hashes, hash]
}

/** 移除一张参考图；不存在则返回原数组引用（同上：让「无变化」可识别） */
export function removeCharacterReference(hashes: string[], hash: string): string[] {
  const i = hashes.indexOf(hash)
  if (i < 0) return hashes
  return [...hashes.slice(0, i), ...hashes.slice(i + 1)]
}

// ─────────────────────────────────────────────────────────────
// 查询（按 id 定位）
// ─────────────────────────────────────────────────────────────

/**
 * 按 `panelId` 全篇定位分镜格。
 *
 * `panelId` 由 `createId('panel')` 生成（UUID），**全局唯一**——与命令层
 * `mapPanel` 的口径一致：只带 panelId 就能定位，不必让调用方再传 episodeId + pageId。
 * 代价是一次全篇扫描（话 × 页 × 格），在本地单机数据规模下可忽略。
 */
export function findPanel(project: ComicProject, panelId: string): ComicPanel | null {
  for (const ep of project.episodes) {
    for (const page of ep.pages) {
      const found = page.panels.find((p) => p.id === panelId)
      if (found) return found
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────
// 统计（派生量；阅读顺序见 domain/comic/layout/readingOrder）
// ─────────────────────────────────────────────────────────────

/** 统计：全部页数 */
export function countPages(project: ComicProject): number {
  return project.episodes.reduce((n, ep) => n + ep.pages.length, 0)
}

/**
 * 统计：全部分镜格数。
 * 口径 = **已排入版式的格**（版式叶子数）。池里的孤儿格（删格后回收保留）
 * 不计入——它们不在页面上，是内容备份而非当前分镜。
 */
export function countPanels(project: ComicProject): number {
  let n = 0
  for (const ep of project.episodes) {
    for (const page of ep.pages) n += countLayoutPanels(page.layout)
  }
  return n
}

// ─────────────────────────────────────────────────────────────
// 归一化（读回迁移）
// ─────────────────────────────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}
function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function asFiniteNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
/**
 * 词表收敛：值不在词表里就回落到缺省。
 *
 * **对外导出**（M6-15）而不是留在本文件私有：`panelRun.asComicPanelParams` 也要把
 * 引擎递来的不透明 params 收窄成同一套词表值。两处各写一份 `includes` 判断，
 * 缺省值的口径（缺省景别是 medium 还是 wide）迟早会漂移。
 */
export function pickFrom<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}
/** 可选词表字段：只在命中词表时返回，否则 undefined（不给「假的默认值」） */
function optionalFrom<T extends string>(v: unknown, allowed: readonly T[]): T | undefined {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined
}

/**
 * 镜头语言归一化。格与留痕**共用一份口径**：
 * 两处各写一遍「缺省景别是 medium / 机位是 eye-level」，迟早有一处忘了跟着改。
 */
function normalizeShot(raw: unknown): ComicShot {
  const r = asRecord(raw)
  const shot: ComicShot = {
    framing: pickFrom(r.framing, SHOT_FRAMINGS, DEFAULT_FRAMING),
    angle: pickFrom(r.angle, SHOT_ANGLES, DEFAULT_ANGLE),
  }
  const transition = optionalFrom(r.transition, PANEL_TRANSITIONS)
  if (transition) shot.transition = transition
  return shot
}

function normalizeBalloon(raw: unknown): ComicBalloon | null {
  const r = asRecord(raw)
  const id = asString(r.id)
  if (!id) return null
  const balloon: ComicBalloon = {
    id,
    type: pickFrom(r.type, BALLOON_TYPES, 'speech'),
    text: asString(r.text),
    x: asFiniteNumber(r.x),
    y: asFiniteNumber(r.y),
    w: asFiniteNumber(r.w),
    h: asFiniteNumber(r.h),
  }
  const speakerId = asString(r.speakerId)
  if (speakerId) balloon.speakerId = speakerId
  const tail = asRecord(r.tail)
  if (typeof tail.x === 'number' && typeof tail.y === 'number') {
    balloon.tail = { x: tail.x, y: tail.y }
  }
  return balloon
}

/**
 * 留痕归一化（M6-15）。
 *
 * 与别的读回一样：**只补不删**。缺 `version` 就补 1、状态不在词表里就当成 `succeeded`，
 * 而不是把这条记录丢掉——留痕的语义是「发生过的事」，读不出来时**宁可信息退化、
 * 也不能让历史凭空少一条**（少一条 = 那一版图又变成孤儿）。
 */
function normalizePanelRun(raw: unknown): ComicPanelRun | null {
  const r = asRecord(raw)
  const id = asString(r.id)
  if (!id) return null
  return {
    id,
    version: Math.max(1, Math.trunc(asFiniteNumber(r.version, 1))),
    createdAt: asFiniteNumber(r.createdAt),
    status: pickFrom(r.status, RUN_STATUSES, 'succeeded'),
    outputHashes: asStringArray(r.outputHashes),
    scene: asString(r.scene),
    framing: pickFrom(r.framing, SHOT_FRAMINGS, DEFAULT_FRAMING),
    angle: pickFrom(r.angle, SHOT_ANGLES, DEFAULT_ANGLE),
    characterIds: asStringArray(r.characterIds),
    channelId: asString(r.channelId),
    model: asString(r.model),
    referenceHashes: asStringArray(r.referenceHashes),
    fingerprint: asString(r.fingerprint),
    durationMs: asFiniteNumber(r.durationMs),
  }
}

function normalizePanel(raw: unknown): ComicPanel | null {
  const r = asRecord(raw)
  const id = asString(r.id)
  if (!id) return null
  const panel: ComicPanel = {
    id,
    scene: asString(r.scene),
    shot: normalizeShot(r.shot),
    characterIds: asStringArray(r.characterIds),
    balloons: asArray(r.balloons)
      .map(normalizeBalloon)
      .filter((b): b is ComicBalloon => b !== null),
    runs: asArray(r.runs)
      .map(normalizePanelRun)
      .filter((x): x is ComicPanelRun => x !== null),
  }
  const assetHash = asString(r.assetHash)
  if (assetHash) panel.assetHash = assetHash
  const channelId = asString(r.channelId)
  if (channelId) panel.channelId = channelId
  const model = asString(r.model)
  if (model) panel.model = model
  return panel
}

function normalizeLayoutNode(raw: unknown): LayoutNode | null {
  const r = asRecord(raw)
  if (r.kind === 'panel') {
    const panelId = asString(r.panelId)
    return panelId ? { kind: 'panel', panelId } : null
  }
  if (r.kind === 'cut') {
    const node: LayoutCut = {
      kind: 'cut',
      direction: pickFrom(r.direction, CUT_DIRECTIONS, 'v'),
      position: pickFrom(r.position, CUT_POSITIONS, 'equal'),
      count: Math.max(2, Math.trunc(asFiniteNumber(r.count, 2))),
      children: asArray(r.children)
        .map(normalizeLayoutNode)
        .filter((n): n is LayoutNode => n !== null),
    }
    const skew = asFiniteNumber(r.skew, NaN)
    if (Number.isFinite(skew)) node.skew = skew
    return node
  }
  return null
}

function normalizePage(raw: unknown, index: number): ComicPage {
  const r = asRecord(raw)
  return {
    id: asString(r.id, createId('page')),
    index: Math.trunc(asFiniteNumber(r.index, index)),
    title: asString(r.title),
    layout: asArray(r.layout)
      .map(normalizeLayoutNode)
      .filter((n): n is LayoutNode => n !== null),
    panels: asArray(r.panels)
      .map(normalizePanel)
      .filter((p): p is ComicPanel => p !== null),
  }
}

function normalizeEpisode(raw: unknown, index: number): ComicEpisode {
  const r = asRecord(raw)
  return {
    id: asString(r.id, createId('ep')),
    index: Math.trunc(asFiniteNumber(r.index, index)),
    title: asString(r.title, `第 ${index + 1} 话`),
    pages: asArray(r.pages).map((p, i) => normalizePage(p, i)),
  }
}

function normalizeCharacter(raw: unknown): ComicCharacter | null {
  const r = asRecord(raw)
  const id = asString(r.id)
  if (!id) return null
  return {
    id,
    name: asString(r.name, '未命名角色'),
    description: asString(r.description),
    referenceHashes: asStringArray(r.referenceHashes),
  }
}

/**
 * 把任意来源的行归一化成当前 `ComicProject`（读回迁移，M6-2）。
 *
 * `comics` 表存的是整个文档对象，模型升级后旧文档缺字段。这里补齐缺省而非
 * 报错——**只补不删**，未知字段忽略。骨架期（M5/M6-0）的页/格从未产生过真实
 * 数据（UI 只能建话），因此不写「旧 panels → 新 layout」的转换器，只做形状收敛。
 *
 * 注：不做版本号判定。等首次出现**有真实数据需要差异化迁移**时再引入
 * `schemaVersion` 字段，避免现在写一堆永远走不到的分支。
 */
export function normalizeComicProject(raw: unknown): ComicProject {
  const r = asRecord(raw)
  return {
    id: asString(r.id),
    title: asString(r.title, '未命名漫画剧'),
    readingDirection: pickFrom(r.readingDirection, READING_DIRECTIONS, DEFAULT_READING_DIRECTION),
    characters: asArray(r.characters)
      .map(normalizeCharacter)
      .filter((c): c is ComicCharacter => c !== null),
    episodes: asArray(r.episodes).map((ep, i) => normalizeEpisode(ep, i)),
  }
}
