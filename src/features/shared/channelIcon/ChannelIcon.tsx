import type { CSSProperties, SVGProps } from 'react'
import styles from './ChannelIcon.module.css'

/**
 * **内置品牌彩色图**（用户第 20 批：「换成彩色版」）—— 三条固定渠道用官网图，
 * 不跟我画的那套单色矢量标记混。Agnes 用的是仓库里早就有的那张（`model-logos/agnes.png`）。
 * 想换图只动这一份映射与 `assets/channel-logos/`。
 */
import modelscopeLogo from '../../../assets/channel-logos/modelscope.ico'
import agnesLogo from '../../../assets/channel-logos/agnes.png'
import runninghubLogo from '../../../assets/channel-logos/runninghub.ico'
import logo65535 from '../../../assets/channel-logos/65535.svg'

const LOGOS: Record<string, string> = {
  modelscope: modelscopeLogo,
  agnes: agnesLogo,
  /** API 那条与 CLI 那条是同一个品牌，共用一张图 */
  'runninghub-api': runninghubLogo,
  runninghub: runninghubLogo,
  '65535': logo65535,
  '65535-chat': logo65535,
  '65535-task': logo65535,
  '65535-image-sync': logo65535,
}

/**
 * 渠道图标（用户第 19 批 #4/#5）。
 *
 * 三种来源，优先级从高到低：① 用户上传的图（`channel.icon` 是 data URL）；
 * ② **内置品牌矢量标记**（按协议 id 取：ModelScope / Agnes / RunningHub）；
 * ③ **通用矢量标记**（认不出协议时兜底 —— 用户原话「自定义的渠道默认有一个矢量图标」）。
 *
 * 为什么是矢量（SVG）而不是 PNG：用户明确要「矢量图标」——它不是照片，
 * 要跟着字号缩放、跟着主题换色（`stroke: currentColor`，两套主题自动反转）。
 * 想换标记时只改下面这份 `MARKS`，调用方只认协议 id。
 *
 * 住在 `features/shared/` 与 `ModelIcon` 同一条理由：设置页要用、画布侧也可能要用，
 * 放工作台私有层会被依赖方向守卫拦下。
 */

/** 通用矢量标记（自定义 / 认不出协议时兜底）：插头意象 —— 用户要的「默认有一个矢量图标」 */
const FALLBACK = 'M12 3v5M8.5 8h7v4.5a3.5 3.5 0 0 1-7 0zM12 16v5'

const LABEL: Record<string, string> = {
  modelscope: 'ModelScope 魔搭',
  agnes: 'Agnes',
  'runninghub-api': 'RunningHub',
  runninghub: 'RunningHub',
  '65535': '65535',
  '65535-chat': '65535',
  '65535-task': '65535',
  '65535-image-sync': '65535',
}

export interface ChannelIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** 协议 id（决定用哪枚内置标记） */
  protocol: string
  /** 用户上传的图标（data URL）；给了就优先用它 */
  icon?: string | null
  size?: number
}

export function ChannelIcon({ protocol, icon, size = 18 }: ChannelIconProps) {
  /**
   * 优先级：**用户上传的图** → **内置品牌彩色图** → 单色矢量标记（兜底）。
   * 内置那三张是颜色图，跟"上传一张图"是同一种画法（都进 `<img>`），
   * 所以两者共用同一段渲染，不再分叉。
   */
  const src = icon ?? LOGOS[protocol] ?? ''
  if (src) {
    return (
      <span
        className={styles.plate}
        style={{ '--channel-plate': `${size}px` } as CSSProperties}
        data-channel-icon={protocol}
        data-channel-icon-kind={icon ? 'image' : 'brand'}
        title={LABEL[protocol] ?? '自定义渠道'}
        aria-hidden
      >
        <img className={styles.image} src={src} alt="" width={size} height={size} data-channel-icon-img />
      </span>
    )
  }
  return (
    <span
      className={styles.plate}
      style={{ '--channel-plate': `${size}px` } as CSSProperties}
      data-channel-icon={protocol}
      data-channel-icon-kind="default"
      title={LABEL[protocol] ?? '自定义渠道'}
      aria-hidden
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d={FALLBACK} />
      </svg>
    </span>
  )
}
