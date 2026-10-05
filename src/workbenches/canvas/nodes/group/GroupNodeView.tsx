import type { NodeViewProps } from '../registry'
import { ContainerBody } from '../../frame/ContainerBody'

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
  return (
    <ContainerBody
      node={props.node}
      kind="group"
      children={props.childNodes}
      renderChild={props.renderChild}
      emptyText="拖入提示词或生成结果"
      emptyHint="组内素材与提示词都作为本次生成的输入"
    />
  )
}
