/**
 * comic 工作台私有 reducer（M6-2，纯函数）。
 *
 * 与画布 `state/commands/reducer.ts` 的分工一致：**reducer 纯、store 薄**。
 * 差别在返回形态——画布的 reducer 产出 `CommandResult`（正/逆向补丁 + 持久化计划），
 * 因为画布是「图 + 补丁流」模型；comic 的数据是**单个聚合对象**、没有补丁模型，
 * 因此这里只返回**下一个 `ComicProject`**（撤销栈与补丁化留到需要时再引入）。
 *
 * 约定：
 * - **不可变**更新，绝不原地改；
 * - **无变化时返回原引用**（如把阅读方向设成同值、更新不存在的角色），
 *   让 store 侧可以靠 `next !== prev` 判断「是否要落库」，避免空写。
 */

import type {
  BalloonType,
  ComicBalloon,
  ComicCharacter,
  ComicEpisode,
  ComicPage,
  ComicPanel,
  ComicProject,
  ComicShot,
  CutDirection,
  PanelTransition,
  ReadingDirection,
  ShotAngle,
  ShotFraming,
} from '../../../domain/comic/model/comicProject'
import {
  newComicBalloon,
  newComicCharacter,
  newComicPanel,
} from '../../../domain/comic/model/comicProject'
import {
  instantiateFullPage,
  removeLeaf,
  splitLeaf,
} from '../../../domain/comic/layout/layoutEdit'
import {
  type BalloonRect,
  defaultBalloonRect,
  movedBalloonRect,
  movedTail,
  resizedBalloonRect,
  sameTail,
  withBalloonType,
} from '../../../domain/comic/panel/balloonLayout'
import {
  type PanelRunInput,
  appendPanelRun,
  restorePanelRun,
} from '../../../domain/comic/panel/panelRunRecord'
import { createId } from '../../../shared/id'

/** 角色卡可改字段（id 不可改） */
export type ComicCharacterPatch = Partial<
  Pick<ComicCharacter, 'name' | 'description' | 'referenceHashes'>
>

/** 格可改字段（M6-4）：画面描述 + 镜头语言（对白走独立命令）；M6-5 补生成配置 */
export interface ComicPanelPatch {
  scene?: string
  shot?: ComicShotPatch
  /** 生成渠道（M6-5）；未配置则该格不参与生成 */
  channelId?: string
  /** 生成模型（M6-5） */
  model?: string
}

/** 镜头语言局部修改；`transition: null` 表示**清除**转场（首页无转场） */
export interface ComicShotPatch {
  framing?: ShotFraming
  angle?: ShotAngle
  transition?: PanelTransition | null
}

/** 对白贴纸可改字段；`speakerId: null` 表示**清除**说话人 */
export interface ComicBalloonPatch {
  text?: string
  type?: BalloonType
  speakerId?: string | null
}

/**
 * comic 工作台私有命令。
 *
 * 命令集刻意从零起——comic 不与 canvas 共用命令联合（架构 §5.10：
 * 「命令按工作台注册，跨工作台不共用」）。
 */
