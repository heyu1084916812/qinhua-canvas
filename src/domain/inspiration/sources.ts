/**
 * 灵感库的来源清单（用户 2026-10-14：「我要在左边菜单加一个灵感库，用 github 上
 * 开源的库，直接链接他们的内容」）。
 *
 * 每个来源 = **GitHub 仓库里的一个数据文件**。轻画只拉这个文件（纯文本索引），
 * 预览图与视频一律走**原始外链** —— 用户明确说过「同步本地太大了，因为里面还有视频」。
 * 所以这里没有"下载媒体"这件事，只有"拉一份 JSON / 解析成案例"。
 */
/**
 * README 型来源的**版式**（一家一种，规则表在 `parseReadmeCases` 里）。
 *
 * 加新来源时先看它属于哪种；不符合任何一种就再加一种规则 ——
 * **不要复制一份解析函数**：三份几乎一样的正则，改一处忘两处是迟早的事。
 */
export type ReadmeStyle = 'pico' | 'youmind' | 'youmindAll'

/** 灵感来源的媒体类型：视频来源要在卡片和详情里真的能播放。 */
export type InspirationMediaKind = 'image' | 'video'

export interface InspirationSource {
  id: string
  /** 来源名（左侧列表用，与仓库自述一致） */
  name: string
  /** 仓库地址（出处，给人点） */
  repo: string
  /** 数据文件的 raw 地址（唯一要联网取的东西） */
  dataUrl: string
  /** 同一来源拆成多个数据文件时按顺序聚合；有它时不再使用 dataUrl 的备用分支。 */
  dataUrls?: string[]
  /** 文档型来源的官方预览：按数据文件 URL 精确映射标题 / GIF / MP4。 */
  mediaByUrl?: Record<
    string,
    {
      title?: string
      imageUrl?: string
      videoUrl?: string
    }
  >
  /**
   * 预览图基址：案例里的相对路径拼在它后面。
   *
   * ⚠️ **必须实测，不能按数据文件里的字面路径猜**：`cases.json` 里写的是
   * `/images/case544.jpg`（那是**站点视角**的绝对路径），而仓库里真实位置是
   * `data/images/case544.jpg` —— 直接拼仓库根会得到一屏 404 破图（本轮实测踩到）。
   */
  imageBase: string
  /** 一句话说明这个来源是什么 */
  note: string
  /**
   * 数据文件**形态** —— 决定用哪个解析器。
   *
   * - `json`：仓库直接给结构化数据（字段齐全、最稳）；
   * - `readme`：内容写在 README 的分节里，要按 markdown 提（**脆一些**：
   *   上游一改版式就解析不出来）。所以 `refresh` 在"解析出 0 条"时**报错而不覆盖旧缓存** ——
   *   版式变了最多是"这次没刷成功"，不会把上一次的好数据洗掉。
   */
  format: 'json' | 'readme' | 'text' | 'request'
  /** README 型的版式（`format: 'readme'` 时用；不填 = `pico`） */
  readmeStyle?: ReadmeStyle
  /** 搜索框旁那一档「模型分类」（如 GPT Image / Nano Banana / Seedance）。 */
  modelCategory: string
  /** 图 / 视频。视频来源会优先解析 README 里的 mp4 / webm / mov 地址。 */
  kind: InspirationMediaKind
  /** 自定义来源才为 false；内置来源用于管理面板的默认顺序。 */
  builtin?: boolean
  /** 自定义 README 仓库在 main 取不到时的备用地址（一般是 master）。 */
  fallbackDataUrl?: string
}

/**
 * 预置来源（2026-10-23 实查：星数高、仍在维护、数据文件可直取）。
 *
 * 优先结构化 JSON；README 和官方 TXT 规范走各自的专用解析器。
 * 解析出 0 条时刷新会报错并保留旧缓存，不会把来源伪装成“空库”。
 *
 * ⚠️ **地址一律走 jsDelivr（`cdn.jsdelivr.net/gh/...`）而不是 raw.githubusercontent.com**：
 * 2026-10-14 实测本机访问 raw 多次 **连接超时**（同一时刻 jsDelivr 1.7 秒返回），
 * 而用户在国内 —— 灵感库的刷新成功率直接取决于这条链路的可达性。
 * jsDelivr 是 GitHub 的只读镜像 CDN，路径规则 `gh/OWNER/REPO@BRANCH/PATH`。
 */
