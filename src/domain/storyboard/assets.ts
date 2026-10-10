import { createId } from '../../shared/id'
import type { DramaAsset, DramaCharacter, DramaScene } from './storyboard'

/**
 * **资产提取与去重**（对账 #416；调研稿 §6.3）。
 *
 * 三件事，一条流水线：
 *
 * 1. **抽取**：模型在拆镜时按镜返回 `characterNames` / `locationNames`（§6.3 第 1 条），
 *    另外可以声明一份带别名与描述的资产清单。
 * 2. **归并去重**：同一对象的两种叫法（「林轩」/「林公子」）必须合成一条 —— 判据是
 *    `name + aliases` 的**归一化集合**（去空白、折大小写），命中哪条就并进哪条。
 * 3. **用户确认**：已有资产**只增不减** —— 模型这一轮没提到，不代表用户想删它
 *    （"资产库是用户可编辑的，不是 LLM 说了算"，§6.3 第 3 条）。
 *
 * 为什么范围无关：函数只吃"名字"，不吃"哪一集"。调研稿 §6.3 第 5 条要求
 * 工序 ②（拆镜）与 ④（资产库）**用同一个函数**，只是一次喂一集、一次喂全篇。
 */

/** 名字归一：去掉所有空白（含全角空格）+ 大小写折叠 —— 归并判据只有这一份 */
export function normalizeName(value: string): string {
  return value.replace(/[\s\u3000]+/g, '').toLowerCase()
}

/** 模型声明的资产草案（还没进库，也可能带着别名与描述） */
export interface DraftAsset {
  name: string
  description?: string
  aliases?: readonly string[]
}

/** 镜头级的名字（调研稿 §6.3 第 1 条的那两个键） */
export interface DraftAssetNames {
  characterNames: readonly string[]
  locationNames: readonly string[]
}

export interface ExtractAssetsInput {
  /** 镜头级的名字：传一集的镜头就是"这一集的"，传全篇就是"全篇的"（函数不关心） */
  shots: readonly DraftAssetNames[]
  /** 模型声明的资产清单（可选：只回 shots 的模型照样能用） */
  characters?: readonly DraftAsset[]
  scenes?: readonly DraftAsset[]
  /** 已有资产 = 用户的确认结果（只增不减） */
  existingCharacters?: readonly DramaCharacter[]
  existingScenes?: readonly DramaScene[]
}

function namesOf(asset: DramaAsset): string[] {
  return [asset.name, ...asset.aliases].map(normalizeName).filter(Boolean)
}

/** 按名字 / 别名找已有资产（**别名归并**的落点） */
export function findAssetByName<T extends DramaAsset>(
  assets: readonly T[],
  name: string,
): T | undefined {
  const wanted = normalizeName(name)
  if (!wanted) return undefined
  return assets.find((a) => namesOf(a).includes(wanted))
}

/** 给界面 / 导出用：名字 → 资产 id（认不出来就是 `undefined`，绝不编一个） */
export function assetIdOf(assets: readonly DramaAsset[], name: string): string | undefined {
  return findAssetByName(assets, name)?.id
}

function mergeOne(
  out: DramaAsset[],
  declared: DraftAsset,
): void {
  const names = [declared.name, ...(declared.aliases ?? [])].map((v) => v.trim()).filter(Boolean)
  const canonical = names[0]
  if (!canonical) return
  let hit: DramaAsset | undefined
  for (const name of names) {
    hit = findAssetByName(out, name)
    if (hit) break
  }
  if (hit) {
    /**
     * 归并到已有那条：**别名并进来、描述只在空时补**。
     *
     * 描述不覆盖是刻意的：用户改过的描述是他确认过的"这个角色长什么样"，
     * 模型的下一轮输出不该把它冲掉（同"资产库不是 LLM 说了算"）。
     */
    for (const name of names) {
      if (name === hit.name) continue
      if (!namesOf(hit).includes(normalizeName(name))) hit.aliases.push(name)
    }
    if (!hit.description.trim() && declared.description?.trim()) {
      hit.description = declared.description.trim()
    }
    return
  }
  out.push({
    id: createId('asset'),
    name: canonical,
    description: (declared.description ?? '').trim(),
    aliases: names.slice(1),
  })
}

function mergeAssets(
  existing: readonly DramaAsset[],
  declared: readonly DraftAsset[],
  mentioned: readonly string[],
): DramaAsset[] {
  /* 复制一份再改：调用方手里的文档不该被就地改（纯函数的底线） */
  const out: DramaAsset[] = existing.map((a) => ({ ...a, aliases: [...a.aliases] }))
  for (const item of declared) mergeOne(out, item)
  for (const raw of mentioned) {
    const name = raw.trim()
    if (!name || findAssetByName(out, name)) continue
    /**
     * 镜头里提到、但模型没声明过的名字：补一条**最小资产**（只有名字）。
     * 这就是 §6.3 的"从分镜结果里汇总需要制作的产物" —— 编造由用户在这里删掉。
     */
    out.push({ id: createId('asset'), name, description: '', aliases: [] })
  }
  return out
}

/** 抽取 + 归并（纯函数；`shots` 的范围由调用方决定：一集或全篇） */
export function extractAssets(input: ExtractAssetsInput): {
  characters: DramaCharacter[]
  scenes: DramaScene[]
} {
  const characterNames = input.shots.flatMap((s) => [...s.characterNames])
  const locationNames = input.shots.flatMap((s) => [...s.locationNames])
  return {
    characters: mergeAssets(input.existingCharacters ?? [], input.characters ?? [], characterNames),
    scenes: mergeAssets(input.existingScenes ?? [], input.scenes ?? [], locationNames),
  }
}

/**
 * 镜头草案 → 绑定：一镜**一个场景**（取 `locationNames[0]`）＋ 若干出场角色。
 *
 * 一镜一个场景是有意的（场景是资产不是容器，调研稿 §6.1）：多出来的地点名
 * **仍会进资产库**（不丢），只是不挂到这一镜上 —— 要换直接在下拉里选。
 */
export function resolveDraftBindings(
  draft: DraftAssetNames,
  characters: readonly DramaCharacter[],
  scenes: readonly DramaScene[],
): { sceneId?: string; characterIds?: string[] } {
  const sceneId = draft.locationNames[0] ? assetIdOf(scenes, draft.locationNames[0]) : undefined
  const characterIds = [
    ...new Set(
      draft.characterNames
        .map((n) => assetIdOf(characters, n))
        .filter((v): v is string => Boolean(v)),
    ),
  ]
  return {
    ...(sceneId ? { sceneId } : {}),
    ...(characterIds.length > 0 ? { characterIds } : {}),
  }
}
