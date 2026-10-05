import { Fragment, memo, type ReactNode } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { NodeFrame } from '../frame/NodeFrame'
import { getNodeDefinition } from '../nodes/registry'
import { portDeclsOf } from '../../../domain/canvas/nodeSpecs/ports'
import { heightFromContentOf, resizeLockOf } from '../../../domain/canvas/nodeSpecs/resizeLock'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import type { RunMode } from '../../../domain/canvas/model/runRecord'
import type { NodeViewEvent } from '../nodes/registry'
import type { InputPortAsset } from '../nodes/registry'
import type { NodeInput } from '../../../domain/shared/execution/types'

/**
 * React Flow 的自定义节点（引擎替换 P0）。
 *
 * 关键点：**外观一行代码都没重写** —— 仍然复用 `NodeFrame` + `def.View`，
 * 换的只是"谁负责摆位、谁负责连线、谁负责手势"。
 *
 * ⚠️ `NodeFrame` 自己会按 `node.x/y` 绝对定位（那是给老的 `.world` 图层用的），
 * 而 React Flow 已经把节点摆在 `position` 上了，所以这里必须**把坐标归零**再交给它，
 * 否则位置会翻倍偏移（与 `NodeLayer.renderChild` 对容器子节点做的事一样）。
 */
/** 图级派生数据（由 `useNodeDerivedMaps` 算好注入；两个表面共用同一批字段） */
export interface FlowNodeDerivedProps {
  upstreamAssetHashes?: string[]
  upstreamPromptCount?: number
  hasRunnableDownstream?: boolean
  upstreamImageInputs?: NodeInput[]
  inputPortAssets?: Record<string, InputPortAsset[]>
}

export interface FlowNodeData extends FlowNodeDerivedProps, Record<string, unknown> {
  node: NodeSnapshot
  running: boolean
  error: string | null
  runMode: RunMode
  emit: (event: NodeViewEvent) => void
  /** 容器（分组 / 批量）的子节点：沿用老表面那套 —— 由容器本体按网格渲染 */
  childNodes?: NodeSnapshot[]
  renderChild?: (child: NodeSnapshot) => ReactNode
}

function handlePosition(side: 'left' | 'right') {
  return side === 'left' ? Position.Left : Position.Right
}

function FlowNodeInner({ data, selected }: NodeProps) {
  const { node, running, error, runMode, emit, childNodes, renderChild, ...derived } =
    data as unknown as FlowNodeData
  const def = getNodeDefinition(node.type)
  const ports = portDeclsOf(def.ports)
  const frameNode = { ...node, x: 0, y: 0 }

  /**
   * 端点（React Flow 的 `Handle`）走 `NodeFrame.overlay`，**不放在 `children` 里**：
   * - 放进 `children` ⇒ 落进 `.body { overflow: clip }`，手柄伸在框外的那一半被裁 ⇒ 拉线手势起不来；
   * - 放在 NodeFrame **外面**（同级）⇒ 够得着，但不再是 `[data-node-type]` 的后代 ⇒
   *   冒烟 / 探针的 `[data-node-type] [data-port]` 找不到端点（G66 实测超时）。
   * `overlay` 同时满足：在框内、不被裁。
   */
  const handleNodes = ports.map((port) => {
    const position = handlePosition(port.side)
    const style = { top: `${port.y * 100}%` }
    if (port.kind === 'both') {
      return (
        <Fragment key={port.id}>
          <Handle id={port.id} type="target" position={position} style={style} data-port={port.id} />
          <Handle id={port.id} type="source" position={position} style={style} data-port={port.id} />
        </Fragment>
      )
    }
    return (
      <Handle
        key={port.id}
        id={port.id}
        type={port.kind === 'input' ? 'target' : 'source'}
        position={position}
        style={style}
        data-port={port.id}
      />
    )
  })

  return (
    <NodeFrame
      node={frameNode}
      selected={!!selected}
      scale={1}
      ports={def.ports}
      minSize={def.sizing.min}
      resizeLock={resizeLockOf(node)}
      heightFromContent={heightFromContentOf(node)}
      /* 老画布那份端点交给 React Flow 的 Handle 画，避免两套端点叠在一起 */
      portsHidden
      overlay={handleNodes}
      onFramePointerDown={() => {}}
      onResize={() => {}}
      onRename={(title) => emit({ type: 'rename', title })}
    >
      <def.View
        node={node}
        size={{ w: node.w, h: node.h }}
        scale={1}
        selected={!!selected}
        running={running}
        globalRunning={false}
        runMode={runMode}
        error={error}
        emit={emit}
        {...derived}
        childNodes={childNodes}
        renderChild={renderChild}
      />
    </NodeFrame>
  )
}

export const FlowFlowNode = memo(FlowNodeInner)

/**
 * 容器（分组 / 批量）里的子节点：与顶层节点**共用同一个 `NodeFrame` + `def.View`**，
 * 只有两条差别 —— 坐标由容器网格决定（归零）、端点隐藏（§6.11「组内节点端点隐藏」）。
 *
 * 关键：子节点**不进 React Flow 的节点列表**，而是作为容器 `View` 的 `renderChild` 结果
 * 渲染在容器内部。这与老表面 `NodeLayer.renderChild` 完全一致，因此容器的网格布局、
 * 拖出归属等语义不用重写。
 */
export function FlowChildFrame({
  child,
  selected,
  running,
  error,
  runMode,
  emit,
  derived,
}: {
  child: NodeSnapshot
  selected: boolean
  running: boolean
  error: string | null
  runMode: RunMode
  emit: (event: NodeViewEvent) => void
  derived?: FlowNodeDerivedProps
}) {
  const def = getNodeDefinition(child.type)
  return (
    <NodeFrame
      node={{ ...child, x: 0, y: 0 }}
      selected={selected}
      scale={1}
      ports={def.ports}
      minSize={def.sizing.min}
      portsHidden
      resizeLock={resizeLockOf(child)}
      heightFromContent={heightFromContentOf(child)}
      onFramePointerDown={() => {}}
      onResize={() => {}}
      onRename={(title) => emit({ type: 'rename', title })}
    >
      <def.View
        node={child}
        size={{ w: child.w, h: child.h }}
        scale={1}
        selected={selected}
        running={running}
        globalRunning={false}
        runMode={runMode}
        error={error}
        emit={emit}
        {...derived}
      />
    </NodeFrame>
  )
}
