/**
 * 画布工具栏与菜单用的**线性图标集**（用户 2026-09-19）。
 *
 * 为什么自己画 SVG 而不用图标库：
 *   1. 仓库至今零图标依赖（工具栏一直用文本字形），为十来个图标引一整个库不划算；
 *   2. 这些图标的**形状本身有产品含义**（如「水平排列」= 三条竖条、「垂直排列」= 三条横条），
 *      用通用库反而要挑半天还未必对得上参考产品；
 *   3. 内联 SVG 能直接吃 `currentColor`，两套主题自动跟随，不额外接主题变量。
 *
 * 统一约定：
 *   - `stroke="currentColor"` + `fill="none"`，线宽 1.6（在 16px 下最接近参考产品的观感）；
 *   - 尺寸由调用方给（默认 16），不写死，方便菜单 / 按钮各取所需；
 *   - `viewBox` 一律 24×24、`strokeLinecap/Join = round`，保证视觉重量一致。
 */
import type { ReactNode, SVGProps } from 'react'

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
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** 提示词：灯泡（「灵光一现」，与参考产品一致） */
export function IconPrompt(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.4.3.5.8.5 1.2v.4h6v-.4c0-.4.1-.9.5-1.2A6 6 0 0 0 12 3Z" />
    </Svg>
  )
}

/** 生成：魔杖 + 星点 */
export function IconGeneration(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20 16.5 7.5" />
      <path d="M15 6 18 9" />
      <path d="M17.5 3.5v2M20.5 6.5h-2M20.7 4.3l-1.4 1.4" />
      <path d="M7 15l1.5 1.5" />
    </Svg>
  )
}

/** 对比：左右两半，一半实心 */
export function IconCompare(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="5" width="7" height="14" rx="1.6" fill="currentColor" stroke="none" />
      <rect x="13" y="5" width="7" height="14" rx="1.6" />
    </Svg>
  )
}

/** 分组：带角标的方框（「把若干节点框进出」） */
export function IconGroup(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
      <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
      <path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16" />
      <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" />
      <rect x="8.5" y="8.5" width="7" height="7" rx="1.2" />
    </Svg>
  )
}

/** 批量：叠起来的多份文件 */
export function IconBatch(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 4h6l4 4v8a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 16V5.5A1.5 1.5 0 0 1 8 4Z" />
      <path d="M14 4v4h4" />
      <path d="M4 8v10.5A1.5 1.5 0 0 0 5.5 20H15" />
    </Svg>
  )
}

/** 画板：带角标的画布 + 一支笔 */
export function IconBoard(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8" />
      <path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8" />
      <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H16" />
      <path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
      <path d="M13.5 16.5 19 11l-1.6-1.6L11.9 14.9l-.4 2z" />
    </Svg>
  )
}

/** 重置视图：逆时针回转箭头 */
export function IconReset(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 10a8 8 0 1 1 1.6 6" />
      <path d="M4 5v5h5" />
    </Svg>
  )
}

/**
 * 宫格排列：九宫格。
 * 方格比等分略小、彼此留缝，这样才像「排成格子」而不是「一张底纹」。
 */
export function IconGridArrange(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="3.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="3.5" width="5" height="5" rx="1" />
      <rect x="15.5" y="3.5" width="5" height="5" rx="1" />
      <rect x="3.5" y="9.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <rect x="15.5" y="9.5" width="5" height="5" rx="1" />
      <rect x="3.5" y="15.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="15.5" width="5" height="5" rx="1" />
      <rect x="15.5" y="15.5" width="5" height="5" rx="1" />
    </Svg>
  )
}

/** 水平排列：三条**竖条**（并排成一行） */
export function IconRowArrange(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="3.5" width="4.6" height="17" rx="1.2" />
      <rect x="9.7" y="3.5" width="4.6" height="17" rx="1.2" />
      <rect x="15.4" y="3.5" width="4.6" height="17" rx="1.2" />
    </Svg>
  )
}

/** 垂直排列：三条**横条**（叠成一列） */
export function IconColumnArrange(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4" width="17" height="4.6" rx="1.2" />
      <rect x="3.5" y="9.7" width="17" height="4.6" rx="1.2" />
      <rect x="3.5" y="15.4" width="17" height="4.6" rx="1.2" />
    </Svg>
  )
}

/** 整理节点：左右两列节点 + 一条指向右的箭头（「按连线分层」） */
export function IconTidy(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3.5" width="5" height="4" rx="1" />
      <rect x="3" y="10" width="5" height="4" rx="1" />
      <rect x="3" y="16.5" width="5" height="4" rx="1" />
      <rect x="16" y="6.5" width="5" height="4" rx="1" />
      <rect x="16" y="13.5" width="5" height="4" rx="1" />
      <path d="M8 5.5h4.5a3 3 0 0 1 3 3v0" />
      <path d="M8 18.5h4.5a3 3 0 0 0 3-3v0" />
      <path d="M12 12h6" />
      <path d="M16 9.6 18.4 12 16 14.4" />
    </Svg>
  )
}

/** 撤销 / 重做（生成按钮的箭头也用它，见 §6.8） */
export function IconUndo(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 7H4v-5" />
      <path d="M4.6 7a8 8 0 1 1-1.3 6" />
    </Svg>
  )
}

export function IconRedo(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 7h5v-5" />
      <path d="M19.4 7a8 8 0 1 0 1.3 6" />
    </Svg>
  )
}

/** 导入素材：向上箭头入盘 */
export function IconImport(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3v10" />
      <path d="M8 9.5 12 13.5 16 9.5" />
      <path d="M4 15v4.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </Svg>
  )
}
