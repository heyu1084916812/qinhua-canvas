import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { CompareData } from '../../../../domain/canvas/model/node'
import type { NodeViewProps } from '../registry'
import { useAsset } from '../../hooks/useAsset'
import styles from './CompareNodeView.module.css'

/**
 * 对比节点视图（产品文档 §6.10）。
 * 取上游前 2 张图片左右叠放，中间竖向分割线可拖动（1px + 圆形手柄）；
 * 拖动只改本地瞬时值，松手才 emit updateData（避免拖动期刷命令 / 进撤销栈）。
 * 上游不足 2 张时缺位显示空状态占位。
 */
export function CompareNodeView(props: NodeViewProps) {
  const data = props.node.data as CompareData
  const hashes = props.upstreamAssetHashes ?? []
  const leftFallback = hashes[0] ?? data.leftAssetHash
  const rightFallback = hashes[1] ?? data.rightAssetHash
  const leftUrl = useAsset(leftFallback)
  const rightUrl = useAsset(rightFallback)

  const [ratio, setRatio] = useState(data.splitRatio)
  const [dragging, setDragging] = useState(false)
  // 松手后待外部确认的值：emit 走命令层 → store → props 回灌有延迟，
  // 回灌到位前保留本地值，避免视觉回弹（陈列室 emit 为空实现时也保持稳定）。
  const pendingRef = useRef<number | null>(null)

  // 跟随外部数据：仅在「没有待确认值」或「外部已追平待确认值」时同步
  useEffect(() => {
    if (dragging) return
    const pending = pendingRef.current
    if (pending !== null && Math.abs(pending - data.splitRatio) < 1e-6) {
      pendingRef.current = null
      return
    }
    if (pending !== null) return
    setRatio(data.splitRatio)
  }, [data.splitRatio, dragging])

  const clamp = (v: number) => Math.min(0.95, Math.max(0.05, v))

  const onHandleDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      const host = e.currentTarget.parentElement
      if (!host) return
      const rect = host.getBoundingClientRect()
      if (rect.width <= 0) return
      setDragging(true)

      const handleAt = (clientX: number) => clamp((clientX - rect.left) / rect.width)

      const move = (ev: PointerEvent) => {
        setRatio(handleAt(ev.clientX))
      }
      const up = (ev: PointerEvent) => {
        const next = handleAt(ev.clientX)
        setDragging(false)
        setRatio(next)
        pendingRef.current = next
        props.emit({ type: 'updateData', patch: { splitRatio: next } })
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [props],
  )

  const bothReady = Boolean(leftUrl && rightUrl)

  return (
    <div className={styles.body} data-compare-ratio={ratio.toFixed(3)}>
      <div className={styles.stage}>
        <div className={styles.base}>
          {leftUrl ? (
            <img src={leftUrl} alt="" draggable={false} />
          ) : (
            <EmptySlot label="上游第 1 张" />
          )}
        </div>

        {rightUrl && (
          <div
            className={styles.overlay}
            style={{ clipPath: `inset(0 0 0 ${(ratio * 100).toFixed(3)}%)` }}
          >
            {rightUrl ? <img src={rightUrl} alt="" draggable={false} /> : null}
          </div>
        )}

        {bothReady && (
          <>
            <div
              className={styles.divider}
              style={{ left: `${(ratio * 100).toFixed(3)}%` }}
              aria-hidden="true"
            />
            <div
              className={styles.handle}
              data-compare-handle
              style={{ left: `${(ratio * 100).toFixed(3)}%` }}
              onPointerDown={onHandleDown}
              title="拖动对比"
              role="separator"
              aria-label="对比分割线"
            />
          </>
        )}
      </div>

      <div className={styles.labels}>
        <span className={styles.label}>A · 左</span>
        <span className={styles.label}>B · 右</span>
      </div>
    </div>
  )
}

function EmptySlot({ label }: { label: string }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyText}>{label}</span>
      <span className={styles.emptyHint}>连线上游生成节点</span>
    </div>
  )
}
