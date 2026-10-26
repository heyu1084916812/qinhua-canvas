import { useRef, useState } from 'react'
import { useFonts } from '../../app/providers/FontProvider'
import { useCanvasStyle } from '../../app/providers/CanvasStyleProvider'
import {
  FONT_COUNT_MAX,
  FONT_FORMATS,
  FONT_SIZE_MAX,
  fontFamiliesOf,
  type UserFont,
} from '../../domain/ui/fonts'
import { UI_SCALES, uiScaleLabel } from '../../domain/ui/appearance'
import { NODE_BODY_SIZES, NODE_TITLE_SIZES } from '../../domain/project/canvasStyle'
import styles from './FontManagerPanel.module.css'
import { SettingsRow } from './SettingsRow'

/**
 * 「外观与体验 → 字体」面板（用户 2026-10-09：「我能加入字体吗？可以的话给我加一个」）。
 *
 * ## 用户能看到什么
 *
 * - **界面字体**：系统默认 + 已导入的自定义字体；每个自定义字体**用自己的字渲染自己的名字**
 *   （预览即所见，不用去别处试）；
 * - **导入字体**：选 `.ttf / .otf / .woff / .woff2`；校验失败当场说原因（格式 / 体积 / 数量上限）；
 * - **界面字号**：紧凑 / 标准 / 舒适；**字距**：标准 / 宽松。
 *
 * ## 三条边界（界面上也写了）
 *
 * 1. 只影响**界面**，不改生成结果、不改节点内容；
 * 2. 字体存在本机、不上传；
 * 3. 删除字体时若正被选中，自动回落系统字体（不留指不到的引用）。
 */
/** 这次选文件是"新建一个字体"还是"给某个字族补粗体" */
type ImportTarget = { kind: 'new' } | { kind: 'bold'; family: string; name: string }

