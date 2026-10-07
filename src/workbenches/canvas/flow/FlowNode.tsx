import { Fragment, memo, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { NodeFrame } from '../frame/NodeFrame'
import { getNodeDefinition } from '../nodes/registry'
import { portDeclsOf } from '../../../domain/canvas/nodeSpecs/ports'
import { heightFromContentOf, resizeLockOf } from '../../../domain/canvas/nodeSpecs/resizeLock'
import { RESIZE_CORNERS } from '../../../domain/canvas/nodeSpecs/resizeLock'
import { isContainerType } from '../../../domain/canvas/model/node'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { containerMinSize, groupFitSize } from '../../../domain/canvas/layout/packContainer'
import type { RunMode } from '../../../domain/canvas/model/runRecord'
import type { NodeViewEvent } from '../nodes/registry'
import type { InputPortAsset } from '../nodes/registry'
import type { NodeInput } from '../../../domain/shared/execution/types'
import type { Rect } from '../../../domain/canvas/geometry/rect'

/**
 * React Flow 的自定义节点（引擎替换 P0）。
 *
 * 关键点：**外观一行代码都没重写** —— 仍然复用 `NodeFrame` + `def.View`，
 * 换的只是"谁负责摆位、谁负责连线、谁负责手势"。
 *
 * ⚠️ `NodeFrame` 自己会按 `node.x/y` 绝对定位（那是给老的 `.world` 图层用的），
 * 而 React Flow 已经把节点摆在 `position` 上了 ⇒ 交给它 `selfPositioned={false}`
 * 关掉那套定位。**注意不要再用"把坐标归零"的老办法**：那会让缩放手柄把节点写回
 * 世界原点（2026-10-06 第 13 批第 7 条，见 `NodeFrame.selfPositioned` 的说明）。
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
  /**
   * 缩放提交（绝对矩形 + 阶段）。**阶段必须带上**：`node.resize` 用 `begin/move/end`
   * 做事务合并，少了它拖动缩放每帧都会落一条撤销记录（老表面就是这么传的）。
   */
  resize: (rect: Rect, phase: 'begin' | 'move' | 'end') => void
  /** 当前视口缩放：`NodeFrame` 要用它把屏幕位移换算回世界单位（缩放跟手 / 矢量内容按比例放大） */
  zoom: number
  /** 容器（分组 / 批量）的子节点：沿用老表面那套 —— 由容器本体按网格渲染 */
  childNodes?: NodeSnapshot[]
  renderChild?: (child: NodeSnapshot) => ReactNode
}

function handlePosition(side: 'left' | 'right') {
  return side === 'left' ? Position.Left : Position.Right
}

