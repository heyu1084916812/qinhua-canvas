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

/**
 * 参数**分组**：一个浮层里并排放的几段（用户 2026-10-02：「具体参数的设置
 * （多个参数集合在一起那种）」）。
 *
 * 与单组模式（`options`）二选一。分段只是**渲染形状**的差别 ——
 * 定位翻转、点外关闭、开新关旧全部沿用同一套，不为此再写第二个浮动组件。
 */
export interface ParamSection {
  /** 稳定锚点后缀：落到 `data-param-section` / `data-param-in` 上（测试用） */
  name: string
  /** 分组标题（多组模式显示；单组模式不显示） */
  label: string
  variant: 'list' | 'pill' | 'ratioGrid'
  options: ParamOption[]
  value: string
  onSelect: (value: string) => void
  /** 展开但这一段一个候选都没有时的说明 */
  emptyHint?: string
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
  /** 单组模式的候选。用 `sections` 时不必传 */
  options?: ParamOption[]
  value?: string
  /**
   * 浮层形态：
   * - `list`：竖版列表（平台 / 模型 / 尺寸 / 参考模式）
   * - `pill`：横排胶囊（画质 / 质量 / 数量）
   * - `ratioGrid`：图形化比例网格（比例专用，每格用矩形示意宽高比）
   */
  variant?: 'list' | 'pill' | 'ratioGrid'
  /**
   * 多组模式：一个浮层里几段参数（比例 / 画质 / 质量）。
   * 传了它就不看 `options` / `value` / `variant`。
   */
  sections?: ParamSection[]
  /**
   * chip 尺寸。
   *
   * `panel`（默认）= 创作面板那套 46px / 16px 大字：那几个 chip 是用户反复
   * 读写的主要信息，比正文还小会让人反复凑近看。
   * `compact` = 对话窗工具条里的 26px / 小字：它挤在 380px 面板的输入框下沿，
   * 用 46px 会把输入区顶掉半屏。
   */
  size?: 'panel' | 'compact'
  /** 是否展开。同一时刻只允许一个（§6.8「开新关旧」），唯一性由父级持有的 key 保证 */
  open: boolean
  onToggle: () => void
  onClose: () => void
  /** 单组模式的选择回调 */
  onSelect?: (value: string) => void
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
 *
 * 关闭有三条路，**只有一条住在本组件里**：
 *   ① 点击浮层外 —— 本组件的 `pointerdown` 捕获监听；
 *   ② 面板内点其他 chip —— 由父级换 key 实现「开新关旧」；
 *   ③ Esc —— **由调用方在自己的根节点上处理**，组件不管。
 *
 * ③ 为什么不放进来（2026-10-02 实测踩到）：Esc 是**面板级**的按键策略，
 * 各面板要按自己的语义决定「先关浮层还是关面板」，还要用 `preventDefault()`
 * 声明这次 Esc 被消费（否则 `NodeFollowBar` 的 window 监听会顺手清空选中，
 * 面板当场消失）。组件里挂一个 document 捕获监听会**抢在**面板之前把它关掉，
 * 面板那边的「已被消费」协议就失效了 —— 表现是「按 Esc 想收起下拉，整个面板没了」。
 */
export function ParamPicker(props: ParamPickerProps) {
  const { name, ariaLabel, label, open, onToggle, onClose, size = 'panel' } = props
  /**
   * 单组与多组在这里**归一成同一种形状**：下面只认「若干段」。
   * 单组就是「一段、且不画分组标题」—— 两处共用同一份选项渲染，
   * 不会出现「创作面板的网格与对话窗的网格长得不一样」。
   */
  const sections: ParamSection[] = props.sections ?? [
    {
      name,
      label: '',
      variant: props.variant ?? 'list',
      options: props.options ?? [],
      value: props.value ?? '',
      onSelect: props.onSelect ?? (() => {}),
      ...(props.emptyHint ? { emptyHint: props.emptyHint } : {}),
    },
  ]
  const grouped = Boolean(props.sections)
  const totalOptions = sections.reduce((n, s) => n + s.options.length, 0)
  /** 当前值对应的图标（没有就不占位），让 chip 与浮层里的那一行看起来是同一个东西 */
  const currentIcon = props.options?.find((o) => o.value === props.value)?.icon
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
  }, [open, totalOptions])

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
        className={[
          styles.chip,
          size === 'compact' ? styles.chipCompact : '',
          open ? styles.chipOpen : '',
        ]
          .filter(Boolean)
          .join(' ')}
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
            grouped ? styles.grouped : VARIANT_CLASS[sections[0]!.variant],
            below ? styles.below : styles.above,
          ].join(' ')}
          data-param-popup={name}
          data-param-variant={grouped ? 'grouped' : sections[0]!.variant}
          data-param-placement={below ? 'below' : 'above'}
          role="listbox"
          aria-label={ariaLabel}
        >
          {totalOptions === 0 ? (
            <span className={styles.empty} data-param-empty={name}>
              {sections[0]?.emptyHint ?? '没有可选项'}
            </span>
          ) : grouped ? (
            sections.map((s) => (
              <div key={s.name} className={styles.section} data-param-section={s.name}>
                <span className={styles.sectionTitle}>{s.label}</span>
                <div className={VARIANT_CLASS[s.variant]}>
                  {s.options.map((o) => (
                    <ParamOptionButton
                      key={o.value}
                      option={o}
                      variant={s.variant}
                      value={s.value}
                      inSection={s.name}
                      onPick={() => {
                        s.onSelect(o.value)
                        /**
                         * 多组模式**选完不关**：它是一个「参数集合」，用户多半一次要
                         * 调两三样，每选一格就关掉会逼他重复点开三次。单组模式保持
                         * 原行为（选完即关），创作面板的手感一点都不变。
                         */
                      }}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            sections[0]!.options.map((o) => (
              <ParamOptionButton
                key={o.value}
                option={o}
                variant={sections[0]!.variant}
                value={sections[0]!.value}
                inSection={null}
                onPick={() => {
                  sections[0]!.onSelect(o.value)
                  onClose()
                }}
              />
            ))
          )}
        </div>
      )}
    </span>
  )
}

/** 形态 → CSS module 类名。浮层与分组内的那层容器共用同一份映射 */
const VARIANT_CLASS = {
  list: styles.list,
  pill: styles.pill,
  ratioGrid: styles.ratioGrid,
} as const

/**
 * 一枚候选。单组与多组**共用这一个组件** —— 抽出来是为了让「两处长得一样」
 * 成为结构上的事实，而不是靠两边各写一遍再人工对齐。
 */
function ParamOptionButton(props: {
  option: ParamOption
  variant: ParamSection['variant']
  value: string
  /** 多组模式下这一段的锚点后缀（`data-param-in`）；单组模式传 null */
  inSection: string | null
  onPick: () => void
}) {
  const { option: o, variant, value, inSection, onPick } = props
  /** 多组模式要能区分「同样是 auto 的画质与质量」，靠这个属性把选项限定到段内 */
  const sectionAttrs = inSection ? { 'data-param-in': inSection } : {}

  if (variant === 'ratioGrid') {
    return (
      <button
        type="button"
        role="option"
        aria-selected={o.value === value}
        className={
          o.value === value ? `${styles.ratioCell} ${styles.ratioCellOn}` : styles.ratioCell
        }
        data-param-option={o.value}
        {...sectionAttrs}
        disabled={o.disabled}
        title={o.title ?? o.label}
        onClick={onPick}
      >
        {/* 空值 = 「自动」：它不是宽高比，画个矩形只会和 1:1 撞脸，故只留文字 */}
        {o.value !== '' && <RatioGlyph ratio={o.value} />}
        <span className={styles.ratioText}>{o.label}</span>
      </button>
    )
  }
  return (
    <button
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
      {...sectionAttrs}
      disabled={o.disabled}
      title={o.title ?? o.label}
      onClick={onPick}
    >
      {o.icon && <span className={styles.rowIcon}>{o.icon}</span>}
      <span className={styles.rowText}>{o.label}</span>
      {variant === 'list' && o.value === value && (
        <span className={styles.check} aria-hidden="true">
          ✓
        </span>
      )}
    </button>
  )
}

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
        data-ratio-glyph={ratio}
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
      data-ratio-glyph={ratio}
      style={{ width: `${width}px`, height: `${height}px` }}
      aria-hidden="true"
    />
  )
}
