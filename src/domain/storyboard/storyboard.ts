import { createId } from '../../shared/id'

/**
 * **漫剧工作台 · 第一阶段**的领域模型（对账 #382 / 调研稿 §4.4）。
 *
 * 形态：**剧本 → 分集 → 分镜**，每镜带四个字段 —— 画面描述（喂生图）/ 台词 / 时长 / 画面提示词。
 *
 * 三条刻意定下来的事：
 *
 * 1. **先整对象存一行**（一张 `storyboards` 表、id = projectId）。形态还没固化 ——
 *    历史 comic 工作台的记录写着"形态未定时不拆表，先整对象存一行"，等这个形态被用起来
 *    再决定要不要拆列；现在拆表只会让每次调整字段都变成一次迁移。
 * 2. **纯函数**：所有编辑都"进旧 doc、出 new doc"，不碰 storage / React。
 *    于是每一条规则都能在 node 下单测（本文件下面的测试就是干这个的）。
 * 3. **只做前段**：这一阶段**不**碰视频。分镜的提示词与画面描述是给"生图"用的，
 *    逐镜视频要等视频模型参数补齐（#120）再说 —— 调研稿 §4.4 明确否定过"现在做全流程"。
 */

export interface StoryboardScript {
  title: string
  /** 一句话故事（列表里显示这一条，不进提示词） */
  logline: string
  /** 剧本正文（自由文本；分镜从这里拆） */
  body: string
}

/**
 * **资产**（角色 / 场景，对账 #416；调研稿 §6.1 / §6.3）。
 *
 * 形态刻意与调研一致：`name` + `aliases[]` + `description`。
 *
 * - **放项目级、不放集级**：同一角色在第 1 集和第 30 集必须是同一个对象
 *   （Autodesk Flow 那条共识，调研稿 §6.1 的取舍表）。
 * - `aliases` 是**归并的抓手**：「林轩 / 林公子」是同一个人的两种叫法，
 *   抽取结果按它去重（调研稿 §6.3 第 2 条）。
 * - `description` 是**一致性的物理来源**：以后接参考图 / 定妆图时，
 *   这一段会拼进提示词（本批还不生成，别把它当成"已经用上了"）。
 */
export interface DramaAsset {
  id: string
  name: string
  description: string
  aliases: string[]
  /**
   * 这一条资产在画布上的**生成节点 id**（对账 #419）：定妆图 / 基准图就是用它跑的。
   *
   * 与镜头上的 `nodeId` 同一条纪律：它是**缓存不是真相** —— 节点被用户在画布上删掉后，
   * 拿它去节点表里找不到，就当作"还没做过基准图"（界面据此允许重新做）。
   */
  nodeId?: string
  /**
   * **角色定妆图 / 场景基准图**的素材 hash（同一个字段两种叫法，对账 #419）。
   *
   * 为什么一个字段就够：角色与场景在这一层是同一类东西（名字 + 别名 + 描述 + 一张基准图），
   * 拆成两个字段只会让每条读写逻辑各写两遍 —— 差异在**提示词**里（`assetBasePrompt`），
   * 不在数据形状里。
   */
  baseHash?: string
  /** 多视角 turnaround 的生成节点 id（角色专用；与 base 节点分开，互不顶图） */
  turnaroundNodeId?: string
  /** 多视角 turnaround 产物的素材 hash */
  turnaroundHash?: string
}

export type DramaCharacter = DramaAsset
export type DramaScene = DramaAsset

/**
 * 一镜里的**一句台词**（对账 #435）。
 *
 * 三个字段各自有明确用途，一个都不许多余：
 * - `speakerId`：谁说的（引用角色库；**空 = 没说清** —— 旁白、画外音、或者用户还没点）。
 *   刻意不做"按名字猜"：猜错会让字幕挂到别人身上，比空着更糟。
 * - `text`：那句话本身。
 * - `emotion`：情绪提示（研究稿 §323：`供 TTS / 表演`）。**初级只存不消费** ——
 *   现在不拼进任何提示词，也不许在界面上假装它起作用了。
 */
export interface StoryboardLine {
  id: string
  speakerId?: string
  text: string
  emotion?: string
  /** 配音音色 id；空 = 使用当前配音渠道的默认音色 */
  voice?: string
  /** 语速 0.25..4；空 = 1 */
  speed?: number
  /** TTS 产物素材 hash（只存引用，字节在 assets） */
  audioHash?: string
  /** 用户可读的音频名；hash 不可读，界面与导出显示它 */
  audioName?: string
}

export interface StoryboardEpisode {
  id: string
  title: string
  summary: string
  /**
   * 这一集对应**原文的哪一段**（`sourceText` 的字符区间，左闭右开）。
   *
   * 拆集（#417）时写上：它既是"用户校对 LLM 产出的唯一抓手"（调研稿 §6.1 取舍表），
   * 也是拆镜时喂给模型的**准确输入**（比整个剧本正文准得多）。
   * 手写的集没有它 —— 那就回落剧本正文，两条路都留着。
   */
  sourceRange?: { from: number; to: number }
  /** 开场钩子（一句话；调研稿 §3.1 说的"合理的集"的可操作定义） */
  hookOpen?: string
  /** 结尾钩子（同上） */
  hookEnd?: string
  /** 这一集使用的背景音乐素材 hash（只存引用，字节在 assets 表） */
  bgmHash?: string
  /** 用户可读的音频原名；hash 不可读，界面与合成包要显示它 */
  bgmName?: string
  /** 0..1；只在有 bgmHash 时有意义，默认 0.2 */
  bgmVolume?: number
}

export const DEFAULT_BGM_VOLUME = 0.2

export interface StoryboardShot {
  id: string
  episodeId: string
  /** 画面描述：这一镜**画什么**（生图提示词的素材） */
  scene: string
  /**
   * **对白层**（对账 #435；《轻画-漫剧形态调研.md》§34 / §468 的建议 (a)）。
   *
   * 为什么对白要**独立于画面**（ACBF 那条洞见在这里升级成必需）：
   * 图会被反复重生成，台词不该跟着重打一遍；而"这一句谁说的"只有独立出来才存得下 ——
   * 它是**压字幕**与**将来喂 TTS**的共同前置（研究稿 §34 原话：导出 SRT 供 TTS / 口型）。
   *
   * 一镜可以有好几句（两个人对着说话就是两条），也可以是空镜（`[]`）。
   * 老数据里的 `dialogue: string` 在**读回时迁移成一句**，一个字都不丢（见 `parseShotLines`）。
   */
  lines: StoryboardLine[]
  /** 这一镜预计几秒（成片节奏的粗排；导出表里带上） */
  durationSec: number
  /** 画面提示词：留空就由 `scene` 派生（`shotPrompt`） */
  prompt: string
  /**
   * 视频提示词：专门写运镜、动作、表情与节奏。
   *
   * 留空时仍以画面提示词为基准，并追加一条最小“自然镜头运动”约束；
   * 它不能替代静态画面提示词（人物 / 场景一致性仍来自后者与资产块）。
   */
  videoPrompt?: string
  /**
   * 这一镜发生在哪个场景（引用 `scenes[].id`）。
   *
   * 空 = 还没定。**读回时会丢掉悬空引用**（见 `parseStoryboard`）——
   * 与"丢孤儿镜头"同一条纪律：悬空 id 在界面上看不见、导出里却会冒出来。
   */
  sceneId?: string
  /** 这一镜有哪些角色出场（引用 `characters[].id`，同一 id 不重复） */
  characterIds?: string[]
  /**
   * 这一镜在画布上的**生成节点 id**（对账 #415，「铺到画布」时写回）。
   *
   * ⚠️ 它是**缓存不是真相**：节点可能已经在画布上被用户删掉，这个字段就成了悬空引用。
   * 所以「要不要铺」不只看它有没有值，而是拿它去画布的节点表里找存在性
   * （见 `shotsNeedingNode`）；悬空的那一镜会被重新铺一次。
   */
  nodeId?: string
  /**
   * 这一镜出图后的**素材 hash**（引擎把产物写回节点后，页面把它镜像到这里）。
   *
   * 为什么要镜像：导出分镜表、列表缩略图、以后接视频都要读它，
   * 而这些地方不该各自去画布里翻节点（那是两套真相）。真相仍在画布的节点上，
   * 这里只是**同一个项目内的一致副本**，节点被替换时会一起清掉（见 `attachShotNodes`）。
   */
  imageHash?: string
  /**
   * 这一镜的**视频节点 id**（对账 #429，「这一镜出视频」时写上）。
   *
   * 为什么视频**另起一个节点**、而不是像出图那样写回同一个：写回会把这一镜的
   * **图**顶掉，而图还得留着 —— 它既是视频的输入，也是分镜表里的画面。
   *
   * 与 `nodeId` 同一条纪律：**缓存不是真相**。节点可能已被用户删掉，
   * 所以"要不要重出视频"要看它在不在画布的节点表里，不能只看这个字段有没有值。
   */
  videoNodeId?: string
  /**
   * 首尾帧模式下作为**尾帧**的下一镜图片节点。
   *
   * 只记录“我们自己接的那条边”：重出视频时若下一镜换了节点 / 图片，
   * 页面据此先断开旧尾帧，再连接新尾帧；用户手工接的其它参考图不动。
   * 空 = 这一镜只用单张首帧（图生视频）。
   */
  videoEndNodeId?: string
  /** 这一镜视频产物的素材 hash（与 `imageHash` 同一套镜像纪律；换视频节点时清掉） */
  videoHash?: string
}

