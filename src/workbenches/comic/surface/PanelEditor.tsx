import { useState } from 'react'
import type {
  BalloonType,
  ComicCharacter,
  ComicPanel,
  ComicPanelRun,
  PanelTransition,
  ShotAngle,
  ShotFraming,
} from '../../../domain/comic/model/comicProject'
import {
  BALLOON_TYPES,
  PANEL_TRANSITIONS,
  SHOT_ANGLES,
  SHOT_FRAMINGS,
} from '../../../domain/comic/model/comicProject'
import {
  BALLOON_TYPE_LABELS,
  PANEL_RUN_STATUS_LABELS,
  PANEL_TRANSITION_LABELS,
  SHOT_ANGLE_LABELS,
  SHOT_FRAMING_LABELS,
} from '../../../domain/comic/model/labels'
import { panelCanGenerate } from '../../../domain/comic/panel/panelRun'
import { canRestorePanelRun, livePanelRun } from '../../../domain/comic/panel/panelRunRecord'
import type { ComicBalloonPatch, ComicPanelPatch } from '../../../state/workbenches/comic/reducer'
import type { PanelRunState } from '../execution/ComicExecutionProvider'
import { useAsset } from '../hooks/useAsset'
import styles from './PanelEditor.module.css'

/**
 * 格属性面板（M6-4，受控组件——只渲染 + 抛意图，不持状态、不碰 store）。
 *
 * 对应调研稿 §7 的「右：格属性面板」三段式：
 *   ① 画面描述（喂生图的 prompt，对应画布生成节点）
 *   ② 镜头语言（景别 / 机位 / 转场，**字段化**，不塞进提示词）
 *   ③ 出场角色（多选；生成时把角色描述与参考图并入请求）
 * 另加 ④ **对白层**列表：四个类型可加，每行可改类型 / 文本 / 说话人 / 删除；
 * ⑤ **生成画面**（M6-5d）：平台 / 模型 / 生成按钮；
 * ⑥ **版本历史**（M6-15）：每次生成留一条痕，可回退到任意一版。
 *
 * 对白贴纸的**直接操作**（位置 / 尺寸 / 尾巴指向）都在左侧预览里做（`BalloonLayer`），
 * 这里只管属性 —— 「属性在这里、直接操作在那里」的分工与调研稿一致。
 */
interface PanelEditorProps {
  panel: ComicPanel
  characters: ComicCharacter[]
  /** 该格在阅读顺序里的序号（1 起）；无版式时为 null */
  readingIndex: number | null
  /** 可选平台（启用的渠道），供生图配置 */
  channelOptions: readonly { id: string; name: string }[]
  /** 当前渠道的图像模型（来自渠道**已勾选**的 `models`，过滤 category === 'image'；§7.4） */
  imageModels: readonly { id: string }[]
  /** 该格的运行态（运行中 / 报错）；空闲为 undefined */
  runState: PanelRunState | undefined
  onUpdateScene: (scene: string) => void
  onUpdateShot: (shot: NonNullable<ComicPanelPatch['shot']>) => void
  onToggleCharacter: (characterId: string) => void
  onAddBalloon: (type: BalloonType) => void
  onUpdateBalloon: (balloonId: string, patch: ComicBalloonPatch) => void
  onRemoveBalloon: (balloonId: string) => void
  /** 生成配置（平台 / 模型）——命令在装配层翻译成 panel.update */
  onSetChannel: (channelId: string) => void
  onSetModel: (model: string) => void
  /** 生成这一格（画面 → 图）；运行中再次点击 = 取消 */
  onGenerate: () => void
  onCancel: () => void
  /**
   * 回退到某一版留痕（M6-15）。**回退本身也会追加一条新版本**——
   * 界面上的「当前」标记随之移动，历史行数只增不减。
   */
  onRestoreRun: (runId: string) => void
}

