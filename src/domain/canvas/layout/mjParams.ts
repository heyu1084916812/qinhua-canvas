/**
 * **Midjourney 独有的风格参数**（用户 2026-10-03：参考图二做一个面板，放在参数后面）。
 *
 * ## 值域出处（**有一处要如实说明**）
 *
 * 取自 Midjourney 官方参数表：
 *
 * | 参数 | 官方写法 | 值域 | 默认 |
 * | --- | --- | --- | --- |
 * | 风格化程度 | `--stylize` / `--s` | 0–1000 | 100 |
 * | 怪异度 | `--weird` / `--w` | 0–3000 | 0 |
 * | 多样性（混乱度） | `--chaos` / `--c` | 0–100 | 0 |
 * | 个性化风格 | `--p` | 一段个性化代码（字符串） | 空 |
 *
 * ⚠️ **本机没能直读官网**：`docs.midjourney.com` / `help.midjourney.com` /
 * `www.midjourney.com` 三个域名对 Node 直连与**无痕系统 Chrome** 都回 **403
 * （Cloudflare 安全验证）**，本机也拿不到浏览器控制通道（`unsupported Codex auth method`）。
 * 所以这几档是**公开的官方参数表**，不是这一次从官网页面上读下来的 ——
 * 已记入对账清单待有网络条件时复核。数值本身是 MJ 圈子里最稳定的一组公开口径。
 *
 * ## 为什么是「提示词后缀」而不是 JSON 字段
 *
 * Midjourney 的参数**本来就写在提示词里**（`a cat --ar 16:9 --stylize 200`）——
 * 这是它唯一被官方支持的传参方式，中转站的 MJ 代理也照这个收。
 * 所以 `mjFlags()` 拼出来的这串会**追加到提示词末尾**（见 `openaiImages.ts` 的
 * `midjourney` 分支），而不是塞进 JSON 的某个字段里。
 */

/** 三个滑杆的键（个性化风格是文本框，不在这里） */
export type MjSliderKey = 'stylize' | 'weird' | 'chaos'

export interface MjSliderSpec {
  key: MjSliderKey
  /** 面板上的中文名（图二那份） */
  label: string
  /** 悬停说明：写清官方参数名、值域与默认值 */
  hint: string
  min: number
  max: number
  /** 官方默认值（面板没设过时显示它） */
  default: number
  /** 拼进提示词用的官方长写法（`--stylize`） */
  flag: string
  /** MJ 的短别名（悬停说明里带上，用户抄去 Discord 也能用） */
  short: string
}

export const MJ_SLIDERS: readonly MjSliderSpec[] = [
  {
    key: 'stylize',
    label: '风格化程度',
    hint: 'Midjourney --stylize（0–1000，默认 100）：越高越"艺术化"，越低越贴提示词',
    flag: '--stylize',
    short: '--s',
    min: 0,
    max: 1000,
    default: 100,
  },
  {
    key: 'weird',
    label: '怪异度',
    hint: 'Midjourney --weird（0–3000，默认 0）：开启怪异美学，值越大越离奇',
    flag: '--weird',
    short: '--w',
    min: 0,
    max: 3000,
    default: 0,
  },
  {
    key: 'chaos',
    label: '多样性',
    hint: 'Midjourney --chaos（0–100，默认 0）：四张结果之间的差异程度',
    flag: '--chaos',
    short: '--c',
    min: 0,
    max: 100,
    default: 0,
  },
]

/** 「个性化风格」（`--p`）的输入上限：官方给的是短代码，不是文章 */
export const MJ_PERSONALIZE_MAX = 64

/** 面板上带 `?` 的说明文案（与 `hint` 同源，供 title 用） */
export function mjSliderByKey(key: MjSliderKey): MjSliderSpec {
  return MJ_SLIDERS.find((s) => s.key === key) ?? MJ_SLIDERS[0]!
}

/**
 * 把节点上存的值**收进官方区间**；没设过（`undefined`）时给官方默认值。
 *
 * 为什么在领域层收一道：面板那条路能保证只给合法值，但 agent 建的节点、
 * 老项目里存下来的值都可能越界 —— 发一个 `--stylize 5000` 出去，MJ 只会报错。
 */
export function mjSliderValue(raw: unknown, spec: MjSliderSpec): number {
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw ?? ''))
  if (!Number.isFinite(n)) return spec.default
  return Math.min(spec.max, Math.max(spec.min, Math.round(n)))
}

/** 面板 / 适配器共用的「这一份 MJ 参数」（已收口，可直接用来拼后缀） */
export interface MjSettings {
  stylize: number
  weird: number
  chaos: number
  /** 个性化代码（`--p`）；空串 = 没设 */
  personalize: string
}

export function mjSettingsOf(raw: unknown): MjSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const personalize = String(src.personalize ?? '').trim()
  return {
    stylize: mjSliderValue(src.stylize, mjSliderByKey('stylize')),
    weird: mjSliderValue(src.weird, mjSliderByKey('weird')),
    chaos: mjSliderValue(src.chaos, mjSliderByKey('chaos')),
    personalize: personalize.slice(0, MJ_PERSONALIZE_MAX),
  }
}

/**
 * MJ 设置 → **提示词后缀**（`--stylize 100 --weird 50 --p abc`）。
 *
 * 只写**与官方默认值不同**的那些：MJ 的参数是提示词的一部分，把默认值也写进去
 * 会平白拉长提示词（而且用户复制到 Discord 时看到的是一串噪音）。
 */
export function mjFlags(raw: unknown): string {
  const mj = mjSettingsOf(raw)
  const parts: string[] = []
  for (const spec of MJ_SLIDERS) {
    const value = mj[spec.key]
    if (value !== spec.default) parts.push(`${spec.flag} ${value}`)
  }
  /** 个性化风格没有「默认值」可言：填了就发 */
  if (mj.personalize) parts.push(`--p ${mj.personalize}`)
  return parts.join(' ')
}