export interface StoryboardDoc {
  projectId: string
  /**
   * **原文**（小说 / 大纲，粘贴进来的那一份）：拆集（#417）的输入。
   *
   * 与 `script.body` 的分工：这个是"素材原文"，`script.body` 是"剧本"。
   * 调研稿 §9 的开放问题 #7（是否落库）这里按 (a) 办 —— 存，代价是体积，
   * 换到的是**能重跑拆集**与"点分镜看原文"的能力（后者还没做）。
   */
  sourceText: string
  script: StoryboardScript
  /** 角色库（项目级、跨集复用） */
  characters: DramaCharacter[]
  /** 场景库（同上；场景是**资产不是容器**，调研稿 §6.1） */
  scenes: DramaScene[]
  episodes: StoryboardEpisode[]
  shots: StoryboardShot[]
  /**
   * 用户说过"**不是同一个**"的那些资产对（对账 #437）——键是 `pairKey`（与顺序无关）。
   *
   * 存下来的唯一目的：**同一对不再问第二次**（同一个错误提示反复冒出来，
   * 用户最后会把整个入口忽略掉）。读回时按**现存的** id 过滤：
   * 资产删掉之后那些键就没有意义了。
   */
  mergeDismissals?: string[]
  updatedAt: number
}

/** 新片的空文档（新建漫剧项目时用它） */
export function emptyStoryboard(projectId: string, now = 0): StoryboardDoc {
  return {
    projectId,
    sourceText: '',
    script: { title: '未命名漫剧', logline: '', body: '' },
    characters: [],
    scenes: [],
    episodes: [],
    shots: [],
    updatedAt: now,
  }
}

const text = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/** 一镜的对白层读回（含**老数据的迁移**）—— 见 `StoryboardShot.lines` 与 `StoryboardLine` */
function parseShotLines(row: Record<string, unknown>, knownCharacters: ReadonlySet<string>): StoryboardLine[] {
  const raw = Array.isArray(row.lines) ? row.lines : []
  const lines: StoryboardLine[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = text(record.id)
    const body = text(record.text).trim()
    /** 没 id 或没正文的整条丢掉：一句空台词在字幕里就是一个空行 */
    if (!id || !body) continue
    /** 悬空说话人一律丢掉（与 `sceneId` 同一条纪律：界面上看不见、导出里却会冒出来） */
    const speakerRaw = text(record.speakerId)
    const speakerId = speakerRaw && knownCharacters.has(speakerRaw) ? speakerRaw : ''
    const emotion = text(record.emotion).trim()
    const voice = text(record.voice).trim()
    const speed = clampSpeechSpeed(record.speed, 1)
    const audioHash = text(record.audioHash).trim()
    const audioName = text(record.audioName).trim()
    lines.push({
      id,
      text: body,
      ...(speakerId ? { speakerId } : {}),
      ...(emotion ? { emotion } : {}),
      ...(voice ? { voice } : {}),
      ...(speed !== 1 ? { speed } : {}),
      ...(audioHash
        ? {
            audioHash,
            ...(audioName ? { audioName } : {}),
          }
        : {}),
    })
  }
  if (lines.length > 0) return lines
  /**
   * **迁移**：老文档里只有 `dialogue: string`。
   * id 用 `legacy-1` 而不是 `createId()`——**读回要保持幂等**：每次读都生成新 id 的话，
   * 用户任何一次编辑都会把这一镜的 line id 换掉（而它正是将来配音要对齐的键）。
   */
  const legacy = text(row.dialogue).trim()
  return legacy ? [{ id: 'legacy-1', text: legacy }] : []
}

/**
 * **脏数据容错读回**（与外观 / 通知偏好同一条规矩：只补坏的那一项，不整份丢弃）。
 *
 * 另外**丢掉孤儿镜头**（`episodeId` 指向不存在的集）：留着它们会在导出里凭空多出几行，
 * 而界面上根本看不到 —— 那比丢掉更难查。
 */
/** 资产数组的容错读回（缺 id / 缺 name 的整条丢掉；别名只留非空字符串、去重） */
function parseAssetList(raw: unknown): DramaAsset[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((a) => {
    if (!a || typeof a !== 'object') return []
    const row = a as Record<string, unknown>
    const id = text(row.id)
    const name = text(row.name)
    if (!id || !name) return []
    const aliases = Array.isArray(row.aliases)
      ? [...new Set(row.aliases.map((v) => text(v)).filter((v) => v && v !== name))]
      : []
    const nodeId = text(row.nodeId)
    const baseHash = text(row.baseHash)
    const turnaroundNodeId = text(row.turnaroundNodeId)
    const turnaroundHash = text(row.turnaroundHash)
    return [
      {
        id,
        name,
        description: text(row.description),
        aliases,
        ...(nodeId ? { nodeId } : {}),
        ...(baseHash ? { baseHash } : {}),
        ...(turnaroundNodeId ? { turnaroundNodeId } : {}),
        ...(turnaroundHash ? { turnaroundHash } : {}),
      },
    ]
  })
}

