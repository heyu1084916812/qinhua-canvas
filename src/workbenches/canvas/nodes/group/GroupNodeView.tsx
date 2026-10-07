import type { NodeViewProps } from '../registry'
import type { GroupData, NodeSnapshot } from '../../../../domain/canvas/model/node'
import { GroupBody } from '../../frame/GroupBody'
import { orderChildren } from '../../frame/ContainerBody'

/**
 * 分组节点视图（产品文档 §6.11）。
 *
 * 本体只有「固定比例容器 + 内部节点」：5:4 由 sizing.lockAspect 保证，
 * 虚线边框（hover / 选中可见）+ 半透明 --bg-subtle 60% 背景。
 * 形态逻辑（3×3 行优先网格、动态最小尺寸）在 ContainerBody 里与批量共用；
 * 这里只提供分组语义的空态文案。
 *
 * 组内节点由 画布表面 递归渲染成完整 frame 后注入，端点已由 NodeFrame 按 parentId 隐藏；
 * 素材增删 / 隐藏 / 排序都从创作面板完成（§6.11「素材增删、隐藏、排序从创作面板完成」），
 * 本体不放编辑控件。
 */
export function GroupNodeView(props: NodeViewProps) {
  const data = props.node.data as Partial<GroupData>
  /** 子节点按 `data.childIds` 排（表达 z 序；位置仍是各自的 local 坐标） */
  const ordered = orderChildren(props.childNodes ?? [], (data.childIds ?? []) as string[])
  return (
    <GroupBody
      node={props.node as NodeSnapshot}
      children={ordered}
      renderChild={props.renderChild}
    />
  )
}