export type ComicCommand =
  | { kind: 'episode.add'; title?: string }
  | { kind: 'character.add'; name?: string; description?: string; referenceHashes?: string[] }
  | { kind: 'character.update'; id: string; patch: ComicCharacterPatch }
  | { kind: 'character.remove'; id: string }
  | { kind: 'project.setReadingDirection'; direction: ReadingDirection }
  // ── 版式（M6-3）：改版式不动内容、删格不丢内容（内容留 `page.panels` 池）──
  | { kind: 'page.add'; episodeId: string }
  | { kind: 'page.instantiate'; episodeId: string; pageId: string }
  | { kind: 'page.splitLeaf'; episodeId: string; pageId: string; panelId: string; direction: CutDirection }
  | { kind: 'page.removeLeaf'; episodeId: string; pageId: string; panelId: string }
  | { kind: 'page.layoutReset'; episodeId: string; pageId: string }
  // ── 格内容与对白（M6-4）：按 `panelId` 定位（id 全局唯一，见 `mapPanel`）──
  //    对白的三条**直接操作**（M6-14）：`move` 定位 / `resize` 改尺寸 / `moveTail` 改指向，
  //    三者互不重叠——「位置」「尺寸」「尾巴指向」是一组正交的自由度。
  | { kind: 'panel.update'; panelId: string; patch: ComicPanelPatch }
  | { kind: 'panel.toggleCharacter'; panelId: string; characterId: string }
  // ── 生成结果落位（M6-5）：共享执行引擎的 `ComicPlacement` 经此写回格的 assetHash ──
  | { kind: 'panel.setAsset'; panelId: string; assetHash: string | null }
  // ── 生成留痕与版本回退（M6-15）：留痕住在格内，故两条命令都只带 panelId ──
  //    `append` 的载荷刻意**不含 version**（`PanelRunInput`）：版本号由 reducer 从
  //    该格已有历史推出，调用方无从指定——见 `panelRunRecord.ts` 不变量 2。
  | { kind: 'panel.runRecord.append'; panelId: string; run: PanelRunInput }
  | {
      kind: 'panel.runRecord.restore'
      panelId: string
      /** 要回到的那一版（历史条目 id，非版本号） */
      runId: string
      /** 本次回退所产生的新留痕 id（由调用方给，保证 reducer 纯净） */
      newRunId: string
      createdAt: number
    }
  | { kind: 'balloon.add'; panelId: string; type: BalloonType }
  | { kind: 'balloon.update'; panelId: string; balloonId: string; patch: ComicBalloonPatch }
  | { kind: 'balloon.move'; panelId: string; balloonId: string; x: number; y: number }
  | { kind: 'balloon.resize'; panelId: string; balloonId: string; w: number; h: number }
  | { kind: 'balloon.moveTail'; panelId: string; balloonId: string; x: number; y: number }
  | { kind: 'balloon.remove'; panelId: string; balloonId: string }

function addEpisode(project: ComicProject, title?: string): ComicProject {
  const episode: ComicEpisode = {
    id: createId('ep'),
    index: project.episodes.length,
    title: title?.trim() || `第 ${project.episodes.length + 1} 话`,
    pages: [],
  }
  return { ...project, episodes: [...project.episodes, episode] }
}

function addCharacter(
  project: ComicProject,
  cmd: Extract<ComicCommand, { kind: 'character.add' }>,
): ComicProject {
  const character = newComicCharacter({
    name: cmd.name,
    description: cmd.description,
    referenceHashes: cmd.referenceHashes,
  })
  return { ...project, characters: [...project.characters, character] }
}

function updateCharacter(
  project: ComicProject,
  id: string,
  patch: ComicCharacterPatch,
): ComicProject {
  const i = project.characters.findIndex((c) => c.id === id)
  if (i < 0) return project
  const prev = project.characters[i]!
  const next: ComicCharacter = {
    ...prev,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.referenceHashes !== undefined ? { referenceHashes: patch.referenceHashes } : {}),
  }
  if (
    next.name === prev.name &&
    next.description === prev.description &&
    next.referenceHashes === prev.referenceHashes
  ) {
    return project
  }
  const characters = project.characters.slice()
  characters[i] = next
  return { ...project, characters }
}

/**
 * 删角色卡：同时清掉全篇对它的**引用**，避免留下悬空 id
 * （格的 `characterIds` 与对白的 `speakerId`）。
 */
function removeCharacter(project: ComicProject, id: string): ComicProject {
  if (!project.characters.some((c) => c.id === id)) return project

  const episodes = project.episodes.map((ep) => {
    let changed = false
    const pages = ep.pages.map((page) => {
      let pageChanged = false
      const panels = page.panels.map((panel) => {
        const characterIds = panel.characterIds.filter((cid) => cid !== id)
        const balloons = panel.balloons.map((b) => {
          if (b.speakerId !== id) return b
          const next = { ...b }
          delete next.speakerId
          return next
        })
        const refsChanged =
          characterIds.length !== panel.characterIds.length ||
          balloons.some((b, i) => b !== panel.balloons[i])
        if (!refsChanged) return panel
        pageChanged = true
        return { ...panel, characterIds, balloons }
      })
      if (!pageChanged) return page
      changed = true
      return { ...page, panels }
    })
    if (!changed) return ep
    return { ...ep, pages }
  })

  return {
    ...project,
    characters: project.characters.filter((c) => c.id !== id),
    episodes,
  }
}