function FlowNodeInner({ data, selected }: NodeProps) {
  const { node, running, error, runMode, emit, resize, zoom, childNodes, renderChild, ...derived } =
    data as unknown as FlowNodeData
  const def = getNodeDefinition(node.type)
  /**
   * 端点声明：只用来画 **React Flow 的 `Handle` 锚点**（`handleNodes`）。
   * 看得见的那颗圆点在 `FlowPortLayer` 上（见那里的说明），`NodeFrame` 不参与。
   */
  const ports = portDeclsOf(def.ports)
  /**
   * 容器（分组 / 批量）的最小尺寸**随内容走**（= 内容 + 四边等距 20px，见 `packContainer.ts`）：
   * 少了这一条，缩小手柄能一直往里拖，把子节点**压住**（用户 2026-10-06 第 13 批第 7 条：
   * 「缩小的时候会掩盖一些节点…可以规则为保持四周的边距」）。
   */
  /**
   * 缩放下限按容器类型分流（2026-10-06 第 14 批第 1 条起**两套布局**）：
   * - **分组**：子节点自由摆放 ⇒ 下限 = 它们的包围盒 + 四边等距（`groupFitSize`）；
   * - **批量**：子节点走 3×3 网格 ⇒ 下限 = 网格尺寸（`containerMinSize`）。
   */
  const minSize = node.type === 'group'
    ? groupFitSize(childNodes ?? [])
    : isContainerType(node.type)
      ? containerMinSize(node.type as 'group' | 'batch', childNodes?.length ?? 0)
      : def.sizing.min

  /**
   * 端点（React Flow 的 `Handle`）走 `NodeFrame.overlay`，**不放在 `children` 里**：
   * - 放进 `children` ⇒ 落进 `.body { overflow: clip }`，手柄伸在框外的那一半被裁 ⇒ 拉线手势起不来；
   * - 放在 NodeFrame **外面**（同级）⇒ 够得着，但不再是 `[data-node-type]` 的后代 ⇒
   *   冒烟 / 探针的 `[data-node-type] [data-port]` 找不到端点（G66 实测超时）。
   * `overlay` 同时满足：在框内、不被裁。
   */
  const handleNodes = ports.map((port) => {
    const position = handlePosition(port.side)
    /**
     * ⚠️ `pointerEvents: 'none'` 是**契约**：RF 的 Handle 只负责两件事 ——
     * ① 给 RF 算边的端点位置；② 给冒烟 / 探针留 `[data-port]` 几何锚点。
     * **手势不归它收**：RF 的节点带 transform（自己是层叠上下文），相邻节点会整块盖住它的
     * Handle，端点于是拖不动（G91 ⑦ 实测：重叠 17px 就够）。收手势的是 `FlowPortLayer`
     * ——在所有节点之上的一层，命中后交给老表面那套拖线控制器（两个引擎共用一份建边语义）。
     */
    const style = { top: `${port.y * 100}%`, pointerEvents: 'none' as const }
    if (port.kind === 'both') {
      return (
        <Fragment key={port.id}>
          {/*
            共用口（fusion 的 `patch`）只有一个锚点，但 RF 要两只 Handle 才能两个方向都收放。
            契约：**只有一只带 `data-port`**（冒烟 / 探针按它取唯一锚点），另一只只留 RF 语义。
            带锚点的那只必须是 **source 且在 DOM 里靠后**（靠后 = 盖在上面）：
            从这里按下往外拖 = 出（与老表面 `kind !== 'input'` 归成"出"同一条口径）。
          */}
          <Handle id={port.id} type="target" position={position} style={style} />
          <Handle
            id={port.id}
            type="source"
            position={position}
            style={style}
            data-port={port.id}
            data-port-kind={port.kind}
          />
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
        data-port-kind={port.kind}
      />
    )
  })

  return (
    <NodeFrame
      /*
       * ⚠️ 传**真实坐标** + `selfPositioned={false}`（2026-10-06 第 13 批第 7 条）：
       * 以前传的是 `{...node, x: 0, y: 0}`（为了不被 RF 二次偏移），结果缩放手柄算出的
       * 矩形 x/y 恒为 0 ⇒ `node.resize` 把节点写回世界原点（"缩放时会位移"）。
       */
      node={node}
      selfPositioned={false}
      selected={!!selected}
      scale={zoom}
      minSize={minSize}
      resizeLock={resizeLockOf(node)}
      /* 容器四角可缩放（用户 2026-10-06 第 13 批第 5 条）；其它类型仍是右下那一只 */
      resizeCorners={isContainerType(node.type) ? RESIZE_CORNERS : undefined}
      heightFromContent={heightFromContentOf(node)}
      /* 老画布那份端点交给 React Flow 的 Handle 画，避免两套端点叠在一起 */
      overlay={handleNodes}
      onFramePointerDown={() => {}}
      onResize={resize}
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
 * 渲染在容器内部。这与老画布那套容器渲染完全一致，因此容器的网格布局、
 * 拖出归属等语义不用重写。
 */
export function FlowChildFrame({
  child,
  selected,
  running,
  error,
  runMode,
  emit,
  resize,
  zoom,
  onFramePointerDown,
  derived,
}: {
  child: NodeSnapshot
  selected: boolean
  running: boolean
  error: string | null
  runMode: RunMode
  emit: (event: NodeViewEvent) => void
  resize: (rect: Rect, phase: 'begin' | 'move' | 'end') => void
  zoom: number
  /**
   * 子节点按下：**容器子节点不是 React Flow 的节点**（由容器 View 按网格渲染），
   * React Flow 拖不动它们，所以"拖动子节点"这条链路要自己接
   * （选中 + 用老表面那套拖动控制器，让"拖出容器"语义保持同一份实现）。
   */
  onFramePointerDown: (e: ReactPointerEvent) => void
  derived?: FlowNodeDerivedProps
}) {
  const def = getNodeDefinition(child.type)
  return (
    <NodeFrame
      /* 同 `FlowNodeInner`：真实坐标 + 不自我定位（子节点的 x/y 是**相对父容器**的） */
      node={child}
      selfPositioned={false}
      selected={selected}
      scale={zoom}
      minSize={def.sizing.min}
      resizeLock={resizeLockOf(child)}
      heightFromContent={heightFromContentOf(child)}
      onFramePointerDown={onFramePointerDown}
      onResize={resize}
      onRename={(title) => emit({ type: 'rename', title })}
    >
      <def.View
        node={child}
        size={{ w: child.w, h: child.h }}
        scale={zoom}
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
