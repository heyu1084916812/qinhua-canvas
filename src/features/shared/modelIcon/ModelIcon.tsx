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
 * ## 为什么外面套一层底板
 *
 * 有几家的图标是**单色深色线条**（OpenAI、Midjourney）。深色主题下面板底色变深时，
 * 深色线条会直接糊在背景里看不见。底板取 `--bg-surface`：浅色主题下它是白的
 * （与图标原底色一致，看不出来），深色主题下它是深灰、图标仍是深色线条也依然读得出
 * 「这里有一个 logo」，且**两套主题都不写字面量颜色**（由主题守卫强制）。
 *
 * 想换图标时只改这一个文件与那七个 PNG，调用方只认 `vendor`。
 */
import type { SVGProps } from 'react'
import type { PresetVendor } from '../../../domain/project/modelPresets'
import styles from './ModelIcon.module.css'

import openaiLogo from '../../../assets/model-logos/openai.png'
import geminiLogo from '../../../assets/model-logos/gemini.png'
import midjourneyLogo from '../../../assets/model-logos/midjourney.png'
import jimengLogo from '../../../assets/model-logos/jimeng.png'
import falLogo from '../../../assets/model-logos/fal.png'
import minimaxLogo from '../../../assets/model-logos/minimax.png'
import wanLogo from '../../../assets/model-logos/wan.png'
import agnesLogo from '../../../assets/model-logos/agnes.png'

const LOGOS: Record<PresetVendor, string> = {
  openai: openaiLogo,
  google: geminiLogo,
  midjourney: midjourneyLogo,
  bytedance: jimengLogo,
  fal: falLogo,
  minimax: minimaxLogo,
  alibaba: wanLogo,
  agnes: agnesLogo,
}

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
}

interface ModelIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  vendor: PresetVendor
  size?: number
}

export function ModelIcon({ vendor, size = 16 }: ModelIconProps) {
  return (
    <span
      className={styles.plate}
      style={{ width: `${size + 4}px`, height: `${size + 4}px` }}
      data-model-icon={vendor}
      title={VENDOR_LABEL[vendor]}
    >
      <img
        className={styles.logo}
        src={LOGOS[vendor]}
        alt=""
        width={size}
        height={size}
        data-model-logo={vendor}
      />
    </span>
  )
}
