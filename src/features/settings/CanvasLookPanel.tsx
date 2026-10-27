import { useCanvasStyle } from '../../app/providers/CanvasStyleProvider'
import { useTheme } from '../../app/ThemeProvider'
import {
  CANVAS_BACKGROUNDS,
  CANVAS_TONES,
  NODE_DENSITIES,
  canvasBackgroundLabel,
  canvasToneLabel,
  nodeDensityLabel,
} from '../../domain/project/canvasStyle'
import { ColorPickerPopover } from '../shared/colorPicker/ColorPickerPopover'
import styles from './CanvasLookPanel.module.css'
import { SettingsRow } from './SettingsRow'

interface ColorControlProps {
  scope: 'canvas' | 'node'
  separated?: boolean
  label: string
  hint: string
  value: string | null
  fallback: string
  disabled: boolean
  onChange: (color: string) => void
  onReset: () => void
}

function ColorControl({
  scope,
  separated = false,
  label,
  hint,
  value,
  fallback,
  disabled,
  onChange,
  onReset,
}: ColorControlProps) {
  const current = value ?? fallback

  return (
    <div className={separated ? styles.customColorRowSeparated : styles.customColorRow}>
      <SettingsRow
        className={styles.colorHeading}
        label={label}
        description={hint}
        control={
          value ? (
            <button
              type="button"
              className={styles.colorReset}
              data-canvas-color-reset={scope === 'canvas' ? true : undefined}
              data-node-color-reset={scope === 'node' ? true : undefined}
              disabled={disabled}
              onClick={onReset}
            >
              恢复主题默认
            </button>
          ) : null
        }
      />
      <div className={styles.customColorControls}>
        <ColorPickerPopover
          value={current}
          disabled={disabled}
          target={scope}
          label={scope === 'canvas' ? '自定义画布背景颜色' : '自定义节点背景颜色'}
          onCommit={onChange}
          renderTrigger={({ open, toggle }) => (
            <button
              type="button"
              className={
                value
                  ? `${styles.colorWell} ${styles.colorWellOn}`
                  : styles.colorWell
              }
              aria-label={scope === 'canvas' ? '自定义画布背景颜色' : '自定义节点背景颜色'}
              aria-haspopup="dialog"
              aria-expanded={open}
              title="打开取色器"
              disabled={disabled}
              data-canvas-custom-color={scope === 'canvas' ? true : undefined}
              data-node-custom-color={scope === 'node' ? true : undefined}
              onClick={toggle}
            >
              <span
                className={styles.colorWellFill}
                style={{ background: current }}
                aria-hidden
              />
            </button>
          )}
        />
        <span className={styles.colorValue}>
          {value ? `#${value.slice(1).toUpperCase()}` : '跟随主题'}
        </span>
      </div>
      <span className={styles.colorStatus} aria-live="polite">
        {value ? `正在使用 #${value.slice(1).toUpperCase()}` : '当前跟随主题默认'}
      </span>
    </div>
  )
}

/**
 * 「外观与体验 → 画布」面板（对账 #379 的 C4 / C5）。
 *
 * ## 与上面那块「界面字体」的分工（产品文档 §4.1 三条红线）
 *
 * - 界面字体 / 界面字号 / 字距 = **本机偏好**：换机器要重设，不进项目；
 * - 画布底色 / 色调 / 节点标题与正文字号 / 新节点默认尺寸 = **项目偏好**：
 *   存在 `projects.extra.canvasStyle`，随项目导出与导入。
 *
 * 这块面板故意把「随项目走」写在标题下的小字里 —— 用户改完换台机器打不开同一个观感时，
 * 第一反应会是"设置丢了"，先说明白能省一次困惑。
 *
 * ## 没打开项目时
 *
 * 设置浮层在项目页也能开，那时没有"当前项目"可改 —— 面板如实说"打开一个项目后可调"，
 * 控件置灰。**不糊一个上一次的项目上去**（那会让用户在 A 项目里改到 B 项目的观感）。
 */
export function CanvasLookPanel() {
  const { projectId, style: current, update, reset } = useCanvasStyle()
  const { setting } = useTheme()
  const disabled = !projectId
  const fallbackCanvasColor = setting === 'dark' ? '#161616' : '#ecf5f9'
  const fallbackNodeColor = setting === 'dark' ? '#222222' : '#ffffff'

  return (
    <div className={styles.panel} data-canvas-look-panel data-settings-panel>
      <section className={styles.block}>
        <div className={styles.head}>
          <h3 className={styles.title}>画布</h3>
          <button
            type="button"
            className={styles.reset}
            onClick={reset}
            disabled={disabled}
            data-canvas-look-reset
          >
            恢复默认
          </button>
        </div>
        <p className={styles.caption}>随项目保存，只影响画布背景。</p>

        <SettingsRow
          label="背景样式"
          control={
            <div className={styles.segments} role="radiogroup" aria-label="画布背景样式">
              {CANVAS_BACKGROUNDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={current.background === kind}
                  className={current.background === kind ? `${styles.seg} ${styles.segOn}` : styles.seg}
                  data-canvas-background={kind}
                  disabled={disabled}
                  onClick={() => update({ background: kind })}
                >
                  {canvasBackgroundLabel(kind)}
                </button>
              ))}
            </div>
          }
        />

        <SettingsRow
          label="背景色调"
          control={
            <div className={styles.swatches} role="radiogroup" aria-label="画布背景色调">
              {CANVAS_TONES.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  role="radio"
                  aria-checked={!current.customColor && current.tone === tone}
                  aria-label={canvasToneLabel(tone)}
                  title={canvasToneLabel(tone)}
                  className={
                    !current.customColor && current.tone === tone
                      ? `${styles.swatch} ${styles.swatchOn}`
                      : styles.swatch
                  }
                  data-canvas-tone={tone}
                  disabled={disabled}
                  onClick={() => update({ tone, customColor: null })}
                />
              ))}
            </div>
          }
        />

        <ColorControl
          scope="canvas"
          separated
          label="自定义颜色"
          hint="使用取色器，或填写 HEX 色值"
          value={current.customColor}
          fallback={fallbackCanvasColor}
          disabled={disabled}
          onChange={(customColor) => update({ customColor })}
          onReset={() => update({ customColor: null })}
        />
      </section>

      <section className={styles.block}>
        <h3 className={styles.title}>节点外观</h3>
        <p className={styles.caption}>只影响节点显示，不改变生成结果；底色同时作用于外框与内容井。</p>

        <ColorControl
          scope="node"
          label="节点底色"
          hint="统一控制所有节点，留空跟随浅色 / 深色主题"
          value={current.nodeColor}
          fallback={fallbackNodeColor}
          disabled={disabled}
          onChange={(nodeColor) => update({ nodeColor })}
          onReset={() => update({ nodeColor: null })}
        />

        <SettingsRow
          label="新节点默认尺寸"
          description="只影响之后新建的节点。"
          control={
            <div className={styles.segments} role="radiogroup" aria-label="新节点默认尺寸">
              {NODE_DENSITIES.map((density) => (
                <button
                  key={density}
                  type="button"
                  role="radio"
                  aria-checked={current.density === density}
                  className={
                    current.density === density ? `${styles.seg} ${styles.segOn}` : styles.seg
                  }
                  data-node-density={density}
                  disabled={disabled}
                  onClick={() => update({ density })}
                >
                  {nodeDensityLabel(density)}
                </button>
              ))}
            </div>
          }
        />
      </section>

      {disabled ? (
        <p className={styles.hint} data-canvas-look-hint>
          打开项目后可调整。
        </p>
      ) : null}
    </div>
  )
}
