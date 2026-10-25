import { useFonts } from '../../app/providers/FontProvider'
import { useTheme } from '../../app/ThemeProvider'
import { ACCENT_PALETTES, accentTokens } from '../../domain/ui/appearance'
import styles from './InterfacePanel.module.css'

/**
 * 「外观与体验 → 主题与动效」面板（对账 #379 剩余项）。
 *
 * 这一块全是**本机偏好**（与下面那块"画布"相反 —— 那个随项目走）：
 * 换一台机器要重设，不进项目文件、也不影响出图。
 *
 * 三件事：
 * - **配色**：浅色 / 深色（与侧栏底部那个切换是**同一份状态**，两处都能改）；
 * - **强调色**：八档色板，运行时覆盖 `--accent` / `--accent-text` 两个令牌
 *   （色值是 JS 常量数据，CSS 里只出现 `var()` —— 见 domain/ui/appearance 的说明）；
 * - **减少动效 / 显示小地图**：两个开关。
 */
export function InterfacePanel() {
  const { appearance, setAccent, setMotion, setShowMinimap } = useFonts()
  const { setting, setSetting } = useTheme()

  return (
    <div
      className={styles.panel}
      data-interface-panel
      data-settings-panel
      data-theme-panel
    >
      <section className={styles.block}>
        <h3 className={styles.title}>主题</h3>
        <p className={styles.caption}>本机偏好，与侧栏切换同步。</p>

        <div className={styles.row}>
          <span className={styles.rowLabel}>配色</span>
          <div className={styles.segments} role="radiogroup" aria-label="配色">
            {(['light', 'dark'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={setting === mode}
                className={setting === mode ? `${styles.seg} ${styles.segOn}` : styles.seg}
                data-theme-choice={mode}
                onClick={() => setSetting(mode)}
              >
                {mode === 'light' ? '浅色' : '深色'}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>强调色</span>
          <div className={styles.swatches} role="radiogroup" aria-label="强调色">
            {ACCENT_PALETTES.map((palette) => {
              const tokens = accentTokens(palette.id, setting)
              const on = appearance.accent === palette.id
              const pairLabel = `${palette.label} · 浅色 ${palette.light.accent} / 深色 ${palette.dark.accent}`
              return (
                <button
                  key={palette.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={pairLabel}
                  title={pairLabel}
                  className={on ? `${styles.swatch} ${styles.swatchOn}` : styles.swatch}
                  data-accent={palette.id}
                  /* 色值来自 JS 常量：CSS 里写不了（主题守卫会拦字面量颜色），
                     而且这里展示的就该是**当前主题下**那一套值 —— 所见即所得。 */
                  style={{ background: tokens.accent, color: tokens.text }}
                  onClick={() => setAccent(palette.id)}
                >
                  {on ? '✓' : ''}
                </button>
              )
            })}
          </div>
        </div>
        <p className={styles.caption}>浅色与深色主题分别使用对应色值，切换主题自动更新。</p>
      </section>

      <section className={styles.block}>
        <h3 className={styles.title}>动效与显示</h3>
        <p className={styles.caption}>减少动效仅关闭过渡动画。</p>

        <label className={styles.switchRow}>
          <span className={styles.rowLabel}>减少动效</span>
          <span className={styles.switchBox}>
            <input
              type="checkbox"
              className={styles.switchInput}
              checked={appearance.motion === 'reduced'}
              data-motion-toggle
              onChange={(e) => setMotion(e.target.checked ? 'reduced' : 'full')}
            />
            <span className={styles.track} aria-hidden="true" />
          </span>
        </label>

        <label className={styles.switchRow}>
          <span className={styles.rowLabel}>显示小地图</span>
          <span className={styles.switchBox}>
            <input
              type="checkbox"
              className={styles.switchInput}
              checked={appearance.showMinimap}
              data-minimap-toggle
              onChange={(e) => setShowMinimap(e.target.checked)}
            />
            <span className={styles.track} aria-hidden="true" />
          </span>
        </label>
      </section>
    </div>
  )
}
