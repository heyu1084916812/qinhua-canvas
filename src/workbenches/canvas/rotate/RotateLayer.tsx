import { useEffect, useState, useSyncExternalStore } from 'react'
import { useCanvasStore, useGraph } from '../storeContext'
import { useAssetMeta } from '../hooks/useAsset'
import { toWorldRectInGraph } from '../../../domain/canvas/geometry/coords'
import { assetNodeSize } from '../../../domain/canvas/layout/assetNodeSize'
import { fingerprintBytes } from '../../../domain/shared/hash'
import {
  IconCheck,
  IconClose,
  IconMirrorH,
  IconMirrorV,
  IconRedo,
  IconUndo,
} from '../toolbar/icons'
import styles from './RotateLayer.module.css'

/**
 * 「旋转与镜像」编辑（用户 2026-10-05 第 10 条）：
 * 「点击后右边复制一个新的节点并且连接，上方出现功能栏有三部分，分别是关闭旋转与镜像、
 *  角度的改变多少度，以及旋转 左右镜像和上下镜像，最右边还有一个保存按钮」。
 *
 * 前两段（复制新节点 + 连线）在 `NodeFollowBar` 的「旋转」按钮里做；
 * 本层只负责**工具条 + 预览 + 保存**：
 * - 工具条三部分按用户顺序排：`✕ 旋转与镜像` / `角度（步长）+ 左转右转` / `左右镜像·上下镜像` / `保存`；
 * - 预览是**实时**的（`transform` 直接挂在图上），用户不用等保存才知道转成什么样；
 * - 保存：把变换**真画进像素**（canvas），落成新素材并写回这个复制节点的
 *   `assetHash` / `naturalSize` / 尺寸 —— 一步撤销。
 *
 * 角度按「步长 × 次」来，不做无级拖动：用户的原话是「角度的**改变多少度**」，
 * 而且 90° 这类整数角在像素上没有插值糊边的问题。
 */