const MINIMAX_H3_BASE = 'https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/'

const MINIMAX_H3_SKILLS = [
  '3d-animation-short-generator',
  'brand-promo-video-generator',
  'co-op-game-intro-generator',
  'handdrawn-live-video-generator',
  'minimalist-product-ad-generator',
  'music-video-subtitle-generator',
  'paper-collage-explainer-generator',
  'papercraft-stop-motion-explainer',
] as const

const MINIMAX_H3_MEDIA: NonNullable<InspirationSource['mediaByUrl']> = {
  ...Object.fromEntries(
    MINIMAX_H3_SKILLS.map((name) => [
      `${MINIMAX_H3_BASE}skills/${name}/SKILL.cn.md`,
      { imageUrl: `${MINIMAX_H3_BASE}assets/${name}.gif` },
    ]),
  ),
  [`${MINIMAX_H3_BASE}skills/h3-prompt-writing/references/base-en.txt`]: {
    title: 'MiniMax H3 · T2VA 官方视频案例',
    videoUrl: `${MINIMAX_H3_BASE}assets/t2va.mp4`,
  },
  [`${MINIMAX_H3_BASE}skills/h3-prompt-writing/references/ref-en.txt`]: {
    title: 'MiniMax H3 · Ref2VA 官方视频案例',
    videoUrl: `${MINIMAX_H3_BASE}assets/ref2va.mp4`,
  },
}

const MINIMAX_H3_CASE_MEDIA: NonNullable<InspirationSource['mediaByUrl']> = {
  [`${MINIMAX_H3_BASE}scripts/readme/reproducible-768p-t2va-request.sh`]: {
    title: 'T2VA 768p 官方可复现案例',
    videoUrl: `${MINIMAX_H3_BASE}assets/t2va.mp4`,
  },
  [`${MINIMAX_H3_BASE}scripts/readme/reproducible-768p-fl2va-request.sh`]: {
    title: 'FL2VA 768p 官方可复现案例',
    videoUrl: `${MINIMAX_H3_BASE}assets/fl2va.mp4`,
  },
  [`${MINIMAX_H3_BASE}scripts/readme/reproducible-768p-ref2va-request.sh`]: {
    title: 'Ref2VA 768p 官方可复现案例',
    videoUrl: `${MINIMAX_H3_BASE}assets/ref2va.mp4`,
  },
}

