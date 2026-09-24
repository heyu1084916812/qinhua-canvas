import { useEffect, useRef, useState } from 'react'
import { skillGuard, type Skill } from '../../../domain/prompt/skill'
import styles from './SkillPicker.module.css'

/**
 * 技能选择器（用户 2026-09-24）。
 *
 * 形态与 `ParamPicker` 一致（胶囊 + 上拉浮层），因为它和面板上的平台 / 模型
 * 是同类控件：**选一个值，然后执行**。换个样子会让人以为它是另一类东西。
 *
 * 几处刻意的行为：
 *  - **点开才加载列表**：技能可能上百条，每次渲染都算一遍没必要；
 *  - 每个技能显示**它自己能不能跑**（缺图 / 缺文本时置灰并说明），
 *    而不是统一置灰 —— 用户要的是「哪个能用」，不是「都不能用」；
 *  - 空库时不是给一个空浮层，而是直接说明「去后台添加」。
 */
export function SkillPicker({
  skills,
  running,
  text,
  imageCount,
  onRun,
  onOpenLibrary,
}: {
  skills: Skill[]
  running: boolean
  text: string
  imageCount: number
  onRun: (skill: Skill) => void
  /** 打开技能库（缺技能时的出口；不传则该入口不显示） */
  onOpenLibrary?: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)

  /** 点外部 / Esc 关闭（与数字控件的浮层同一套做法） */
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span className={styles.wrap} ref={rootRef}>
      <button
        type="button"
        className={styles.chip}
        data-panel-skill-chip
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={running}
        title={skills.length > 0 ? '用自己写的技能处理这段文本' : '还没有技能：去「后台设置 → 技能」添加'}
        onClick={() => setOpen((v) => !v)}
      >
        技能
        {skills.length > 0 && <span className={styles.count}>{skills.length}</span>}
      </button>

      {open && (
        <div className={styles.popup} data-panel-skill-popup role="listbox">
          <div className={styles.head}>技能</div>
          {skills.length === 0 ? (
            <div className={styles.empty}>
              {/*
                空库不是死路：给一个真的能点的出口。
                只写「去后台设置添加」而不给按钮，用户得自己找路（本项目吃过这个亏）。
              */}
              还没有技能。
              {onOpenLibrary && (
                <>
                  <br />
                  <button
                    type="button"
                    className={styles.emptyBtn}
                    data-panel-skill-open
                    onClick={() => {
                      setOpen(false)
                      onOpenLibrary()
                    }}
                  >
                    去技能库新建 →
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className={styles.list}>
              {skills.map((s) => {
                const blocked = skillGuard(s, { text, imageCount })
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    className={styles.item}
                    data-panel-skill-item={s.id}
                    disabled={!!blocked}
                    /* 悬停时把「为什么不能点」说出来，而不是让人猜 */
                    title={blocked ?? (s.description || s.name)}
                    onClick={() => {
                      onRun(s)
                      setOpen(false)
                    }}
                  >
                    <span className={styles.itemName}>{s.name}</span>
                    {s.description && <span className={styles.itemDesc}>{s.description}</span>}
                    {blocked && <span className={styles.itemBlocked}>{blocked}</span>}
                  </button>
                )
              })}
              {onOpenLibrary && (
                <button
                  type="button"
                  className={styles.moreBtn}
                  data-panel-skill-open
                  onClick={() => {
                    setOpen(false)
                    onOpenLibrary()
                  }}
                >
                  管理技能库 →
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </span>
  )
}
