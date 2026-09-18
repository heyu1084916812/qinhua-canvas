/**
 * 主题切换（明 / 暗 / 跟随系统）。
 *
 * 三档**轮转**而不是「明 / 暗」二选一：默认「跟随系统」才是大多数人的真实意图
 * （系统切了它就跟着切），做个只能二选一的开关等于逼用户放弃这一档。
 * 但一轮转就必须把「当前是哪一档」说清楚——按钮上直接写档位名，
 * 而不是只给一个 ☾ 图标让人猜（无障碍 §4.5：图标按钮要有可读名字）。
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

/** 三档的字形：浅 = 太阳 / 深 = 月亮 / 跟随系统 = 半明半暗 */
const GLYPH = {
  light: '☀',
  dark: '☾',
  system: '◐',
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
  const { setting, system, resolved, setSetting } = useTheme()
  /**
   * 标题要说明**当前生效的是哪一套**，而不只是「你选了哪一档」：
   * 选了「跟随系统」的人点开一看是深色，需要知道那是系统给的还是自己选的。
   */
  const hint =
    setting === 'system'
      ? `主题：跟随系统（当前${system === 'dark' ? '深色' : '浅色'}）`
      : `主题：${themeSettingLabel(setting)}`
  return (
    <button
      type="button"
      className={[styles.btn, compact ? styles.compact : '', className ?? ''].filter(Boolean).join(' ')}
      data-theme-toggle
      data-theme-setting={setting}
      title={`${hint}，点击切换`}
      aria-label={hint}
      onMouseDown={onMouseDown}
      onClick={() => setSetting(nextThemeSetting(setting, resolved))}
    >
      <span className={styles.glyph} aria-hidden="true">
        {GLYPH[setting]}
      </span>
      {!compact && <span className={styles.label}>{themeSettingLabel(setting)}</span>}
    </button>
  )
}
