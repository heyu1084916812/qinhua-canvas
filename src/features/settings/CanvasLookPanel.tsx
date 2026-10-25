import { useEffect, useState } from 'react'
import { useCanvasStyle } from '../../app/providers/CanvasStyleProvider'
import { useTheme } from '../../app/ThemeProvider'
import {
  CANVAS_BACKGROUNDS,
  CANVAS_TONES,
  NODE_BODY_SIZES,
  NODE_DENSITIES,
  NODE_TITLE_SIZES,
  canvasBackgroundLabel,
  canvasToneLabel,
  nodeDensityLabel,
  normalizeHexColor,
} from '../../domain/project/canvasStyle'
import styles from './CanvasLookPanel.module.css'

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
  const fallbackColor = setting === 'dark' ? '#161616' : '#ecf5f9'
  const [pickerColor, setPickerColor] = useState(current.customColor ?? fallbackColor)
  const [hexDraft, setHexDraft] = useState((current.customColor ?? fallbackColor).slice(1).toUpperCase())
  const [hexInvalid, setHexInvalid] = useState(false)

  useEffect(() => {
    const next = current.customColor ?? fallbackColor
    setPickerColor(next)
    setHexDraft(next.slice(1).toUpperCase())
    setHexInvalid(false)
  }, [current.customColor, fallbackColor])

  const normalizedDraft = normalizeHexColor(`#${hexDraft}`)
  const applyHex = () => {
    if (!normalizedDraft) {
      setHexInvalid(true)
      return
    }
    setHexInvalid(false)
    setPickerColor(normalizedDraft)
    setHexDraft(normalizedDraft.slice(1).toUpperCase())
    update({ customColor: normalizedDraft })
  }

  return (
    <div className={styles.panel} data-canvas-look-panel>
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

        <div className={styles.row}>
          <span className={styles.rowLabel}>背景样式</span>
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
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>背景色调</span>
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
        </div>

        <div className={styles.customColorRow}>
          <div className={styles.customColorMeta}>
            <span className={styles.rowLabel}>自定义颜色</span>
            <span className={styles.customColorHint}>使用取色器，或填写 HEX 色值</span>
          </div>
          <div className={styles.customColorControls}>
            <label
              className={
                current.customColor
                  ? `${styles.colorWell} ${styles.colorWellOn}`
                  : styles.colorWell
              }
              title="打开取色器"
            >
              <span
                className={styles.colorWellFill}
                style={{ background: current.customColor ?? pickerColor }}
              />
              <input
                type="color"
                className={styles.colorPicker}
                value={pickerColor}
                aria-label="自定义画布背景颜色"
                data-canvas-custom-color
                disabled={disabled}
                onChange={(e) => {
                  const color = e.target.value.toLowerCase()
                  setPickerColor(color)
                  setHexDraft(color.slice(1).toUpperCase())
                  setHexInvalid(false)
                  update({ customColor: color })
                }}
              />
            </label>
            <div
              className={
                hexInvalid ? `${styles.hexField} ${styles.hexFieldInvalid}` : styles.hexField
              }
            >
              <span className={styles.hexHash}>#</span>
              <input
                className={styles.hexInput}
                value={hexDraft}
                maxLength={6}
                spellCheck={false}
                autoComplete="off"
                aria-label="画布背景 HEX 色值"
                aria-invalid={hexInvalid}
                data-canvas-hex-input
                disabled={disabled}
                onChange={(e) => {
                  setHexDraft(
                    e.target.value
                      .replace(/[^0-9a-f]/gi, '')
                      .slice(0, 6)
                      .toUpperCase(),
                  )
                  setHexInvalid(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyHex()
                  if (e.key === 'Escape') {
                    setHexDraft((current.customColor ?? pickerColor).slice(1).toUpperCase())
                    setHexInvalid(false)
                  }
                }}
              />
            </div>
            <button
              type="button"
              className={styles.colorApply}
              disabled={disabled || !normalizedDraft}
              data-canvas-hex-apply
              onClick={applyHex}
            >
              应用
            </button>
          </div>
          <span
            className={hexInvalid ? styles.colorError : styles.colorStatus}
            role={hexInvalid ? 'alert' : undefined}
            aria-live="polite"
          >
            {hexInvalid
              ? '请输入 3 位或 6 位十六进制色值'
              : current.customColor
                ? `正在使用 #${current.customColor.slice(1).toUpperCase()}`
                : '当前使用预设色调'}
          </span>
        </div>
      </section>

      <section className={styles.block}>
        <h3 className={styles.title}>节点内容显示</h3>
        <p className={styles.caption}>只影响节点显示，不改变生成结果。</p>

        <div className={styles.row}>
          <span className={styles.rowLabel}>节点标题字号</span>
          <div className={styles.segments} role="radiogroup" aria-label="节点标题字号">
            {NODE_TITLE_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                role="radio"
                aria-checked={current.titleSize === size}
                className={current.titleSize === size ? `${styles.seg} ${styles.segOn}` : styles.seg}
                data-node-title-size={size}
                disabled={disabled}
                onClick={() => update({ titleSize: size })}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>提示词正文字号</span>
          <div className={styles.segments} role="radiogroup" aria-label="提示词正文字号">
            {NODE_BODY_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                role="radio"
                aria-checked={current.bodySize === size}
                className={current.bodySize === size ? `${styles.seg} ${styles.segOn}` : styles.seg}
                data-node-body-size={size}
                disabled={disabled}
                onClick={() => update({ bodySize: size })}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.row}>
          <span className={styles.rowLabel}>新节点默认尺寸</span>
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
        </div>
      </section>

      {disabled ? (
        <p className={styles.hint} data-canvas-look-hint>
          打开项目后可调整。
        </p>
      ) : null}
    </div>
  )
}
