import { useEffect, useMemo, useState } from 'react'
import type {
  ContextMemory,
  ContextMemoryKind,
} from '../../domain/shared/context'
import { WORKBENCHES } from '../../domain/shared/workbench'
import {
  layoutMemoryGraph,
  MEMORY_GRAPH_HEIGHT,
  MEMORY_GRAPH_WIDTH,
} from './memoryGraphLayout'
import styles from './MemoryGraph.module.css'

const KIND_LABELS: Record<ContextMemoryKind, string> = {
  preference: '偏好',
  fact: '事实',
  constraint: '硬约束',
  decision: '已确认决定',
}

function shortText(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ')
  return normalized.length > 12 ? `${normalized.slice(0, 12)}…` : normalized
}

export function MemoryGraph({ memories }: { memories: readonly ContextMemory[] }) {
  const layout = useMemo(() => layoutMemoryGraph(memories), [memories])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = memories.find((memory) => memory.id === selectedId) ?? null

  useEffect(() => {
    if (selectedId && !memories.some((memory) => memory.id === selectedId)) {
      setSelectedId(null)
    }
  }, [memories, selectedId])

  if (memories.length === 0) {
    return (
      <div className={styles.empty}>
        保存记忆后，这里会把偏好、事实、约束和决定连成关系图。
      </div>
    )
  }

  return (
    <div className={styles.wrap} data-memory-graph>
      <div className={styles.stage}>
        <svg
          className={styles.lines}
          viewBox={`0 0 ${MEMORY_GRAPH_WIDTH} ${MEMORY_GRAPH_HEIGHT}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {layout.hubs.map((hub) => (
            <line
              key={`center-${hub.kind}`}
              className={styles.edgePrimary}
              x1={layout.center.x}
              y1={layout.center.y}
              x2={hub.x}
              y2={hub.y}
            />
          ))}
          {layout.nodes.map((node) => {
            const hub = layout.hubs.find((item) => item.kind === node.memory.kind)
            if (!hub) return null
            return (
              <line
                key={`node-${node.memory.id}`}
                className={styles.edge}
                x1={hub.x}
                y1={hub.y}
                x2={node.x}
                y2={node.y}
              />
            )
          })}
        </svg>

        <div
          className={styles.center}
          style={{
            left: `${(layout.center.x / MEMORY_GRAPH_WIDTH) * 100}%`,
            top: `${(layout.center.y / MEMORY_GRAPH_HEIGHT) * 100}%`,
          }}
        >
          <b>个人记忆</b>
          <span>{memories.filter((memory) => memory.enabled).length} 条启用</span>
        </div>

        {layout.hubs.map((hub) => (
          <div
            key={hub.kind}
            className={styles.hub}
            data-memory-graph-hub={hub.kind}
            data-memory-kind={hub.kind}
            style={{
              left: `${(hub.x / MEMORY_GRAPH_WIDTH) * 100}%`,
              top: `${(hub.y / MEMORY_GRAPH_HEIGHT) * 100}%`,
            }}
          >
            <b>{KIND_LABELS[hub.kind]}</b>
            <span>{hub.count}</span>
          </div>
        ))}

        {layout.nodes.map((node) => (
          <button
            key={node.memory.id}
            type="button"
            className={styles.node}
            data-memory-graph-node={node.memory.id}
            data-memory-kind={node.memory.kind}
            data-memory-enabled={node.memory.enabled ? 'true' : 'false'}
            aria-pressed={selectedId === node.memory.id}
            title={node.memory.text}
            style={{
              left: `${(node.x / MEMORY_GRAPH_WIDTH) * 100}%`,
              top: `${(node.y / MEMORY_GRAPH_HEIGHT) * 100}%`,
            }}
            onClick={() => setSelectedId(node.memory.id)}
          >
            {shortText(node.memory.text)}
          </button>
        ))}
      </div>

      <div className={styles.legend} aria-label="记忆类型">
        {(Object.keys(KIND_LABELS) as ContextMemoryKind[]).map((kind) => (
          <span key={kind} data-memory-kind={kind}>
            <i />
            {KIND_LABELS[kind]}
          </span>
        ))}
        {layout.hiddenCount > 0 ? (
          <span className={styles.hidden}>还有 {layout.hiddenCount} 条未绘制</span>
        ) : null}
      </div>

      {selected ? (
        <div className={styles.selection} data-memory-graph-selected={selected.id}>
          <div>
            <b>{KIND_LABELS[selected.kind]}</b>
            <span>
              {selected.workbench ? WORKBENCHES[selected.workbench].label : '全部工作台'}
              {' · '}
              修订 {selected.currentRevision}
              {!selected.enabled ? ' · 已停用' : ''}
            </span>
          </div>
          <p>{selected.text}</p>
        </div>
      ) : (
        <p className={styles.hint}>点击节点查看完整记忆。</p>
      )}
    </div>
  )
}
