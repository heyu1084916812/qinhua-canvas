import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { CompareData } from '../../../../domain/canvas/model/node'
import type { NodeViewProps } from '../registry'
import { useAssetThumbUrl } from '../../hooks/useAsset'
import { assetBoxCorrection } from '../../../../domain/canvas/layout/assetBoxCorrection'
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
  // 对比区是**节点尺寸**的小图 ⇒ 走缩略图那条路（对账 #231）：拿 4K 原图解码给这么小的框看不划算
  const leftUrl = useAssetThumbUrl(leftFallback)
  const rightUrl = useAssetThumbUrl(rightFallback)

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

  /**
   * 媒体**真实像素到手之后**把节点框纠正成素材比例（同 `GenerationNodeView.reportNatural`）。
   *
   * 用户 2026-10-16：「对比节点的比例需要自适应，不要固定」。对比节点原先是个
   * `lockAspect` 的固定 4:3 框（240×180），而素材常常是 3072×5504 那种竖长条 ——
   * 竖图落进方框里两侧全是空的（截图就是这样）。
   *
   * 为什么在**显示这一层**补：图片的真实像素只有解码后才知道，这里正是那个时刻；
   * 决策交给纯函数 `assetBoxCorrection`（它已经处理过「用户手动调过就不碰」这一档）。
   */
  const reportNatural = (width: number, height: number) => {
    if (!width || !height) return
    const fix = assetBoxCorrection({ w: props.node.w, h: props.node.h }, { width, height })
    if (!fix) return
    props.emit({
      type: 'updateData',
      patch: { naturalSize: fix.naturalSize },
      ...(fix.size ? { size: fix.size } : {}),
      /** 后台纠错不是用户操作：不进撤销栈，但仍照常落库 */
      transient: true,
    })
  }

  /**
   * 双击进灯箱对比（用户 2026-10-16：「双击能灯箱进行对比」）。
   *
   * 灯箱本来就有一档「对比」（融合结果跟原图对着看，见 `LightboxLayer`），
   * 这里把 **A 当结果、B 当「对比原图」** 喂给它 —— 对比节点的两张图来自两个不同的
   * 上游节点，节点上没有 `compareWith` 可读，所以必须显式传。
   */
  const openLightbox = () => {
    if (leftFallback) {
      props.emit({
        type: 'openLightbox',
        assetHash: leftFallback,
        ...(rightFallback ? { compareWith: rightFallback } : {}),
      })
      return
    }
    if (rightFallback) props.emit({ type: 'openLightbox', assetHash: rightFallback })
  }

  return (
    <div
      className={styles.body}
      data-compare-ratio={ratio.toFixed(3)}
      title="对比顺序：先连接的图在左 A，后连接的图在右 B；拖动中间竖线查看小差异"
      onDoubleClick={openLightbox}
    >
      <div className={styles.stage}>
        <div className={styles.base}>
          {leftUrl ? (
            <img
              src={leftUrl}
              alt=""
              draggable={false}
              onLoad={(e) => reportNatural(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
            />
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
              /**
               * ⚠️ **`nodrag` 不能少**（用户 2026-10-16：「拖动滑块没有跟随鼠标」）。
               *
               * React Flow 的拖动监听挂在节点元素上、是**原生**的，而 React 的
               * `stopPropagation()` 只在根容器那一次合成派发里生效 —— 原生监听早就跑过了。
               * 于是拖手柄会**同时把整个节点拖走**：分割线相对节点没动，看起来就是「不跟手」。
               * `nodrag` 是 React Flow 的免拖动类名（`NodeFrame` 的缩放手柄用的同一条办法）。
               */
              className={`${styles.handle} nodrag`}
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
        <span className={styles.label} data-compare-label="left">
          A · 左 · 先连接
        </span>
        <span className={styles.label} data-compare-label="right">
          B · 右 · 后连接
        </span>
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
