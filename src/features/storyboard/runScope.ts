import type { RunRecordScope } from '../../domain/shared/execution/runRecord'

export type StoryboardRunSubjectKind =
  | 'asset'
  | 'shot-image'
  | 'shot-video'
  | 'speech'
  | 'digital-human'
  | 'video-postprocess'

export interface StoryboardRunScopeHint {
  subjectKind: StoryboardRunSubjectKind
  subjectId: string
  scopeId: string
}

export const STORYBOARD_RUN_SCOPE_FIELDS = {
  version: '__storyboardScopeVersion',
  subjectKind: '__storyboardSubjectKind',
  subjectId: '__storyboardSubjectId',
  scopeId: '__storyboardScopeId',
} as const

/**
 * 把漫剧业务主体附加到画布节点的隐藏 data 上。
 *
 * 这些字段只供执行层写 RunRecord 使用，不参与节点渲染：
 * - `subjectId` 指向镜头、角色资产、场景资产或台词；
 * - `scopeId` 指向分集或项目级动作；
 * - 画布承载节点会复制 sourceData，因此字段会随产物节点一起保留。
 */
export function withStoryboardRunScope(
  data: Readonly<Record<string, unknown>>,
  hint: StoryboardRunScopeHint,
): Record<string, unknown> {
  const subjectId = hint.subjectId.trim()
  const scopeId = hint.scopeId.trim()
  if (!subjectId) throw new Error('漫剧运行主体不能为空')
  if (!scopeId) throw new Error('漫剧运行范围不能为空')
  return {
    ...data,
    [STORYBOARD_RUN_SCOPE_FIELDS.version]: 1,
    [STORYBOARD_RUN_SCOPE_FIELDS.subjectKind]: hint.subjectKind,
    [STORYBOARD_RUN_SCOPE_FIELDS.subjectId]: subjectId,
    [STORYBOARD_RUN_SCOPE_FIELDS.scopeId]: scopeId,
  }
}

export function storyboardRunScopeHintOf(
  data: Readonly<Record<string, unknown>> | null | undefined,
): StoryboardRunScopeHint | null {
  if (!data || data[STORYBOARD_RUN_SCOPE_FIELDS.version] !== 1) return null
  const subjectKind = data[STORYBOARD_RUN_SCOPE_FIELDS.subjectKind]
  const subjectId = data[STORYBOARD_RUN_SCOPE_FIELDS.subjectId]
  const scopeId = data[STORYBOARD_RUN_SCOPE_FIELDS.scopeId]
  if (
    !isSubjectKind(subjectKind) ||
    typeof subjectId !== 'string' ||
    !subjectId.trim() ||
    typeof scopeId !== 'string' ||
    !scopeId.trim()
  ) {
    return null
  }
  return {
    subjectKind,
    subjectId: subjectId.trim(),
    scopeId: scopeId.trim(),
  }
}

/**
 * 漫剧借用画布执行时的 RunRecord 作用域。
 *
 * `planId` 是每次用户动作唯一的执行实例 id，因此可稳定生成 operationId；
 * 若旧画布节点没有隐藏业务主体，返回 null，由调用方回落到画布兼容作用域，
 * 不能拿画布 nodeId 冒充漫剧业务主体。
 */
export function storyboardRunRecordScopeOf(
  data: Readonly<Record<string, unknown>> | null | undefined,
  planId: string,
): RunRecordScope | null {
  const hint = storyboardRunScopeHintOf(data)
  if (!hint) return null
  return {
    scopeVersion: 1,
    workbench: 'storyboard',
    subjectId: hint.subjectId,
    scopeId: hint.scopeId,
    operationId: `storyboard:${planId}:${hint.subjectId}`,
  }
}

function isSubjectKind(value: unknown): value is StoryboardRunSubjectKind {
  return (
    value === 'asset' ||
    value === 'shot-image' ||
    value === 'shot-video' ||
    value === 'speech' ||
    value === 'digital-human' ||
    value === 'video-postprocess'
  )
}