export function PanelEditor({
  panel,
  characters,
  readingIndex,
  channelOptions,
  imageModels,
  runState,
  onUpdateScene,
  onUpdateShot,
  onToggleCharacter,
  onAddBalloon,
  onUpdateBalloon,
  onRemoveBalloon,
  onSetChannel,
  onSetModel,
  onGenerate,
  onCancel,
  onRestoreRun,
}: PanelEditorProps) {
  const generating = runState?.kind === 'running'
  const canGenerate = panelCanGenerate(panel)
  // 按钮文案：运行中可取消；有产物 = 重生成；否则生成
  const genLabel = generating ? '取消生成' : panel.assetHash ? '重生成' : '生成'
  /** 当前生效版本（历史真相；画面真相是 panel.assetHash） */
  const live = livePanelRun(panel.runs)
  /** 点缩略图看大图：存一份 hash，浮层自己读回素材 */
  const [previewHash, setPreviewHash] = useState<string | null>(null)
  return (
    <aside className={styles.editor} data-comic-panel-editor>
      <header className={styles.head}>
        <h3 className={styles.title} data-comic-panel-editor-title>
          {readingIndex !== null ? `第 ${readingIndex} 格` : '分镜格'}
        </h3>
        <span className={styles.sub}>{panel.balloons.length} 条对白</span>
      </header>

      {/* ① 画面描述 */}
      <section className={styles.block}>
        <span className={styles.label}>画面描述</span>
        <textarea
          className={styles.textarea}
          data-comic-scene
          aria-label="画面描述"
          value={panel.scene}
          placeholder="喂生图的画面描述（对应画布生成节点）"
          onChange={(e) => onUpdateScene(e.target.value)}
        />
      </section>

      {/* ② 镜头语言 */}
      <section className={styles.block} data-comic-shot>
        <span className={styles.label}>镜头语言</span>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>景别</span>
          <select
            className={styles.select}
            data-comic-shot-framing
            aria-label="景别"
            value={panel.shot.framing}
            onChange={(e) => onUpdateShot({ framing: e.target.value as ShotFraming })}
          >
            {SHOT_FRAMINGS.map((f) => (
              <option key={f} value={f}>
                {SHOT_FRAMING_LABELS[f]}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>机位</span>
          <select
            className={styles.select}
            data-comic-shot-angle
            aria-label="机位"
            value={panel.shot.angle}
            onChange={(e) => onUpdateShot({ angle: e.target.value as ShotAngle })}
          >
            {SHOT_ANGLES.map((a) => (
              <option key={a} value={a}>
                {SHOT_ANGLE_LABELS[a]}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>转场</span>
          <select
            className={styles.select}
            data-comic-shot-transition
            aria-label="与上一格的转场"
            value={panel.shot.transition ?? ''}
            onChange={(e) =>
              onUpdateShot({
                transition: e.target.value === '' ? null : (e.target.value as PanelTransition),
              })
            }
          >
            <option value="">（无）</option>
            {PANEL_TRANSITIONS.map((t) => (
              <option key={t} value={t}>
                {PANEL_TRANSITION_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* ③ 出场角色 */}
      <section className={styles.block} data-comic-panel-characters>
        <span className={styles.label}>出场角色</span>
        {characters.length === 0 ? (
          <p className={styles.hint} data-comic-panel-characters-empty>
            还没有角色卡。在上方「角色卡」区新建后即可勾选，生成时会把外观描述与参考图并入请求。
          </p>
        ) : (
          <div className={styles.charRow}>
            {characters.map((c) => {
              const on = panel.characterIds.includes(c.id)
              return (
                <label
                  key={c.id}
                  className={on ? `${styles.charChip} ${styles.charChipOn}` : styles.charChip}
                >
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    data-comic-panel-character
                    data-comic-panel-character-id={c.id}
                    checked={on}
                    onChange={() => onToggleCharacter(c.id)}
                  />
                  <span className={styles.charName}>{c.name}</span>
                </label>
              )
            })}
          </div>
        )}
      </section>

      {/* ④ 对白层 */}
      <section className={styles.block} data-comic-balloons>
        <div className={styles.blockHead}>
          <span className={styles.label}>对白层</span>
          <div className={styles.addRow}>
            {BALLOON_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={styles.addBtn}
                data-comic-balloon-add={t}
                onClick={() => onAddBalloon(t)}
              >
                ＋{BALLOON_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        {panel.balloons.length === 0 ? (
          <p className={styles.hint} data-comic-balloons-empty>
            还没有对白。点上方类型按钮添加，贴纸会出现在左侧预览里（可拖动）。
          </p>
        ) : (
          <ul className={styles.balloonList}>
            {panel.balloons.map((b, i) => (
              <li
                key={b.id}
                className={styles.balloonRow}
                data-comic-balloon
                data-comic-balloon-id={b.id}
              >
                <div className={styles.balloonTop}>
                  <span className={styles.balloonNo}>{i + 1}</span>
                  <select
                    className={styles.select}
                    data-comic-balloon-type
                    aria-label="对白类型"
                    value={b.type}
                    onChange={(e) => onUpdateBalloon(b.id, { type: e.target.value as BalloonType })}
                  >
                    {BALLOON_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {BALLOON_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  {b.type === 'speech' || b.type === 'thought' ? (
                    <select
                      className={styles.select}
                      data-comic-balloon-speaker
                      aria-label="说话人"
                      value={b.speakerId ?? ''}
                      onChange={(e) =>
                        onUpdateBalloon(b.id, {
                          speakerId: e.target.value === '' ? null : e.target.value,
                        })
                      }
                    >
                      <option value="">（未指定说话人）</option>
                      {characters.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <span className={styles.spacer} />
                  <button
                    type="button"
                    className={styles.dangerBtn}
                    data-comic-balloon-remove
                    title="删除这条对白"
                    onClick={() => onRemoveBalloon(b.id)}
                  >
                    删除
                  </button>
                </div>
                <input
                  className={styles.input}
                  data-comic-balloon-text
                  aria-label="对白文本"
                  value={b.text}
                  placeholder="对白文本"
                  onChange={(e) => onUpdateBalloon(b.id, { text: e.target.value })}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ⑤ 生成（M6-5d）：平台 / 模型 → 生成这一格的画面（画面描述 + 镜头 + 角色 → 提示词） */}
      <section className={styles.block} data-comic-panel-generate>
        <span className={styles.label}>生成画面</span>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>平台</span>
          <select
            className={styles.select}
            data-comic-panel-channel
            aria-label="生图平台"
            value={panel.channelId ?? ''}
            disabled={generating}
            onChange={(e) => onSetChannel(e.target.value)}
          >
            <option value="">选择平台</option>
            {channelOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>模型</span>
          <select
            className={styles.select}
            data-comic-panel-model
            aria-label="生图模型"
            value={panel.model ?? ''}
            disabled={generating || !panel.channelId}
            onChange={(e) => onSetModel(e.target.value)}
          >
            {/* 同画布：没选平台时说字段名，选了平台却没勾模型才说「未选模型」 */}
            <option value="">{panel.channelId && imageModels.length === 0 ? '未选模型' : '生图模型'}</option>
            {imageModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className={generating ? `${styles.genBtn} ${styles.genBtnCancel}` : styles.genBtn}
          data-comic-panel-generate-btn
          disabled={!generating && !canGenerate}
          title={!canGenerate && !generating ? '需要先选平台与模型，并填写画面描述' : genLabel}
          onClick={() => (generating ? onCancel() : onGenerate())}
        >
          {genLabel}
        </button>

        {generating ? (
          <p className={styles.genStatus} data-comic-panel-gen-status>
            生成中…
          </p>
        ) : runState?.kind === 'error' ? (
          <p className={styles.genError} data-comic-panel-gen-error>
            {runState.message}
          </p>
        ) : !canGenerate ? (
          <p className={styles.hint} data-comic-panel-gen-hint>
            选好平台与模型、填写画面描述后即可生成。
          </p>
        ) : null}
      </section>

      {/* ⑥ 版本历史（M6-15）：每次生成留一条痕，只增不减，可回退到任意一版 */}
      <section className={styles.block} data-comic-panel-history>
        <div className={styles.blockHead}>
          <span className={styles.label}>版本历史</span>
          {panel.runs.length > 0 ? (
            <span className={styles.sub} data-comic-history-count>
              {panel.runs.length} 次生成
            </span>
          ) : null}
        </div>

        {panel.runs.length === 0 ? (
          <p className={styles.hint} data-comic-history-empty>
            还没有生成过。此后每次生成都会留下一条记录（含失败的那次），可随时回退。
          </p>
        ) : (
          <ul className={styles.runList}>
            {/* 倒序显示：最新一次在最上面（历史本身仍是正序追加） */}
            {[...panel.runs].reverse().map((r) => (
              <RunRow
                key={r.id}
                run={r}
                live={live?.id === r.id}
                onPreview={setPreviewHash}
                onRestore={onRestoreRun}
              />
            ))}
          </ul>
        )}
      </section>

      <p className={styles.footHint} data-comic-panel-hint>
        对白贴纸在左侧预览里拖动；拖右下角手柄改尺寸、拖尾巴改指向
      </p>

      {previewHash ? (
        <RunPreview hash={previewHash} onClose={() => setPreviewHash(null)} />
      ) : null}
    </aside>
  )
}

/** 一次生成的留痕：v号 + 状态徽标 + 「当前」标记 + 时间 + 缩略图 + 参考图数 */
function RunRow({
  run,
  live,
  onPreview,
  onRestore,
}: {
  run: ComicPanelRun
  live: boolean
  onPreview: (hash: string) => void
  onRestore: (runId: string) => void
}) {
  const hash = run.outputHashes[0]
  // 只有「成功且有产物」的版本可回退；「当前版本」自己不需要回退入口
  const restorable = canRestorePanelRun(run)
  const canRestore = restorable && !live
  const restoreTitle = live
    ? '这就是当前版本'
    : restorable
      ? '把画面回退到这一版'
      : '这一次没有成功产物，无法回退'
  return (
    <li
      className={live ? `${styles.runRow} ${styles.runRowLive}` : styles.runRow}
      data-comic-run
      data-comic-run-id={run.id}
      data-comic-run-version={run.version}
      data-comic-run-status={run.status}
      data-comic-run-live={live ? 'true' : 'false'}
    >
      <button
        type="button"
        className={styles.runThumbBtn}
        data-comic-run-thumb
        disabled={!hash}
        title={hash ? '查看大图' : '这一次没有产物'}
        onClick={() => (hash ? onPreview(hash) : undefined)}
      >
        <RunThumb hash={hash} />
      </button>

      <div className={styles.runMeta}>
        <div className={styles.runTop}>
          <span className={styles.runVer} data-comic-run-ver-label>
            v{run.version}
          </span>
          <span className={styles.runStatus} data-comic-run-status-label>
            {PANEL_RUN_STATUS_LABELS[run.status]}
          </span>
          {live ? (
            <span className={styles.runLiveTag} data-comic-run-live-tag>
              当前
            </span>
          ) : null}
        </div>
        <span className={styles.runLine}>{formatRunTime(run.createdAt)}</span>
        <span className={styles.runLine}>
          {run.outputHashes.length} 张
          {run.referenceHashes.length > 0 ? ` · 参考图 ×${run.referenceHashes.length}` : ''}
        </span>
      </div>

      <button
        type="button"
        className={styles.runRestore}
        data-comic-run-restore
        disabled={!canRestore}
        title={restoreTitle}
        onClick={() => onRestore(run.id)}
      >
        回退
      </button>
    </li>
  )
}

/** 留痕缩略图：**没有产物就不挂 `useAsset`**（取图成本 = 真有图的版本数） */
function RunThumb({ hash }: { hash: string | undefined }) {
  const url = useAsset(hash)
  if (!url) {
    return (
      <span className={styles.runThumbEmpty} aria-hidden>
        —
      </span>
    )
  }
  return <img className={styles.runThumb} src={url} alt="" data-comic-run-art />
}

/**
 * 大图浮层（点缩略图打开）。刻意极简：无遮罩动画、无「上一张 / 下一张」——
 * 这里只是「看清这一版」，浏览历史本身靠列表。
 */
function RunPreview({ hash, onClose }: { hash: string; onClose: () => void }) {
  const url = useAsset(hash)
  return (
    <div
      className={styles.previewScrim}
      data-comic-run-preview
      role="button"
      tabIndex={0}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') onClose()
      }}
    >
      {url ? <img className={styles.previewImg} src={url} alt="这一版的画面" /> : null}
    </div>
  )
}

/** 留痕时间：月-日 时:分（本地时区）。展示用，不参与任何判定。 */
function formatRunTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