export function FontManagerPanel() {
  const fonts = useFonts()
  const canvas = useCanvasStyle()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [importTarget, setImportTarget] = useState<ImportTarget>({ kind: 'new' })

  const selectedId = fonts.appearance.font.kind === 'custom' ? fonts.appearance.font.fontId : null
  const atLimit = fonts.fonts.length >= FONT_COUNT_MAX
  /** 界面上按**字族**展示（常规 + 可选粗体），底层仍是一份文件一行 */
  const groups = fontFamiliesOf(fonts.fonts)

  const pick = (target: ImportTarget) => {
    setImportTarget(target)
    inputRef.current?.click()
  }

  const onFile = async (file: File | undefined) => {
    if (!file || busy) return
    const target = importTarget
    setBusy(true)
    setStatus('')
    try {
      const bytes = await file.arrayBuffer()
      const result = await fonts.addFont({
        name: file.name,
        size: file.size,
        bytes,
        /* 补粗体：同一个字族、700 槽位（见 domain/ui/fonts 的 FontWeight 说明） */
        ...(target.kind === 'bold' ? { weight: 700 as const, family: target.family } : {}),
      })
      setStatus(
        result.ok
          ? target.kind === 'bold'
            ? `已给「${target.name}」补上粗体：加粗用真字形，不再靠浏览器合成`
            : `已导入「${file.name}」并启用`
          : result.reason,
      )
    } catch {
      // 读文件失败（权限 / 文件被删）也要说一句，不能静默
      setStatus('读不到这个文件，换一个再试')
    } finally {
      setBusy(false)
      setImportTarget({ kind: 'new' })
      // 清空 input 的值，否则再选同一个文件不会触发 change
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const startRename = (font: UserFont) => {
    setRenamingId(font.id)
    setRenameValue(font.name)
  }

  const commitRename = async () => {
    if (renamingId) await fonts.renameFont(renamingId, renameValue)
    setRenamingId(null)
    setRenameValue('')
  }

  return (
    <div className={styles.panel} data-font-panel data-typography data-settings-panel>
      <section className={styles.block}>
        <div className={styles.head}>
          <h3 className={styles.title}>界面字体</h3>
          <span className={styles.count} data-font-count>
            {fonts.fonts.length} / {FONT_COUNT_MAX}
          </span>
        </div>
        {/*
          用户 2026-10-09 问：「他控制的是哪一部分的字体？是不是还有一些字体没有控制到？」
          —— 这一段就是**如实回答**：管什么、不管什么，一次写清（不是"介绍文字"）。
        */}
        <p className={styles.caption} data-font-scope>
          控制界面与节点字族；命令日志和生成图片不使用。
        </p>

        <div className={styles.list} role="radiogroup" aria-label="界面字体">
          <div
            className={selectedId === null ? `${styles.item} ${styles.itemOn}` : styles.item}
            data-font-option="system"
          >
            <button
              type="button"
              role="radio"
              aria-checked={selectedId === null}
              className={styles.chooseArea}
              onClick={() => fonts.chooseFont({ kind: 'system' })}
            >
              <span className={styles.itemName}>系统默认</span>
              <span className={styles.itemHint}>Segoe UI / 微软雅黑</span>
            </button>
          </div>

          {groups.map((group) => (
            <div
              key={group.family}
              className={
                selectedId === group.regular.id ? `${styles.item} ${styles.itemOn}` : styles.item
              }
              data-font-option={group.regular.id}
              data-font-bold-state={group.bold ? 'yes' : 'no'}
            >
              {renamingId === group.regular.id ? (
                <input
                  className={styles.renameInput}
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => void commitRename()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void commitRename()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selectedId === group.regular.id}
                  className={styles.chooseArea}
                  onClick={() => fonts.chooseFont({ kind: 'custom', fontId: group.regular.id })}
                >
                  {/* 用这个字体渲染它自己的名字：预览即所见 */}
                  <span className={styles.itemName} style={{ fontFamily: `'${group.regular.family}'` }}>
                    {group.regular.name}
                  </span>
                  <span className={styles.itemHint}>
                    {group.regular.format.toUpperCase()} ·{' '}
                    {(group.regular.size / 1024 / 1024).toFixed(1)}MB ·{' '}
                    {group.bold ? '粗体已导入' : '粗体由浏览器合成'}
                  </span>
                </button>
              )}
              <div className={styles.actions}>
                {group.bold ? (
                  <button
                    type="button"
                    className={styles.mini}
                    data-font-bold-remove={group.bold.id}
                    onClick={() => void fonts.removeFont(group.bold!.id)}
                  >
                    移除粗体
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.mini}
                    data-font-bold-add={group.regular.id}
                    disabled={busy || atLimit}
                    onClick={() =>
                      pick({ kind: 'bold', family: group.family, name: group.regular.name })
                    }
                  >
                    补粗体
                  </button>
                )}
                <button
                  type="button"
                  className={styles.mini}
                  data-font-rename={group.regular.id}
                  onClick={() => startRename(group.regular)}
                >
                  重命名
                </button>
                <button
                  type="button"
                  className={styles.mini}
                  data-font-remove={group.regular.id}
                  onClick={() => void fonts.removeFont(group.regular.id)}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className={styles.importPanel}>
          <input
            ref={inputRef}
            type="file"
            accept={FONT_FORMATS.map((f) => `.${f}`).join(',')}
            className={styles.file}
            data-font-file
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <SettingsRow
            className={styles.importRow}
            label="导入字体"
            description={
              atLimit
                ? `已达上限（${FONT_COUNT_MAX} 个），先删掉不用的再导入。`
                : (
                    <>
                      支持 {FONT_FORMATS.join(' / ')}，单文件不超过{' '}
                      {FONT_SIZE_MAX / 1024 / 1024}MB。
                      <span data-font-weight-note>
                        同字族补一份粗体文件可获得真粗体；可变字体无需补。
                      </span>
                    </>
                  )
            }
            control={
              <button
                type="button"
                className={styles.btn}
                data-font-import
                disabled={busy || atLimit}
                onClick={() => pick({ kind: 'new' })}
              >
                {busy ? '正在导入…' : '导入字体文件'}
              </button>
            }
          />
        </div>

        {status && (
          <p className={styles.status} role="status" data-font-status>
            {status}
          </p>
        )}
      </section>

      <section className={styles.block}>
        <h3 className={styles.title}>界面字号</h3>
        <p className={styles.caption}>只缩放界面文字，不改变画布。</p>
        <SettingsRow
          label="界面字号"
          control={
            <div className={styles.inlineControls}>
              <div className={styles.seg} role="radiogroup" aria-label="界面字号">
                {UI_SCALES.map((scale) => (
                  <button
                    key={scale}
                    type="button"
                    role="radio"
                    aria-checked={fonts.appearance.scale === scale}
                    className={
                      fonts.appearance.scale === scale ? `${styles.segItem} ${styles.segOn}` : styles.segItem
                    }
                    data-ui-scale={scale}
                    onClick={() => fonts.setScale(scale)}
                  >
                    {uiScaleLabel(scale)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className={styles.resetBtn}
                data-font-reset
                onClick={() => fonts.reset()}
              >
                恢复默认
              </button>
            </div>
          }
        />

        <SettingsRow
          label="字距"
          control={
            <div className={styles.seg} role="radiogroup" aria-label="字距">
              {(['normal', 'wide'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={fonts.appearance.letterSpacing === value}
                  className={
                    fonts.appearance.letterSpacing === value
                      ? `${styles.segItem} ${styles.segOn}`
                      : styles.segItem
                  }
                  data-letter-spacing={value}
                  onClick={() => fonts.setLetterSpacing(value)}
                >
                  {value === 'normal' ? '标准' : '宽松'}
                </button>
              ))}
            </div>
          }
        />
      </section>

      <section className={styles.block}>
        <h3 className={styles.title}>节点文字</h3>
        <p className={styles.caption}>随当前项目保存，只影响画布节点的标题与提示词正文。</p>
        <SettingsRow
          label="节点标题字号"
          control={
            <div className={styles.seg} role="radiogroup" aria-label="节点标题字号">
              {NODE_TITLE_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  role="radio"
                  aria-checked={canvas.style.titleSize === size}
                  className={
                    canvas.style.titleSize === size
                      ? `${styles.segItem} ${styles.segOn}`
                      : styles.segItem
                  }
                  data-node-title-size={size}
                  disabled={!canvas.projectId}
                  onClick={() => canvas.update({ titleSize: size })}
                >
                  {size}
                </button>
              ))}
            </div>
          }
        />
        <SettingsRow
          label="提示词正文字号"
          control={
            <div className={styles.seg} role="radiogroup" aria-label="提示词正文字号">
              {NODE_BODY_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  role="radio"
                  aria-checked={canvas.style.bodySize === size}
                  className={
                    canvas.style.bodySize === size
                      ? `${styles.segItem} ${styles.segOn}`
                      : styles.segItem
                  }
                  data-node-body-size={size}
                  disabled={!canvas.projectId}
                  onClick={() => canvas.update({ bodySize: size })}
                >
                  {size}
                </button>
              ))}
            </div>
          }
        />
        {!canvas.projectId ? <p className={styles.hint}>打开项目后可调整。</p> : null}
      </section>
    </div>
  )
}
