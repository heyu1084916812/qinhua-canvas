/**
 * 灵感库的来源清单（用户 2026-10-14：「我要在左边菜单加一个灵感库，用 github 上
 * 开源的库，直接链接他们的内容」）。
 *
 * 每个来源 = **GitHub 仓库里的一个数据文件**。轻画只拉这个文件（纯文本索引），
 * 预览图与视频一律走**原始外链** —— 用户明确说过「同步本地太大了，因为里面还有视频」。
 * 所以这里没有"下载媒体"这件事，只有"拉一份 JSON / 解析成案例"。
 */
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
}

/**
 * 预置来源（2026-10-14 实查：星数高、仓库真实存在、数据文件可直取）。
 *
 * ⚠️ 这里**只放有结构化数据文件**的仓库。README 型（内容写在 markdown 表格 / 列表里）
 * 要另写解析器，那些留到后面按需接 —— 不在这里假装能读。
 */
export const INSPIRATION_SOURCES: readonly InspirationSource[] = [
  {
    id: 'gpt-image-2',
    name: 'Awesome GPT Image 2',
    repo: 'https://github.com/freestylefly/awesome-gpt-image-2',
    dataUrl:
      'https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data/cases.json',
    /** 实测：图片在仓库的 `data/images/`（数据文件里的 `/images/...` 是站点路径） */
    imageBase: 'https://raw.githubusercontent.com/freestylefly/awesome-gpt-image-2/main/data',
    note: '541 条 GPT Image 2 案例，带完整提示词与原作者署名',
  },
]

export function sourceById(id: string): InspirationSource | undefined {
  return INSPIRATION_SOURCES.find((s) => s.id === id)
}
