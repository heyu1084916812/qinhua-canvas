import type { NodeSnapshot, NodeType, GenerationData, GroupData, BatchData, PromptData } from '../../domain/canvas/model/node'
import type { ProjectListItem } from '../../domain/project/project'
import { getSpec } from '../../domain/canvas/nodeSpecs/registry'
import { PACKED_CELL } from '../../domain/canvas/layout/constants'
import { createId } from '../../shared/id'

/**
 * 陈列室造数据（架构 §5.7）：把组件的全部状态并排渲染在一页，由 fixtures 提供确定输入。
 */
export function makeNode(type: NodeType, over: Partial<NodeSnapshot> = {}): NodeSnapshot {
  const spec = getSpec(type)
  if (!spec) throw new Error(`[preview fixtures] 未知节点类型：${type}`)
  const data = spec.createDefaultData()
  return {
    id: over.id ?? createId('node'),
    projectId: over.projectId ?? 'preview',
    type,
    parentId: over.parentId ?? null,
    x: over.x ?? 0,
    y: over.y ?? 0,
    w: over.w ?? spec.sizing.min.w,
    h: over.h ?? spec.sizing.min.h,
    title: over.title ?? spec.label,
    data: (over.data ?? data) as NodeSnapshot['data'],
    stale: over.stale,
  } as NodeSnapshot
}

/** 生成节点数据造数据（陈列室：已配置渠道/模型、提示词、缩略图各态） */
export function genData(over: Partial<GenerationData> = {}): GenerationData {
  const spec = getSpec('generation')!
  return { ...(spec.createDefaultData() as GenerationData), ...over }
}

/** 提示词节点数据造数据（单测与陈列室共用） */
export function promptData(over: Partial<PromptData> = {}): PromptData {
  const spec = getSpec('prompt')!
  return { ...(spec.createDefaultData() as PromptData), ...over }
}

/** 首页项目卡片造数据（陈列室：默认 / 重命名 / 菜单 / 删除确认各态） */
export function makeProject(over: Partial<ProjectListItem> = {}): ProjectListItem {
  const now = over.updatedAt ?? Date.now()
  return {
    id: over.id ?? createId('proj'),
    workbench: over.workbench ?? 'canvas',
    name: over.name ?? '未命名项目',
    createdAt: over.createdAt ?? now - 3600_000,
    updatedAt: now,
    thumbnail: over.thumbnail ?? null,
    extra: over.extra ?? {},
    nodeCount: over.nodeCount ?? 0,
  }
}

/** 分组节点数据造数据（陈列室：空 / 各数量网格 / 含提示词） */
export function groupData(over: Partial<GroupData> = {}): GroupData {
  const spec = getSpec('group')!
  return { ...(spec.createDefaultData() as GroupData), ...over }
}

/** 批量节点数据造数据（陈列室：空 / 素材集合 / 提示词集合） */
export function batchData(over: Partial<BatchData> = {}): BatchData {
  const spec = getSpec('batch')!
  return { ...(spec.createDefaultData() as BatchData), ...over }
}

/** 容器子节点造数据：素材单元用 assetHash，提示词单元用 text */
export function previewChild(
  id: string,
  type: 'generation' | 'prompt',
  assetHash?: string,
  text?: string,
): NodeSnapshot {
  const spec = getSpec(type)!
  return {
    id,
    projectId: 'preview',
    type,
    parentId: null,
    x: 0,
    y: 0,
    w: PACKED_CELL.w,
    h: PACKED_CELL.h,
    title: type === 'prompt' ? '提示词' : '生成',
    disabled: false,
    data:
      type === 'prompt'
        ? { text: text ?? '', upstreamPromptLinked: false }
        : { ...(spec.createDefaultData() as GenerationData), assetHash },
  } as NodeSnapshot
}