export function parseStoryboard(raw: unknown, projectId: string): StoryboardDoc {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const scriptRaw = o.script && typeof o.script === 'object' ? (o.script as Record<string, unknown>) : {}
  const characters = parseAssetList(o.characters)
  const scenes = parseAssetList(o.scenes)
  const knownCharacters = new Set(characters.map((c) => c.id))
  const knownScenes = new Set(scenes.map((s) => s.id))
  const episodes: StoryboardEpisode[] = (Array.isArray(o.episodes) ? o.episodes : []).flatMap((e) => {
    if (!e || typeof e !== 'object') return []
    const row = e as Record<string, unknown>
    const id = text(row.id)
    if (!id) return []
    const hookOpen = text(row.hookOpen)
    const hookEnd = text(row.hookEnd)
    const bgmHash = text(row.bgmHash)
    const bgmName = text(row.bgmName)
    const bgmVolume = clampVolume(row.bgmVolume)
    /** 原文范围：两个数、且 from < to 才认（脏数据当没有，不做"猜个范围"） */
    const rangeRaw = row.sourceRange && typeof row.sourceRange === 'object' ? (row.sourceRange as Record<string, unknown>) : null
    const from = rangeRaw ? num(rangeRaw.from, -1) : -1
    const to = rangeRaw ? num(rangeRaw.to, -1) : -1
    return [
      {
        id,
        title: text(row.title) || '未命名一集',
        summary: text(row.summary),
        ...(from >= 0 && to > from ? { sourceRange: { from, to } } : {}),
        ...(hookOpen ? { hookOpen } : {}),
        ...(hookEnd ? { hookEnd } : {}),
        ...(bgmHash
          ? {
              bgmHash,
              ...(bgmName ? { bgmName } : {}),
              bgmVolume,
            }
          : {}),
      },
    ]
  })
  const known = new Set(episodes.map((e) => e.id))
  const shots: StoryboardShot[] = (Array.isArray(o.shots) ? o.shots : []).flatMap((s) => {
    if (!s || typeof s !== 'object') return []
    const row = s as Record<string, unknown>
    const id = text(row.id)
    const episodeId = text(row.episodeId)
    if (!id || !known.has(episodeId)) return []
    const nodeId = text(row.nodeId)
    const imageHash = text(row.imageHash)
    const videoNodeId = text(row.videoNodeId)
    const videoEndNodeId = text(row.videoEndNodeId)
    const videoHash = text(row.videoHash)
    /** 悬空引用一律丢掉（手改过的备份 / 删过资产的老数据都可能留） */
    const sceneIdRaw = text(row.sceneId)
    const sceneId = sceneIdRaw && knownScenes.has(sceneIdRaw) ? sceneIdRaw : ''
    const characterRefs = Array.isArray(row.characterIds)
      ? [
          ...new Set(
            row.characterIds.map((v) => text(v)).filter((v) => v && knownCharacters.has(v)),
          ),
        ]
      : []
    return [
      {
        id,
        episodeId,
        scene: text(row.scene),
        lines: parseShotLines(row, knownCharacters),
        durationSec: num(row.durationSec, DEFAULT_SHOT_SECONDS),
        prompt: text(row.prompt),
        ...(text(row.videoPrompt).trim() ? { videoPrompt: text(row.videoPrompt).trim() } : {}),
        /* 空串不落成字段：没有就是没有，别写一个 `undefined` 占位 */
        ...(nodeId ? { nodeId } : {}),
        ...(imageHash ? { imageHash } : {}),
        ...(videoNodeId ? { videoNodeId } : {}),
        ...(videoEndNodeId ? { videoEndNodeId } : {}),
        ...(videoHash ? { videoHash } : {}),
        ...(sceneId ? { sceneId } : {}),
        ...(characterRefs.length > 0 ? { characterIds: characterRefs } : {}),
      },
    ]
  })
  const doc: StoryboardDoc = {
    projectId,
    sourceText: text(o.sourceText),
    script: {
      title: text(scriptRaw.title) || '未命名漫剧',
      logline: text(scriptRaw.logline),
      body: text(scriptRaw.body),
    },
    characters,
    scenes,
    episodes,
    shots,
    /* "不是同一个"那些键按**现存的 id** 过滤：资产删掉之后那些键就没有意义了 */
    ...(() => {
      const alive = new Set([...characters, ...scenes].map((a) => a.id))
      const pairs = Array.isArray(o.mergeDismissals)
        ? [
            ...new Set(
              o.mergeDismissals
                .map((v) => text(v))
                .filter((v) => {
                  const [a, b] = v.split('|')
                  return !!a && !!b && alive.has(a) && alive.has(b)
                }),
            ),
          ]
        : []
      return pairs.length > 0 ? { mergeDismissals: pairs } : {}
    })(),
    updatedAt: num(o.updatedAt, 0),
  }
  /** 读回时就顺手把"按集分组"整一遍（老数据 / 手改过的备份都可能乱序） */
  return { ...doc, shots: normalizeShotOrder(doc) }
}

/** 一镜的默认时长（秒）：短视频里最常用的那个档，用户改就是了 */
export const DEFAULT_SHOT_SECONDS = 3

/**
 * 一对资产的**去重键**（对账 #437）：与顺序无关（`a|b` 与 `b|a` 是同一个键）。
 *
 * 放在这一层而不是 `mergeSuggest.ts`：这个键是**文档里的数据**（`mergeDismissals`），
 * 读写它的两边都得用同一份规则；放在上层会让 storyboard 反过来 import 它（循环）。
 */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * 记下"这两条**不是同一个**"（对账 #437）：以后不再把它们提成候选。
 *
 * 只认**同类且都存在**的两条 id（键里不存类别，跨类的对子本来就不该出现）；
 * 已经记过就返回原引用（别搅动防抖保存）。
 */
export function dismissMerge(
  doc: StoryboardDoc,
  kind: AssetKind,
  a: string,
  b: string,
  now = 0,
): StoryboardDoc {
  const list = kind === 'char' ? doc.characters : doc.scenes
  if (a === b || !list.some((x) => x.id === a) || !list.some((x) => x.id === b)) return doc
  const key = pairKey(a, b)
  const current = doc.mergeDismissals ?? []
  if (current.includes(key)) return doc
  return { ...doc, mergeDismissals: [...current, key], updatedAt: now }
}

/**
 * **把镜头按"集顺序 + 集内原有顺序"整一遍**（稳定排序）。
 *
 * 为什么要它：镜头顺序就是播放顺序，而编辑动作会在不同位置插入（新增、换集、导入）。
 * 与其在每个入口各算一次"该插在第几位"，不如**只在这里定一次口径**：
 * 集顺序决定大块，块内保持原有先后。这样"往一个还没有镜头的集里加一镜"也不会跑到片头去。
 */
export function normalizeShotOrder(doc: StoryboardDoc): StoryboardShot[] {
  const order = new Map(doc.episodes.map((e, index) => [e.id, index]))
  return doc.shots
    .map((shot, index) => ({ shot, index }))
    .sort((a, b) => {
      const ea = order.get(a.shot.episodeId) ?? Number.MAX_SAFE_INTEGER
      const eb = order.get(b.shot.episodeId) ?? Number.MAX_SAFE_INTEGER
      return ea === eb ? a.index - b.index : ea - eb
    })
    .map((entry) => entry.shot)
}

/** 一镜的提示词：留空由画面描述派生（"画面描述即提示词"是最省事的默认） */
export function shotPrompt(shot: StoryboardShot): string {
  return shot.prompt.trim() || shot.scene.trim()
}

/**
 * **资产设定块的抬头**（对账 #418）。
 *
 * 为什么要这句"不要画进画面"：块里是「场景「雨夜街道」：霓虹、积水」这种带标签的文字，
 * 而图生模型对"带冒号的短句"很敏感 —— 不声明一句，它可能真的把标签画进图里。
 * 这是业界常用的写法（把设定说成"说明"而不是"要画的字"），不是我们自创的花活。
 */
export const ASSET_BLOCK_HEADER =
  '保持以下角色与场景的设定在整部片里一致；这些文字只是设定说明，不要画进画面：'

/** 这一镜绑定的场景与角色（角色按**库里的顺序**，保证同一份数据每次拼出来一样） */
export function assetsOfShot(
  doc: StoryboardDoc,
  shot: StoryboardShot,
): { scene?: DramaScene; characters: DramaCharacter[] } {
  const scene = shot.sceneId ? doc.scenes.find((s) => s.id === shot.sceneId) : undefined
  const ids = new Set(shot.characterIds ?? [])
  return {
    ...(scene ? { scene } : {}),
    characters: ids.size > 0 ? doc.characters.filter((c) => ids.has(c.id)) : [],
  }
}

/**
 * **这一镜该接哪几张参考图**（对账 #430）。
 *
 * 这一条把 #419 的"定妆图 / 基准图"从**只显示**变成**真喂进生成**：镜头绑了角色 / 场景，
 * 那些资产的基准图节点就是这一镜的参考图 —— 连线即 `inputs`（G141 验过这条机制）。
 *
 * 三条口径：
 * 1. **有图才接**：资产还没出基准图（`baseHash` 空）就不接线 —— 接上去也送不出任何字节，
 *    只会在画布上拉一堆没有内容的线；
 * 2. **节点必须活着**：`nodeId` 是缓存不是真相（用户在画布上删过节点就不算），
 *    与 `shotsNeedingNode` 同一条纪律；
 * 3. **顺序固定**：场景在前、角色按库里的顺序 —— 同一份数据每次算出来一样，
 *    否则"改一个描述"会连带连线顺序都变。
 */
export function shotRefNodeIds(
  doc: StoryboardDoc,
  shot: StoryboardShot,
  liveNodeIds: ReadonlySet<string>,
): string[] {
  const { scene, characters } = assetsOfShot(doc, shot)
  const out: string[] = []
  const push = (asset: DramaAsset) => {
    if (!asset.baseHash || !asset.nodeId) return
    if (!liveNodeIds.has(asset.nodeId)) return
    if (out.includes(asset.nodeId)) return
    out.push(asset.nodeId)
  }
  if (scene) push(scene)
  for (const c of characters) push(c)
  return out
}

