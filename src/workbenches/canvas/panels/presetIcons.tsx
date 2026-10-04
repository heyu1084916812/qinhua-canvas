import type { ReactNode, SVGProps } from 'react'
import { IconModelCube } from '../toolbar/icons'

/**
 * 预设菜单里**每一条各自的图标**（用户 2026-10-05 第 8 条：参考截图重做矢量图）。
 *
 * 与 `toolbar/icons.tsx` 那套的分工：那边是画布工具（排列 / 分组 / 循环…），
 * 这边只服务预设菜单，形状照用户给的那张参考（图九）逐条对：
 * 故事板 = 带斜线的画框、25 宫格 = 3×3、四宫格 = 2×2、推演 = 时钟 + 箭头、
 * 全景 = 宽幅相机、多机位 = 带镜头的九宫格、三视图 = 画框里的人脸 / 人、
 * 场景 = 叠层、产品 = 立方体、质感 = 带星的人脸、光影 = 风景画框。
 *
 * 统一口径与主图标集一致：24×24、`stroke: currentColor`、线宽 1.6、圆头圆角。
 */
interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  size?: number
}

function Svg({ size = 16, children, ...rest }: IconProps & { children: ReactNode }) {
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
      {...rest}
    >
      {children}
    </svg>
  )
}

/** 调度故事板：画框 + 一道分镜斜线 + 起手点 */
function IconShotList(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.4" y="5" width="15.2" height="14" rx="2.4" />
      <path d="M7.8 16.2 16 8.4" />
      <circle cx="9.4" cy="9.4" r="1.1" />
    </Svg>
  )
}

/** 故事板：画框 + 两栏（一格画面、一格说明） */
function IconStoryboard(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.4" y="5" width="15.2" height="14" rx="2.4" />
      <path d="M9.2 5v14" />
      <path d="M12.4 8.6h4.4M12.4 12h4.4M12.4 15.4h2.8" />
    </Svg>
  )
}

/** 3×3 宫格（25 宫格连贯分镜） */
function IconGrid3(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2.4" />
      <path d="M9.34 4v16M14.66 4v16M4 9.34h16M4 14.66h16" />
    </Svg>
  )
}

/** 2×2 宫格（剧情推演四宫格） */
function IconGrid2(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2.4" />
      <path d="M12 4v16M4 12h16" />
    </Svg>
  )
}

/** 时钟 + 顺时针箭头（画面推演：3 秒后） */
function IconClockAfter(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11.4" cy="12.2" r="6.2" />
      <path d="M11.4 8.8v3.4l2.4 1.6" />
      <path d="M18.6 6.2v3.4h-3.4" />
      <path d="M18.4 9.4a7.6 7.6 0 0 0-2.6-2.6" />
    </Svg>
  )
}

/** 时钟 + 逆时针箭头（画面推演：5 秒前） */
function IconClockBefore(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12.6" cy="12.2" r="6.2" />
      <path d="M12.6 8.8v3.4l-2.4 1.6" />
      <path d="M5.4 6.2v3.4h3.4" />
      <path d="M5.6 9.4a7.6 7.6 0 0 1 2.6-2.6" />
    </Svg>
  )
}

/** 720 全景：宽幅相机（弧面 + 中央镜头） */
function IconPanorama(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.4 9.6c2.7-1.7 5.6-2.5 8.6-2.5s5.9.8 8.6 2.5v4.8c-2.7 1.7-5.6 2.5-8.6 2.5s-5.9-.8-8.6-2.5z" />
      <circle cx="12" cy="12" r="1.5" />
    </Svg>
  )
}

/** 多机位九宫格：3×3 + 中间那颗镜头 */
function IconMultiCam(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2.4" />
      <path d="M9.34 4v16M14.66 4v16M4 9.34h16M4 14.66h16" />
      <circle cx="12" cy="12" r="1.3" />
    </Svg>
  )
}

/** 角色脸部三视图：画框 + 人脸 + 转向箭头 */
function IconFaceTurn(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4.6" width="13.4" height="13.4" rx="3" />
      <path d="M8.6 9.8h.01M13 9.8h.01" />
      <path d="M8.8 13.2c1.2 1 2.6 1 3.8 0" />
      <path d="M19.6 9.4a6.6 6.6 0 0 1 0 5.2" />
      <path d="M20.8 18.6v-3.4h-3.4" />
    </Svg>
  )
}

/** 角色（设定图 / 三视图）：一个人 */
function IconPerson(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="9" r="3.2" />
      <path d="M6.4 19.2c0-3.1 2.5-5.2 5.6-5.2s5.6 2.1 5.6 5.2" />
    </Svg>
  )
}

/** 场景设定图：叠层 */
function IconSceneLayers(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m12 4.4 7.2 3.6L12 11.6 4.8 8z" />
      <path d="m4.8 12.2 7.2 3.6 7.2-3.6" />
      <path d="m4.8 16 7.2 3.6L19.2 16" />
    </Svg>
  )
}

/** 人像质感调节：带星的人脸 */
function IconFaceSparkle(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10.8" cy="12.6" r="6.2" />
      <path d="M8.6 11h.01M12.8 11h.01" />
      <path d="M8.4 14.6c1.4 1.2 3.2 1.2 4.6 0" />
      <path d="m18.6 3.6.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" />
    </Svg>
  )
}

/** 电影级光影校正：风景画框 */
function IconPicture(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.6" y="5" width="16.8" height="14" rx="2.4" />
      <circle cx="8.6" cy="9.6" r="1.3" />
      <path d="m5.2 16.4 4.4-4.2 3.2 3 2.8-2.6 3.6 3.4" />
    </Svg>
  )
}

/**
 * 预设 id → 图标。**逐条映射**（不是按分类给一个）：用户第 8 条要的就是
 * 「每条有自己的矢量图」，按分类复用等于回到了上一版的样子。
 */
export const PRESET_ICON: Record<string, ReactNode> = {
  'shot-list': <IconShotList />,
  storyboard: <IconStoryboard />,
  'storyboard-25': <IconGrid3 />,
  'beats-4': <IconGrid2 />,
  'later-3s': <IconClockAfter />,
  'earlier-5s': <IconClockBefore />,
  'panorama-720': <IconPanorama />,
  'multicam-9': <IconMultiCam />,
  'face-turnaround': <IconFaceTurn />,
  'body-turnaround': <IconPerson />,
  'character-sheet': <IconPerson />,
  'scene-sheet': <IconSceneLayers />,
  'product-sheet': <IconModelCube />,
  'portrait-texture': <IconFaceSparkle />,
  'cinematic-light': <IconPicture />,
}
