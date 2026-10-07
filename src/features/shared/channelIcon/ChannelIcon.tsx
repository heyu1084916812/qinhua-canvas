import type { SVGProps } from 'react'
import styles from './ChannelIcon.module.css'

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

/** 内置品牌标记：键 = 协议 id（`domain/project/protocol.ts` 的 `id`） */
const MARKS: Record<string, string> = {
  /** ModelScope 魔搭：圆角方框里一道"山 / M"形 */
  modelscope: 'M4 8.2 8 12l4-3.8L16 12l4-3.8V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z',
  /** Agnes：六边形里的 A（三角 + 横杠） */
  agnes: 'M12 4l7 4v8l-7 4-7-4V8zM9.2 15.4h5.6M12 9.2l2.6 6',
  /** RunningHub：圆环 + 播放三角（"跑起来"的意象） */
  runninghub: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM10.4 8.6 15.6 12l-5.2 3.4z',
}

/** 通用标记（自定义 / 未知协议）：插头意象 */
const FALLBACK = 'M12 3v5M8.5 8h7v4.5a3.5 3.5 0 0 1-7 0zM12 16v5'

const LABEL: Record<string, string> = {
  modelscope: 'ModelScope 魔搭',
  agnes: 'Agnes',
  runninghub: 'RunningHub',
}

export interface ChannelIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** 协议 id（决定用哪枚内置标记） */
  protocol: string
  /** 用户上传的图标（data URL）；给了就优先用它 */
  icon?: string | null
  size?: number
}

export function ChannelIcon({ protocol, icon, size = 18 }: ChannelIconProps) {
  if (icon) {
    return (
      <span className={styles.plate} data-channel-icon={protocol} data-channel-icon-kind="image" aria-hidden>
        <img className={styles.image} src={icon} alt="" width={size} height={size} data-channel-icon-img />
      </span>
    )
  }
  const path = MARKS[protocol]
  return (
    <span
      className={styles.plate}
      data-channel-icon={protocol}
      data-channel-icon-kind={path ? 'brand' : 'default'}
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
        <path d={path ?? FALLBACK} />
      </svg>
    </span>
  )
}