/**
 * 这一镜的参考图连线**该怎么改**（纯函数：只算出该接 / 该断的，不发命令）。
 *
 * 为什么要 `disconnect`（而不是只增不减）：把这一镜的角色从 A 换成 B 之后，
 * A 的定妆图那条线还留着 —— 请求里就会**同时喂 A 和 B**，而出图的用户完全不知道
 * 为什么画面里混着上一版的人。这是"同一个事实两个来源"的老毛病，必须在源头掐掉。
 *
 * **但只断"我们自己接的"**：源节点必须是本片某条资产（角色 / 场景）的基准图节点。
 * 用户手工连进来的别的东西（比如拉一张生成图当参考）一律不动 —— 那一份不是我们能替他决定的。
 */
export function planShotRefEdges(
  doc: StoryboardDoc,
  shot: StoryboardShot,
  incomingSources: readonly string[],
  liveNodeIds: ReadonlySet<string>,
): { connect: string[]; disconnect: string[] } {
  const wanted = new Set(shotRefNodeIds(doc, shot, liveNodeIds))
  const managed = new Set<string>()
  for (const asset of [...doc.characters, ...doc.scenes]) {
    if (asset.nodeId && liveNodeIds.has(asset.nodeId)) managed.add(asset.nodeId)
  }
  const incoming = new Set(incomingSources)
  return {
    connect: [...wanted].filter((id) => !incoming.has(id)),
    disconnect: [...incoming].filter((id) => managed.has(id) && !wanted.has(id)),
  }
}

/**
 * **真正会发给模型的提示词** = 这一镜自己的提示词 + 资产设定块（对账 #418）。
 *
 * 三条口径：
 * 1. **没绑定就一行都不加**：返回与 `shotPrompt` **逐字相同**的结果 ——
 *    手写分镜 / 旧项目的出图行为零变化。
 * 2. **描述为空只写名字**：名字也是信息（"这一镜里有骑手"），但不硬编一段描述。
 * 3. **顺序固定**：场景在前、角色按库里的顺序 —— 同一份数据每次拼出来一样，
 *    否则"改一个描述"会连带整段的顺序都变，diff 里看不出真正改了什么。
 */
export function shotPromptWithAssets(doc: StoryboardDoc, shot: StoryboardShot): string {
  const base = shotPrompt(shot)
  const { scene, characters } = assetsOfShot(doc, shot)
  const lines: string[] = []
  if (scene) {
    lines.push(`场景「${scene.name}」${scene.description.trim() ? `：${scene.description.trim()}` : ''}`)
  }
  for (const c of characters) {
    lines.push(`角色「${c.name}」${c.description.trim() ? `：${c.description.trim()}` : ''}`)
  }
  if (lines.length === 0) return base
  return `${base}\n\n${ASSET_BLOCK_HEADER}\n${lines.join('\n')}`
}

/**
 * 真正发给视频模型的提示词。
 *
 * 画面提示词回答“画面里有什么”，视频提示词回答“怎么动”。旧项目没有视频提示词时，
 * 不能直接把静帧提示词发过去就完事（模型通常只会做很小的漂移），所以补一条最小运动约束；
 * 有下一镜尾帧时再显式写清“从这一镜自然过渡到下一镜”，让首尾帧语义进入语言层。
 */
export function shotVideoPrompt(
  doc: StoryboardDoc,
  shot: StoryboardShot,
  nextShot?: StoryboardShot,
): string {
  const visual = shotPromptWithAssets(doc, shot)
  const motion = shot.videoPrompt?.trim()
  const lines = [motion ? `${motion}\n\n画面基准：${visual}` : visual]
  if (!motion) {
    lines.push('镜头运动：生成自然、连续的镜头运动，保持人物身份、服装、场景与光线一致。')
  }
  if (nextShot) {
    const nextScene = nextShot.scene.trim() || shotPrompt(nextShot)
    lines.push(
      `镜头衔接：从这一镜自然过渡到下一镜——${nextScene}。` +
        '动作、视线与运动方向要连续，避免突然跳变。',
    )
  }
  return lines.join('\n\n')
}

export function updateScript(
  doc: StoryboardDoc,
  patch: Partial<StoryboardScript>,
  now = 0,
): StoryboardDoc {
  return {
    ...doc,
    script: {
      title: text(patch.title, doc.script.title),
      logline: text(patch.logline, doc.script.logline),
      body: text(patch.body, doc.script.body),
    },
    updatedAt: now,
  }
}

/** 改原文（拆集 #417 的输入）；文本没变就返回**原引用**（调用方据此不做多余落库） */
export function updateSourceText(doc: StoryboardDoc, text: string, now = 0): StoryboardDoc {
  if (text === doc.sourceText) return doc
  return { ...doc, sourceText: text, updatedAt: now }
}

export function addEpisode(doc: StoryboardDoc, now = 0): StoryboardDoc {
  const episode: StoryboardEpisode = {
    id: createId('ep'),
    title: `第 ${doc.episodes.length + 1} 集`,
    summary: '',
  }
  return { ...doc, episodes: [...doc.episodes, episode], updatedAt: now }
}

export function updateEpisode(
  doc: StoryboardDoc,
  id: string,
  patch: Partial<
    Pick<
      StoryboardEpisode,
      'title' | 'summary' | 'hookOpen' | 'hookEnd' | 'bgmHash' | 'bgmName' | 'bgmVolume'
    >
  >,
  now = 0,
): StoryboardDoc {
  return {
    ...doc,
    episodes: doc.episodes.map((e) => {
      if (e.id !== id) return e
      const hookOpen = text(patch.hookOpen, e.hookOpen ?? '').trim()
      const hookEnd = text(patch.hookEnd, e.hookEnd ?? '').trim()
      const bgmHash = text(patch.bgmHash, e.bgmHash ?? '').trim()
      const bgmName = text(patch.bgmName, e.bgmName ?? '').trim()
      const bgmVolume = clampVolume(patch.bgmVolume, e.bgmVolume ?? DEFAULT_BGM_VOLUME)
      const next: StoryboardEpisode = {
        ...e,
        title: text(patch.title, e.title) || e.title,
        summary: text(patch.summary, e.summary),
      }
      /* 钩子清空就把字段删掉（与其它可选字段同一条纪律：空不落字段） */
      if (hookOpen) next.hookOpen = hookOpen
      else delete next.hookOpen
      if (hookEnd) next.hookEnd = hookEnd
      else delete next.hookEnd
      if (bgmHash) {
        next.bgmHash = bgmHash
        if (bgmName) next.bgmName = bgmName
        else delete next.bgmName
        next.bgmVolume = bgmVolume
      } else {
        delete next.bgmHash
        delete next.bgmName
        delete next.bgmVolume
      }
      return next
    }),
    updatedAt: now,
  }
}

function clampVolume(value: unknown, fallback = DEFAULT_BGM_VOLUME): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

/** 删一集**连它的镜头一起删**（否则那些镜头会变成孤儿，界面上再也看不到） */
export function removeEpisode(doc: StoryboardDoc, id: string, now = 0): StoryboardDoc {
  return {
    ...doc,
    episodes: doc.episodes.filter((e) => e.id !== id),
    shots: doc.shots.filter((s) => s.episodeId !== id),
    updatedAt: now,
  }
}

/** 上下移一集（`delta` 取 ±1；到边界就原样返回） */
export function moveEpisode(doc: StoryboardDoc, id: string, delta: number, now = 0): StoryboardDoc {
  const at = doc.episodes.findIndex((e) => e.id === id)
  const to = at + Math.sign(delta)
  if (at < 0 || to < 0 || to >= doc.episodes.length) return doc
  const next = doc.episodes.slice()
  const [item] = next.splice(at, 1)
  next.splice(to, 0, item!)
  return { ...doc, episodes: next, updatedAt: now }
}

export function addShot(doc: StoryboardDoc, episodeId: string, now = 0): StoryboardDoc {
  if (!doc.episodes.some((e) => e.id === episodeId)) return doc
  const shot: StoryboardShot = {
    id: createId('shot'),
    episodeId,
    scene: '',
    lines: [],
    durationSec: DEFAULT_SHOT_SECONDS,
    prompt: '',
  }
  /**
   * 先追加、再**按集分组整序**（`normalizeShotOrder`）：
   * 直接追加到数组末尾是"这一镜属于这一集"的最近位置，整序会把它挪到这一集的块尾；
   * 而"这一集还没有镜头"时也不会跑到片头去（那正是整序要解决的）。
   */
  return { ...doc, shots: normalizeShotOrder({ ...doc, shots: [...doc.shots, shot] }), updatedAt: now }
}

