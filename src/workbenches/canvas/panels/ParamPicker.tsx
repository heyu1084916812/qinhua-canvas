import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import styles from './ParamPicker.module.css'
import { RATIO_FOLLOW_SOURCE } from '../../../domain/canvas/layout/constants'

/** 参数选项：`value` 落到节点数据，`label` 只用于展示 */
export interface ParamOption {
  value: string
  label: string
  /**
   * 选项前的矢量图标（用户 2026-09-27：固定模型清单要「图标 + 名称」）。
   *
   * 由调用方传 ReactNode 而不是图标名：本组件不认识任何厂商，
   * 也不该为了画一个图标去 import 模型目录。
   */
  icon?: ReactNode
  /** 模型明确不支持的档位（如数量超过 `maxCount`）；**未声明**不算不支持 */
  disabled?: boolean
  /** 置灰原因，鼠标悬停可见 */
  title?: string
}

export interface ParamPickerProps {
  /**
   * 稳定标识，落到 `data-param-chip` / `data-param-popup` / `data-param-option` 上。
   *
   * 用 ASCII 短名（`channel` / `model` / `ratio` / …）而不是中文：它是**测试与冒烟的
   * 锚点**，不该随展示文案改动而漂移。这是本项目的一条通则——节点本体早就因为把
   * 参数搬进面板而丢掉了可点锚点，面板里再拿 CSS module 哈希类名定位就等于没锚点。
   */
  name: string
  /** 无障碍名（中文，如「生图平台」） */
  ariaLabel: string
  /** chip 文案：已设置 = 当前值；未设置 = 字段名占位（§6.8「占位文案」） */
  label: string
  options: ParamOption[]
  value: string
  /**
   * 浮层形态：
   * - `list`：竖版列表（平台 / 模型 / 尺寸 / 参考模式）
   * - `pill`：横排胶囊（画质 / 质量 / 数量）
   * - `ratioGrid`：图形化比例网格（比例专用，每格用矩形示意宽高比）
   */
  variant: 'list' | 'pill' | 'ratioGrid'
  /** 是否展开。同一时刻只允许一个（§6.8「开新关旧」），唯一性由父级持有的 key 保证 */
  open: boolean
  onToggle: () => void
  onClose: () => void
  onSelect: (value: string) => void
  disabled?: boolean
  /** 展开但一个候选都没有时的说明（如「该渠道还没勾选模型」） */
  emptyHint?: string
}

/**
 * `useLayoutEffect` 在 SSR 下不执行且会告警；服务端退回 `useEffect`（同样是空操作），
 * 客户端仍是「绘制前测量」，翻转定位不会闪一帧。
 */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * 参数选择面板（产品文档 §3.3 / §6.8）。
 *
 * 取代了此前的原生 `<select>`——原生下拉的展开层由浏览器绘制，**在画布里既不受
 * 无投影 / 1px 描边这套浮层规范约束，也无法被测试与冒烟断言**；而且原生 `<select>`
 * 的选项列表在部分环境里点不开或点不中，用户看到的就是「有些参数动不了、点不动」。
 *
 * 定位：浮在 chip **正上方**；上方空间不够且下方更宽裕时翻转到下方。
 * 关闭：Esc / 点击浮层外 / 面板内点其他 chip（由父级换 key 实现「开新关旧」）。
 */
