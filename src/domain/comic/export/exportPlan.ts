/**
 * 整套导出：**图张计划**（M6-8，纯函数）。
 *
 * 「导出一话 / 整个项目 → 图片包」要回答的问题不是「怎么画」，而是
 * 「打成几张、每张含哪几页、放进什么路径」。这一层就是那个回答，纯字符串与数组运算，
 * 不碰 canvas / Blob / DOM——光栅化在 `workbenches/comic/export` 里做。
 *
 * 三点口径：
 *   1. **单位是「页」，不是「格」**——导出成品是漫画页，不是分镜格。
 *   2. **跨页布局复用 M6-7 的分组**（`spreadGroups`）：封面单页惯例、两页一组、
 *      末尾落单都同一套规则，导出与阅读不会出现两套「哪几页算一组」的认知。
 *   3. **页序 = 叙事序**——与 `readerNav` 一致；阅读方向只影响**并排时的左右**，
 *      不影响图张顺序（方向在光栅化那层用 `spreadSlots` 决定）。
 *
 * 纯函数、无 React / platform / 持久化（架构 §2.2 domain 纯度约束）。
 */

import type { ComicEpisode, ComicProject } from '../model/comicProject'
import { countLayoutPanels } from '../layout/readingOrder'
import { spreadGroups } from '../reader/readerNav'

/** 导出范围：只导当前一话 / 导整个项目 */
export type ExportScope = 'episode' | 'project'
/** 图张版式：一页一张 / 一跨页一张（复用 M6-7 分组） */
export type ExportLayout = 'page' | 'spread'

export interface ExportSheet {
  /** ZIP 内相对路径（已含目录前缀，`/` 分隔，`.png` 结尾） */
  path: string
  /** 所属话在 `project.episodes` 中的下标——光栅化时据此取回真正的页对象 */
  episodeIndex: number
  /** 本张图包含的页序（0 起、升序，相对所属话） */
  pageIndices: number[]
}

export interface ExportPlan {
  /** ZIP 文件名（已净化，`.zip` 结尾） */
  fileName: string
  sheets: ExportSheet[]
  /** 计划涉及的总页数 */
  pageTotal: number
  /** 其中**尚未排版**的页数（导出会是空白页，供 UI 如实提示） */
  emptyPages: number
}

export interface ExportPlanOptions {
  scope: ExportScope
  layout: ExportLayout
  /** `scope === 'episode'` 时导哪一话（0 起；越界夹回） */
  episodeIndex?: number
  /** 封面惯例（默认 `true`）：跨页布局下第 1 页单独成组。与阅读同一口径 */
  loneFirst?: boolean
}

/**
 * 把一段文本净化成可做文件名 / 目录名的片段。
 *
 * 清掉各平台非法字符与控制字符；净化后为空则回落 `fallback`
 * （否则会产出 `/001.png` 这种带空目录的路径）。
 */
export function sanitizeSegment(raw: string, fallback = '未命名'): string {
  // eslint-disable-next-line no-control-regex -- 明确要清掉 C0 控制字符
  const cleaned = raw.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim()
  return cleaned.length > 0 ? cleaned : fallback
}

/** 页序号 → 三位零填充（`1` → `001`）；跨页用 `002-003` */
function pad3(n: number): string {
  return String(n).padStart(3, '0')
}

/** 一话内的图张切分：单页布局逐页；跨页布局走 `spreadGroups` */
function sheetsOfEpisode(
  pageCount: number,
  layout: ExportLayout,
  loneFirst: boolean,
): { label: string; pages: number[] }[] {
  if (pageCount <= 0) return []
  if (layout === 'page') {
    return Array.from({ length: pageCount }, (_, i) => ({ label: pad3(i + 1), pages: [i] }))
  }
  return spreadGroups(pageCount, loneFirst).map((pages) => {
    const first = pages[0] ?? 0
    const last = pages[pages.length - 1] ?? first
    return {
      pages,
      label: pages.length === 2 ? `${pad3(first + 1)}-${pad3(last + 1)}` : pad3(first + 1),
    }
  })
}

/**
 * 生成导出计划：**选中哪些话 → 每话切成几张 → 每张的包内路径与文件名**。
 *
 * 目录结构（`scope === 'project'` 时多一层项目名，避免多话导出后 PNG 混在同层）：
 *   - 本话：`{话名}/001.png`
 *   - 项目：`{项目名}/{话名}/001.png`
 *
 * 无话 / 无页时返回空计划（`sheets: []`）——调用方据此把导出按钮禁用，
 * 而不是在这里抛错。
 */
export function planExport(project: ComicProject, opts: ExportPlanOptions): ExportPlan {
  const loneFirst = opts.loneFirst ?? true
  const projectName = sanitizeSegment(project.title, '漫画剧')

  const picked: { episode: ComicEpisode; index: number }[] = []
  if (opts.scope === 'episode') {
    const count = project.episodes.length
    if (count > 0) {
      const raw = Number.isFinite(opts.episodeIndex) ? Math.trunc(opts.episodeIndex!) : 0
      const i = Math.min(count - 1, Math.max(0, raw))
      const episode = project.episodes[i]
      if (episode) picked.push({ episode, index: i })
    }
  } else {
    project.episodes.forEach((episode, index) => picked.push({ episode, index }))
  }

  const sheets: ExportSheet[] = []
  let pageTotal = 0
  let emptyPages = 0

  for (const { episode, index } of picked) {
    const episodeName = sanitizeSegment(episode.title, `第${index + 1}话`)
    const dir = opts.scope === 'project' ? `${projectName}/${episodeName}` : episodeName
    pageTotal += episode.pages.length
    for (const page of episode.pages) {
      if (countLayoutPanels(page.layout) === 0) emptyPages += 1
    }
    for (const sheet of sheetsOfEpisode(episode.pages.length, opts.layout, loneFirst)) {
      sheets.push({ path: `${dir}/${sheet.label}.png`, episodeIndex: index, pageIndices: sheet.pages })
    }
  }

  const only = picked[0]
  const fileName =
    opts.scope === 'episode' && only
      ? `${projectName}-${sanitizeSegment(only.episode.title, `第${only.index + 1}话`)}.zip`
      : `${projectName}.zip`

  return { fileName, sheets, pageTotal, emptyPages }
}