export function updateShot(
  doc: StoryboardDoc,
  id: string,
  /**
   * `lines` **刻意排除在外**：对白层有增 / 改 / 删三种动作，走下面那三个专属函数。
   * 放进这个通用 patch 里，就会出现"有人以为改了、其实被忽略"的静默失配。
   */
  patch: Partial<Omit<StoryboardShot, 'id' | 'episodeId' | 'lines'>>,
  now = 0,
): StoryboardDoc {
  return {
    ...doc,
    shots: doc.shots.map((s) =>
      s.id === id
        ? {
            ...s,
            scene: text(patch.scene, s.scene),
            durationSec: Math.max(1, Math.round(num(patch.durationSec, s.durationSec))),
            prompt: text(patch.prompt, s.prompt),
            videoPrompt: text(patch.videoPrompt, s.videoPrompt ?? ''),
            /* 对白层**不在这里改**：它有增删改三种动作，走 `addShotLine` / `updateShotLine` /
               `removeShotLine`（同一个函数里塞三种语义，迟早在某一路写错） */
          }
        : s,
    ),
    updatedAt: now,
  }
}

/** 一镜里那句话**谁说的**（角色名）；`speakerId` 空或找不到人时返回空串 */
function speakerNameOf(doc: StoryboardDoc, line: StoryboardLine): string {
  if (!line.speakerId) return ''
  return doc.characters.find((c) => c.id === line.speakerId)?.name ?? ''
}

/** 这一镜的对白（已解出说话人名字）—— 字幕 / 预览 / 导出三处共用这一份读法 */
export function shotDialogueLines(
  doc: StoryboardDoc,
  shot: StoryboardShot,
): {
  lineId: string
  speaker: string
  text: string
  voice?: string
  speed?: number
  audioHash?: string
}[] {
  return shot.lines.map((line) => ({
    lineId: line.id,
    speaker: speakerNameOf(doc, line),
    text: line.text,
    ...(line.voice ? { voice: line.voice } : {}),
    ...(line.speed !== undefined ? { speed: line.speed } : {}),
    ...(line.audioHash ? { audioHash: line.audioHash } : {}),
  }))
}

/** 一句话版本（导出分镜表那种一格里放不下多行的场合）：`骑手：今天最后一单 / 收货人：…` */
export function shotDialogueTextOf(doc: StoryboardDoc, shot: StoryboardShot): string {
  return shotDialogueLines(doc, shot)
    .map((line) => (line.speaker ? `${line.speaker}：${line.text}` : line.text))
    .join(' / ')
}

/** 加一句台词（默认空文本，用户接着打；也可以带预设说话人**用在拆镜导入那条路上**） */
export function addShotLine(
  doc: StoryboardDoc,
  shotId: string,
  preset: { speakerId?: string; text?: string } = {},
  now = 0,
): StoryboardDoc {
  const shot = doc.shots.find((s) => s.id === shotId)
  if (!shot) return doc
  const body = text(preset.text).trim()
  const speakerId = text(preset.speakerId)
  const line: StoryboardLine = {
    id: createId('line'),
    text: body,
    ...(speakerId && doc.characters.some((c) => c.id === speakerId) ? { speakerId } : {}),
  }
  return {
    ...doc,
    shots: doc.shots.map((s) => (s.id === shotId ? { ...s, lines: [...s.lines, line] } : s)),
    updatedAt: now,
  }
}

/** 改一句台词（说话人 / 正文 / 情绪）；**没有任何变化时返回原引用**（别搅动防抖保存） */
export function updateShotLine(
  doc: StoryboardDoc,
  shotId: string,
  lineId: string,
  patch: Partial<Omit<StoryboardLine, 'id'>>,
  now = 0,
): StoryboardDoc {
  let changed = false
  const shots = doc.shots.map((shot) => {
    if (shot.id !== shotId) return shot
    let shotChanged = false
    const lines = shot.lines.map((line) => {
      if (line.id !== lineId) return line
      const next: StoryboardLine = { ...line }
      if (patch.text !== undefined) {
        const body = text(patch.text).trim()
        if (body !== line.text) {
          next.text = body
          delete next.audioHash
          delete next.audioName
          shotChanged = true
        }
      }
      if (patch.speakerId !== undefined) {
        const raw = text(patch.speakerId)
        const speakerId = raw && doc.characters.some((c) => c.id === raw) ? raw : ''
        if ((line.speakerId ?? '') !== speakerId) {
          if (speakerId) next.speakerId = speakerId
          else delete next.speakerId
          shotChanged = true
        }
      }
      if (patch.emotion !== undefined) {
        const emotion = text(patch.emotion).trim()
        if ((line.emotion ?? '') !== emotion) {
          if (emotion) next.emotion = emotion
          else delete next.emotion
          shotChanged = true
        }
      }
      if (patch.voice !== undefined) {
        const voice = text(patch.voice).trim()
        if ((line.voice ?? '') !== voice) {
          if (voice) next.voice = voice
          else delete next.voice
          delete next.audioHash
          delete next.audioName
          shotChanged = true
        }
      }
      if (patch.speed !== undefined) {
        const speed = clampSpeechSpeed(patch.speed, line.speed ?? 1)
        if ((line.speed ?? 1) !== speed) {
          if (speed !== 1) next.speed = speed
          else delete next.speed
          delete next.audioHash
          delete next.audioName
          shotChanged = true
        }
      }
      if (patch.audioHash !== undefined) {
        const audioHash = text(patch.audioHash).trim()
        if ((line.audioHash ?? '') !== audioHash) {
          if (audioHash) next.audioHash = audioHash
          else delete next.audioHash
          shotChanged = true
        }
      }
      if (patch.audioName !== undefined) {
        const audioName = text(patch.audioName).trim()
        if ((line.audioName ?? '') !== audioName) {
          if (audioName) next.audioName = audioName
          else delete next.audioName
          shotChanged = true
        }
      }
      return shotChanged ? next : line
    })
    if (!shotChanged) return shot
    changed = true
    return { ...shot, lines }
  })
  return changed ? { ...doc, shots, updatedAt: now } : doc
}

function clampSpeechSpeed(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.round(Math.min(4, Math.max(0.25, n)) * 100) / 100
}

/** 删一句台词（不存在那一句时返回原引用） */
export function removeShotLine(
  doc: StoryboardDoc,
  shotId: string,
  lineId: string,
  now = 0,
): StoryboardDoc {
  const shot = doc.shots.find((s) => s.id === shotId)
  if (!shot || !shot.lines.some((l) => l.id === lineId)) return doc
  return {
    ...doc,
    shots: doc.shots.map((s) =>
      s.id === shotId ? { ...s, lines: s.lines.filter((l) => l.id !== lineId) } : s,
    ),
    updatedAt: now,
  }
}

export function removeShot(doc: StoryboardDoc, id: string, now = 0): StoryboardDoc {
  return { ...doc, shots: doc.shots.filter((s) => s.id !== id), updatedAt: now }
}

/** 在同一集内上下移一镜（跨集不换集 —— 换集是"这一镜挪到别的集"，那是另一件事） */
export function moveShot(doc: StoryboardDoc, id: string, delta: number, now = 0): StoryboardDoc {
  const shot = doc.shots.find((s) => s.id === id)
  if (!shot) return doc
  const sameEpisode = doc.shots.filter((s) => s.episodeId === shot.episodeId)
  const at = sameEpisode.findIndex((s) => s.id === id)
  const to = at + Math.sign(delta)
  if (at < 0 || to < 0 || to >= sameEpisode.length) return doc
  const nextId = sameEpisode[to]!.id
  const a = doc.shots.findIndex((s) => s.id === id)
  const b = doc.shots.findIndex((s) => s.id === nextId)
  const next = doc.shots.slice()
  const tmp = next[a]!
  next[a] = next[b]!
  next[b] = tmp
  return { ...doc, shots: next, updatedAt: now }
}

export function shotsOf(doc: StoryboardDoc, episodeId: string): StoryboardShot[] {
  return doc.shots.filter((s) => s.episodeId === episodeId)
}

