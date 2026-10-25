import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { CompareData } from '../../../../domain/canvas/model/node'
import type { NodeViewProps } from '../registry'
import { useAssetThumbUrl } from '../../hooks/useAsset'
import { assetBoxCorrection } from '../../../../domain/canvas/layout/assetBoxCorrection'
import styles from './CompareNodeView.module.css'

export function CompareNodeView(props: NodeViewProps) {
  const data = props.node.data as CompareData
  const hashes = props.upstreamAssetHashes ?? []
  const leftFallback = hashes[0] ?? data.leftAssetHash
  const rightFallback = hashes[1] ?? data.rightAssetHash
  const leftUrl = useAssetThumbUrl(leftFallback)
  const rightUrl = useAssetThumbUrl(rightFallback)

  const [ratio, setRatio] = useState(data.splitRatio)
  const [dragging, setDragging] = useState(false)
  const pendingRef = useRef<number | null>(null)

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

  const reportNatural = (width: number, height: number) => {
    if (!width || !height) return
    const fix = assetBoxCorrection({ w: props.node.w, h: props.node.h }, { width, height })
    if (!fix) return
    props.emit({
      type: 'updateData',
      patch: { naturalSize: fix.naturalSize },
      ...(fix.size ? { size: fix.size } : {}),
      transient: true,
    })
  }

  const openLightbox = () => {
    if (leftFallback) {
      props.emit({
        type: 'openLightbox',
        assetHash: leftFallback,
        ...(rightFallback
          ? { compareWith: rightFallback, compareKind: 'pair' as const }
          : {}),
      })
      return
    }
    if (rightFallback) props.emit({ type: 'openLightbox', assetHash: rightFallback })
  }

  return (
    <div
      className={styles.body}
      data-compare-ratio={ratio.toFixed(3)}
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
            <div style={{ width: '100%', height: '100%' }} />
          )}
        </div>
        {rightUrl && (
          <div
            className={styles.overlay}
            style={{ clipPath: `inset(0 0 0 ${(ratio * 100).toFixed(3)}%)` }}
          >
            <img src={rightUrl} alt="" draggable={false} />
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
              className={`${styles.handle} nodrag`}
              data-compare-handle
              style={{ left: `${(ratio * 100).toFixed(3)}%` }}
              onPointerDown={onHandleDown}
              role="separator"
              aria-label="对比分割线"
            />
          </>
        )}
      </div>
    </div>
  )
}
