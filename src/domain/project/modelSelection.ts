import type { ModelCapability } from '../shared/capability'

/**
 * 「选择模型」面板的纯逻辑（产品文档 §7.4）。
 *
 * 单独成模块而不是写进设置页组件的理由与 reader 的 `readerNav` 一样：
 * 这些口径（筛选口径、分组顺序、应用时的新旧合并）**在界面上看不出对错**——
 * 勾错了、漏合并了，看起来都只是「列表长得不太一样」，只有单测能把它们钉住。
 * 本模块不依赖 platform / state / React，可在 node 下单测。
 */

export type ModelCategory = ModelCapability['category']

/** 分类 tab 的取值：'all' 是「全部」这一档，不是模型能力，故不并进 ModelCategory */
export type CategoryFilter = 'all' | ModelCategory

/** 分类的顺序与中文名（§7.4 的三行与 tab 共用一份，避免两处各写一遍） */
export const MODEL_CATEGORIES: { value: ModelCategory; label: string }[] = [
  { value: 'image', label: '生图' },
  { value: 'chat', label: '对话' },
  { value: 'video', label: '视频' },
]

export const CATEGORY_FILTERS: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  ...MODEL_CATEGORIES,
]

export function categoryLabel(category: ModelCategory): string {
  return MODEL_CATEGORIES.find((c) => c.value === category)?.label ?? category
}

/**
 * 选择面板的列表筛选：先按分类、再按名称关键字（大小写不敏感的子串）。
 * 关键字两端去空白；空关键字 = 不过滤。**保持输入顺序**，不做二次排序——
 * 上游给的顺序（mock 是固定清单、真实中转多按字母序）比任何本地排序都更有信息量。
 */
export function filterModels(
  models: readonly ModelCapability[],
  category: CategoryFilter,
  keyword: string,
): ModelCapability[] {
  const q = keyword.trim().toLowerCase()
  return models.filter((m) => {
    if (category !== 'all' && m.category !== category) return false
    if (q && !m.id.toLowerCase().includes(q)) return false
    return true
  })
}

/**
 * 已选模型按分类分组（§7.4 的「生图模型 / 对话模型 / 视频模型」三行）。
 * **始终返回固定三组**（顺序 = 生图 / 对话 / 视频），空组由调用方决定是否隐藏——
 * 「哪一组没有」是渲染决策，不该藏在纯函数里；顺序稳定则必须有单一口径。
 */
export function groupModelsByCategory(
  models: readonly ModelCapability[],
): { category: ModelCategory; label: string; models: ModelCapability[] }[] {
  return MODEL_CATEGORIES.map((c) => ({
    category: c.value,
    label: c.label,
    models: models.filter((m) => m.category === c.value),
  }))
}

/** 打开面板时的初始勾选：此前已选的保持勾上（§7.4「可再次打开勾选此前未选中的」） */
export function initialChecked(selected: readonly ModelCapability[]): Set<string> {
  return new Set(selected.map((m) => m.id))
}

/**
 * 「应用到模型列表」——本次勾选结果 → 新的 `models`。
 *
 * 两条口径都不能省：
 * 1. **命中缓存的按缓存为准**：模型详情（能力参数）可能在上游更新过，勾选动作顺带吃到新能力，
 *    而不是把旧快照原样留着（能力驱动参数显隐，旧快照会让新参数永远不出现）。
 * 2. **缓存里已消失但用户仍勾着的，保留**：上游改个名不该把用户的选择静默清掉；
 *    它仍会出现在「已选模型」里，用户可以自己按 × 去掉（那里是唯一的删除入口）。
 */
export function applySelection(
  prevSelected: readonly ModelCapability[],
  allModels: readonly ModelCapability[],
  checked: ReadonlySet<string>,
): ModelCapability[] {
  const out: ModelCapability[] = []
  const seen = new Set<string>()
  for (const m of allModels) {
    if (checked.has(m.id)) {
      out.push(m)
      seen.add(m.id)
    }
  }
  for (const m of prevSelected) {
    if (checked.has(m.id) && !seen.has(m.id)) {
      out.push(m)
      seen.add(m.id)
    }
  }
  return out
}

/** 从「已选模型」里删掉一个（§7.4 每个胶囊右侧的 ×） */
export function removeModel(selected: readonly ModelCapability[], modelId: string): ModelCapability[] {
  return selected.filter((m) => m.id !== modelId)
}
