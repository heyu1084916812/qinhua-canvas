/**
 * **同义归并的 LLM 查重建议**（对账 #437；《轻画-漫剧形态调研.md》§370）。
 *
 * 拆镜时会按 `name + aliases` **自动归并**（#416），但模型换个叫法（"林轩" / "林公子"）
 * 就会落下两条重复。手工合并已经在 #436 交付 —— 这一层补**建议**那半。
 *
 * ## 为什么是 LLM，不是模糊匹配
 *
 * 真实情形恰恰是**没有共同子串**的两种叫法（"林轩" / "林公子" 只共享一个姓）。
 * 规则只能靠"同姓"这种弱信号，会把所有同姓的人判成一个人 —— 一个满是错报的清单
 * 比没有清单更糟（用户会把整个入口忽略掉）。研究稿给的正是这两条路，选 LLM 那一条。
 *
 * ## 四条口径
 *
 * 1. 模型只回**候选组 + 理由**，**一个字都不自动改文档**；
 * 2. 用户逐条「合并」（复用 #436 的两下确认）或「不是同一个」；
 * 3. 说过的"不是同一个"记进文档（`mergeDismissals`）——**以后不再问同一对**；
 * 4. 调模型这件事**点之前就说清会花一次对话额度**（本项目"不悄悄多花"那条纪律）。
 */
import { extractJsonBlock } from '../shared/jsonBlock'
import { pairKey, type StoryboardDoc } from './storyboard'

/** 键的算法住在 `storyboard.ts`（它是**文档里的数据**）；这里原样再导出，调用方不用记两处 */
export { pairKey }

/** 系统提示词里的标记：适配器（含 mock）按它认出这是哪一类请求 */
export const MERGE_MARKER = '【漫剧同义归并】'

export interface MergeSuggestion {
  kind: 'char' | 'scene'
  /** 留下的那一条 */
  keepId: string
  /** 并进去的那几条（组里其余成员） */
  dropIds: string[]
  /** 模型给的理由（如实展示给用户 —— 他要照着它判断） */
  reason: string
}

export type MergeParse =
  | { ok: true; suggestions: MergeSuggestion[] }
  | { ok: false; error: string }

/** 这一对是不是已经说过"不是同一个" */
export function isDismissed(doc: StoryboardDoc, a: string, b: string): boolean {
  return (doc.mergeDismissals ?? []).includes(pairKey(a, b))
}

export function buildMergeSystem(): string {
  return `${MERGE_MARKER}你是漫剧项目的场记，负责找出**同一个角色 / 同一个场景被记成了两条**的情况。

判断依据只有这些：名字、别名、以及描述里写的东西。

输出契约（必须严格遵守）
\`\`\`json
{"groups":[{"kind":"char","ids":["第一条的 id","第二条的 id"],"reason":"一句话理由（人话，≤30 字）"}]}
\`\`\`

三条硬规矩：
1. **只输出 JSON**，不要解释、不要代码块以外的文字；
2. 「ids」只能写清单里出现过的 id，**同一组至少两条**；「kind」只能是 "char" 或 "scene"；
3. **拿不准就不要输出这一组** —— 漏报只是少一个提示，误报会让用户合错人。`
}

/**
 * 给模型的清单：**id + 名字 + 别名 + 描述 + 出场镜数**。
 *
 * 出场镜数要带上：它是用户判断"这两条是不是同一个人"的重要线索
 * （两条都各自被好几镜引用时，合并的后果更大，更该慎重）。
 */
export function buildMergeText(doc: StoryboardDoc): string {
  const lines: string[] = []
  const refsOf = (kind: 'char' | 'scene', id: string) =>
    doc.shots.filter((s) =>
      kind === 'char' ? (s.characterIds ?? []).includes(id) : s.sceneId === id,
    ).length
  const push = (kind: 'char' | 'scene', list: StoryboardDoc['characters']) => {
    for (const asset of list) {
      lines.push(
        `- [${kind}] id=${asset.id} 名字=${asset.name} 别名=${
          asset.aliases.join('、') || '（无）'
        } 描述=${asset.description || '（无）'} 出场=${refsOf(kind, asset.id)} 镜`,
      )
    }
  }
  push('char', doc.characters)
  push('scene', doc.scenes)
  return `项目里的角色与场景：\n${lines.join('\n')}`
}

/**
 * 解析模型的候选组。
 *
 * 校验三道（与拆镜那条同一个口径：**形状不对一个字都不用**）：
 * ① `groups` 必须是数组；② 每个 id 都得在库里的**同一类**里存在；
 * ③ 组内去重后至少两条。任何一组不合法就**丢掉那一组**（不整体失败 ——
 * 一组写错不该把其它组也废掉），但**一组都不剩**时如实报错。
 */
export function parseMergeReply(raw: string, doc: StoryboardDoc): MergeParse {
  const json = extractJsonBlock(raw)
  const record = json && typeof json === 'object' && !Array.isArray(json)
    ? (json as Record<string, unknown>)
    : null
  if (!record || !Array.isArray(record.groups)) {
    return { ok: false, error: '没解析出候选：模型回的不是约定的 JSON。再点一次试试。' }
  }
  const chars = new Set(doc.characters.map((c) => c.id))
  const scenes = new Set(doc.scenes.map((s) => s.id))
  const suggestions: MergeSuggestion[] = []
  for (const item of record.groups) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const group = item as Record<string, unknown>
    const kind = group.kind === 'char' || group.kind === 'scene' ? group.kind : null
    if (!kind) continue
    const known = kind === 'char' ? chars : scenes
    const ids = Array.isArray(group.ids)
      ? [...new Set(group.ids.filter((v): v is string => typeof v === 'string' && known.has(v)))]
      : []
    if (ids.length < 2) continue
    suggestions.push({
      kind,
      keepId: ids[0]!,
      dropIds: ids.slice(1),
      reason: typeof group.reason === 'string' ? group.reason.trim().slice(0, 60) : '',
    })
  }
  if (suggestions.length === 0) {
    return { ok: false, error: '模型没给出可用的候选（要么本来就没重复，要么它回的形状不对）。' }
  }
  return { ok: true, suggestions }
}

/** 滤掉"用户已经说过不是同一个"的那些候选（同一组里只要有一对被否过就不提它了） */
export function withoutDismissed(
  doc: StoryboardDoc,
  suggestions: readonly MergeSuggestion[],
): MergeSuggestion[] {
  return suggestions.filter((suggestion) => {
    const all = [suggestion.keepId, ...suggestion.dropIds]
    for (let i = 0; i < all.length; i += 1) {
      for (let j = i + 1; j < all.length; j += 1) {
        if (isDismissed(doc, all[i]!, all[j]!)) return false
      }
    }
    return true
  })
}
