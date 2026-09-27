/**
 * 固定模型目录用的**厂商矢量图标**（用户 2026-09-27：「前方需要加相关的矢量图标」）。
 *
 * 刻意画成**抽象几何标记**而不是各家的官方 logo：
 *   1. 这些商标不属于本项目，直接复刻官方 logo 不合适；
 *   2. 面板里这些图标只有 16px，作用是「一眼分辨厂商」，
 *      抽象标记（螺旋 / 星芒 / 帆 / 种子 …）在这个尺寸下同样好认；
 *   3. 与 `toolbar/icons.tsx` 同一套约定：`currentColor` + 1.6 线宽，
 *      两套主题自动跟随，不额外接主题变量。
 *
 * 想要换成官方图标时，只改这一个文件即可（调用方只认 `vendor`）。
 */
import type { SVGProps } from 'react'
import type { PresetVendor } from '../../../domain/project/modelPresets'

interface ModelIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  vendor: PresetVendor
  size?: number
}

export function ModelIcon({ vendor, size = 16, ...rest }: ModelIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-model-icon={vendor}
      {...rest}
    >
      {SHAPES[vendor]}
    </svg>
  )
}

const SHAPES: Record<PresetVendor, JSX.Element> = {
  /** OpenAI：花瓣结（抽象螺旋，不复制官方标志） */
  openai: (
    <>
      <path d="M12 4.2c2.2-1.2 4.6.2 4.6 2.6" />
      <path d="M19.8 12c1.2 2.2-.2 4.6-2.6 4.6" />
      <path d="M12 19.8c-2.2 1.2-4.6-.2-4.6-2.6" />
      <path d="M4.2 12c-1.2-2.2.2-4.6 2.6-4.6" />
      <circle cx="12" cy="12" r="3.4" />
    </>
  ),
  /** Google / Gemini：四角星芒 */
  google: (
    <>
      <path d="M12 3.5c.9 4.6 3.4 7.1 8 8-4.6.9-7.1 3.4-8 8-.9-4.6-3.4-7.1-8-8 4.6-.9 7.1-3.4 8-8Z" />
    </>
  ),
  /** Midjourney：帆船（三角帆 + 船身） */
  midjourney: (
    <>
      <path d="M13 4.5 13 15" />
      <path d="M13 5.5 6.5 15H13" />
      <path d="M4 17.5h15l-2 3.5H6l-2-3.5Z" />
    </>
  ),
  /** 字节 / 即梦：破土种子（一叶 + 芽） */
  bytedance: (
    <>
      <path d="M12 20v-6.5" />
      <path d="M12 13.5c-3.6 0-5.5-2-5.5-5.5 3.6 0 5.5 2 5.5 5.5Z" />
      <path d="M12 13.5c0-3.6 2-5.5 5.5-5.5 0 3.6-2 5.5-5.5 5.5Z" />
    </>
  ),
  /** MiniMax：三层递进箭头 */
  minimax: (
    <>
      <path d="M4 17 10 11 14 15 20 7" />
      <path d="M15 7h5v5" />
      <path d="M4 20.5h16" />
    </>
  ),
  /** fal：闪电 */
  fal: (
    <>
      <path d="M13.5 3.5 6 13.5h5l-1 7 8-10.5h-5l.5-6.5Z" />
    </>
  ),
  /** 阿里 / Wan：云涡 */
  alibaba: (
    <>
      <path d="M7.5 18.5a4 4 0 0 1-.4-8 5 5 0 0 1 9.6-1.2 3.6 3.6 0 0 1 .6 7.1" />
      <path d="M9.5 18.5h7" />
    </>
  ),
}