/* ─────────────────── 资产库（角色 / 场景）与镜头绑定（对账 #416） ─────────────────── */

export function addCharacter(doc: StoryboardDoc, now = 0): StoryboardDoc {
  const character: DramaCharacter = {
    id: createId('char'),
    name: `角色 ${doc.characters.length + 1}`,
    description: '',
    aliases: [],
  }
  return { ...doc, characters: [...doc.characters, character], updatedAt: now }
}

export function addScene(doc: StoryboardDoc, now = 0): StoryboardDoc {
  const scene: DramaScene = {
    id: createId('scene'),
    name: `场景 ${doc.scenes.length + 1}`,
    description: '',
    aliases: [],
  }
  return { ...doc, scenes: [...doc.scenes, scene], updatedAt: now }
}

/** 改资产（名字留空就不改：`name` 是导出与绑定显示的唯一抓手，不允许空） */
export function updateCharacter(
  doc: StoryboardDoc,
  id: string,
  patch: Partial<Pick<DramaAsset, 'name' | 'description' | 'aliases'>>,
  now = 0,
): StoryboardDoc {
  if (!doc.characters.some((c) => c.id === id)) return doc
  const characters = doc.characters.map((c) => {
    if (c.id !== id) return c
    const name = text(patch.name, c.name).trim() || c.name
    const aliases = patch.aliases
      ? [...new Set(patch.aliases.map((a) => text(a).trim()).filter((a) => a && a !== name))]
      : c.aliases
    return { ...c, name, description: text(patch.description, c.description), aliases }
  })
  return { ...doc, characters, updatedAt: now }
}

export function updateScene(
  doc: StoryboardDoc,
  id: string,
  patch: Partial<Pick<DramaAsset, 'name' | 'description' | 'aliases'>>,
  now = 0,
): StoryboardDoc {
  if (!doc.scenes.some((s) => s.id === id)) return doc
  const scenes = doc.scenes.map((s) => {
    if (s.id !== id) return s
    const name = text(patch.name, s.name).trim() || s.name
    const aliases = patch.aliases
      ? [...new Set(patch.aliases.map((a) => text(a).trim()).filter((a) => a && a !== name))]
      : s.aliases
    return { ...s, name, description: text(patch.description, s.description), aliases }
  })
  return { ...doc, scenes, updatedAt: now }
}

/** 从镜头上摘掉一个角色 id；空了就把字段删掉（不留 `[]` 这种"看着像有绑定"的残渣） */
function withoutCharacterRef(shot: StoryboardShot, id: string): StoryboardShot {
  const next = (shot.characterIds ?? []).filter((v) => v !== id)
  const copy: StoryboardShot = { ...shot }
  if (next.length > 0) copy.characterIds = next
  else delete copy.characterIds
  return copy
}

/**
 * **删角色：连镜头上的引用一起清**（不留下悬空 id）。
 *
 * 调研稿 §6.3 第 3 条把"资产库是用户可编辑的"写成了需求；而"删角色"最容易埋的坑
 * 就是**悬空引用** —— 界面上那一格空了、导出里却还印着一个已经不存在的名字。
 * 界面用**两下确认**把"会从 N 镜里去掉"说在前面（N 由页面算好）。
 */
export function removeCharacter(doc: StoryboardDoc, id: string, now = 0): StoryboardDoc {
  if (!doc.characters.some((c) => c.id === id)) return doc
  return {
    ...doc,
    characters: doc.characters.filter((c) => c.id !== id),
    shots: doc.shots.map((s) => (s.characterIds?.includes(id) ? withoutCharacterRef(s, id) : s)),
    updatedAt: now,
  }
}

/** 删场景：同上，把镜头上指向它的 `sceneId` 一起清掉 */
export function removeScene(doc: StoryboardDoc, id: string, now = 0): StoryboardDoc {
  if (!doc.scenes.some((s) => s.id === id)) return doc
  return {
    ...doc,
    scenes: doc.scenes.filter((s) => s.id !== id),
    shots: doc.shots.map((s) => {
      if (s.sceneId !== id) return s
      const copy: StoryboardShot = { ...s }
      delete copy.sceneId
      return copy
    }),
    updatedAt: now,
  }
}

/**
 * **把两条资产合成一条**（对账 #436：`keepId` 留下，`dropId` 并进去然后消失）。
 *
 * 为什么需要它：拆镜时会按 `name + aliases` **自动归并**（#416），但模型换个叫法
 * （"林轩" / "林公子"）就会落下**两条重复**。以前用户只能删掉一条 —— 而删会把引用一起清掉，
 * 于是每一镜都得重新绑一次。合并而不是删除，才是这件事的答案。
 *
 * 四条口径（每条都为了"别让用户的东西白做"）：
 * 1. **引用跟过来**：镜头里指向 `dropId` 的一律改成 `keepId`；**同一镜同时引用了两条时合并成一条**
 *    （不去重的话，那一镜会挂着两个 id，而库里只有一个 —— 导出里就会出现重复名字）。
 * 2. **名字也进别名**：`drop` 的名字与本来的别名并进 `keep.aliases`（去重、去掉与 keep 名字相同的）。
 *    这正是"以后拆镜还能认出林公子就是林轩"的抓手（调研稿 §6.3 第 2 条）。
 * 3. **描述只在 keep 为空时借过来**：用户写过的描述不许被另一条覆盖。
 * 4. **基准图 keep 没有就接 drop 的**（否则刚出的定妆图白做）；两条都有就留 keep 的 ——
 *    这是唯一一处"丢了 drop 的一份产物"，所以界面上要**先确认再合并**。
 *
 * 不合法（id 相等 / 找不到其中一条）一律返回**原引用**。
 */
export function mergeAsset(
  doc: StoryboardDoc,
  kind: AssetKind,
  keepId: string,
  dropId: string,
  now = 0,
): StoryboardDoc {
  if (!keepId || !dropId || keepId === dropId) return doc
  const list = kind === 'char' ? doc.characters : doc.scenes
  const keep = list.find((a) => a.id === keepId)
  const drop = list.find((a) => a.id === dropId)
  if (!keep || !drop) return doc

  /** 别名：keep 原有的 + drop 的名字与别名；去掉空的、去掉与 keep 名字相同的、去重 */
  const aliases = [
    ...new Set(
      [...keep.aliases, drop.name, ...drop.aliases]
        .map((v) => v.trim())
        .filter((v) => v && v !== keep.name),
    ),
  ]
  /**
   * 基准图与节点：**keep 没有就接 drop 的**（两条一起接 —— 只接 hash 会指向别人的节点）。
   * 只接 `nodeId` 那半条也要管：那代表"这一条已经建过节点、只是还没出图"，
   * 不接的话那个节点会在画布上变成没人认领的孤儿。
   */
  const carry =
    !keep.baseHash && drop.baseHash && drop.nodeId
      ? { nodeId: drop.nodeId, baseHash: drop.baseHash }
      : !keep.nodeId && drop.nodeId
        ? { nodeId: drop.nodeId }
        : {}
  const carryTurnaround =
    !keep.turnaroundHash && drop.turnaroundHash && drop.turnaroundNodeId
      ? { turnaroundNodeId: drop.turnaroundNodeId, turnaroundHash: drop.turnaroundHash }
      : !keep.turnaroundNodeId && drop.turnaroundNodeId
        ? { turnaroundNodeId: drop.turnaroundNodeId }
        : {}
  const merged: DramaAsset = {
    ...keep,
    aliases,
    description: keep.description.trim() ? keep.description : drop.description,
    ...carry,
    ...carryTurnaround,
  }
  const nextList = list.filter((a) => a.id !== dropId).map((a) => (a.id === keepId ? merged : a))

  const shots = doc.shots.map((shot) => {
    if (kind === 'scene') {
      if (shot.sceneId !== dropId) return shot
      return { ...shot, sceneId: keepId }
    }
    if (!shot.characterIds?.includes(dropId)) return shot
    const refs = [...new Set(shot.characterIds.map((id) => (id === dropId ? keepId : id)))]
    return { ...shot, characterIds: refs }
  })

  return {
    ...doc,
    ...(kind === 'char' ? { characters: nextList } : { scenes: nextList }),
    shots,
    updatedAt: now,
  }
}