// ─────────────────────────────────────────────────────────────
// 版式（M6-3）
// ─────────────────────────────────────────────────────────────

/** 定位并替换某话（找不到 / 未变化 → 原引用） */
function mapEpisode(
  project: ComicProject,
  episodeId: string,
  update: (episode: ComicEpisode) => ComicEpisode | null,
): ComicProject {
  let changed = false
  const episodes = project.episodes.map((ep) => {
    if (ep.id !== episodeId) return ep
    const next = update(ep)
    if (!next) return ep
    changed = true
    return next
  })
  return changed ? { ...project, episodes } : project
}

/** 定位并替换某话里的某页（找不到 / 未变化 → 原引用） */
function mapPage(
  project: ComicProject,
  episodeId: string,
  pageId: string,
  update: (page: ComicPage) => ComicPage | null,
): ComicProject {
  return mapEpisode(project, episodeId, (ep) => {
    let changed = false
    const pages = ep.pages.map((page) => {
      if (page.id !== pageId) return page
      const next = update(page)
      if (!next) return page
      changed = true
      return next
    })
    return changed ? { ...ep, pages } : null
  })
}

/** 加一页（空版式 = 尚未排版） */
function addPage(project: ComicProject, episodeId: string): ComicProject {
  return mapEpisode(project, episodeId, (ep) => ({
    ...ep,
    pages: [
      ...ep.pages,
      { id: createId('page'), index: ep.pages.length, title: '', layout: [], panels: [] },
    ],
  }))
}

/** 空版式 → 满页单格（编辑器首次排版）；已有版式则不动 */
function instantiatePage(project: ComicProject, episodeId: string, pageId: string): ComicProject {
  return mapPage(project, episodeId, pageId, (page) => {
    if (page.layout.length > 0) return null
    const panel = newComicPanel()
    return { ...page, layout: instantiateFullPage(panel.id), panels: [...page.panels, panel] }
  })
}

/**
 * 切开某格：新兄弟格**同步入池**（版式与内容解耦——池里多一格不影响其它页，
 * 因为池按页隔离）。
 */
function splitPageLeaf(
  project: ComicProject,
  episodeId: string,
  pageId: string,
  panelId: string,
  direction: CutDirection,
): ComicProject {
  return mapPage(project, episodeId, pageId, (page) => {
    const sibling = newComicPanel()
    const layout = splitLeaf(page.layout, panelId, direction, sibling.id)
    if (!layout) return null
    return { ...page, layout, panels: [...page.panels, sibling] }
  })
}

/** 清空版式（回到「尚未排版」）；**内容仍留池中**，可重新排版 */
function resetPageLayout(project: ComicProject, episodeId: string, pageId: string): ComicProject {
  return mapPage(project, episodeId, pageId, (page) =>
    page.layout.length === 0 ? null : { ...page, layout: [] },
  )
}

/**
 * 从版式里移除某格；**内容仍留池中**（`orphanPanelIds` 可列出，供回收/重排）。
 * 最后一个格被移除时版式回到空（= 尚未排版）。
 */
function removePageLeaf(
  project: ComicProject,
  episodeId: string,
  pageId: string,
  panelId: string,
): ComicProject {
  return mapPage(project, episodeId, pageId, (page) => {
    const layout = removeLeaf(page.layout, panelId)
    if (!layout) return null
    return { ...page, layout }
  })
}

// ─────────────────────────────────────────────────────────────
// 格内容与对白（M6-4）
// ─────────────────────────────────────────────────────────────

