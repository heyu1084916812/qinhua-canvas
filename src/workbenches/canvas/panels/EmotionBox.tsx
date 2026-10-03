import { DEFAULT_EMOTION_ID, EMOTIONS, emotionById } from '../../../domain/canvas/layout/presets'
import { IconClose } from '../toolbar/icons'
import { useAsset } from '../hooks/useAsset'
import styles from './EmotionBox.module.css'

/**
 * 情绪调节（用户 2026-10-05 第 14 条后半，参考图二十）。
 *
 * 三块：左边**角色**（就直接用本节点上游那张参考图 —— 用户手上真正要被改成这个表情的
 * 就是它，再画一个 3D 头像只会多一个和生成无关的东西）、右边 **5×5 点位**、
 * 底部一行**当前情绪定位**。
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
  onPick,
  onClose,
}: {
  emotion: string
  /** 上游第一张带素材的图（没有就显示一句提示，而不是空白） */
  characterHash?: string
  onPick: (emotionId: string) => void
  onClose: () => void
}) {
  const current = emotionById(emotion) ?? emotionById(DEFAULT_EMOTION_ID)!
  const characterUrl = useAsset(characterHash)

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
      </div>

      <div className={styles.body}>
        <div className={styles.preview}>
          {characterUrl ? (
            <img src={characterUrl} alt="" data-emotion-character />
          ) : (
            <span className={styles.previewEmpty}>把一张有人物的图连到本节点，这里会显示它</span>
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
