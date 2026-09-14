import { useMemo, useState, useSyncExternalStore } from 'react'
import { useComicStore, useComicProject } from '../storeContext'
import type { CutDirection, ReadingDirection } from '../../../domain/comic/model/comicProject'
import { addCharacterReference, removeCharacterReference } from '../../../domain/comic/model/comicProject'
import { layoutPanelIds, readingOrderOf } from '../../../domain/comic/layout/readingOrder'
import type { ModelCapability } from '../../../domain/shared/capability'
import type { ExportLayout, ExportScope } from '../../../domain/comic/export/exportPlan'
import { useChannels } from '../../../app/providers/ChannelStoreProvider'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import { createId } from '../../../shared/id'
import { useAsset } from '../hooks/useAsset'
import { useComicExecution } from '../execution/ComicExecutionProvider'
import { exportComicProject } from '../export/comicExport'
import { createCharacterRefUploader } from './characterRefUpload'
import { PageLayoutEditor } from './PageLayoutEditor'
import { PanelEditor } from './PanelEditor'
import { EpisodeOverview } from './EpisodeOverview'
import { ComicReader } from './ComicReader'
import styles from './ComicSurface.module.css'

/**
 * comic 工作台表面（M5 骨架 → M6-2 项目级 → M6-3 页版式 → M6-4 格编辑 + 对白层）。
 *
 * 布局（对应调研稿 §7 的「顶 / 左 / 中 / 右」，此处纵向分区 + 版式区双栏）：
 *   1. 项目信息（标题 + 计数）
 *   2. 话与版式：话 tab → 页 chips → **双栏工作区**（左：页版式预览 + 对白贴纸层；
 *      右：格属性面板 —— 画面描述 / 镜头语言 / 出场角色 / 对白层）
 *   3. 阅读方向（项目级，影响阅读顺序派生）
 *   4. 角色卡库（项目级）
 *
 * **本组件只接线**：所有规则在纯 reducer / domain 里；这里只做选中态（话 / 页 / 格）
 * 与命令派发。选中态用「派生回退」——state 里存的是**意图**，真正渲染的实体按
 * 「存的 id 命中 → 否则取第一个」派生，避免 hydrate 后 id 失效导致的空屏。
 *
 * 极简形态：无投影、1px 细描边、圆角取 token；分镜格统一白底。
 */