/**
 * 按 `panelId` 定位并替换某格。
 *
 * 与 `mapEpisode` / `mapPage` 不同：格命令**只带 `panelId`**。理由：`panelId` 由
 * `createId('panel')` 生成（UUID），**全局唯一**，因此不必让调用方再传
 * episodeId + pageId —— 少两个参数就少两处「传错页」的可能。代价是一次全篇扫描
 * （话 × 页 × 格），在本地单机数据规模下可忽略。
 */
function mapPanel(
  project: ComicProject,
  panelId: string,
  update: (panel: ComicPanel) => ComicPanel | null,
): ComicProject {
  let changed = false
  const episodes = project.episodes.map((ep) => {
    let epChanged = false
    const pages = ep.pages.map((page) => {
      let pageChanged = false
      const panels = page.panels.map((p) => {
        if (p.id !== panelId) return p
        const next = update(p)
        if (!next) return p
        pageChanged = true
        return next
      })
      if (!pageChanged) return page
      epChanged = true
      return { ...page, panels }
    })
    if (!epChanged) return ep
    changed = true
    return { ...ep, pages }
  })
  return changed ? { ...project, episodes } : project
}

/** 合并镜头语言补丁；无变化返回原引用 */
function mergeShot(prev: ComicShot, patch: ComicShotPatch): ComicShot {
  const framing = patch.framing ?? prev.framing
  const angle = patch.angle ?? prev.angle
  const transition =
    patch.transition === undefined ? prev.transition : (patch.transition ?? undefined)
  if (framing === prev.framing && angle === prev.angle && transition === prev.transition) {
    return prev
  }
  const next: ComicShot = { framing, angle }
  if (transition) next.transition = transition
  return next
}

/** 改格：画面描述 / 镜头语言 / 生成配置（只动**实际变化**的字段，未传字段保持不动） */
function updatePanel(
  project: ComicProject,
  panelId: string,
  patch: ComicPanelPatch,
): ComicProject {
  return mapPanel(project, panelId, (panel) => {
    let next = panel
    if (patch.scene !== undefined && patch.scene !== next.scene) {
      next = { ...next, scene: patch.scene }
    }
    if (patch.channelId !== undefined && patch.channelId !== next.channelId) {
      next = { ...next, channelId: patch.channelId }
    }
    if (patch.model !== undefined && patch.model !== next.model) {
      next = { ...next, model: patch.model }
    }
    if (patch.shot) {
      const shot = mergeShot(next.shot, patch.shot)
      if (shot !== next.shot) next = { ...next, shot }
    }
    return next === panel ? null : next
  })
}

/**
 * 写回生成结果（M6-5）：设 / 清格的 `assetHash`。
 *
 * `null` = 清除（如生成失败后回退）。注意**只动 assetHash**——
 * 对白层 `balloons` 与画面描述都保持不动，这正是「重生成不丢对白」的实现层保证。
 */
function setPanelAsset(project: ComicProject, panelId: string, assetHash: string | null): ComicProject {
  return mapPanel(project, panelId, (panel) => {
    if (assetHash === null) {
      if (panel.assetHash === undefined) return null
      const cleared = { ...panel }
      delete cleared.assetHash
      return cleared
    }
    return panel.assetHash === assetHash ? null : { ...panel, assetHash }
  })
}

/**
 * 追加一条生成留痕（M6-15）：版本号由 `appendPanelRun` 从该格历史推出。
 *
 * 幂等（同 id 已存在返原引用）在 `mapPanel` 层就短路了：`update` 返回原格则
 * 整棵树原样返回，store 侧 `next !== prev` 判为「无变化」，不空写库。
 */
function appendRunRecord(
  project: ComicProject,
  panelId: string,
  run: PanelRunInput,
): ComicProject {
  return mapPanel(project, panelId, (panel) => {
    const next = appendPanelRun(panel, run)
    return next === panel ? null : next
  })
}

/**
 * 回退到某一版（M6-15）：写回画面输入与产物，**并把这次回退本身追加为新留痕**。
 *
 * 源版本不存在 / 不可回退（失败 / 无产物）时 `restorePanelRun` 返原格引用，
 * 这里再折成 `null` 让 `mapPanel` 整树返回原引用 —— 既不产生假留痕，
 * 也不触发一次空的整对象落库。
 */
