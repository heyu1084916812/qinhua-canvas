import { createId } from '../../shared/id'
import { resolveChatTarget, type ChatTarget } from '../shared/chatTarget'
import { extractAssets, resolveDraftBindings, type DraftAsset } from './assets'
import { episodeSourceText } from './episodes'
import { extractJsonBlock } from '../shared/jsonBlock'
import {
  DEFAULT_SHOT_SECONDS,
  normalizeShotOrder,
  type DramaCharacter,
  type DramaScene,
  type StoryboardDoc,
  type StoryboardEpisode,
  type StoryboardShot,
} from './storyboard'

/**
 * **漫剧工作台 · 用模型拆这一集的分镜**（对账 #414，#382 后段第一步）。
 *
 * 三件事分开、各管一段（调研稿 §6.2 的「先 JSON、再校验、后落库」）：
 *
 * 1. **提示词**：系统指令 = 内置技能 `assets/builtin-skills/storyboard-breakdown.md` 的正文
 *    （单一来源，改技能即改行为）**+** 一段机器可读的输出契约；用户正文 = 这一集的标题 / 梗概 / 剧本。
 * 2. **解析与校验**：模型回什么都要过 `parseBreakdownReply` —— 代码块、前后夹解释都能容忍；
 *    但**形状不对、一条可用镜头都没有时一律判失败**，绝不"猜着填"（那会把幻觉写进用户的片子）。
 * 3. **落库**：`replaceEpisodeShots` 只换这一集，别的集一个不动；顺序仍走 `normalizeShotOrder`。
 *
 * 为什么这一层是纯函数：它决定"什么东西能进用户的分镜表"，是这条链路里最该被单测钉死的部分。
 */

/** 内置技能 id（`state/project/builtinSkillCatalog.ts` 用 `builtin:<文件名>` 生成） */
export const BREAKDOWN_SKILL_ID = 'builtin:storyboard-breakdown'

/**
 * 契约里的识别标记。
 *
 * 它进的是**真实提示词**（不是测试专用字符串），同时被离线 mock 用来认出"这一问是拆镜"——
 * 与「人脸外接框」那条同一种手法：假数据的保真度决定断言的上限。
 */
export const BREAKDOWN_MARKER = '【分镜拆解】'

/** 一次最多收多少镜（超出截断：宁可少收，也不让一次误回复把项目塞爆） */
export const MAX_SHOT_DRAFTS = 40

/** 单镜时长上限（秒）。调研稿 §3.5 的口径：单段视频 4–15 秒，这里按整秒收 */
export const MAX_SHOT_SECONDS = 15

/** 模型没回来时用的兜底系统指令（正常情况下内置技能一定在） */
const FALLBACK_SYSTEM = '你是一名短片分镜导演。请把用户给出的剧情拆成可执行的分镜列表。'

/**
 * **输出契约**（附在技能正文之后，模型的最后一条指令）。
 *
 * 为什么必须显式写契约：技能正文是给"人 + 模型"看的散文（「每个镜头输出：镜号、景别…」），
 * 而我们要的是**能落库的结构**。让模型在散文之后看到一段确定的结构要求，
 * 比让解析器去猜散文的排版可靠得多。
 */
const CONTRACT = `${BREAKDOWN_MARKER}输出契约（必须严格遵守）

1. 只输出一个 JSON 对象，不要解释、不要客套；可以用 \`\`\`json 代码块包住。
2. 结构固定为：
   {"characters":[{"name":"角色名","aliases":["别的叫法"],"description":"外观 / 身份"}],
    "scenes":[{"name":"场景名","aliases":[],"description":"场地与氛围"}],
    "shots":[{"scene":"画面内容","dialogue":"台词或旁白","durationSec":3,"prompt":"给生图模型的画面提示词","characterNames":["出场角色名"],"locationNames":["这一镜发生在哪"]}]}
3. scene 必填且非空（这一镜画什么）；dialogue 没有就填空字符串；durationSec 取 1-15 的整数；prompt 留空即表示用 scene。
4. **同一个角色的不同叫法必须合成一条**：写进 characters 时用最正式的名字当 name，其余叫法进 aliases —— 别把同一个人拆成两条。
5. characters / scenes 只声明剧情里明确出现的，没把握的不要编（用户会在资产库里改）。\`characterNames\` / \`locationNames\` 里写的名字要与它们一致。
6. 镜头数量按内容决定，别为凑数把节奏拆碎；最多 ${MAX_SHOT_DRAFTS} 个。`

/** 组装系统指令：技能正文在前、契约在后（最后一条指令才管得住输出形状） */
export function buildBreakdownSystem(skillBody?: string): string {
  const body = (skillBody ?? '').trim()
  return `${body || FALLBACK_SYSTEM}\n\n${CONTRACT}`
}

