import type {
  ComicPage,
  CutDirection,
  ReadingDirection,
} from '../../../domain/comic/model/comicProject'
import { layoutRects } from '../../../domain/comic/layout/layoutEdit'
import { readingOrderOf } from '../../../domain/comic/layout/readingOrder'
import { BalloonLayer } from './BalloonLayer'
import { useAsset } from '../hooks/useAsset'
import styles from './PageLayoutEditor.module.css'

/**
 * 页版式编辑器（M6-3，受控组件——只渲染 + 抛意图，不持状态、不碰 store）。
 *
 * 形态（调研稿 §7 的「中：页编辑区」最小可见版）：
 *   - 页比例固定 2:3，预览按 `layoutRects` 绝对定位渲染每格（0..1 相对坐标 → 百分比）；
 *   - 每格左上角**淡色序号印章**，序号来自 `readingOrderOf(page, direction)` ——
 *     即**切换阅读方向时只有序号变、格子位置不变**（几何与顺序解耦，见 layoutEdit 文件头）；
 *   - 点格选中（黑色边框）；工具条对选中格「横切 / 竖切 / 删格」。
 *   - **M6-4**：每格叠一层对白贴纸（`BalloonLayer`）；选中格可拖贴纸，其余格只读展示。
 *   - **M6-14**：选中格的贴纸再带**尺寸手柄**（右下角）与**可拖尾巴**——三条直接操作
 *     （位置 / 尺寸 / 尾巴指向）都在这一层里，`PageLayoutEditor` 只负责往上抛意图。
 *
 * **未兑现（如实记账）**：拖动切割线、切割位置微调（`position` 三档）、`skew` 微倾、
 * 单格转自由形状的逃生舱 —— 本组只做「按钮式切割」的最小可见版，
 * 先把「切割树 → 可见版式 + 序号」这条链路跑通，交互细节留后续。
 *
 * **M6-6 加 `mode`**：`'edit'`（默认，原行为）/ `'read'`（翻页预览用——隐藏工具条与
 * 序号印章、格不可点选、贴纸不可拖）。两种模式共用同一套几何与渲染，
 * 保证「预览里看到的」与「编辑器里看到的」是同一个东西；差异只在交互层。
 */
export type PageLayoutMode = 'edit' | 'read'

interface PageLayoutEditorProps {
  page: ComicPage
  direction: ReadingDirection
  /** `'edit'`（默认）显示工具条与序号印章；`'read'` 只读渲染（翻页预览） */
  mode?: PageLayoutMode
  /** 当前选中的格 id（不在本页版式里时按「未选中」处理） */
  selectedPanelId: string | null
  onSelectPanel: (panelId: string) => void
  onInstantiate: () => void
  onSplit: (panelId: string, direction: CutDirection) => void
  onRemoveLeaf: (panelId: string) => void
  onMoveBalloon: (panelId: string, balloonId: string, x: number, y: number) => void
  onResizeBalloon: (panelId: string, balloonId: string, w: number, h: number) => void
  onMoveBalloonTail: (panelId: string, balloonId: string, x: number, y: number) => void
  onReset: () => void
}

