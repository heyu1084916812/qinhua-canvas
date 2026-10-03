import type { NodeSnapshot } from '../../../domain/canvas/model/node'

/**
 * 创作参数面板的数据模型（产品文档 §6.8 / §6.11 / §6.12）。
 *
 * 分组与批量的面板「与生成节点完全一致」，差别只在第一部分缩略图的来源与语义，
 * 因此面板本身做成「一份组件 + 数据驱动」：
 * - 分组：上游缩略图 + 组内素材/提示词缩略图（两类都要）
 * - 批量：只有内部素材缩略图（拖出才移除）
 * - 生成：上游 + 自身内容（M2 已在节点内实现，M3 起迁到本面板）
 *
 * 缩略图的共同属性：编号角标（左上，显性）、小眼睛（右上，隐性）、可拖动排序。
 */
export interface PanelThumb {
  /** 所在表 / 归属，排序命令按它决定改谁的顺序 */
  owner: 'upstream' | 'self'
  /** 稳定 id：素材用节点 id（不是 hash，因为同一素材可能被多个节点引用） */
  id: string
  /** 预览用素材 hash；提示词项没有 hash */
  assetHash?: string
  /** 提示词项：显示文本摘要而非图片 */
  text?: string
  /** 是否参与本次生成（小眼睛状态） */
  visible: boolean
  /**
   * 删除按钮的语义（用户 2026-09-21 改）：
   *
   * **每一张缩略图都可删**，但按来源分两种动作——
   * - `upstream`（上游节点的图）：删掉**那条连线**，上游节点本身不受影响。
   * - `self`（本节点自己的图）：**清空自己的素材**，节点回到「没上传图片」状态。
   *
   * 早先 §6.6 只允许删 `self`（上游只能小眼睛隐藏），理由是「删上游素材语义模糊」。
   * 用户这次把语义定死了：**上游删的是连线**，于是两类都能有明确的删除动作，
   * 上游不必再委屈地只能隐藏。
   */
  removable?: boolean
  /**
   * 该缩略图对应的**连线 id**（`owner==='upstream'` 时才有）。
   *
   * 为什么必须由模型给出而不是视图自己找：视图层不读图（架构 §4.7），
   * 而「删哪条边」要按 (上游节点 id → 本节点 id) 在图里查出来。
   */
  edgeId?: string
}

export interface PanelModel {
  /** 第一部分：缩略图（按展示顺序） */
  thumbs: PanelThumb[]
  /**
   * 第一部分里的集合卡（§6.12「作为上游：集合卡」）。
   * 批量节点作为上游时不展开缩略图，只显示一张标注内含素材数量的卡；
   * 可与其他缩略图拖动排序，因此带上同一套编号角标。
   */
  collections: PanelCollection[]
  /** 第一部分为空时的占位提示 */
  emptyHint: string
  /** 第二部分：提示词文本 */
  prompt: string
  /** 提示词下方的上游提示词胶囊（§6.7「上游已链接提示词节点 {n}」） */
  linkedPromptCount: number
  /** 提示词容器右侧的小眼睛（§6.11「组内若有提示词节点…提供小眼睛」） */
  promptToggle: { visible: boolean; title: string } | null
  /**
   * 提示词节点已选中的**技能 id**（`null` = 没选）。
   *
   * 技能是**设定**不是动作（用户 2026-09-24）：面板只负责展示「选了哪个」，
   * 真正生效在点生成时。故这里只带一个 id，不带技能正文 ——
   * 正文归技能库管，节点只记「用哪一条」。
   */
  selectedSkillId?: string | null
}

/** 集合卡（§6.12）：不展开内部素材，只标注数量；隐藏的素材不计入 */
export interface PanelCollection {
  /** 批量节点 id */
  id: string
  /** 内含素材数量（隐藏项已排除） */
  count: number
  /** 内容类型文案：素材 / 提示词 */
  kind: 'media' | 'prompt'
  /** 是否参与本次生成 */
  visible: boolean
}

/**
 * 配方快照：改参数时由面板一并带出「它当前显示的那套渠道 / 模型 / 参数」。
 *
 * 为什么由面板带、而不是让宿主从节点上读（用户 2026-09-23 实测踩到）：
 * 节点为空、只有面板兜底显示着渠道与模型时，节点 data 上取到的永远是空，
 * 于是「改了参数就记配方」这条链从源头断掉——表现为「改了参数，下一个新建节点
 * 还是原来的默认值」。面板手上本来就有解析链算出的可用组合，由它带出来最准确。
 */
