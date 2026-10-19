import type { WorkbenchId } from '../shared/workbench'

/**
 * 项目（跨工作台）领域模型（产品文档 §8 数据模型 · projects 表）。
 * 与具体画布图数据无关——图数据只存在 nodes / edges / resultGroups 表，
 * 项目行只负责「这个画布叫什么、落在哪个工作台、最近编辑时间」。
 */
export interface Project {
  id: string
  workbench: WorkbenchId
  name: string
  createdAt: number
  updatedAt: number
  /** 缩略图数据 URL；M1 暂未生成，留空 */
  thumbnail?: string | null
  /** 后续里程碑扩展位（模板来源、封面策略等），不进 UI 逻辑 */
  extra?: Record<string, unknown>
  /** 一层项目文件夹；null / 缺省 = 未归档 */
  folderId?: string | null
  /** 有值即置顶；数值用于多个置顶项之间的稳定排序 */
  pinnedAt?: number
  /**
   * 删除时间戳（软删）。**有值 = 在回收站里**，项目列表不再显示它。
   *
   * 为什么要软删（用户 2026-10-09，对账 #378 A3）：
   * 原先删项目是**不可逆**的（连带 nodes / edges / tasks / runRecords / agentSessions
   * 一起删），误点一下数据就没了。现在删除 = 打标记，回收站里可以还原。
   *
   * 注意：**还原只是清掉这个字段**，级联表（节点 / 连线 / 记录）在软删时**一条都没动** ——
   * 所以还原后图是完好的，不需要"重建"。
   */
  deletedAt?: number
}

/**
 * 首页卡片展示用：在 Project 基础上附加节点数。
 * nodeCount 来自 nodes 表的实时统计，不持久化、不写回。
 */
export interface ProjectListItem extends Project {
  nodeCount: number
  /**
   * 项目封面的**素材 hash**（用户 2026-09-27：用最后一张生成图当封面）。
   *
   * 与 `Project.thumbnail`（dataURL）的区别是**存什么**：
   * 这里只有内容寻址的 hash（几十字节），图本身在 assets 表里，
   * 由卡片用既有的 `useAsset` 取。项目列表因此不必背几 MB 的 base64。
   *
   * `null` = 这个项目还没有任何生成产物（新项目、或只连了线没跑过）——
   * 卡片据此回落成网格占位，不显示破图。
   */
  coverHash?: string | null
}

export interface CreateProjectInput {
  name?: string
  workbench?: WorkbenchId
  folderId?: string | null
}

export interface ProjectFolder {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  pinnedAt?: number
}

const DEFAULT_NAME: Record<WorkbenchId, string> = {
  canvas: '未命名项目',
  /* 电商工作台（对账 #384）：默认名直接说用途，比"未命名项目"好用 */
  ecommerce: '电商出图',
  /* 漫剧工作台（对账 #382）：同上，列表里一眼看出这是干什么的 */
  storyboard: '漫剧',
}

/** 构造一个新的 Project 领域对象（纯函数，不含持久化与 id 生成） */
export function createProject(
  input: CreateProjectInput,
  id: string,
  now: number,
): Project {
  const workbench = input.workbench ?? 'canvas'
  return {
    id,
    workbench,
    name: input.name?.trim() || DEFAULT_NAME[workbench],
    createdAt: now,
    updatedAt: now,
    thumbnail: null,
    extra: {},
    folderId: input.folderId ?? null,
  }
}

export function createProjectFolder(
  input: { name?: string },
  id: string,
  now: number,
): ProjectFolder {
  return {
    id,
    name: input.name?.trim() || '未命名文件夹',
    createdAt: now,
    updatedAt: now,
  }
}
