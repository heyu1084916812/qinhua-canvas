/**
 * 固定模型目录用的**厂商官方图标**（用户 2026-09-27 第 8 轮：「这些模型的 logo
 * 我要官方的 logo，png 格式，给我找一下，或者复刻一下，当前的不太像」）。
 *
 * 上一版是手绘的抽象几何标记，用户对照参考图后认为「不太像」，故换成**真实官方
 * 图标的 PNG**（128px，取自各厂商站点图标，见 `src/assets/model-logos/`）。
 *
 * ## 为什么外面套一层底板
 *
 * 有几家的图标是**单色深色线条**（OpenAI、Midjourney）。深色主题下面板底色变深时，
 * 深色线条会直接糊在背景里看不见 —— 这与本文件上一版踩过的是同一类问题。
 * 底板取 `--bg-surface`：浅色主题下它是白的（与图标原底色一致，看不出来），
 * 深色主题下它是深灰、图标仍是深色线条也依然读得出「这里有一个 logo」，
 * 且**两套主题都不写字面量颜色**（由主题守卫强制）。
 *
 * 想要换图标时只改这一个文件与那七个 PNG，调用方只认 `vendor`。
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

const LOGOS: Record<PresetVendor, string> = {
  openai: openaiLogo,
  google: geminiLogo,
  midjourney: midjourneyLogo,
  bytedance: jimengLogo,
  fal: falLogo,
  minimax: minimaxLogo,
  alibaba: wanLogo,
}

/** 每个厂商的中文名，供无障碍朗读（图标本身是 `aria-hidden` 的装饰） */
const VENDOR_LABEL: Record<PresetVendor, string> = {
  openai: 'OpenAI',
  google: 'Google',
  midjourney: 'Midjourney',
  bytedance: '字节跳动',
  fal: 'fal',
  minimax: 'MiniMax',
  alibaba: '阿里',
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