export interface RecipeSnapshot {
  channelId: string
  model: string
  mode: 'image' | 'video'
  params: Record<string, unknown>
}

/** 面板事件：全部是语义事件，由页面装配层翻译成命令（架构 §4.7） */
export type PanelEvent =
  | { type: 'setPrompt'; text: string }
  | { type: 'setChannel'; channelId: string }
  | { type: 'setModel'; model: string; recipe?: RecipeSnapshot }
  | { type: 'setRatio'; ratio: string; recipe?: RecipeSnapshot }
  | { type: 'setResolution'; resolution: string; recipe?: RecipeSnapshot }
  | { type: 'setQuality'; quality: string; recipe?: RecipeSnapshot }
  /** 图片「背景」（图一）：`auto` / `opaque` / `transparent` */
  | { type: 'setBackground'; background: string; recipe?: RecipeSnapshot }
  | { type: 'setCount'; count: number; recipe?: RecipeSnapshot }
  /**
   * 功能类别切换（§6.8「右上角为图片 / 视频功能类别切换」）。
   *
   * 视频**不是另一种节点**，而是同一个生成节点的 `data.mode`——模板「图生视频」
   * 建出来的就是 `{ type: 'generation', data: { mode: 'video' } }`。
   * 面板知道当前模型属于哪一类（它持有模型列表），所以由它判断切换后要不要留模型：
   * `keepModel = false` 表示当前模型不属于目标类别，装配层需一并清空，否则会把
   * 生图模型发给视频渠道。让装配层自己去查列表等于把这份知识抄两遍。
   */
  | { type: 'setMode'; mode: 'image' | 'video'; keepModel: boolean; recipe?: RecipeSnapshot }
  /** 视频参数（§6.8 视频模式）：尺寸 / 时长 / 首尾帧·全能参考 */
  /** 视频清晰度档：取值由各模型的能力表约束（`720P` / `2K` / `480P` …），故不再写死联合 */
  | { type: 'setSize'; size: string; recipe?: RecipeSnapshot }
  | { type: 'setDurationSec'; sec: number; recipe?: RecipeSnapshot }
  | { type: 'setRefMode'; refMode: 'first-last-frame' | 'all-purpose'; recipe?: RecipeSnapshot }
  /** 视频「生成模式」（图四/图五/图七/图九那种下拉） */
  | { type: 'setVideoMode'; videoMode: string; recipe?: RecipeSnapshot }
  /** 视频「生成音频」开关（图三/图六） */
  | { type: 'setGenerateAudio'; generateAudio: boolean; recipe?: RecipeSnapshot }
  | { type: 'toggleThumb'; owner: PanelThumb['owner']; id: string }
  /** 删除节点自身内容（§6.6「节点自身内容 → 删除」）；上游缩略图不可删，只有小眼睛 */
  | { type: 'removeOwnAsset' }
  /**
   * 删除**某一张缩略图**（用户 2026-09-21）。
   *
   * 语义由 `owner` 决定（见 `PanelThumb` 的说明）：
   * - `self` → 清空本节点的素材；
   * - `upstream` → 删掉那条连线（上游节点保留）。
   */
  | { type: 'removeThumb'; owner: PanelThumb['owner']; id: string }
  | { type: 'toggleCollection'; id: string }
  | { type: 'togglePrompt' }
  | { type: 'reorderThumbs'; owner: PanelThumb['owner']; order: string[] }
  | { type: 'optimize' }
  | { type: 'translate' }
  | { type: 'run' }
  | { type: 'cancel' }
  | { type: 'close' }
  /**
   * 选中 / 取消一个**技能**（用户 2026-09-24）。
   *
   * 与 `run` / `optimize` 这类「动作」不同，这是一个**设定**：
   * 它只把「用哪条技能」写到节点上，不发起任何请求。
   * 生效时机是**下一次点生成**（见 `CanvasExecutionProvider` 的提示词分支）。
   */
  | { type: 'selectSkill'; skillId: string | null }
  /**
   * 去后台设置配渠道（面板发现「没有可用平台」时的引导出口）。
   *
   * 这是**宿主导航**事件而非画布命令：面板只负责发现「配不出来」这件事并上报，
   * 路由由页面容器处理（工作台 UI 层不认识路由，见架构 §4.7）。
   */
  | { type: 'openSettings' }

export interface PanelHostProps {
  node: NodeSnapshot
  model: PanelModel
  emit: (event: PanelEvent) => void
}

/** 缩略图排序：把 from 位置的项移到 to 位置，返回新的 id 顺序 */
export function moveInOrder<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice()
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}
