import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { DEFAULT_EMOTION_ID, EMOTIONS, emotionById } from '../../../domain/canvas/layout/presets'
import { IconClose } from '../toolbar/icons'
import { useAsset } from '../hooks/useAsset'
import styles from './EmotionBox.module.css'

/**
 * 情绪调节（用户 2026-10-05 第 14 条后半，参考图二十）。
 *
 * 三块：左边**这次要改的那张图**（本节点自己的素材 —— 再画一个 3D 头像只会多一个
 * 和生成无关的东西）、右边 **5×5 点位**、底部一行**当前情绪定位**。
 *
 * 25 个名字与顺序在 `domain/canvas/layout/presets.ts` 的 `EMOTIONS` 里，
 * 五个一排（顺序本身就是语义：上激动下平静、左亲近右疏离）。这里不抄第二份名字。
 *
 * **关闭 = 清掉这次的情绪**：面板开与不开由「有没有选情绪」这一个事实决定，
 * 不另存一个 `open` 状态 —— 两个状态迟早会出现「关掉了但表情还在提示词里」。
 */
export function EmotionBox({
  emotion,
  characterHash,
  faceBox,
  onPick,
  onReframe,
  onClose,
  header,
}: {
  emotion: string
  /**
   * **本节点自己的那张图**（= 这次真正要改的对象）。
   *
   * 没有就显示一句引导文案，而不是拿上游的图顶上：预览必须承诺生成真会做的事。
   */
  characterHash?: string
  /**
   * 已经认出来的那张脸在哪（归一化 0–1，`GenerationData.faceBox`）。
   *
   * 画在预览图上，让用户**一眼看到「系统认的是这张脸」**——识别这件事原本是隐形的，
   * 认错了也只能等生成出来才发现。没有值时就不画框（不猜一个位置）。
   */
  faceBox?: { x: number; y: number; w: number; h: number }
  onPick: (emotionId: string) => void
  /**
   * 自己框「要改的那张脸」（开框选灯箱）。
   *
   * 常驻而不是只在失败时出现：自动识别会认错人 —— 合影里最大的那张脸
   * 未必是用户想改的那张，认错了也得有地方改。
   */
  onReframe: () => void
  onClose: () => void
  /**
   * 头排右侧那两枚参数（比例 / 数量）。
   *
   * 由创作面板传进来，而不是在这里再造一个：那两个值属于节点参数的**同一份状态**
   * （`data.ratio` / `data.count`），这里只是把它们的入口也摆到这一排
   * —— 参考产品图二十的头部就是「比例 · 数量 · 生成」。
   */
  header?: ReactNode
}) {
  const current = emotionById(emotion) ?? emotionById(DEFAULT_EMOTION_ID)!
  const characterUrl = useAsset(characterHash)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  /**
   * 图片**真正画在哪**（相对预览容器的像素矩形）。
   *
   * 图是 `object-fit: contain`：宽高比与容器不一致时四周会留空，
   * 按容器百分比摆人脸框就会整体偏。这里量出实际显示区域，框按它算。
   */
  const [fit, setFit] = useState<{ dx: number; dy: number; dw: number; dh: number } | null>(null)

  const measureFit = useCallback(() => {
    const stage = previewRef.current
    const img = imgRef.current
    if (!stage || !img || !img.naturalWidth || !img.naturalHeight) return
    const cw = stage.clientWidth
    const ch = stage.clientHeight
    if (!cw || !ch) return
    const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight)
    const dw = img.naturalWidth * scale
    const dh = img.naturalHeight * scale
    setFit({ dx: (cw - dw) / 2, dy: (ch - dh) / 2, dw, dh })
  }, [])

  /** 容器尺寸会随面板伸缩变（`ResizeObserver` 而不是只量一次） */
  useEffect(() => {
    const stage = previewRef.current
    if (!stage || !characterUrl) {
      setFit(null)
      return
    }
    measureFit()
    const ro = new ResizeObserver(measureFit)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [characterUrl, measureFit])

  return (
    <div className={styles.box} data-panel-emotion>
      <div className={styles.head}>
        <button
          type="button"
          className={styles.close}
          data-emotion-close
          title="关闭情绪调节（同时清掉这次选的情绪）"
          aria-label="关闭情绪调节"
          onClick={onClose}
        >
          <IconClose size={14} />
        </button>
        <span className={styles.title}>情绪调节</span>
        {header && <span className={styles.headTools}>{header}</span>}
      </div>

      <div className={styles.body}>
        <div className={styles.preview} ref={previewRef}>
          {characterUrl ? (
            <img
              ref={imgRef}
              src={characterUrl}
              alt=""
              data-emotion-character
              onLoad={measureFit}
            />
          ) : (
            <span className={styles.previewEmpty}>先让这个节点出一张有人的图，这里会显示它</span>
          )}
          {faceBox && fit && (
            <span
              className={styles.faceBox}
              data-emotion-facebox
              style={{
                left: fit.dx + faceBox.x * fit.dw,
                top: fit.dy + faceBox.y * fit.dh,
                width: faceBox.w * fit.dw,
                height: faceBox.h * fit.dh,
              }}
            />
          )}
          {characterUrl && (
            <button
              type="button"
              className={styles.reframe}
              data-emotion-reframe
              title="自己在图上框出要改的那张脸"
              onClick={onReframe}
            >
              手动框脸
            </button>
          )}
        </div>

        <div className={styles.gridWrap}>
          <span className={`${styles.axis} ${styles.axisTop}`}>激动</span>
          <span className={`${styles.axis} ${styles.axisBottom}`}>平静</span>
          <span className={`${styles.axis} ${styles.axisLeft}`}>亲近</span>
          <span className={`${styles.axis} ${styles.axisRight}`}>疏离</span>
          <div className={styles.grid} data-emotion-grid>
            {EMOTIONS.map((e) => (
              <button
                key={e.id}
                type="button"
                className={e.id === current.id ? `${styles.dot} ${styles.dotOn}` : styles.dot}
                style={{ gridRow: e.row + 1, gridColumn: e.col + 1 }}
                data-emotion={e.id}
                aria-label={e.name}
                aria-pressed={e.id === current.id}
                title={e.name}
                onClick={() => onPick(e.id)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className={styles.foot}>
        <span className={styles.footLabel}>情绪定位</span>
        <span className={styles.footValue} data-emotion-current>
          {current.name}
        </span>
      </div>
    </div>
  )
}
