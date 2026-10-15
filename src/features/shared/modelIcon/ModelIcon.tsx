/**
 * 固定模型目录用的**厂商官方图标**（用户 2026-09-27 第 8 轮：「这些模型的 logo
 * 我要官方的 logo，png 格式，给我找一下，或者复刻一下，当前的不太像」）。
 *
 * ## 为什么住在 `features/shared/`
 *
 * 这个图标有**两个消费方**：画布生成节点的模型下拉（前端）与设置页的模型映射行
 * （后端）。它原先住在 `workbenches/canvas/panels/` 下——那是画布私有层，设置页
 * （`pages/`）引用它会踩「共享层不得依赖工作台私有层」的边界。
 * **先试过放 `ui/`，被 `ui-stateless` 规则拦下**（ui 层只许依赖 ui 与 shared，
 * 不许碰 assets 与 react），故落到前后端都能引用的 `features/shared/`。
 * 同一份实现、两处引用 ⇒ 同一个模型在两处不可能画出两个样。
 *
 * ## 为什么**默认 20px**（图标比文字上下各大 3px 的统一口径）
 *
 * 用户 2026-10-15 第二轮：「图标要比文字上下大 3 个像素，上面大 3 个下面大 3 个」。
 *
 * 落地口径只有一句：**图标 = 同行文字字号 + 6px**（上下各 3）。
 * ⚠️ 只加 3px 是错的 —— 那是上下各 1.5px，实测不被接受。
 *
 * 所以这个 20px 对应的是 **14px 的字**（`--fs-nav` / `--fs-label`）：
 * 设置页模型映射行传的就是它。18px 字的地方（浮层列表行 `--picker-option-fs`）
 * 要 24px，由 `ParamPicker.module.css` 的 `.rowIcon` 覆盖 ——
 * 同一份图标、按字号配尺寸，不该一刀切。字号不同的调用方显式传 `size`。
 *
 * 想换图标时只改这一个文件与 `modelLogoPaths.ts`，调用方只认 `vendor`。
 */
import type { SVGProps } from 'react'
import type { PresetVendor } from '../../../domain/project/modelPresets'
import styles from './ModelIcon.module.css'

import { MODEL_LOGO_PATHS } from './modelLogoPaths'

/** 每个厂商的中文名，供悬停提示（图标本身是 `aria-hidden` 的装饰） */
const VENDOR_LABEL: Record<PresetVendor, string> = {
  openai: 'OpenAI',
  google: 'Google',
  midjourney: 'Midjourney',
  bytedance: '字节跳动',
  fal: 'fal',
  minimax: 'MiniMax',
  alibaba: '阿里',
  agnes: 'Agnes',
  deepseek: 'DeepSeek',
  zhipu: '智谱 GLM',
  tencent: '腾讯混元',
}

interface ModelIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  vendor: PresetVendor
  size?: number
}

/**
 * 渲染：`<svg>` 直接内联厂商路径，**不套容器底板**。
 *
 * 为什么要内联而不是 `<img src=...png>`：`fill="currentColor"` 只在内联 SVG 里
 * 才会继承父级文字色 —— 走 `<img>` 时图片是独立文档，吃不到外部颜色，
 * 深色主题下会一直是黑的（正是旧版必须加底板的原因）。
 * 内联之后颜色自动跟主题反转，底板也就没有必要了。
 */
export function ModelIcon({ vendor, size = 20 }: ModelIconProps) {
  return (
    <svg
      className={styles.icon}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      data-model-icon={vendor}
      aria-hidden
    >
      <title>{VENDOR_LABEL[vendor]}</title>
      {MODEL_LOGO_PATHS[vendor].map((d, i) => (
        <path key={i} d={d} fillRule="evenodd" clipRule="evenodd" />
      ))}
    </svg>
  )
}