export const DEFAULT_INSPIRATION_SOURCES: readonly InspirationSource[] = [
  {
    id: 'gpt-image-2',
    name: 'Awesome GPT Image 2',
    repo: 'https://github.com/freestylefly/awesome-gpt-image-2',
    dataUrl: 'https://cdn.jsdelivr.net/gh/freestylefly/awesome-gpt-image-2@main/data/cases.json',
    /** 实测：图片在仓库的 `data/images/`（数据文件里的 `/images/...` 是站点路径） */
    imageBase: 'https://cdn.jsdelivr.net/gh/freestylefly/awesome-gpt-image-2@main/data',
    note: '541 条 GPT Image 2 案例，带完整提示词与原作者署名',
    format: 'json',
    modelCategory: 'GPT Image',
    kind: 'image',
    builtin: true,
  },
  {
    id: 'youmind-ai-image-selected',
    name: 'YouMind AI 图片精选',
    repo: 'https://github.com/YouMind-OpenLab/ai-image-prompts-skill',
    dataUrl:
      'https://cdn.jsdelivr.net/gh/YouMind-OpenLab/ai-image-prompts-skill@main/references/ecommerce-main-image.json',
    dataUrls: [
      'https://cdn.jsdelivr.net/gh/YouMind-OpenLab/ai-image-prompts-skill@main/references/ecommerce-main-image.json',
      'https://cdn.jsdelivr.net/gh/YouMind-OpenLab/ai-image-prompts-skill@main/references/comic-storyboard.json',
      'https://cdn.jsdelivr.net/gh/YouMind-OpenLab/ai-image-prompts-skill@main/references/poster-flyer.json',
      'https://cdn.jsdelivr.net/gh/YouMind-OpenLab/ai-image-prompts-skill@main/references/infographic-edu-visual.json',
    ],
    imageBase: '',
    note: '电商主图、漫画分镜、海报与信息图 4 个分类，约 2,900 条精选提示词',
    format: 'json',
    modelCategory: 'AI 图片',
    kind: 'image',
    builtin: true,
  },
  {
    id: 'shuixian-prompts',
    name: '水仙 AI 提示词',
    repo: 'https://github.com/BaYue-SYJ/shuixian-prompts',
    dataUrl:
      'https://raw.githubusercontent.com/BaYue-SYJ/shuixian-prompts/main/shuixian-unified/data/prompts.part1.json',
    dataUrls: [
      'https://raw.githubusercontent.com/BaYue-SYJ/shuixian-prompts/main/shuixian-unified/data/prompts.part1.json',
      'https://raw.githubusercontent.com/BaYue-SYJ/shuixian-prompts/main/shuixian-unified/data/prompts.part2.json',
      'https://raw.githubusercontent.com/BaYue-SYJ/shuixian-prompts/main/shuixian-unified/data/prompts.part3.json',
    ],
    imageBase:
      'https://cdn.jsdelivr.net/gh/BaYue-SYJ/shuixian-prompts@main/shuixian-unified/',
    note: '5,000+ 中文图片提示词，覆盖即梦、可灵、Seedream、Midjourney 等模型',
    format: 'json',
    modelCategory: '即梦',
    kind: 'image',
    builtin: true,
  },
  {
    id: 'minimax-h3-official',
    name: 'MiniMax H3 官方提示词',
    repo: 'https://github.com/MiniMax-AI/MiniMax-H3',
    dataUrl:
      'https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/h3-prompt-writing/references/base-en.txt',
    dataUrls: [
      'https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/h3-prompt-writing/SKILL.md',
      'https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/h3-prompt-writing/references/base-en.txt',
      'https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/h3-prompt-writing/references/ref-en.txt',
      'https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/3d-animation-short-generator/SKILL.cn.md',
      'https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/brand-promo-video-generator/SKILL.cn.md',
      'https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/co-op-game-intro-generator/SKILL.cn.md',
      'https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/handdrawn-live-video-generator/SKILL.cn.md',
      'https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/minimalist-product-ad-generator/SKILL.cn.md',
      'https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/music-video-subtitle-generator/SKILL.cn.md',
      'https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/paper-collage-explainer-generator/SKILL.cn.md',
      'https://raw.githubusercontent.com/MiniMax-AI/MiniMax-H3/main/skills/papercraft-stop-motion-explainer/SKILL.cn.md',
    ],
    mediaByUrl: MINIMAX_H3_MEDIA,
    imageBase: '',
    note: '官方 11 份提示词资产：写作规范、基础 / 全参考指南，以及 8 套带 GIF 预览的视频风格工作流',
    format: 'text',
    modelCategory: 'MiniMax H3',
    kind: 'video',
    builtin: true,
  },
  {
    id: 'minimax-h3-official-cases',
    name: 'MiniMax H3 官方视频案例',
    repo: 'https://github.com/MiniMax-AI/MiniMax-H3/tree/main/scripts/readme',
    dataUrl: Object.keys(MINIMAX_H3_CASE_MEDIA)[0]!,
    dataUrls: Object.keys(MINIMAX_H3_CASE_MEDIA),
    mediaByUrl: MINIMAX_H3_CASE_MEDIA,
    imageBase: '',
    note: '3 个官方可复现视频请求：T2VA / FL2VA / Ref2VA 768p，脚本提示词与 MP4 一一对应',
    format: 'request',
    modelCategory: 'MiniMax H3',
    kind: 'video',
    builtin: true,
  },
  {
    id: 'atlascloud-minimax-h3',
    name: 'AtlasCloud MiniMax H3',
    repo: 'https://github.com/AtlasCloudAI/awesome-minimax-h3-prompts',
    dataUrl:
      'https://raw.githubusercontent.com/AtlasCloudAI/awesome-minimax-h3-prompts/main/data/prompts.json',
    fallbackDataUrl:
      'https://cdn.jsdelivr.net/gh/AtlasCloudAI/awesome-minimax-h3-prompts@main/data/prompts.json',
    imageBase: '',
    note: '103 条 MiniMax H3 展示案例，全部带视频，34 条带参考图；CC BY 4.0',
    format: 'json',
    modelCategory: 'MiniMax H3',
    kind: 'video',
    builtin: true,
  },
  {
    id: 'learnprompt-seedance',
    name: 'LearnPrompt Seedance',
    repo: 'https://github.com/LearnPrompt/awesome-seedance',
    dataUrl:
      'https://raw.githubusercontent.com/LearnPrompt/awesome-seedance/main/data/cases.json',
    fallbackDataUrl:
      'https://cdn.jsdelivr.net/gh/LearnPrompt/awesome-seedance@main/data/cases.json',
    imageBase: '',
    note: '903 条 Seedance 2.5 / 2.0 视频案例，带作者、来源和复测信息',
    format: 'json',
    modelCategory: 'Seedance',
    kind: 'video',
    builtin: true,
  },
  {
    /** 用例结构：`### 例 N: [标题](原推文)（by [@作者](主页)）` + 一张图 + 一个提示词代码块 */
    id: 'nano-banana',
    name: 'Awesome Nano Banana',
    repo: 'https://github.com/PicoTrex/Awesome-Nano-Banana-images',
    dataUrl: 'https://cdn.jsdelivr.net/gh/PicoTrex/Awesome-Nano-Banana-images@main/README.md',
    /** README 里的图片路径就是**仓库根相对**（`images/pro_case1/output.jpg`），基址取根 */
    imageBase: 'https://cdn.jsdelivr.net/gh/PicoTrex/Awesome-Nano-Banana-images@main',
    note: 'Nano Banana / Nano Banana Pro 的分场景案例，每条带完整提示词与原作者',
    format: 'readme',
    modelCategory: 'Nano Banana',
    kind: 'image',
    builtin: true,
  },
  /**
   * YouMind 三家共用同一套版式（`### No. N:` + `#### 📝 Prompt` + `#### 🖼`），
   * 所以只加一种 `readmeStyle`。它们的生成图**托管在自己的 CMS 上（绝对地址）**，
   * 所以 `imageBase` 留空 —— 留空时解析器不会去拼相对路径（拼了就是一条死链）。
   */
  {
    id: 'youmind-nano-banana-pro',
    name: 'YouMind Nano Banana Pro',
    repo: 'https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts',
    dataUrl:
      'https://cdn.jsdelivr.net/gh/YouMind-OpenLab/awesome-nano-banana-pro-prompts@main/README.md',
    imageBase: '',
    note: 'Nano Banana Pro 提示词库（按编号分节，每组带生成图）',
    format: 'readme',
    readmeStyle: 'youmind',
    modelCategory: 'Nano Banana',
    kind: 'image',
    builtin: true,
  },
  {
    id: 'youmind-gpt-image-2',
    name: 'YouMind GPT Image 2',
    repo: 'https://github.com/YouMind-OpenLab/awesome-gpt-image-2',
    dataUrl: 'https://cdn.jsdelivr.net/gh/YouMind-OpenLab/awesome-gpt-image-2@main/README.md',
    imageBase: '',
    note: 'GPT Image 2 提示词库（按编号分节，每组带生成图）',
    format: 'readme',
    readmeStyle: 'youmind',
    modelCategory: 'GPT Image',
    kind: 'image',
    builtin: true,
  },
  {
    id: 'youmind-seedance-2',
    name: 'YouMind Seedance 2.0',
    repo: 'https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts',
    dataUrl:
      'https://cdn.jsdelivr.net/gh/YouMind-OpenLab/awesome-seedance-2-prompts@main/README.md',
    imageBase: '',
    note: 'Seedance 2.0 视频提示词库（按编号分节）',
    format: 'readme',
    /**
     * ⚠️ 这家**两段格式并存**：前 6 条是 `### No. N:`（Featured），
     * 后面 `## 🎬 All Prompts` 下还有 100 多条**纯 `### 标题`**（没有编号）。
     * 只认 `No.` 会只拿到 6 条（实测踩到）—— 所以用"所有三级标题都算案例"这条规则。
     */
    readmeStyle: 'youmindAll',
    modelCategory: 'Seedance',
    kind: 'video',
    builtin: true,
  },
  {
    /** 顶层就是数组的 JSON（见 `parseFlatJsonCases`）：`title` / `prompt` / `preview` / `author` */
    id: 'banana-quicker',
    name: 'Banana Prompt Quicker',
    repo: 'https://github.com/glidea/banana-prompt-quicker',
    dataUrl: 'https://cdn.jsdelivr.net/gh/glidea/banana-prompt-quicker@main/prompts.json',
    /** 它数据里的预览图本来就是 jsDelivr 绝对地址，不需要基址 */
    imageBase: '',
    note: '323 条实战提示词，按工作 / 生活 / 学习等场景分类，带预览图与作者',
    format: 'json',
    modelCategory: 'Nano Banana',
    kind: 'image',
    builtin: true,
  },
]

