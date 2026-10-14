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

export interface InspirationSource {
  id: string
  /** 来源名（左侧列表用，与仓库自述一致） */
  name: string
  /** 仓库地址（出处，给人点） */
  repo: string
  /** 数据文件的 raw 地址（唯一要联网取的东西） */
  dataUrl: string
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
  format: 'json' | 'readme'
  /** README 型的版式（`format: 'readme'` 时用；不填 = `pico`） */
  readmeStyle?: ReadmeStyle
}

/**
 * 预置来源（2026-10-14 实查：星数高、仓库真实存在、数据文件可直取）。
 *
 * ⚠️ 这里**只放有结构化数据文件**的仓库。README 型（内容写在 markdown 表格 / 列表里）
 * 要另写解析器，那些留到后面按需接 —— 不在这里假装能读。
 *
 * ⚠️ **地址一律走 jsDelivr（`cdn.jsdelivr.net/gh/...`）而不是 raw.githubusercontent.com**：
 * 2026-10-14 实测本机访问 raw 多次 **连接超时**（同一时刻 jsDelivr 1.7 秒返回），
 * 而用户在国内 —— 灵感库的刷新成功率直接取决于这条链路的可达性。
 * jsDelivr 是 GitHub 的只读镜像 CDN，路径规则 `gh/OWNER/REPO@BRANCH/PATH`。
 */
export const INSPIRATION_SOURCES: readonly InspirationSource[] = [
  {
    id: 'gpt-image-2',
    name: 'Awesome GPT Image 2',
    repo: 'https://github.com/freestylefly/awesome-gpt-image-2',
    dataUrl: 'https://cdn.jsdelivr.net/gh/freestylefly/awesome-gpt-image-2@main/data/cases.json',
    /** 实测：图片在仓库的 `data/images/`（数据文件里的 `/images/...` 是站点路径） */
    imageBase: 'https://cdn.jsdelivr.net/gh/freestylefly/awesome-gpt-image-2@main/data',
    note: '541 条 GPT Image 2 案例，带完整提示词与原作者署名',
    format: 'json',
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
  },
]

export function sourceById(id: string): InspirationSource | undefined {
  return INSPIRATION_SOURCES.find((s) => s.id === id)
}
