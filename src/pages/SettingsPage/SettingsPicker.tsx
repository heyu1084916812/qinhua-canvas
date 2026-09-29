import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import styles from './SettingsPicker.module.css'

/**
 * 设置页专用的「chip + 浮层菜单」（用户 2026-09-29 第 13 轮）。
 *
 * 起因是两条批注：选路策略的下拉、模型映射的下拉「跟没设计过一样」，
 * 要求做成**生图节点参数（ParamPicker）那一套 UI**。
 *
 * 为什么不直接复用 `workbenches/canvas/panels/ParamPicker`：
 * 它 import 了画布布局常量（`RATIO_FOLLOW_SOURCE`），属于画布工作区的内部件；
 * 设置页反向依赖画布布局，等于把两个界面的生命周期绑在一起 —— 画布改比例档位
 * 会牵动后台设置页。这里按同一套**视觉口径**另写一份设置本地实现：
 *
 *  - chip 触发器：透明底、46px 高、`--bg-hover` 表示 hover / 展开；
 *  - 浮层：`--bg-surface` + 1px `--stroke` + `--radius-control`、**无投影**；
 *  - 菜单行 44px、选中行 `--bg-hover`、行尾勾选标记；
 *  - 点击浮层外 / Esc 关闭；同一时刻只会有一个菜单（新开一个时旧的自然被关掉）。
 */

export interface PickerOption {
  value: string
  label: string
  /** 行下方的补充说明（选路策略用来放「高的先跑」这类口径） */
  hint?: string
}

/** SSR 下 `useLayoutEffect` 会告警，退回 `useEffect`（同样是空操作） */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * 浮层定位与关闭的共同逻辑。
 *
 * 定位沿用 ParamPicker 的口径：装在 chip **正下方**，下方空间不足且上方更宽裕时
 * 翻到上方。设置页的表单在中部，绝大多数时候是向下展开。
 */
function usePickerMenu(open: boolean) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [above, setAbove] = useState(false)
  /** 由调用方在渲染前写入关闭函数，避免依赖顺序问题 */
  const setOpenRef = useRef<(() => void) | null>(null)

  useIsoLayoutEffect(() => {
    if (!open) {
      setAbove(false)
      return
    }
    const wrap = wrapRef.current
    const pop = popRef.current
    if (!wrap || !pop) return
    const anchor = wrap.getBoundingClientRect()
    const height = pop.getBoundingClientRect().height
    const roomBelow = window.innerHeight - anchor.bottom
    const roomAbove = anchor.top
    setAbove(roomBelow < height + 12 && roomAbove > roomBelow)
  }, [open])

  /**
   * 点击浮层外关闭。挂在 **document 捕获阶段**：设置页外层也有自己的
   * 事件处理（如拖拽排序），冒泡阶段可能收不到。
   */
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpenRef.current?.()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenRef.current?.()
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return { wrapRef, popRef, above, closeRef: setOpenRef }
}

/** V 形 chevron：展开时由 CSS 旋转 180° */
function Chevron({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3.5 5.25 7 8.75l3.5-3.5" />
    </svg>
  )
}

export interface StrategyPickerProps {
  value: string
  options: PickerOption[]
  onChange: (value: string) => void
}

/**
 * 选路策略选择器（chip + 浮层）。
 *
 * chip 上同时显示当前档位的名字与口径说明 —— 策略是**全局**的，
 * 页面上没有别处再复述它；只写「性能优先」四个字时，用户还得展开才知道
 * 它是按实测延迟排的。
 */
export function StrategyPicker({ value, options, onChange }: StrategyPickerProps) {
  const [open, setOpen] = useState(false)
  const { wrapRef, popRef, above, closeRef } = usePickerMenu(open)
  closeRef.current = () => setOpen(false)
  const current = options.find((o) => o.value === value) ?? options[0]

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={open ? `${styles.chip} ${styles.chipOpen}` : styles.chip}
        data-route-strategy
        data-route-strategy-value={value}
        aria-label="选路策略"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.chipLabel}>{current?.label ?? ''}</span>
        {current?.hint && <span className={styles.chipHint}>{current.hint}</span>}
        <Chevron className={open ? `${styles.chevron} ${styles.chevronOpen}` : styles.chevron} />
      </button>
      {open && (
        <div
          ref={popRef}
          className={[styles.popup, above ? styles.above : styles.below].join(' ')}
          data-route-strategy-menu
          role="listbox"
          aria-label="选路策略"
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={o.value === value ? `${styles.row} ${styles.rowOn}` : styles.row}
              data-route-strategy-option={o.value}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              <span className={styles.rowMain}>
                <span className={styles.rowLabel}>{o.label}</span>
                {o.hint && <span className={styles.rowHint}>{o.hint}</span>}
              </span>
              {o.value === value && (
                <span className={styles.check} aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export interface ModelMapComboProps {
  /** 映射行的逻辑名，落到 `data-route-map-input` / `data-route-map-toggle` */
  rowId: string
  /** 候选所属类别（`image | chat | video`），落到菜单与选项锚点 */
  category: string
  value: string
  options: readonly string[]
  placeholder?: string
  emptyHint?: string
  ariaLabel: string
  onChange: (value: string) => void
}

/**
 * 模型映射的「可手填 + 可下拉」输入框。
 *
 * 与画布参数 chip 的差别只有一处：这里是**自由文本**（本站模型 ID 未必在候选里），
 * 所以主体是输入框，右侧挂一个下拉开关；候选来自该渠道已勾选 / 已拉取的同类模型。
 */
export function ModelMapCombo({
  rowId,
  category,
  value,
  options,
  placeholder,
  emptyHint,
  ariaLabel,
  onChange,
}: ModelMapComboProps) {
  const [open, setOpen] = useState(false)
  const { wrapRef, popRef, above, closeRef } = usePickerMenu(open)
  closeRef.current = () => setOpen(false)

  return (
    <div className={open ? `${styles.combo} ${styles.comboOpen}` : styles.combo} ref={wrapRef}>
      <input
        className={styles.comboInput}
        data-route-map-input={rowId}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className={styles.comboToggle}
        data-route-map-toggle={rowId}
        aria-label={`${ariaLabel}候选`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Chevron className={open ? `${styles.chevron} ${styles.chevronOpen}` : styles.chevron} />
      </button>
      {open && (
        <div
          ref={popRef}
          className={[styles.popup, styles.comboMenu, above ? styles.above : styles.below].join(' ')}
          data-route-map-menu={category}
          role="listbox"
          aria-label={`${ariaLabel}候选`}
        >
          {options.length === 0 ? (
            <span className={styles.empty}>{emptyHint ?? '没有可选项'}</span>
          ) : (
            options.map((o) => (
              <button
                key={o}
                type="button"
                role="option"
                aria-selected={o === value}
                className={o === value ? `${styles.row} ${styles.rowOn}` : styles.row}
                data-route-map-option={category}
                data-value={o}
                onClick={() => {
                  onChange(o)
                  setOpen(false)
                }}
              >
                <span className={styles.rowMain}>
                  <span className={styles.rowLabel}>{o}</span>
                </span>
                {o === value && (
                  <span className={styles.check} aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
