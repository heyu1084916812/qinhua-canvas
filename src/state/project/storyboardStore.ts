import type { StoragePort } from '../../platform/ports'
import {
  emptyStoryboard,
  parseStoryboard,
  type StoryboardDoc,
} from '../../domain/storyboard/storyboard'

/**
 * 漫剧文档的存取（对账 #382）。
 *
 * **一行 = 一个项目的整份文档**（`storyboards` 表，`id` = projectId）：
 * 形态还没固化就先别拆表（理由写在 `domain/storyboard/storyboard.ts` 的文件头与
 * `indexedDbStorage.ts` 的 v11 注释里）。`doc` 整份塞在 `doc` 字段里，
 * 行上另有 `projectId` / `updatedAt` 两个可索引列（备份、按项目取、按时间排序都用得上）。
 *
 * 读写都过 `parseStoryboard`：**读回时就把脏数据补齐、丢掉孤儿镜头**，
 * 于是界面与导出永远只面对一份"干净文档"，不用各自再判一次。
 */

export interface StoryboardStore {
  /** 读回（没有就返回空文档，不写库 —— "还没开始写"和"存了个空"不是一回事） */
  load(projectId: string): Promise<StoryboardDoc>
  save(doc: StoryboardDoc): Promise<void>
}

export function createStoryboardStore(storage: StoragePort): StoryboardStore {
  return {
    async load(projectId) {
      const rows = await storage.query('storyboards', { id: projectId })
      const row = rows[0] as { doc?: unknown } | undefined
      if (!row) return emptyStoryboard(projectId, Date.now())
      return parseStoryboard(row.doc, projectId)
    },

    async save(doc) {
      await storage.put('storyboards', {
        id: doc.projectId,
        projectId: doc.projectId,
        updatedAt: doc.updatedAt,
        doc,
      } as never)
    },
  }
}