function restoreRunRecord(
  project: ComicProject,
  panelId: string,
  runId: string,
  newRunId: string,
  createdAt: number,
): ComicProject {
  return mapPanel(project, panelId, (panel) => {
    const next = restorePanelRun(panel, runId, { newRunId, createdAt })
    return next === panel ? null : next
  })
}

/** 勾选 / 取消勾选出场角色 */
function togglePanelCharacter(
  project: ComicProject,
  panelId: string,
  characterId: string,
): ComicProject {
  return mapPanel(project, panelId, (panel) => {
    const has = panel.characterIds.includes(characterId)
    const characterIds = has
      ? panel.characterIds.filter((id) => id !== characterId)
      : [...panel.characterIds, characterId]
    return { ...panel, characterIds }
  })
}

/** 加一个对白贴纸（初始位置按该格已有贴纸数叠放） */
function addBalloon(project: ComicProject, panelId: string, type: BalloonType): ComicProject {
  return mapPanel(project, panelId, (panel) => {
    const balloon = newComicBalloon(type, defaultBalloonRect(type, panel.balloons.length))
    return { ...panel, balloons: [...panel.balloons, balloon] }
  })
}

/** 改对白：文本 / 类型（同步尾巴）/ 说话人（`null` = 清除） */
function updateBalloon(
  project: ComicProject,
  panelId: string,
  balloonId: string,
  patch: ComicBalloonPatch,
): ComicProject {
  return mapPanel(project, panelId, (panel) => {
    let changed = false
    const balloons = panel.balloons.map((b) => {
      if (b.id !== balloonId) return b
      let next = b
      if (patch.text !== undefined && patch.text !== next.text) {
        next = { ...next, text: patch.text }
      }
      if (patch.type !== undefined) next = withBalloonType(next, patch.type)
      if (patch.speakerId !== undefined) {
        if (patch.speakerId === null) {
          if (next.speakerId !== undefined) {
            const cleared = { ...next }
            delete cleared.speakerId
            next = cleared
          }
        } else if (next.speakerId !== patch.speakerId) {
          next = { ...next, speakerId: patch.speakerId }
        }
      }
      if (next === b) return b
      changed = true
      return next
    })
    return changed ? { ...panel, balloons } : null
  })
}

/**
 * 把几何结果写回贴纸（几何与内容字段解耦：`text` / `type` / `speakerId` 不在此处动）。
 * 尾巴缺失时**删字段**而非置 `undefined`（`exactOptionalPropertyTypes` 下的模型约定）。
 */
function withBalloonRect(b: ComicBalloon, rect: BalloonRect): ComicBalloon {
  const next: ComicBalloon = { ...b, x: rect.x, y: rect.y, w: rect.w, h: rect.h }
  if (rect.tail) next.tail = rect.tail
  else delete next.tail
  return next
}

/** 拖动对白贴纸到新位置（夹回格内，尾巴跟随平移） */
function moveBalloon(
  project: ComicProject,
  panelId: string,
  balloonId: string,
  x: number,
  y: number,
): ComicProject {
  return mapPanel(project, panelId, (panel) => {
    let changed = false
    const balloons = panel.balloons.map((b) => {
      if (b.id !== balloonId) return b
      const rect = movedBalloonRect(b, x, y)
      if (rect.x === b.x && rect.y === b.y && sameTail(rect.tail, b.tail)) return b
      changed = true
      return withBalloonRect(b, rect)
    })
    return changed ? { ...panel, balloons } : null
  })
}

/**
 * 缩放对白贴纸（M6-14）：改 `w` / `h`，**左上角不动**，尾巴按相对比例跟随。
 * 与 `balloon.move` 分开是为了语义清晰——「位置」与「尺寸」是两条独立的直接操作。
 */
