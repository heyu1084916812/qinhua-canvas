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
   * 是否显示「删除」按钮。
   *
   * §6.6 把缩略图分成两类，操作刻意不同：**上游链接的素材只能小眼睛隐藏**
   * （取消连线才移除），**节点自身内容可以删除**。所以只有 `owner==='self'`
   * 且确实是本节点内容的项可删；组内 / 上游项一律不可删。
   */
  removable?: boolean
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

/** 面板事件：全部是语义事件，由页面装配层翻译成命令（架构 §4.7） */
export type PanelEvent =
  | { type: 'setPrompt'; text: string }
  | { type: 'setChannel'; channelId: string }
  | { type: 'setModel'; model: string }
  | { type: 'setRatio'; ratio: string }
  | { type: 'setResolution'; resolution: string }
  | { type: 'setQuality'; quality: string }
  | { type: 'setCount'; count: number }
  /**
   * 功能类别切换（§6.8「右上角为图片 / 视频功能类别切换」）。
   *
   * 视频**不是另一种节点**，而是同一个生成节点的 `data.mode`——模板「图生视频」
   * 建出来的就是 `{ type: 'generation', data: { mode: 'video' } }`。
   * 面板知道当前模型属于哪一类（它持有模型列表），所以由它判断切换后要不要留模型：
   * `keepModel = false` 表示当前模型不属于目标类别，装配层需一并清空，否则会把
   * 生图模型发给视频渠道。让装配层自己去查列表等于把这份知识抄两遍。
   */
  | { type: 'setMode'; mode: 'image' | 'video'; keepModel: boolean }
  /** 视频参数（§6.8 视频模式）：尺寸 / 时长 / 首尾帧·全能参考 */
  | { type: 'setSize'; size: 'auto' | '480p' | '720p' | '1080p' }
  | { type: 'setDurationSec'; sec: number }
  | { type: 'setRefMode'; refMode: 'first-last-frame' | 'all-purpose' }
  | { type: 'toggleThumb'; owner: PanelThumb['owner']; id: string }
  /** 删除节点自身内容（§6.6「节点自身内容 → 删除」）；上游缩略图不可删，只有小眼睛 */
  | { type: 'removeOwnAsset' }
  | { type: 'toggleCollection'; id: string }
  | { type: 'togglePrompt' }
  | { type: 'reorderThumbs'; owner: PanelThumb['owner']; order: string[] }
  | { type: 'optimize' }
  | { type: 'translate' }
  /**
   * 把面板草稿写入节点正文（§6.7「面板 = 工作区，正文 = 最终提示词」）。
   *
   * 草稿（`draft`）只是创作过程，下游消费的是 `text`——两者之间唯一的桥就是
   * 这个显式确认动作：由装配层翻译成 `node.updateData({ text: draft })`
   * （transient:false，进撤销栈）。草稿写入后保留不清空，方便继续改了再写。
   */
  | { type: 'applyDraft' }
  | { type: 'run' }
  | { type: 'cancel' }
  | { type: 'close' }
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
