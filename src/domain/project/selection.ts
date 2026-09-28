/**
 * 项目多选状态的纯函数（产品文档 §5.3）。
 *
 * 页面只保存一份 `Set<string>`，选择语义集中在这里：全选只作用于当前可见项目，
 * 搜索 / 排序不会把已经选中的项目悄悄丢掉。把这段语义做成纯函数，
 * 是为了让“全选、清空、是否已全选”不依赖 React 渲染结果。
 */

export function toggleProjectSelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export function selectVisibleProjects(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): Set<string> {
  const next = new Set(selected)
  for (const id of visibleIds) next.add(id)
  return next
}

export function allVisibleProjectsSelected(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): boolean {
  return visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
}

export function clearVisibleProjects(
  selected: ReadonlySet<string>,
  visibleIds: readonly string[],
): Set<string> {
  const next = new Set(selected)
  for (const id of visibleIds) next.delete(id)
  return next
}
