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

export interface StoryboardEpisode {
  id: string
  title: string
  summary: string
}

export interface StoryboardShot {
  id: string
  episodeId: string
  /** 画面描述：这一镜**画什么**（生图提示词的素材） */
  scene: string
  /** 台词 / 旁白（可以有，也可以是一镜空镜） */
  dialogue: string
  /** 这一镜预计几秒（成片节奏的粗排；导出表里带上） */
  durationSec: number
  /** 画面提示词：留空就由 `scene` 派生（`shotPrompt`） */
  prompt: string
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
}

export interface StoryboardDoc {
  projectId: string
  script: StoryboardScript
  episodes: StoryboardEpisode[]
  shots: StoryboardShot[]
  updatedAt: number
}

/** 新片的空文档（新建漫剧项目时用它） */
export function emptyStoryboard(projectId: string, now = 0): StoryboardDoc {
  return {
    projectId,
    script: { title: '未命名漫剧', logline: '', body: '' },
    episodes: [],
    shots: [],
    updatedAt: now,
  }
}

const text = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

/**
 * **脏数据容错读回**（与外观 / 通知偏好同一条规矩：只补坏的那一项，不整份丢弃）。
 *
 * 另外**丢掉孤儿镜头**（`episodeId` 指向不存在的集）：留着它们会在导出里凭空多出几行，
 * 而界面上根本看不到 —— 那比丢掉更难查。
 */
export function parseStoryboard(raw: unknown, projectId: string): StoryboardDoc {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const scriptRaw = o.script && typeof o.script === 'object' ? (o.script as Record<string, unknown>) : {}
  const episodes: StoryboardEpisode[] = (Array.isArray(o.episodes) ? o.episodes : []).flatMap((e) => {
    if (!e || typeof e !== 'object') return []
    const row = e as Record<string, unknown>
    const id = text(row.id)
    if (!id) return []
    return [{ id, title: text(row.title) || '未命名一集', summary: text(row.summary) }]
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
    return [
      {
        id,
        episodeId,
        scene: text(row.scene),
        dialogue: text(row.dialogue),
        durationSec: num(row.durationSec, DEFAULT_SHOT_SECONDS),
        prompt: text(row.prompt),
        /* 空串不落成字段：没有就是没有，别写一个 `undefined` 占位 */
        ...(nodeId ? { nodeId } : {}),
        ...(imageHash ? { imageHash } : {}),
      },
    ]
  })
  const doc: StoryboardDoc = {
    projectId,
    script: {
      title: text(scriptRaw.title) || '未命名漫剧',
      logline: text(scriptRaw.logline),
      body: text(scriptRaw.body),
    },
    episodes,
    shots,
    updatedAt: num(o.updatedAt, 0),
  }
  /** 读回时就顺手把"按集分组"整一遍（老数据 / 手改过的备份都可能乱序） */
  return { ...doc, shots: normalizeShotOrder(doc) }
}

/** 一镜的默认时长（秒）：短视频里最常用的那个档，用户改就是了 */
export const DEFAULT_SHOT_SECONDS = 3

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
  patch: Partial<Pick<StoryboardEpisode, 'title' | 'summary'>>,
  now = 0,
): StoryboardDoc {
  return {
    ...doc,
    episodes: doc.episodes.map((e) =>
      e.id === id
        ? {
            ...e,
            title: text(patch.title, e.title) || e.title,
            summary: text(patch.summary, e.summary),
          }
        : e,
    ),
    updatedAt: now,
  }
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
    dialogue: '',
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
  patch: Partial<Omit<StoryboardShot, 'id' | 'episodeId'>>,
  now = 0,
): StoryboardDoc {
  return {
    ...doc,
    shots: doc.shots.map((s) =>
      s.id === id
        ? {
            ...s,
            scene: text(patch.scene, s.scene),
            dialogue: text(patch.dialogue, s.dialogue),
            durationSec: Math.max(1, Math.round(num(patch.durationSec, s.durationSec))),
            prompt: text(patch.prompt, s.prompt),
          }
        : s,
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
    if (episode.summary.trim()) {
      lines.push(`> ${episode.summary.trim()}`)
      lines.push('')
    }
    const shots = shotsOf(doc, episode.id)
    if (shots.length === 0) {
      lines.push('（这一集还没有分镜）')
      lines.push('')
      return
    }
    lines.push('| # | 画面 | 台词 / 旁白 | 时长 | 画面提示词 |')
    lines.push('| --- | --- | --- | --- | --- |')
    shots.forEach((shot, i) => {
      lines.push(
        `| ${i + 1} | ${cell(shot.scene)} | ${cell(shot.dialogue)} | ${shot.durationSec}s | ${cell(shotPrompt(shot))} |`,
      )
    })
    lines.push('')
  })
  return lines.join('\n').trimEnd() + '\n'
}