export function ComicSurface() {
  const store = useComicStore()
  const project = useComicProject()
  const channels = useChannels()
  const exec = useComicExecution()
  const platform = usePlatform()
  const canUndo = useSyncExternalStore(store.subscribe, store.canUndo, store.canUndo)

  /**
   * 参考图上传器（M6-13）：选图 → 按内容取哈希 → 写素材库。
   *
   * 素材落库**不走命令**而是直写 `assets` 表——与 `ComicExecutionProvider`
   * 写生成产物同一套路径（comic 的 reducer 只产出项目聚合对象，不含素材；
   * 素材与项目文档分离落库）。这里只把 platform 的两个口交出去。
   */
  const refUploader = useMemo(
    () =>
      createCharacterRefUploader({
        pickFile: (accept) => platform.files.pickFile(accept),
        putAsset: (row) => platform.storage.put('assets', row as never),
      }),
    [platform],
  )

  // 生成配置选项：启用渠道 → 当前渠道的图像模型（与画布生成节点同一口径）
  const enabledChannels = channels.enabledChannels()

  const [episodeId, setEpisodeId] = useState<string | null>(null)
  const [pageId, setPageId] = useState<string | null>(null)
  const [panelId, setPanelId] = useState<string | null>(null)
  /** 版式区视图（M6-6）：编辑单页 / 一话总览（缩略网格） */
  const [viewMode, setViewMode] = useState<'edit' | 'overview'>('edit')
  /** 翻页预览浮层开关（M6-6） */
  const [readerOpen, setReaderOpen] = useState(false)
  /** 导出（M6-8）：图张版式 + 进行中/结果提示 */
  const [exportLayout, setExportLayout] = useState<ExportLayout>('page')
  /** 导出页码（M6-11）：**默认关**——页码是阅读辅助不是画面内容，误开要重导才能去 */
  const [exportPageNumbers, setExportPageNumbers] = useState(false)
  const [exportStatus, setExportStatus] = useState('')
  const [exporting, setExporting] = useState(false)

  // 派生回退：命中所选则用之，否则回退到第一个（hydrate 前/后被删都安全）
  const episode = project.episodes.find((e) => e.id === episodeId) ?? project.episodes[0] ?? null
  const page = episode?.pages.find((p) => p.id === pageId) ?? episode?.pages[0] ?? null
  const layoutIds = page ? layoutPanelIds(page.layout) : []
  const activePanelId = panelId !== null && layoutIds.includes(panelId) ? panelId : null

  // 选中格实体（panelId 全局唯一；在池里找，命中版式才渲染编辑器）
  const activePanel = page && activePanelId !== null
    ? page.panels.find((p) => p.id === activePanelId) ?? null
    : null

  // 生成配置：当前格所选渠道 → 该渠道**已勾选**的图像模型（`models`，非拉取缓存 `modelCache`，§7.4）；
  // 切渠道时由编辑器清空 model 避免脏值
  const activeChannel = enabledChannels.find((c) => c.id === activePanel?.channelId)
  const imageModels: ModelCapability[] =
    activeChannel?.models.filter((m) => m.category === 'image') ?? []

  // 阅读序号（1 起）：与左侧预览同一口径（顺序派生，RTL 只改序不改几何）
  const orderIndex = new Map<string, number>()
  if (page) {
    readingOrderOf(page, project.readingDirection).forEach((id, i) => orderIndex.set(id, i + 1))
  }

  // 翻页预览的初始页序：当前页在叙事序里的位置（未命中/无页回退到 0）
  const pageIndex = page && episode ? Math.max(0, episode.pages.findIndex((p) => p.id === page.id)) : 0

  // 导出（M6-8）：当前话下标（planExport 用它定位）+ 全项目页数（无页则禁用）
  const episodeIndex = episode ? project.episodes.findIndex((e) => e.id === episode.id) : -1
  const totalPages = project.episodes.reduce((n, e) => n + e.pages.length, 0)

  const runExport = async (scope: ExportScope) => {
    if (exporting) return
    setExporting(true)
    setExportStatus('导出中…')
    try {
      const result = await exportComicProject(platform, project, {
        scope,
        layout: exportLayout,
        episodeIndex: episodeIndex >= 0 ? episodeIndex : 0,
        pageNumbers: exportPageNumbers,
      })
      const emptyNote = result.emptyPages > 0 ? `，其中 ${result.emptyPages} 页未排版` : ''
      const numNote = exportPageNumbers ? '，页脚带已打页码' : ''
      setExportStatus(
        `已导出 ${result.sheetCount} 张 PNG（共 ${result.pageTotal} 页${emptyNote}${numNote}）`,
      )
    } catch (err) {
      setExportStatus(`导出失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExporting(false)
    }
  }

  const setDirection = (direction: ReadingDirection) =>
    store.dispatch({ kind: 'project.setReadingDirection', direction })

  // dispatch 是同步的（store 契约），动作后可直接读回新快照来定位刚建出来的实体
  const addEpisode = () => {
    store.dispatch({ kind: 'episode.add' })
    const episodes = store.getProject().episodes
    setEpisodeId(episodes[episodes.length - 1]?.id ?? null)
    setPageId(null)
    setPanelId(null)
    setViewMode('edit')
  }

  const addPage = () => {
    if (!episode) return
    store.dispatch({ kind: 'page.add', episodeId: episode.id })
    const pages = store.getProject().episodes.find((e) => e.id === episode.id)?.pages ?? []
    setPageId(pages[pages.length - 1]?.id ?? null)
    setPanelId(null)
  }

  return (
    <div className={styles.surface} data-comic-surface>
      <header className={styles.head}>
        <h1 className={styles.title}>{project.title}</h1>
        <p className={styles.hint}>
          漫画剧工作台 · {project.episodes.length} 话 · {project.characters.length} 角色
        </p>
      </header>

      {/* 话与版式：话 → 页 → 切割树编辑器 */}
      <section className={styles.section} data-comic-pages>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>话与版式</h2>
          <button
            type="button"
            className={styles.addBtn}
            data-comic-add-episode
            onClick={addEpisode}
          >
            ＋ 新建一话
          </button>
        </div>

        {project.episodes.length === 0 ? (
          <p className={styles.hint} data-comic-empty>
            还没有任何一话。新建一话后即可加页并排版。
          </p>
        ) : (
          <>
            <div className={styles.chips} data-comic-episode-tabs>
              {project.episodes.map((ep) => (
                <button
                  key={ep.id}
                  type="button"
                  className={ep.id === episode?.id ? `${styles.chip} ${styles.chipActive}` : styles.chip}
                  data-comic-episode
                  data-comic-episode-id={ep.id}
                  aria-pressed={ep.id === episode?.id}
                  onClick={() => {
                    setEpisodeId(ep.id)
                    setPageId(null)
                    setPanelId(null)
                  }}
                >
                  {ep.title}
                </button>
              ))}
            </div>

            {episode ? (
              <>
                <div className={styles.pagesRow}>
                  <span className={styles.barLabel}>页</span>
                  <div className={styles.chips}>
                    {episode.pages.length === 0 ? (
                      <span className={styles.hint} data-comic-no-page>
                        本话还没有页
                      </span>
                    ) : (
                      episode.pages.map((pg, i) => (
                        <button
                          key={pg.id}
                          type="button"
                          className={pg.id === page?.id ? `${styles.chip} ${styles.chipActive}` : styles.chip}
                          data-comic-page
                          data-comic-page-id={pg.id}
                          aria-pressed={pg.id === page?.id}
                          onClick={() => {
                            setPageId(pg.id)
                            setPanelId(null)
                          }}
                        >
                          {i + 1}
                        </button>
                      ))
                    )}
                  </div>
                  <button type="button" className={styles.addBtn} data-comic-add-page onClick={addPage}>
                    ＋ 页
                  </button>
                  <span className={styles.spacer} />
                  <div className={styles.segmented}>
                    <button
                      type="button"
                      className={viewMode === 'edit' ? `${styles.segBtn} ${styles.segBtnActive}` : styles.segBtn}
                      data-comic-view-edit
                      aria-pressed={viewMode === 'edit'}
                      onClick={() => setViewMode('edit')}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className={viewMode === 'overview' ? `${styles.segBtn} ${styles.segBtnActive}` : styles.segBtn}
                      data-comic-view-overview
                      aria-pressed={viewMode === 'overview'}
                      onClick={() => setViewMode('overview')}
                    >
                      总览
                    </button>
                  </div>
                  <button
                    type="button"
                    className={styles.addBtn}
                    data-comic-open-reader
                    disabled={episode.pages.length === 0}
                    title={episode.pages.length === 0 ? '本话还没有页，无法翻页预览' : '翻页预览本话'}
                    onClick={() => setReaderOpen(true)}
                  >
                    ▶ 预览
                  </button>
                </div>

                {viewMode === 'overview' ? (
                  <EpisodeOverview
                    episode={episode}
                    direction={project.readingDirection}
                    selectedPageId={page?.id ?? null}
                    onSelectPage={(id) => {
                      setPageId(id)
                      setPanelId(null)
                      setViewMode('edit')
                    }}
                  />
                ) : page ? (
                  <div className={styles.workspace} data-comic-workspace>
                    {/* 左：页版式预览 + 对白贴纸层 */}
                    <div className={styles.layoutCol}>
                      <PageLayoutEditor
                        page={page}
                        direction={project.readingDirection}
                        selectedPanelId={activePanelId}
                        onSelectPanel={setPanelId}
                        onInstantiate={() =>
                          store.dispatch({ kind: 'page.instantiate', episodeId: episode.id, pageId: page.id })
                        }
                        onSplit={(target, direction: CutDirection) =>
                          store.dispatch({
                            kind: 'page.splitLeaf',
                            episodeId: episode.id,
                            pageId: page.id,
                            panelId: target,
                            direction,
                          })
                        }
                        onRemoveLeaf={(target) => {
                          store.dispatch({
                            kind: 'page.removeLeaf',
                            episodeId: episode.id,
                            pageId: page.id,
                            panelId: target,
                          })
                          setPanelId(null)
                        }}
                        onMoveBalloon={(targetPanelId, balloonId, x, y) =>
                          store.dispatch({
                            kind: 'balloon.move',
                            panelId: targetPanelId,
                            balloonId,
                            x,
                            y,
                          })
                        }
                        onResizeBalloon={(targetPanelId, balloonId, w, h) =>
                          store.dispatch({
                            kind: 'balloon.resize',
                            panelId: targetPanelId,
                            balloonId,
                            w,
                            h,
                          })
                        }
                        onMoveBalloonTail={(targetPanelId, balloonId, x, y) =>
                          store.dispatch({
                            kind: 'balloon.moveTail',
                            panelId: targetPanelId,
                            balloonId,
                            x,
                            y,
                          })
                        }
                        onReset={() => {
                          store.dispatch({ kind: 'page.layoutReset', episodeId: episode.id, pageId: page.id })
                          setPanelId(null)
                        }}
                      />
                    </div>

                    {/* 右：格属性面板（选中格才渲染；未选时给空态提示） */}
                    {activePanel ? (
                      <PanelEditor
                        panel={activePanel}
                        characters={project.characters}
                        readingIndex={activePanelId !== null ? orderIndex.get(activePanelId) ?? null : null}
                        channelOptions={enabledChannels.map((c) => ({ id: c.id, name: c.name }))}
                        imageModels={imageModels.map((m) => ({ id: m.id }))}
                        runState={exec.panelStateOf(activePanel.id)}
                        onUpdateScene={(scene) =>
                          store.dispatch({
                            kind: 'panel.update',
                            panelId: activePanel.id,
                            patch: { scene },
                          })
                        }
                        onUpdateShot={(shot) =>
                          store.dispatch({
                            kind: 'panel.update',
                            panelId: activePanel.id,
                            patch: { shot },
                          })
                        }
                        onToggleCharacter={(characterId) =>
                          store.dispatch({
                            kind: 'panel.toggleCharacter',
                            panelId: activePanel.id,
                            characterId,
                          })
                        }
                        onAddBalloon={(type) =>
                          store.dispatch({ kind: 'balloon.add', panelId: activePanel.id, type })
                        }
                        onUpdateBalloon={(balloonId, patch) =>
                          store.dispatch({
                            kind: 'balloon.update',
                            panelId: activePanel.id,
                            balloonId,
                            patch,
                          })
                        }
                        onRemoveBalloon={(balloonId) =>
                          store.dispatch({
                            kind: 'balloon.remove',
                            panelId: activePanel.id,
                            balloonId,
                          })
                        }
                        onSetChannel={(channelId) =>
                          // 切渠道后模型缓存不同：一并清空 model，避免残留脏值（与画布生成节点一致）
                          store.dispatch({
                            kind: 'panel.update',
                            panelId: activePanel.id,
                            patch: { channelId, model: '' },
                          })
                        }
                        onSetModel={(model) =>
                          store.dispatch({
                            kind: 'panel.update',
                            panelId: activePanel.id,
                            patch: { model },
                          })
                        }
                        onGenerate={() => void exec.runPanel(activePanel.id)}
                        onCancel={exec.cancel}
                        onRestoreRun={(runId) =>
                          // M6-15 回退：写回该版输入与产物，**并追加一条新留痕**（历史只增）。
                          // 新留痕的 id 与时间由调用方给——reducer 是纯函数，不持时钟。
                          store.dispatch({
                            kind: 'panel.runRecord.restore',
                            panelId: activePanel.id,
                            runId,
                            newRunId: createId('run'),
                            createdAt: Date.now(),
                          })
                        }
                      />
                    ) : (
                      <aside className={styles.editorEmpty} data-comic-panel-editor-empty>
                        点选左侧一个分镜格，编辑画面描述、镜头语言、出场角色与对白。
                      </aside>
                    )}
                  </div>
                ) : (
                  <p className={styles.hint} data-comic-no-page>
                    本话还没有页。点「＋ 页」添加。
                  </p>
                )}
              </>
            ) : null}
          </>
        )}
      </section>

      {/* 阅读方向（项目级，影响版式阅读顺序派生） */}
      <section className={styles.section} data-comic-reading-direction>
        <h2 className={styles.sectionTitle}>阅读方向</h2>
        <div className={styles.segmented}>
          <button
            type="button"
            className={
              project.readingDirection === 'ltr'
                ? `${styles.segBtn} ${styles.segBtnActive}`
                : styles.segBtn
            }
            data-comic-reading-ltr
            aria-pressed={project.readingDirection === 'ltr'}
            onClick={() => setDirection('ltr')}
          >
            左 → 右
          </button>
          <button
            type="button"
            className={
              project.readingDirection === 'rtl'
                ? `${styles.segBtn} ${styles.segBtnActive}`
                : styles.segBtn
            }
            data-comic-reading-rtl
            aria-pressed={project.readingDirection === 'rtl'}
            onClick={() => setDirection('rtl')}
          >
            右 ← 左
          </button>
        </div>
      </section>

      {/* 导出图片包（M6-8）：一话 / 整个项目 → ZIP（每张图一张 PNG） */}
      <section className={styles.section} data-comic-export>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>导出图片包</h2>
        </div>
        <div className={styles.pagesRow}>
          <span className={styles.barLabel}>版式</span>
          <div className={styles.segmented} role="group" aria-label="导出图张版式">
            <button
              type="button"
              className={
                exportLayout === 'page' ? `${styles.segBtn} ${styles.segBtnActive}` : styles.segBtn
              }
              data-comic-export-layout-page
              aria-pressed={exportLayout === 'page'}
              onClick={() => setExportLayout('page')}
            >
              单页
            </button>
            <button
              type="button"
              className={
                exportLayout === 'spread'
                  ? `${styles.segBtn} ${styles.segBtnActive}`
                  : styles.segBtn
              }
              data-comic-export-layout-spread
              aria-pressed={exportLayout === 'spread'}
              onClick={() => setExportLayout('spread')}
            >
              跨页
            </button>
          </div>
          <button
            type="button"
            className={
              exportPageNumbers ? `${styles.segBtn} ${styles.segBtnActive}` : styles.segBtn
            }
            data-comic-export-pagenum
            aria-pressed={exportPageNumbers}
            title="在每张图的页脚带里打上页码（每话内从 1 起；页码不压画面）"
            onClick={() => setExportPageNumbers((v) => !v)}
          >
            页码
          </button>
          <span className={styles.spacer} />
          <button
            type="button"
            className={styles.addBtn}
            data-comic-export-episode
            disabled={exporting || !episode || episode.pages.length === 0}
            title={episode && episode.pages.length > 0 ? '把本话导出为 ZIP' : '本话还没有页'}
            onClick={() => void runExport('episode')}
          >
            {exporting ? '导出中…' : '导出本话'}
          </button>
          <button
            type="button"
            className={styles.addBtn}
            data-comic-export-project
            disabled={exporting || totalPages === 0}
            title={totalPages > 0 ? '把整个项目导出为 ZIP' : '还没有任何页'}
            onClick={() => void runExport('project')}
          >
            导出整个项目
          </button>
        </div>
        <p className={styles.hint} data-comic-export-status>
          {exportStatus ||
            '导出为 ZIP：单页版式每页一张 PNG；跨页版式两页并作一张（封面惯例同阅读）。页码默认不打——点「页码」可在页脚带里加上。'}
        </p>
      </section>

      {/* 角色卡库（项目级；跨格复用外观，保 AI 生成一致性） */}
      <section className={styles.section} data-comic-characters>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>角色卡</h2>
          <button
            type="button"
            className={styles.addBtn}
            data-comic-character-add
            onClick={() => store.dispatch({ kind: 'character.add' })}
          >
            ＋ 新建角色
          </button>
        </div>

        {project.characters.length === 0 ? (
          <p className={styles.hint} data-comic-characters-empty>
            还没有角色卡。新建后可跨格复用外观描述与参考图，保证 AI 生成一致性。
          </p>
        ) : (
          <ul className={styles.charList}>
            {project.characters.map((c) => (
              <li key={c.id} className={styles.character} data-comic-character data-comic-character-id={c.id}>
                <div className={styles.charRow}>
                  <input
                    className={styles.charName}
                    data-comic-character-name
                    value={c.name}
                    placeholder="角色名"
                    onChange={(e) =>
                      store.dispatch({
                        kind: 'character.update',
                        id: c.id,
                        patch: { name: e.target.value },
                      })
                    }
                  />
                  <input
                    className={styles.charDesc}
                    data-comic-character-desc
                    value={c.description}
                    placeholder="外观描述（喂生图的 prompt 片段）"
                    onChange={(e) =>
                      store.dispatch({
                        kind: 'character.update',
                        id: c.id,
                        patch: { description: e.target.value },
                      })
                    }
                  />
                  <button
                    type="button"
                    className={styles.dangerBtn}
                    data-comic-character-remove
                    title="删除角色卡（同时清除全篇对它的引用）"
                    onClick={() => store.dispatch({ kind: 'character.remove', id: c.id })}
                  >
                    删除
                  </button>
                </div>

                {/* 参考图（M6-13）：喂图生图的角色一致性素材；hash 即内容，重复上传不占第二位 */}
                <div className={styles.charRefs}>
                  <span className={styles.charRefsLabel}>参考图</span>
                  {c.referenceHashes.map((hash) => (
                    <CharacterRefThumb
                      key={hash}
                      hash={hash}
                      onRemove={() =>
                        store.dispatch({
                          kind: 'character.update',
                          id: c.id,
                          patch: {
                            referenceHashes: removeCharacterReference(c.referenceHashes, hash),
                          },
                        })
                      }
                    />
                  ))}
                  <button
                    type="button"
                    className={styles.charRefAdd}
                    data-comic-character-ref-add
                    title="上传参考图（喂图生图，可多张）"
                    onClick={async () => {
                      const up = await refUploader.pickAndStore()
                      if (!up) return
                      // 上传是异步的：取上传完成时**最新**的角色列表，而不是本次渲染
                      // 闭包里的 c —— 否则连续上传两张时，后一次会把前一张挤掉
                      const cur = store.getProject().characters.find((x) => x.id === c.id)
                      if (!cur) return
                      store.dispatch({
                        kind: 'character.update',
                        id: c.id,
                        patch: {
                          referenceHashes: addCharacterReference(cur.referenceHashes, up.hash),
                        },
                      })
                    }}
                  >
                    ＋ 上传
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className={styles.foot}>
        <span className={styles.footHint}>版式为切割树 · 删格不丢内容（内容保留在池中）</span>
        <button
          type="button"
          className={styles.ghostBtn}
          disabled={!canUndo}
          title={canUndo ? '撤销' : '暂无可撤销操作'}
        >
          撤销
        </button>
      </footer>

      {/* 翻页预览（M6-6）：全屏只读浮层，按阅读方向翻页 */}
      {readerOpen && episode ? (
        <ComicReader
          episode={episode}
          direction={project.readingDirection}
          initialIndex={pageIndex}
          onClose={() => setReaderOpen(false)}
        />
      ) : null}
    </div>
  )
}

/**
 * 参考图缩略（M6-13）：hash → objectURL。
 *
 * 与格底图 / 一话缩略走**同一条** `useAsset` 路径——素材是内容寻址的，
 * 「这张图从哪来」不影响「怎么读它」。尚未落库时先渲染空占位，
 * `useAsset` 退避重试到位后自动补上（与格的底图完全同款竞态窗口）。
 */
function CharacterRefThumb({ hash, onRemove }: { hash: string; onRemove: () => void }) {
  const url = useAsset(hash)
  return (
    <span className={styles.charRef} data-comic-character-ref={hash} title={hash}>
      {url ? (
        <img className={styles.charRefImg} src={url} alt="" draggable={false} />
      ) : (
        <span className={styles.charRefImg} />
      )}
      <button
        type="button"
        className={styles.charRefRemove}
        data-comic-character-ref-remove
        title="移除这张参考图"
        aria-label="移除参考图"
        onClick={onRemove}
      >
        ×
      </button>
    </span>
  )
}
