import { useRef, useEffect, useState, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCanvasStore, useGraph, useViewportState } from '../storeContext'
import { useAsset } from '../hooks/useAsset'
import { indexNodes } from '../../../domain/canvas/model/graph'
import { toWorldRect } from '../../../domain/canvas/geometry/coords'
import styles from './VersionHistoryPanel.module.css'

/**
 * 版本临时预览层（§6.21「临时预览语义」）：
 * 选中版本的图以 30% 透明度叠加在节点当前显示之上，可拖动对比；
 * 预览期间不修改任何状态，点击预览（未拖动）或按 Esc 退出。
 * 放在 [data-world] 之外：用屏幕坐标锚定节点，缩放平移时随视口换算保持贴合。
 */
export function VersionPreviewLayer() {
  const store = useCanvasStore()
  const graph = useGraph()
  const viewport = useViewportState()
  const preview = useSyncExternalStore(
    store.subscribe,
    store.getVersionPreview,
    store.getVersionPreview,
  )
  const url = useAsset(preview?.assetHash ?? undefined)
  const [drag, setDrag] = useState({ x: 0, y: 0 })
  const dragStartRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null)
  const movedRef = useRef(false)

  // Esc 退出（§6.21）
  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      store.setVersionPreview(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store, preview])

  // 预览切换目标时重置拖动偏移
  useEffect(() => {
    setDrag({ x: 0, y: 0 })
  }, [preview?.recordId])

  if (!preview) return null

  const index = indexNodes(graph.nodes)
  const node = index.get(preview.nodeId)
  if (!node) return null
  const parent = node.parentId ? index.get(node.parentId) ?? null : null
  const rect = toWorldRect(node, parent)
  const left = (rect.x - viewport.x) * viewport.zoom + drag.x
  const top = (rect.y - viewport.y) * viewport.zoom + drag.y
  const width = rect.w * viewport.zoom
  const height = rect.h * viewport.zoom

  const onPointerDown = (e: ReactPointerEvent) => {
    e.stopPropagation()
    movedRef.current = false
    dragStartRef.current = { px: e.clientX, py: e.clientY, x: drag.x, y: drag.y }
    const move = (ev: PointerEvent) => {
      const start = dragStartRef.current
      if (!start) return
      if (Math.abs(ev.clientX - start.px) + Math.abs(ev.clientY - start.py) > 3) movedRef.current = true
      setDrag({ x: start.x + (ev.clientX - start.px), y: start.y + (ev.clientY - start.py) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <img
      className={styles.previewImg}
      data-version-preview
      src={url ?? undefined}
      alt="版本预览"
      draggable={false}
      style={{ left, top, width, height }}
      onPointerDown={onPointerDown}
      onClick={(e) => {
        e.stopPropagation()
        // 拖动松手也会触发 click：只有未拖动的单击才退出（§6.21「再次点击退出」）
        if (movedRef.current) return
        store.setVersionPreview(null)
      }}
    />
  )
}