export function PageLayoutEditor({
  page,
  direction,
  mode = 'edit',
  selectedPanelId,
  onSelectPanel,
  onInstantiate,
  onSplit,
  onRemoveLeaf,
  onMoveBalloon,
  onResizeBalloon,
  onMoveBalloonTail,
  onReset,
}: PageLayoutEditorProps) {
  const readOnly = mode === 'read'
  const rects = layoutRects(page.layout)
  const hasLayout = rects.length > 0

  // 阅读顺序 → 序号（1 起）
  const orderIndex = new Map<string, number>()
  readingOrderOf(page, direction).forEach((id, i) => orderIndex.set(id, i + 1))

  const panelById = new Map(page.panels.map((p) => [p.id, p]))
  const hasSelection = selectedPanelId !== null && orderIndex.has(selectedPanelId)

  return (
    <div
      className={styles.editor}
      data-comic-layout-editor
      data-comic-layout-mode={mode}
      data-comic-layout-read={readOnly ? '' : undefined}
    >
      {readOnly ? null : (
        <div className={styles.toolbar}>
          {!hasLayout ? (
            <button
              type="button"
              className={styles.primaryBtn}
              data-comic-instantiate
              onClick={onInstantiate}
            >
              排版（满页单格）
            </button>
          ) : (
            <>
              <span className={styles.toolHint} data-comic-layout-hint>
                {hasSelection ? `已选第 ${orderIndex.get(selectedPanelId!) ?? '?'} 格` : '点选一个分镜格'}
              </span>
              <button
                type="button"
                className={styles.toolBtn}
                data-comic-split-h
                disabled={!hasSelection}
                title="把选中格上下切两半"
                onClick={() => selectedPanelId && onSplit(selectedPanelId, 'h')}
              >
                横切
              </button>
              <button
                type="button"
                className={styles.toolBtn}
                data-comic-split-v
                disabled={!hasSelection}
                title="把选中格左右切两半"
                onClick={() => selectedPanelId && onSplit(selectedPanelId, 'v')}
              >
                竖切
              </button>
              <button
                type="button"
                className={styles.toolBtn}
                data-comic-remove-panel
                disabled={!hasSelection}
                title="从版式移除该格（内容保留，可重新排版）"
                onClick={() => selectedPanelId && onRemoveLeaf(selectedPanelId)}
              >
                删格
              </button>
              <span className={styles.spacer} />
              <button
                type="button"
                className={styles.ghostBtn}
                data-comic-layout-reset
                title="清空本页版式（内容保留在池中）"
                onClick={onReset}
              >
                清空版式
              </button>
            </>
          )}
        </div>
      )}

      <div className={styles.stage}>
        {!hasLayout ? (
          <div className={styles.stageEmpty} data-comic-layout-empty>
            <p>本页尚未排版</p>
            <p className={styles.stageEmptyHint}>
              {readOnly ? '这一页还没有分镜格' : '点上方「排版」得到满页单格，再对格子横切 / 竖切'}
            </p>
          </div>
        ) : (
          <div
            className={styles.page}
            {...(readOnly
              ? {
                  'data-comic-read-page': '',
                  'data-comic-read-page-id': page.id,
                  'data-comic-page-count': rects.length,
                }
              : { 'data-comic-page-preview': '', 'data-comic-panel-count': rects.length })}
          >
            {rects.map((r) => {
              const selected = !readOnly && r.panelId === selectedPanelId
              const n = orderIndex.get(r.panelId)
              const panel = panelById.get(r.panelId)
              const scene = panel?.scene?.trim()
              return (
                <div
                  key={r.panelId}
                  className={selected ? `${styles.cell} ${styles.cellSelected}` : styles.cell}
                  {...(readOnly
                    ? { 'data-comic-read-panel': '', 'data-comic-read-panel-id': r.panelId }
                    : { 'data-comic-panel': '', 'data-comic-panel-id': r.panelId, 'data-comic-reading-index': n })}
                  style={{
                    left: `calc(${r.x * 100}% + 2px)`,
                    top: `calc(${r.y * 100}% + 2px)`,
                    width: `calc(${r.w * 100}% - 4px)`,
                    height: `calc(${r.h * 100}% - 4px)`,
                  }}
                  onClick={readOnly ? undefined : () => onSelectPanel(r.panelId)}
                >
                  <PanelArt hash={panel?.assetHash} />
                  {readOnly ? null : (
                    <span className={styles.seal} data-comic-reading-seal>
                      {n}
                    </span>
                  )}
                  {scene && !panel?.assetHash ? <span className={styles.cellText}>{scene}</span> : null}
                  <BalloonLayer
                    balloons={panel?.balloons ?? []}
                    interactive={readOnly ? false : selected}
                    onMove={(balloonId, x, y) => onMoveBalloon(r.panelId, balloonId, x, y)}
                    onResize={(balloonId, w, h) => onResizeBalloon(r.panelId, balloonId, w, h)}
                    onMoveTail={(balloonId, x, y) => onMoveBalloonTail(r.panelId, balloonId, x, y)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 格内生成画面（M6-5d）。产物 hash 由 `panel.assetHash` 给出，媒体本体从 `assets` 表读回。
 * 作为格的底层（DOM 在前、无 z-index），序号印章与对白贴纸自然叠在其上——
 * 于是「重生成画面不丢对白」在视觉上也是显然的：换的只是底图，贴纸层纹丝不动。
 */
function PanelArt({ hash }: { hash: string | undefined }) {
  const url = useAsset(hash)
  if (!url) return null
  return <img className={styles.cellArt} src={url} alt="" data-comic-panel-art />
}