function resizeBalloon(
  project: ComicProject,
  panelId: string,
  balloonId: string,
  w: number,
  h: number,
): ComicProject {
  return mapPanel(project, panelId, (panel) => {
    let changed = false
    const balloons = panel.balloons.map((b) => {
      if (b.id !== balloonId) return b
      const rect = resizedBalloonRect(b, w, h)
      if (rect.x === b.x && rect.y === b.y && rect.w === b.w && rect.h === b.h && sameTail(rect.tail, b.tail)) {
        return b
      }
      changed = true
      return withBalloonRect(b, rect)
    })
    return changed ? { ...panel, balloons } : null
  })
}

/**
 * 拖尾巴改变**指向**（M6-14）：只动尾巴锚点，气泡本体纹丝不动。
 * 无尾巴的贴纸（`caption` / `sfx`）无可改动 → 返回原引用（无变化）。
 */
function moveBalloonTail(
  project: ComicProject,
  panelId: string,
  balloonId: string,
  x: number,
  y: number,
): ComicProject {
  return mapPanel(project, panelId, (panel) => {
    let changed = false
    const balloons = panel.balloons.map((b) => {
      if (b.id !== balloonId) return b
      const tail = movedTail(b, x, y)
      if (!tail || (b.tail && tail.x === b.tail.x && tail.y === b.tail.y)) return b
      changed = true
      return { ...b, tail }
    })
    return changed ? { ...panel, balloons } : null
  })
}

/** 删对白贴纸 */
function removeBalloon(project: ComicProject, panelId: string, balloonId: string): ComicProject {
  return mapPanel(project, panelId, (panel) => {
    if (!panel.balloons.some((b) => b.id === balloonId)) return null
    return { ...panel, balloons: panel.balloons.filter((b) => b.id !== balloonId) }
  })
}

/** 纯函数：命令 → 下一个项目快照（无变化时返回原引用） */
export function reduceComic(cmd: ComicCommand, project: ComicProject): ComicProject {
  switch (cmd.kind) {
    case 'episode.add':
      return addEpisode(project, cmd.title)
    case 'character.add':
      return addCharacter(project, cmd)
    case 'character.update':
      return updateCharacter(project, cmd.id, cmd.patch)
    case 'character.remove':
      return removeCharacter(project, cmd.id)
    case 'project.setReadingDirection':
      return project.readingDirection === cmd.direction
        ? project
        : { ...project, readingDirection: cmd.direction }
    case 'page.add':
      return addPage(project, cmd.episodeId)
    case 'page.instantiate':
      return instantiatePage(project, cmd.episodeId, cmd.pageId)
    case 'page.splitLeaf':
      return splitPageLeaf(project, cmd.episodeId, cmd.pageId, cmd.panelId, cmd.direction)
    case 'page.removeLeaf':
      return removePageLeaf(project, cmd.episodeId, cmd.pageId, cmd.panelId)
    case 'page.layoutReset':
      return resetPageLayout(project, cmd.episodeId, cmd.pageId)
    case 'panel.update':
      return updatePanel(project, cmd.panelId, cmd.patch)
    case 'panel.toggleCharacter':
      return togglePanelCharacter(project, cmd.panelId, cmd.characterId)
    case 'panel.setAsset':
      return setPanelAsset(project, cmd.panelId, cmd.assetHash)
    case 'panel.runRecord.append':
      return appendRunRecord(project, cmd.panelId, cmd.run)
    case 'panel.runRecord.restore':
      return restoreRunRecord(project, cmd.panelId, cmd.runId, cmd.newRunId, cmd.createdAt)
    case 'balloon.add':
      return addBalloon(project, cmd.panelId, cmd.type)
    case 'balloon.update':
      return updateBalloon(project, cmd.panelId, cmd.balloonId, cmd.patch)
    case 'balloon.move':
      return moveBalloon(project, cmd.panelId, cmd.balloonId, cmd.x, cmd.y)
    case 'balloon.resize':
      return resizeBalloon(project, cmd.panelId, cmd.balloonId, cmd.w, cmd.h)
    case 'balloon.moveTail':
      return moveBalloonTail(project, cmd.panelId, cmd.balloonId, cmd.x, cmd.y)
    case 'balloon.remove':
      return removeBalloon(project, cmd.panelId, cmd.balloonId)
  }
}