export function ParamPicker(props: ParamPickerProps) {
  const { name, ariaLabel, label, options, value, variant, open, onToggle, onClose, onSelect } = props
  /** 当前值对应的图标（没有就不占位），让 chip 与浮层里的那一行看起来是同一个东西 */
  const currentIcon = options.find((o) => o.value === value)?.icon
  const wrapRef = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const [below, setBelow] = useState(false)

  // 绘制前测量：上方装不下且下方更宽裕 → 翻转到下方（§6.8）
  useIsoLayoutEffect(() => {
    if (!open) {
      setBelow(false)
      return
    }
    const wrap = wrapRef.current
    const pop = popRef.current
    if (!wrap || !pop) return
    const anchor = wrap.getBoundingClientRect()
    const height = pop.getBoundingClientRect().height
    const roomAbove = anchor.top
    const roomBelow = window.innerHeight - anchor.bottom
    setBelow(roomAbove < height + 12 && roomBelow > roomAbove)
  }, [open, options.length])

  /**
   * 点击浮层外关闭。
   *
   * 挂在 **document 捕获阶段**：创作面板根节点会 `stopPropagation()`（避免点面板
   * 误触画布取消选中），冒泡阶段的 document 监听根本收不到面板内部的点击——
   * 那样「点面板里别处」就关不掉浮层了。
   */
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open, onClose])

  return (
    <span className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        className={open ? `${styles.chip} ${styles.chipOpen}` : styles.chip}
        data-param-chip={name}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={props.disabled}
        onClick={onToggle}
      >
        {currentIcon}
        <span className={styles.chipLabel}>{label}</span>
      </button>
      {open && (
        <div
          ref={popRef}
          className={[
            styles.popup,
            variant === 'list' ? styles.list : variant === 'pill' ? styles.pill : styles.ratioGrid,
            below ? styles.below : styles.above,
          ].join(' ')}
          data-param-popup={name}
          data-param-variant={variant}
          data-param-placement={below ? 'below' : 'above'}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.length === 0 ? (
            <span className={styles.empty} data-param-empty={name}>
              {props.emptyHint ?? '没有可选项'}
            </span>
          ) : (
            options.map((o) =>
              variant === 'ratioGrid' ? (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={
                    o.value === value
                      ? `${styles.ratioCell} ${styles.ratioCellOn}`
                      : styles.ratioCell
                  }
                  data-param-option={o.value}
                  disabled={o.disabled}
                  title={o.title ?? o.label}
                  onClick={() => {
                    onSelect(o.value)
                    onClose()
                  }}
                >
                  <RatioGlyph ratio={o.value} />
                  <span className={styles.ratioText}>{o.label}</span>
                </button>
              ) : (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={o.value === value}
                  className={
                    variant === 'list'
                      ? o.value === value
                        ? `${styles.row} ${styles.rowOn}`
                        : styles.row
                      : o.value === value
                        ? `${styles.cap} ${styles.capOn}`
                        : styles.cap
                  }
                  data-param-option={o.value}
                  disabled={o.disabled}
                  title={o.title ?? o.label}
                  onClick={() => {
                    onSelect(o.value)
                    onClose()
                  }}
                >
                  {o.icon && <span className={styles.rowIcon}>{o.icon}</span>}
                  <span className={styles.rowText}>{o.label}</span>
                  {variant === 'list' && o.value === value && (
                    <span className={styles.check} aria-hidden="true">
                      ✓
                    </span>
                  )}
                </button>
              ),
            )
          )}
        </div>
      )}
    </span>
  )
}

/** V 形 chevron（矢量，放大不糊）；展开时由 CSS 旋转 180° */

/**
 * 比例示意图标（§6.8「比例用图形化网格」）。
 *
 * 每格画一个与 `w:h` 同比例的小矩形，长边固定 18px。解析不出比例时退回方块——
 * 不猜一个假比例出来，宁可画成 1:1。
 */
function RatioGlyph({ ratio }: { ratio: string }) {
  /**
   * 「跟随素材」不是宽高比，画矩形示意只会变成一个和 1:1 撞脸的方块
   * （用户 2026-09-24：这一档放全局后，网格里必须一眼认得出它）。
   * 换成「叠两张纸」的线性图形：表示「照搬上游那张图的比例」。
   */
  if (ratio === RATIO_FOLLOW_SOURCE) {
    return (
      <svg
        className={styles.ratioGlyph}
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {/* 后一张（虚线框）+ 前一张（实线框），表达「跟随后面那张的比例」 */}
        <rect x="6" y="2.5" width="9.5" height="9.5" rx="2" strokeDasharray="2.4 2.2" />
        <rect x="2.5" y="6" width="9.5" height="9.5" rx="2" />
      </svg>
    )
  }
  const [rawW, rawH] = ratio.split(':').map((s) => Number.parseFloat(s))
  const ok = Number.isFinite(rawW) && Number.isFinite(rawH) && rawW > 0 && rawH > 0
  const w = ok ? rawW : 1
  const h = ok ? rawH : 1
  const long = 18
  const width = w >= h ? long : Math.round((w / h) * long)
  const height = h >= w ? long : Math.round((h / w) * long)
  return (
    <span
      className={styles.ratioGlyph}
      style={{ width: `${width}px`, height: `${height}px` }}
      aria-hidden="true"
    />
  )
}
