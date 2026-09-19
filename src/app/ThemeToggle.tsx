/**
 * 主题切换（明 / 暗）。
 *
 * **两档互切**（用户 2026-09-19 第 9 条：「只要两个主题色，去掉跟随系统」）。
 * 此前是三档轮转（含「跟随系统」），现在收敛成明 / 暗：按钮上直接写档位名 +
 * 字形，而不是只给一个图标让人猜（无障碍 §4.5：图标按钮要有可读名字）。
 *
 * 为什么住在 app/ 而不是 ui/：它要读 ThemeProvider 的 context，
 * 而 depcruise 的 `ui-stateless` 规定 ui 层只能依赖 ui 与 shared——
 * 纯令牌层不该知道「应用现在是什么主题」，那是应用状态。
 *
 * 图标用纯文本字形（与画布工具栏的对齐图标同一口径，不引图标库）。
 */
import { useTheme } from './ThemeProvider'
import { nextThemeSetting, themeSettingLabel } from '../ui/theme'
import styles from './ThemeToggle.module.css'
import type { MouseEvent as ReactMouseEvent } from 'react'

/** 两档的字形：浅 = 太阳 / 深 = 月亮 */
const GLYPH = {
  light: '☀',
  dark: '☾',
} as const

/**
 * @param compact 只留字形（画布顶栏那种一排按钮的场合）；
 *                默认带档位名，用在首页顶栏这种有余量、且需要自我说明的地方。
 */
export function ThemeToggle({
  className,
  compact,
  onMouseDown,
}: {
  className?: string
  compact?: boolean
  /**
   * 画布顶栏会传它来阻止默认聚焦：按钮点击后若滞留焦点，后续按空格会去激活按钮
   * 而没法「空格 + 拖拽平移」（§6.3）。键盘 Tab 导航不受影响。
   */
  onMouseDown?: (e: ReactMouseEvent) => void
}) {
  const { setting, setSetting } = useTheme()
  /** 两档之后「选了哪档」就等于「当前是哪套」，标题不必再区分二者 */
  const hint = `主题：${themeSettingLabel(setting)}`
  return (
    <button
      type="button"
      className={[styles.btn, compact ? styles.compact : '', className ?? ''].filter(Boolean).join(' ')}
      data-theme-toggle
      data-theme-setting={setting}
      title={`${hint}，点击切换`}
      aria-label={hint}
      onMouseDown={onMouseDown}
      onClick={() => setSetting(nextThemeSetting(setting))}
    >
      <span className={styles.glyph} aria-hidden="true">
        {GLYPH[setting]}
      </span>
      {!compact && <span className={styles.label}>{themeSettingLabel(setting)}</span>}
    </button>
  )
}