/** 给这一镜指定场景；传 `null` 表示"不绑定"（同一个函数管两件事，界面不用分两个入口） */
export function bindShotScene(
  doc: StoryboardDoc,
  shotId: string,
  sceneId: string | null,
  now = 0,
): StoryboardDoc {
  if (sceneId !== null && !doc.scenes.some((s) => s.id === sceneId)) return doc
  const shot = doc.shots.find((s) => s.id === shotId)
  if (!shot) return doc
  if (sceneId === null ? !shot.sceneId : shot.sceneId === sceneId) return doc
  const shots = doc.shots.map((s) => {
    if (s.id !== shotId) return s
    const copy: StoryboardShot = { ...s }
    if (sceneId !== null) copy.sceneId = sceneId
    else delete copy.sceneId
    return copy
  })
  return { ...doc, shots, updatedAt: now }
}

/** 这一镜加上 / 去掉一个出场角色（点一下切换，不要求用户先选"添加"还是"移除"） */
export function toggleShotCharacter(
  doc: StoryboardDoc,
  shotId: string,
  characterId: string,
  now = 0,
): StoryboardDoc {
  if (!doc.characters.some((c) => c.id === characterId)) return doc
  const shot = doc.shots.find((s) => s.id === shotId)
  if (!shot) return doc
  const has = shot.characterIds?.includes(characterId) ?? false
  const shots = doc.shots.map((s) => {
    if (s.id !== shotId) return s
    if (has) return withoutCharacterRef(s, characterId)
    return { ...s, characterIds: [...(s.characterIds ?? []), characterId] }
  })
  return { ...doc, shots, updatedAt: now }
}

/** 这一镜的场景名（没绑定 = 空串；导出与界面共用这一份读法） */
export function sceneNameOf(doc: StoryboardDoc, shot: StoryboardShot): string {
  if (!shot.sceneId) return ''
  return doc.scenes.find((s) => s.id === shot.sceneId)?.name ?? ''
}

/** 这一镜的出场角色名（按**角色库顺序**输出：同一份数据每次导出的顺序都一致） */
export function characterNamesOf(doc: StoryboardDoc, shot: StoryboardShot): string[] {
  if (!shot.characterIds || shot.characterIds.length === 0) return []
  const ids = new Set(shot.characterIds)
  return doc.characters.filter((c) => ids.has(c.id)).map((c) => c.name)
}

/**
 * **定妆图 / 基准图的提示词**（对账 #419；调研稿 §6.3 第 4 条「初级纯文生图」）。
 *
 * 这一批**只做一张基准图**，不接参考图回喂（那要渠道消费 `inputs`，#81/#113 的缺口）。
 * 两条尾巴是刻意的：
 * - 角色：中性表情 + 干净背景 + 展示发型 / 服装 / 配饰 —— 基准图是给"以后做参考图"用的，
 *   不是给观众看的剧照；
 * - 场景：**无人物**空镜 —— 场景图里混进人，后面拿它当参考时会把那个人也带进每一镜。
 * 两句都写「不要文字」：带标签的提示词很容易让图生模型把字画出来。
 */
export function assetBasePrompt(asset: DramaAsset, kind: 'char' | 'scene'): string {
  const name = asset.name.trim() || (kind === 'char' ? '角色' : '场景')
  const desc = asset.description.trim()
  const head = kind === 'char' ? '角色定妆图' : '场景基准图'
  const tail =
    kind === 'char'
      ? '正面半身，中性表情，干净的纯色背景，清晰展示发型、服装与配饰细节，画面里不要出现任何文字'
      : '无人物空镜，展示场地结构与氛围，光线自然，画面里不要出现任何文字'
  return `${head}：${name}${desc ? `。${desc}` : ''}。${tail}`
}

/**
 * **角色多视角 turnaround 的提示词**（漫剧后段的下一块）。
 *
 * 四格：正面全身 / 侧面全身 / 背面全身 / 正面脸部特写。每格都要求同一角色、
 * 同一光照、同一服装与配饰，是为了让之后每一镜拿它当参考时**不是"另一个人"**。
 * 仍然只走现有生图链路：如果角色定妆图节点还在，调用方会把它连成参考图。
 */
export function assetTurnaroundPrompt(asset: DramaAsset): string {
  const name = asset.name.trim() || '角色'
  const desc = asset.description.trim()
  return (
    `角色多视角设定图：${name}${desc ? `。${desc}` : ''}。` +
    '同一角色、同一光照、同一服装与配饰，正面全身、侧面全身、背面全身、正面脸部特写四格并排，' +
    '纯色背景，各视角比例与五官一致，画面里不要出现任何文字'
  )
}

/** 资产库的两个入口（读写都按"哪一类 + 哪一条"定位，界面不用自己分叉） */
type AssetKind = 'char' | 'scene'

function withAsset(
  doc: StoryboardDoc,
  kind: AssetKind,
  id: string,
  patch: (asset: DramaAsset) => DramaAsset,
  now = 0,
): StoryboardDoc {
  if (kind === 'char') {
    const current = doc.characters.find((c) => c.id === id)
    if (!current) return doc
    const next = patch(current)
    /* patch 原样返回 ⇒ 没有变化 ⇒ 返回原引用（调用方据此不做多余落库，与 attach* 同一条纪律） */
    if (next === current) return doc
    return { ...doc, characters: doc.characters.map((c) => (c.id === id ? next : c)), updatedAt: now }
  }
  const current = doc.scenes.find((s) => s.id === id)
  if (!current) return doc
  const next = patch(current)
  if (next === current) return doc
  return { ...doc, scenes: doc.scenes.map((s) => (s.id === id ? next : s)), updatedAt: now }
}

/**
 * 记下"这条资产用哪个节点做基准图"。
 *
 * 换节点时**顺手清掉 `baseHash`**：那张图属于旧节点，留着就是同一个事实两个来源
 * （与镜头上的 `attachShotNodes` 同一条纪律）。
 */
export function setAssetNode(
  doc: StoryboardDoc,
  kind: AssetKind,
  id: string,
  nodeId: string,
  now = 0,
): StoryboardDoc {
  return withAsset(
    doc,
    kind,
    id,
    (asset) => {
      if (asset.nodeId === nodeId) return asset
      const next: DramaAsset = { ...asset, nodeId }
      delete next.baseHash
      return next
    },
    now,
  )
}

/** 把基准图的 hash 镜像回资产（同一个 hash 再来一次是空操作，别搅动防抖保存） */
export function setAssetBaseHash(
  doc: StoryboardDoc,
  kind: AssetKind,
  id: string,
  hash: string,
  now = 0,
): StoryboardDoc {
  return withAsset(
    doc,
    kind,
    id,
    (asset) => (asset.baseHash === hash ? asset : { ...asset, baseHash: hash }),
    now,
  )
}

/** 记下“这条角色用哪个节点做多视角 turnaround”；换节点时清掉旧产物 hash。 */
export function setAssetTurnaroundNode(
  doc: StoryboardDoc,
  kind: AssetKind,
  id: string,
  nodeId: string,
  now = 0,
): StoryboardDoc {
  return withAsset(
    doc,
    kind,
    id,
    (asset) => {
      if (asset.turnaroundNodeId === nodeId) return asset
      const next: DramaAsset = { ...asset, turnaroundNodeId: nodeId }
      delete next.turnaroundHash
      return next
    },
    now,
  )
}

/** 把多视角产物的 hash 镜像回资产；同一个 hash 再来一次是空操作。 */
export function setAssetTurnaroundHash(
  doc: StoryboardDoc,
  kind: AssetKind,
  id: string,
  hash: string,
  now = 0,
): StoryboardDoc {
  return withAsset(
    doc,
    kind,
    id,
    (asset) => (asset.turnaroundHash === hash ? asset : { ...asset, turnaroundHash: hash }),
    now,
  )
}

/**
 * **哪几镜还需要铺到画布**（对账 #415）。
 *
 * 判据两条：① 没铺过；② 铺过但那个节点**已经不在画布上**（用户在画布上把它删了）。
 * 第二条正是"缓存不是真相"的落地 —— 只看 `nodeId` 有没有值，用户删掉节点后
 * 这一镜就永远铺不回来了（按钮显示"已在画布"，画布里却没有）。
 */
