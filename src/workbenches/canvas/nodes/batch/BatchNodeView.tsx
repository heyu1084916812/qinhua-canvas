import type { BatchData } from '../../../../domain/canvas/model/node'
import type { NodeViewProps } from '../registry'
import { ContainerBody } from '../../frame/ContainerBody'

/**
 * 批量节点视图（产品文档 §6.12）。
 *
 * 形态与分组**完全一致**（文档：「固定比例容器布局规则与分组节点一致」），
 * 因此复用同一个 ContainerBody；差异全在语义：
 * - 收纳物二选一（素材 / 提示词），由 `canAcceptIntoBatch` 在落库与拖拽两侧校验
 * - 集合会被「逐个处理」，面板里每个素材各带编号与隐性小眼睛
 *
 * 空态文案按当前 contentType 分流，让用户一眼知道这个容器该放什么。
 * contentType 这里从「已注入的子节点」直接推得（纯展示，不读图，架构 §4.7）。
 */
export function BatchNodeView(props: NodeViewProps) {
  const data = props.node.data as BatchData
  const children = props.childNodes ?? []
  const first = children.find((c) => c.id !== props.node.id)
  const kind = first ? (first.type === 'prompt' ? 'prompt' : 'media') : data.contentType

  return (
    <ContainerBody
      node={props.node}
      kind="batch"
      children={props.childNodes}
      renderChild={props.renderChild}
      emptyText={kind === 'prompt' ? '拖入提示词节点' : '拖入图片 / 视频素材'}
      emptyHint={
        kind === 'prompt'
          ? '每条提示词各生成一张图，可批量文生图'
          : '每个素材各生成一份结果，可批量套图'
      }
    />
  )
}