export function RotateLayer() {
  const store = useCanvasStore()
  const graph = useGraph()
  const rotate = useSyncExternalStore(store.subscribe, store.getRotate, store.getRotate)
  const node = rotate ? graph.nodes.find((n) => n.id === rotate.nodeId) : undefined
  const hash = (node?.data as { assetHash?: string } | undefined)?.assetHash
  const meta = useAssetMeta(hash)

  const [angle, setAngle] = useState(0)
  const [step, setStep] = useState(90)
  const [mirrorH, setMirrorH] = useState(false)
  const [mirrorV, setMirrorV] = useState(false)
  const [saving, setSaving] = useState(false)

  /** 每次打开都从「没转过」开始：上一次的角度留着会让用户看到一张莫名其妙已经转过的图 */
  const editingId = rotate?.nodeId ?? ''
  useEffect(() => {
    if (!editingId) return
    setAngle(0)
    setMirrorH(false)
    setMirrorV(false)
    setSaving(false)
  }, [editingId])

  /** Esc 退出（与其它浮层一致） */
  useEffect(() => {
    if (!rotate) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      store.closeRotateEditor()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [rotate, store])

  if (!rotate || !node || !hash) return null

  const normalized = ((angle % 360) + 360) % 360
  const transform = `rotate(${angle}deg) scaleX(${mirrorH ? -1 : 1}) scaleY(${mirrorV ? -1 : 1})`

  const save = async () => {
    if (!meta.url || saving) return
    setSaving(true)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('load'))
        el.src = meta.url!
      })
      const rad = (angle * Math.PI) / 180
      const cos = Math.abs(Math.cos(rad))
      const sin = Math.abs(Math.sin(rad))
      const w = Math.max(1, Math.round(img.naturalWidth * cos + img.naturalHeight * sin))
      const h = Math.max(1, Math.round(img.naturalWidth * sin + img.naturalHeight * cos))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const g2 = canvas.getContext('2d')
      if (!g2) return
      g2.translate(w / 2, h / 2)
      g2.rotate(rad)
      g2.scale(mirrorH ? -1 : 1, mirrorV ? -1 : 1)
      g2.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) return
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const newHash = await fingerprintBytes(bytes)

      /** 字节与哈希都算完了才开事务（plan 之间不得 await） */
      const size = assetNodeSize({ width: w, height: h })
      const rect = toWorldRectInGraph(node, graph)
      store.beginPlan(`rotate-save:${node.id}`, '保存旋转结果')
      store.dispatch({
        kind: 'asset.put',
        asset: {
          hash: newHash,
          mime: 'image/png',
          bytes,
          width: w,
          height: h,
          createdAt: Date.now(),
          projectId: graph.projectId,
        },
      })
      store.dispatch({
        kind: 'node.updateData',
        id: node.id,
        patch: { assetHash: newHash, naturalSize: { width: w, height: h }, thumbOrder: [newHash] },
      })
      /** 节点框跟着新比例走（居中缩放，别让图从框里跳出去） */
      store.dispatch({
        kind: 'node.resize',
        id: node.id,
        rect: {
          x: rect.x + (rect.w - size.w) / 2,
          y: rect.y + (rect.h - size.h) / 2,
          w: size.w,
          h: size.h,
        },
        phase: 'end',
      })
      store.endPlan()
      await store.flush()
      store.closeRotateEditor()
      store.showUndoBar('已保存旋转结果')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.layer} data-rotate-layer>
      <div className={styles.toolbar} data-rotate-toolbar>
        <button
          type="button"
          className={styles.close}
          data-rotate-close
          title="关闭旋转与镜像"
          aria-label="关闭旋转与镜像"
          onClick={() => store.closeRotateEditor()}
        >
          <IconClose size={16} />
          <span className={styles.closeLabel}>旋转与镜像</span>
        </button>
        <span className={styles.divider} />
        {/* 角度：步长 + 左转 / 右转 —— 用户要的「角度的改变多少度」 */}
        <button
          type="button"
          className={styles.tool}
          data-rotate-left
          title={`逆时针转 ${step}°`}
          aria-label="逆时针转"
          onClick={() => setAngle((a) => a - step)}
        >
          <IconUndo size={16} />
        </button>
        <span className={styles.angle} data-rotate-angle>
          {normalized}°
        </span>
        <button
          type="button"
          className={styles.tool}
          data-rotate-right
          title={`顺时针转 ${step}°`}
          aria-label="顺时针转"
          onClick={() => setAngle((a) => a + step)}
        >
          <IconRedo size={16} />
        </button>
        <label className={styles.stepWrap}>
          <span className={styles.stepLabel}>步长</span>
          <input
            className={styles.step}
            data-rotate-step
            type="number"
            min={1}
            max={180}
            step={1}
            value={step}
            onChange={(e) => {
              const n = Number(e.target.value)
              if (Number.isFinite(n) && n >= 1 && n <= 180) setStep(Math.round(n))
            }}
          />
          <span className={styles.stepLabel}>°</span>
        </label>
        <span className={styles.divider} />
        <button
          type="button"
          className={mirrorH ? `${styles.tool} ${styles.toolOn}` : styles.tool}
          data-rotate-mirror-h
          aria-pressed={mirrorH}
          title="左右镜像"
          onClick={() => setMirrorH((v) => !v)}
        >
          <IconMirrorH size={16} />
        </button>
        <button
          type="button"
          className={mirrorV ? `${styles.tool} ${styles.toolOn}` : styles.tool}
          data-rotate-mirror-v
          aria-pressed={mirrorV}
          title="上下镜像"
          onClick={() => setMirrorV((v) => !v)}
        >
          <IconMirrorV size={16} />
        </button>
        <span className={styles.divider} />
        <button
          type="button"
          className={styles.save}
          data-rotate-save
          disabled={saving}
          onClick={() => void save()}
        >
          <IconCheck size={16} />
          <span>保存</span>
        </button>
      </div>

      <div className={styles.stage}>
        <img
          className={styles.image}
          data-rotate-image
          src={meta.url ?? ''}
          alt=""
          style={{ transform }}
        />
      </div>
    </div>
  )
}