export function shotsNeedingNode(
  shots: readonly StoryboardShot[],
  liveNodeIds: ReadonlySet<string>,
): StoryboardShot[] {
  return shots.filter((s) => !s.nodeId || !liveNodeIds.has(s.nodeId))
}

/**
 * 把「这一镜 → 画布节点」写回文档（铺节点之后调用一次）。
 *
 * 换节点时**顺手清掉 `imageHash`**：那张图属于旧节点，留着会让列表显示一张
 * 已经不在画布上的图（同一个事实两个来源，必然分叉）。
 * 没有任何变化时返回**原引用**（调用方据此避免多余的落库）。
 */
export function attachShotNodes(
  doc: StoryboardDoc,
  pairs: readonly { shotId: string; nodeId: string }[],
  now = 0,
): StoryboardDoc {
  if (pairs.length === 0) return doc
  const map = new Map(pairs.map((p) => [p.shotId, p.nodeId]))
  let changed = false
  const shots = doc.shots.map((s) => {
    const nodeId = map.get(s.id)
    if (!nodeId || s.nodeId === nodeId) return s
    changed = true
    const next: StoryboardShot = { ...s, nodeId }
    delete next.imageHash
    /* 视频也是拿**旧那张图**做的：换了图节点，旧视频就不再属于这一镜（同一条纪律） */
    delete next.videoNodeId
    delete next.videoEndNodeId
    delete next.videoHash
    return next
  })
  return changed ? { ...doc, shots, updatedAt: now } : doc
}

/** 把出图结果镜像回文档（引擎写完节点之后调用；同一 hash 重复调用是空操作） */
export function attachShotImages(
  doc: StoryboardDoc,
  pairs: readonly { shotId: string; hash: string }[],
  now = 0,
): StoryboardDoc {
  if (pairs.length === 0) return doc
  const map = new Map(pairs.map((p) => [p.shotId, p.hash]))
  let changed = false
  const shots = doc.shots.map((s) => {
    const hash = map.get(s.id)
    if (!hash || s.imageHash === hash) return s
    changed = true
    return { ...s, imageHash: hash }
  })
  return changed ? { ...doc, shots, updatedAt: now } : doc
}

/**
 * 把「这一镜的视频节点」写进文档（对账 #429，建完节点立刻调一次）。
 *
 * 为什么**建完节点就写**、而不是等跑完再一起写：跑视频是长任务，中途失败很常见 ——
 * 那时节点已经实实在在躺在画布上了。不写进文档，用户下一次点「出视频」会**又建一个**，
 * 画布上就慢慢堆起一排没人认领的空节点（这与 #415 的"悬空引用要重新铺"是同一类事故）。
 *
 * 换视频节点时清掉旧 `videoHash`（那张视频属于旧节点）。
 * 没有任何变化时返回**原引用**。
 */
export function setShotVideoNode(
  doc: StoryboardDoc,
  shotId: string,
  videoNodeId: string,
  now = 0,
  videoEndNodeId = '',
): StoryboardDoc {
  let changed = false
  const shots = doc.shots.map((s) => {
    const nextEndNodeId = videoEndNodeId.trim()
    if (
      s.id !== shotId ||
      (s.videoNodeId === videoNodeId && (s.videoEndNodeId ?? '') === nextEndNodeId)
    ) {
      return s
    }
    changed = true
    const next: StoryboardShot = { ...s, videoNodeId }
    if (nextEndNodeId) next.videoEndNodeId = nextEndNodeId
    else delete next.videoEndNodeId
    delete next.videoHash
    return next
  })
  return changed ? { ...doc, shots, updatedAt: now } : doc
}

/** 把视频产物 hash 镜像回文档（与 `attachShotImages` 同一套纪律：变了才写、同值空操作） */
export function attachShotVideos(
  doc: StoryboardDoc,
  pairs: readonly { shotId: string; hash: string }[],
  now = 0,
): StoryboardDoc {
  if (pairs.length === 0) return doc
  const map = new Map(pairs.map((p) => [p.shotId, p.hash]))
  let changed = false
  const shots = doc.shots.map((s) => {
    const hash = map.get(s.id)
    if (!hash || s.videoHash === hash) return s
    changed = true
    return { ...s, videoHash: hash }
  })
  return changed ? { ...doc, shots, updatedAt: now } : doc
}

export interface StoryboardStats {
  episodes: number
  shots: number
  /** 全片粗排时长（秒）——按每镜的 `durationSec` 累加 */
  durationSec: number
}

export function storyboardStats(doc: StoryboardDoc): StoryboardStats {
  return {
    episodes: doc.episodes.length,
    shots: doc.shots.length,
    durationSec: doc.shots.reduce((sum, s) => sum + Math.max(0, s.durationSec), 0),
  }
}

/** Markdown 表格里的一格：竖线与换行都会把表格撑坏，先换掉 */
function cell(value: string): string {
  const flat = value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
  return flat || '—'
}

/**
 * **导出分镜表（Markdown）**：剧本 + 逐集逐镜的一张表 + 统计。
 *
 * 为什么先给 Markdown 而不是 CSV / Excel：它是"能直接读、能直接贴、能直接进版本库"的形态，
 * 而这一阶段的目的是**能把分镜交出去**（调研稿 §4.4 的第 4 条："先满足能交付素材"）。
 * 成片、打包、Excel 那些等形态固化再加。
 */
export function exportStoryboardMarkdown(doc: StoryboardDoc): string {
  const stats = storyboardStats(doc)
  const lines: string[] = []
  lines.push(`# ${doc.script.title || '未命名漫剧'}`)
  lines.push('')
  if (doc.script.logline.trim()) {
    lines.push(`> ${doc.script.logline.trim()}`)
    lines.push('')
  }
  lines.push(`共 ${stats.episodes} 集 / ${stats.shots} 镜 / 粗排 ${stats.durationSec} 秒`)
  lines.push('')
  if (doc.script.body.trim()) {
    lines.push('## 剧本')
    lines.push('')
    lines.push(doc.script.body.trim())
    lines.push('')
  }
  doc.episodes.forEach((episode, episodeIndex) => {
    lines.push(`## 第 ${episodeIndex + 1} 集 · ${episode.title}`)
    lines.push('')
    /* 溯源三行（对账 #417）：原文范围 + 开场 / 结尾钩子 —— 交出去的表格里也要能对上原文 */
    if (episode.sourceRange) {
      lines.push(`> 原文第 ${episode.sourceRange.from + 1}–${episode.sourceRange.to} 字`)
      lines.push('')
    }
    if (episode.summary.trim()) {
      lines.push(`> ${episode.summary.trim()}`)
      lines.push('')
    }
    if (episode.hookOpen?.trim()) {
      lines.push(`> 开场钩子：${episode.hookOpen.trim()}`)
      lines.push('')
    }
    if (episode.hookEnd?.trim()) {
      lines.push(`> 结尾钩子：${episode.hookEnd.trim()}`)
      lines.push('')
    }
    if (episode.bgmHash) {
      const volume = Math.round((episode.bgmVolume ?? DEFAULT_BGM_VOLUME) * 100)
      lines.push(
        `> 背景音乐：${episode.bgmName?.trim() || episode.bgmHash}（${episode.bgmHash.slice(0, 8)}…，音量 ${volume}%）`,
      )
      lines.push('')
    }
    const shots = shotsOf(doc, episode.id)
    if (shots.length === 0) {
      lines.push('（这一集还没有分镜）')
      lines.push('')
      return
    }
    /* 场景 / 出场角色两列（对账 #416）：这两列以前只在脑子里，现在写进能交出去的那张表 */
    lines.push('| # | 画面 | 场景 | 出场角色 | 台词 / 旁白 | 时长 | 画面提示词 |')
    lines.push('| --- | --- | --- | --- | --- | --- | --- |')
    shots.forEach((shot, i) => {
      lines.push(
        `| ${i + 1} | ${cell(shot.scene)} | ${cell(sceneNameOf(doc, shot))} | ${cell(
          characterNamesOf(doc, shot).join('、'),
      )} | ${cell(shotDialogueTextOf(doc, shot))} | ${shot.durationSec}s | ${cell(shotPromptWithAssets(doc, shot))} |`,
      )
    })
    lines.push('')
  })
  return lines.join('\n').trimEnd() + '\n'
}