/**
 * 拆镜用的**用户正文**：这一集是什么 + 剧本。
 *
 * 只带这一集的信息（标题 / 梗概）与剧本正文，不带别的集：模型拿到越多无关剧情，
 * 越容易把别集的角色写进这一镜。
 */
export function breakdownText(doc: StoryboardDoc, episode: StoryboardEpisode): string {
  const lines = [`这一集：${episode.title || '未命名一集'}`]
  if (episode.summary.trim()) lines.push(`本集梗概：${episode.summary.trim()}`)
  if (episode.hookOpen?.trim()) lines.push(`开场钩子：${episode.hookOpen.trim()}`)
  if (episode.hookEnd?.trim()) lines.push(`结尾钩子：${episode.hookEnd.trim()}`)
  /**
   * 素材优先级：**这一集的原文**（拆集给的范围）> 剧本正文。
   * 拆过集的片子必须只看自己那一段 —— 拿全篇去拆某一集，模型会把别集的角色写进来。
   */
  const source = episodeSourceText(doc, episode).trim()
  if (source) {
    lines.push(`原文（这一集对应的那一段）：\n${source}`)
  } else {
    const body = doc.script.body.trim()
    lines.push(body ? `剧本：\n${body}` : '剧本：\n（用户没有写剧本正文，只有上面这一条梗概。）')
  }
  return lines.join('\n')
}

/** 点击「拆解」之前的守卫：返回不能拆的原因，或 null（可以拆） */
export function breakdownGuard(doc: StoryboardDoc, episode: StoryboardEpisode | null): string | null {
  if (!episode) return '先加一集，再拆这一集的分镜'
  const hasSource = episodeSourceText(doc, episode).trim().length > 0
  if (!hasSource && !doc.script.body.trim() && !episode.summary.trim()) {
    return '这一集还没有内容可拆：先在左边写原文 / 剧本正文，或在这一集写「这一集要讲什么」'
  }
  return null
}

/** 一轮镜头（还没进文档）——解析结果的形状 */
export interface DraftShot {
  scene: string
  dialogue: string
  durationSec: number
  prompt: string
  /** 这一镜有哪些角色出场（模型给的**名字**；落库前按别名归并成 id，对账 #416） */
  characterNames?: readonly string[]
  /** 这一镜发生在哪（同一镜取第一个当场景，其余名字仍进场景库） */
  locationNames?: readonly string[]
}

export type BreakdownParse =
  | {
      ok: true
      shots: DraftShot[]
      /** 模型声明的角色（带别名与描述；可选：只回 shots 的模型照样能用） */
      characters: DraftAsset[]
      scenes: DraftAsset[]
    }
  | { ok: false; error: string }

/**
 * 容错挖 JSON 的实现搬到了 `jsonBlock.ts`（拆集 #417 也要用它，那边 import 这份）。
 * 这里**原样再导出**：既有调用方与单测的 import 路径零改动。
 */
export { extractJsonBlock } from '../shared/jsonBlock'

const asText = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** 名字数组：只留非空字符串、去重（顺序保留 —— 第一个地点要当这一镜的场景） */
const asNames = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.map((x) => asText(x)).filter(Boolean))] : []

/** 模型声明的资产清单：缺 name 的整条丢掉，别名去掉与正式名重复的那一条 */
function asDraftAssets(v: unknown): DraftAsset[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const name = asText(row.name)
    if (!name) return []
    const aliases = asNames(row.aliases).filter((a) => a !== name)
    const description = asText(row.description)
    return [
      { name, ...(aliases.length > 0 ? { aliases } : {}), ...(description ? { description } : {}) },
    ]
  })
}

function asDuration(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : Number.NaN
  if (!Number.isFinite(n)) return DEFAULT_SHOT_SECONDS
  return Math.min(MAX_SHOT_SECONDS, Math.max(1, Math.round(n)))
}

/**
 * **校验 + 归一化**：模型回复 → 一轮可落库的镜头。
 *
 * 三条判据，缺一条就算失败（失败时**什么都不写**）：
 * ① 挖得出 JSON；② 有 `shots` 数组（或直接是数组）；③ 至少有一条**有画面描述**的镜头。
 * 单条坏镜头（缺 scene）只丢那一条 —— 那属于"模型少写了一格"，整批丢掉会让用户白等一次请求。
 */
