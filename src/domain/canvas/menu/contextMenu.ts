/**
 * 右键菜单项解析（产品文档 §4.1）。
 *
 * 纯函数：只描述「该出现哪些项、以什么顺序、危险项在哪」，不碰 DOM、不碰命令层。
 * UI 层拿到 items 后负责渲染与派发，命令层负责执行 —— 三者解耦，菜单结构可单测。
 *
 * §4.1 分组约定：
 * 运行类（生成 / 改写提示词 / 运行画板）最上 → 编辑类（复制 / 重命名 / 全屏编辑）
 * → 历史与结构类（版本历史）→ 危险操作（删除）单独一组置于底部，以分隔线区分。
 */

import type { NodeType } from '../model/node'

export type ContextMenuAction =
  | { kind: 'run' }
  | { kind: 'runBoard' }
  | { kind: 'duplicate' }
  | { kind: 'rename' }
  | { kind: 'fullscreenEdit' }
  | { kind: 'saveLibrary' }
  | { kind: 'delete' }
  | { kind: 'create'; type: NodeType }
  | { kind: 'paste' }
  | { kind: 'resetView' }

export interface ContextMenuItem {
  id: string
  label: string
  action: ContextMenuAction
  /** 该项之后画一条分隔线（用于把危险操作单独隔到底部） */
  separatorAfter?: boolean
}

/**
 * 可新建的节点类型与展示顺序（§6.5 ① 新建节点菜单 / §4.1 画布空白右键）。
 *
 * 文案与左侧功能栏**逐字一致**（用户 2026-09-19）：早先这里是「提示词 / 生成 / …」，
 * 而功能栏是「提示词节点 / 生成节点 / …」——同一件事在两个入口叫不同名字，
 * 用户会以为它们是两种东西。统一带上「节点」，并保持同样顺序。
 * 图标由 UI 层按 `type` 映射（领域层不持有渲染物）。
 */
export const CREATABLE_TYPES: readonly { type: NodeType; label: string }[] = [
  { type: 'prompt', label: '提示词节点' },
  { type: 'generation', label: '生成节点' },
  { type: 'compare', label: '对比节点' },
  { type: 'group', label: '分组节点' },
  { type: 'batch', label: '批量节点' },
  { type: 'loop', label: '循环节点' },
  { type: 'fusion', label: '融合节点' },
  { type: 'board', label: '画板节点' },
]

/** 右键菜单里带「生成」项的类型（§4.1：生成节点 / 批量节点） */
const RUNNABLE: ReadonlySet<NodeType> = new Set<NodeType>(['generation', 'batch'])

/** 节点菜单的可选上下文：决定「按范围跑」与「清除陈旧」两项该不该出现 */
/**
 * 节点右键菜单。
 * `type` 决定运行类项是否存在：只有生成 / 批量节点有「生成」（§6.12 生成入口）。
 * 生成 / 批量节点有「版本历史」（§6.21：RunRecord 由生成类节点产生）。
 *
 * 执行入口在右键菜单里只保留「运行画板」与「生成」两条。
 *
 * 已下线的三个（用户 2026-09-17）：「整条流程重新运行」「仅刷新陈旧节点」
 * 「清除陈旧标记」。前两个是**覆盖式**重跑——产物写回原节点、旧结果被冲掉；
 * 而落位改成「每次生成新建一个右侧节点」之后，用户要的是「出一份新的、旧的留着对比」，
 * 覆盖式重跑正好与之相反。留着只会让人误点丢结果。
 *
 * 禁用 / 改写提示词属后续，未落地故不列
 * （列出点了没反应的禁用项比不列更糟）。
 *
 * 「全屏编辑」2026-09-21 落地：提示词节点多一项，打开**文本编辑灯箱**（§6.7）。
 * 它放在「编辑类」——与复制 / 重命名同一组（§4.1 的分组约定）。
 */
export function nodeMenuItems(
  type: NodeType,
  opts: { hasAsset?: boolean } = {},
): ContextMenuItem[] {
  const items: ContextMenuItem[] = []
  if (type === 'board') {
    items.push({ id: 'runBoard', label: '运行画板', action: { kind: 'runBoard' }, separatorAfter: true })
  } else if (RUNNABLE.has(type)) {
    items.push({ id: 'run', label: '生成', action: { kind: 'run' }, separatorAfter: true })
  }
  if (type === 'generation' && opts.hasAsset) {
    items.push({
      id: 'saveLibrary',
      label: '保存到素材库',
      action: { kind: 'saveLibrary' },
    })
  }
  items.push({ id: 'duplicate', label: '复制', action: { kind: 'duplicate' } })
  // 只有提示词节点有正文可编辑；其它类型的「正文」概念不存在
  if (type === 'prompt') {
    items.push({ id: 'fullscreenEdit', label: '全屏编辑', action: { kind: 'fullscreenEdit' } })
  }
  items.push({ id: 'rename', label: '重命名', action: { kind: 'rename' }, separatorAfter: true })
  items.push({ id: 'delete', label: '删除', action: { kind: 'delete' } })
  return items
}

/**
 * 画布空白右键菜单（§4.1）：新建节点（全部类型）/ 粘贴 / 重置视图。
 *
 * `canPaste` 由调用方按「剪贴板是否为空」传入（本模块是纯函数，不持有剪贴板）。
 * 空剪贴板时不列「粘贴」——列出点了没反应的死项比不列更糟（与
 * `hasRunnableDownstream` 同口径：菜单只列当下真能做的事）。
 */
export function canvasMenuItems(opts: { canPaste?: boolean } = {}): ContextMenuItem[] {
  const items: ContextMenuItem[] = CREATABLE_TYPES.map((t) => ({
    id: `create:${t.type}`,
    label: t.label,
    action: { kind: 'create', type: t.type } as ContextMenuAction,
  }))
  items[items.length - 1].separatorAfter = true
  if (opts.canPaste) {
    items.push({ id: 'paste', label: '粘贴', action: { kind: 'paste' } })
  }
  items.push({ id: 'resetView', label: '重置视图', action: { kind: 'resetView' } })
  return items
}