/** 旧调用点仍可用这个别名；新代码用 `DEFAULT_INSPIRATION_SOURCES` 表达“内置默认”。 */
export const INSPIRATION_SOURCES = DEFAULT_INSPIRATION_SOURCES

export function sourceById(id: string): InspirationSource | undefined {
  return DEFAULT_INSPIRATION_SOURCES.find((s) => s.id === id)
}

export interface GithubRepoRef {
  owner: string
  name: string
  fullName: string
  webUrl: string
}

/**
 * 管理来源面板只收 GitHub 仓库地址（也接受 `owner/repo`）。
 * 和来源无关的 URL、空串一律拒绝，避免在面板里造出一个永远拉不动的来源。
 */
export function parseGithubRepoInput(raw: string): GithubRepoRef | null {
  const value = raw.trim()
  if (!value) return null
  const github = /github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/i.exec(value)
  const short = /^([\w.-]+)\/([\w.-]+)$/.exec(value)
  const owner = github?.[1] ?? short?.[1]
  const name = github?.[2] ?? short?.[2]
  if (!owner || !name || name.includes(' ')) return null
  const fullName = `${owner}/${name}`
  return { owner, name, fullName, webUrl: `https://github.com/${fullName}` }
}

/**
 * 自定义来源按管理面板口径：只填名称 / GitHub 仓库 / 模型 / 类型。
 * README 走 `youmindAll`（所有三级标题 + 提示词代码块），绝对地址图片与视频都能解析。
 */
export function customInspirationSource(input: {
  name: string
  repo: string
  modelCategory: string
  kind: InspirationMediaKind
}): InspirationSource | null {
  const ref = parseGithubRepoInput(input.repo)
  const name = input.name.trim()
  const modelCategory = input.modelCategory.trim()
  if (!ref || !name || !modelCategory) return null
  return {
    id: `custom:${ref.fullName.toLowerCase()}`,
    name,
    repo: ref.webUrl,
    dataUrl: `https://cdn.jsdelivr.net/gh/${ref.fullName}@main/README.md`,
    fallbackDataUrl: `https://cdn.jsdelivr.net/gh/${ref.fullName}@master/README.md`,
    imageBase: `https://cdn.jsdelivr.net/gh/${ref.fullName}@main`,
    note: `${ref.fullName} · 自定义 GitHub 来源（README 三级标题 + 代码块）`,
    format: 'readme',
    readmeStyle: 'youmindAll',
    modelCategory,
    kind: input.kind,
    builtin: false,
  }
}
