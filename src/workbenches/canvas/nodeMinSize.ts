import { containerMinSize, groupFitSize } from '../../domain/canvas/layout/packContainer'
import { isContainerType, type NodeSnapshot } from '../../domain/canvas/model/node'
import { getNodeDefinition } from './nodes/registry'

/**
 * 一个节点**此刻**的缩放下限。
 *
 * 抽出来的理由：这条规则原先只写在 `FlowNode` 里（喂给 `NodeFrame` 的 `minSize`），
 * 而键盘改尺寸要问的是**同一件事** —— 两处各写一份，迟早出现"键盘能缩到比拖拽更小"
 * 这种只在一条路上出现的洞。规则本身照抄原来那三档，一个字没改：
 *
 * - **分组**：子节点自由摆放 ⇒ 下限 = 它们的包围盒 + 四边等距（`groupFitSize`）；
 * - **批量**：子节点走 3×3 网格 ⇒ 下限 = 网格尺寸（`containerMinSize`）；
 * - 其余：节点定义里声明的 `sizing.min`。
 *
 * `children` 传**这个节点的直接子节点**（顶层节点传空数组即可）。
 */
export function minSizeOf(
  node: Pick<NodeSnapshot, 'type'>,
  children: readonly NodeSnapshot[],
): { w: number; h: number } {
  if (node.type === 'group') return groupFitSize(children)
  if (isContainerType(node.type)) {
    return containerMinSize(node.type as 'group' | 'batch', children.length)
  }
  return getNodeDefinition(node.type).sizing.min
}