export function parseBreakdownReply(raw: string): BreakdownParse {
  if (!(raw ?? '').trim()) return { ok: false, error: '模型没有返回内容，稍后再试' }
  const json = extractJsonBlock(raw)
  if (json === null) return { ok: false, error: '模型没有按契约返回 JSON（回复里找不到可解析的对象），这次没有写入任何分镜' }
  const list = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as { shots?: unknown }).shots)
      ? ((json as { shots: unknown[] }).shots)
      : null
  if (!list) return { ok: false, error: '模型返回的 JSON 里没有 shots 数组，这次没有写入任何分镜' }
  const shots: DraftShot[] = []
  for (const item of list) {
    if (shots.length >= MAX_SHOT_DRAFTS) break
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const scene = asText(row.scene)
    if (!scene) continue
    const characterNames = asNames(row.characterNames ?? row.characters)
    const locationNames = asNames(row.locationNames ?? row.locations)
    shots.push({
      scene,
      dialogue: asText(row.dialogue),
      durationSec: asDuration(row.durationSec),
      prompt: asText(row.prompt),
      /* 空数组不落成字段：没有就是没有（与文档层同一条纪律） */
      ...(characterNames.length > 0 ? { characterNames } : {}),
      ...(locationNames.length > 0 ? { locationNames } : {}),
    })
  }
  if (shots.length === 0) {
    return { ok: false, error: '模型给出的镜头里没有可用的画面描述，这次没有写入任何分镜' }
  }
  /**
   * 资产清单与镜头一起回（对账 #416）。缺了就当空数组 —— 只回 shots 的模型照跑，
   * 资产库靠镜头里的名字兜出来（`extractAssets` 会补最小资产）。
   */
  const container = Array.isArray(json) ? {} : (json as Record<string, unknown>)
  return {
    ok: true,
    shots,
    characters: asDraftAssets(container.characters),
    scenes: asDraftAssets(container.scenes),
  }
}

/**
 * 一轮镜头 → 这一集的真镜头（补 id / episodeId；prompt 空由 `shotPrompt` 回落 scene）。
 *
 * 第三个参数是**归并之后的资产库**：模型给的是名字，落库要的是 id ——
 * 这一步把名字按 `name + aliases` 翻成 id（认不出来的名字不硬编，绑定留空）。
 */
export function shotsFromDraft(
  drafts: readonly DraftShot[],
  episodeId: string,
  assets: { characters: readonly DramaCharacter[]; scenes: readonly DramaScene[] } = {
    characters: [],
    scenes: [],
  },
): StoryboardShot[] {
  return drafts.map((d) => {
    const bindings = resolveDraftBindings(
      { characterNames: d.characterNames ?? [], locationNames: d.locationNames ?? [] },
      assets.characters,
      assets.scenes,
    )
    return {
      id: createId('shot'),
      episodeId,
      scene: d.scene,
      dialogue: d.dialogue,
      durationSec: d.durationSec,
      prompt: d.prompt,
      ...bindings,
    }
  })
}

/**
 * **拆镜 + 资产提取一次做完**（对账 #416）：模型回的那一份 →
 * 「资产库（归并后）+ 这一集的镜头（名字已翻成 id）」。
 *
 * 收成一个纯函数的原因：页面只该做"调模型 / 落库 / 报状态"，归并与绑定的规则
 * 必须能在 node 下单测 —— `assets.test.ts` 已经把那条规则钉死了。
 */
export function buildBreakdownResult(
  base: StoryboardDoc,
  episodeId: string,
  parsed: {
    shots: readonly DraftShot[]
    characters: readonly DraftAsset[]
    scenes: readonly DraftAsset[]
  },
): { doc: StoryboardDoc; shots: StoryboardShot[] } {
  const merged = extractAssets({
    /* 只把"名字"那一层喂给抽取：`extractAssets` 与范围无关（一集 / 全篇同一份逻辑） */
    shots: parsed.shots.map((s) => ({
      characterNames: s.characterNames ?? [],
      locationNames: s.locationNames ?? [],
    })),
    characters: parsed.characters,
    scenes: parsed.scenes,
    existingCharacters: base.characters,
    existingScenes: base.scenes,
  })
  return {
    doc: { ...base, characters: merged.characters, scenes: merged.scenes },
    shots: shotsFromDraft(parsed.shots, episodeId, merged),
  }
}

/**
 * **替换**这一集的镜头（别的集一个不动）。
 *
 * 为什么是替换而不是追加：用户点「拆这一集」的语义是"按现在这份剧情重新拆一遍"。
 * 追加会把上一版留在下面，用户还得分不清哪些是这次的 —— 所以页面用**两下确认**
 * 把"会覆盖"这件事说在前面（`data-storyboard-breakdown-run` 的第二次点击才真跑）。
 */
export function replaceEpisodeShots(
  doc: StoryboardDoc,
  episodeId: string,
  shots: readonly StoryboardShot[],
  now = 0,
): StoryboardDoc {
  const kept = doc.shots.filter((s) => s.episodeId !== episodeId)
  const merged = { ...doc, shots: [...kept, ...shots] }
  return { ...doc, shots: normalizeShotOrder(merged), updatedAt: now }
}

/**
 * **原路径保留**：拆镜这边一直从 `breakdown` 里 import 它。
 * 实现与类型在 `domain/shared/chatTarget.ts`（对账 #422 起电商也要用，故上移）。
 */
export { resolveChatTarget, type ChatTarget }
