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

/** 连接到已有节点：两个节点块之间一条连线（§6.14「连接已有节点」区分于「新建」） */
export function IconLink(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.5" y="7.5" width="6" height="9" rx="1.4" />
      <rect x="15.5" y="7.5" width="6" height="9" rx="1.4" />
      <path d="M8.5 12h7" />
    </Svg>
  )
}

/* ────────────────────────────────────────────────────────────
 * 正文格式图标（用户 2026-09-21）。
 *
 * 形状对齐「线性图标」：只描边、不填充、线宽与上面同一套（1.6 / 24×24）。
 * 标题用 **H1/H2/H3 字形**（用户参考图就是字），列表 / 分隔线 / 复制 / 全屏
 * 用图形——这也是参考图的分法：文字类格式给字形，结构类给图形。
 * ──────────────────────────────────────────────────────────── */

/**
 * 标题字形。用 `<text>` 而不是路径：这三个是**文字本身**（H1/H2/H3），
 * 画成路径反而失真；`font-size` 随 viewBox 缩放。
 *
 * ⚠️ 字号要**撑满视图**（用户 2026-09-21：「H1/H2/H3 好小啊，好扁啊」）：
 * 首版用 `font-size=11`，在 24 的视图里只占不到一半高——旁边的 B / I 是
 * 画满 24 的路径，两者放一起，H 系列明显小一圈、显扁。
 * 现在取 15 并把基线抬到 19，字形高度接近 14/24，与线性图标等重。
 * `fontWeight=700` 同理：线性图标有 1.6 的描边重量，细字压不住。
 */
function HeadingGlyph({ level, ...rest }: IconProps & { level: 1 | 2 | 3 }) {
  return (
    <Svg {...rest}>
      <text
        x="12"
        y="18.6"
        textAnchor="middle"
        fontSize="15.5"
        fontWeight="700"
        fill="currentColor"
        stroke="none"
        fontFamily="var(--font-sans)"
        letterSpacing="-0.4"
      >
        H{level}
      </text>
    </Svg>
  )
}

export function IconH1(props: IconProps) {
  return <HeadingGlyph level={1} {...props} />
}
export function IconH2(props: IconProps) {
  return <HeadingGlyph level={2} {...props} />
}
export function IconH3(props: IconProps) {
  return <HeadingGlyph level={3} {...props} />
}

/** 正文：一个段落符号（¶），表示「取消标题 / 列表，回到普通段落」 */
export function IconParagraph(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13 4v16" />
      <path d="M17 4v16" />
      <path d="M13 4h-3a4 4 0 0 0 0 8h3" />
    </Svg>
  )
}

/** 粗体：字形 B */
export function IconBold(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 4h6a4 4 0 0 1 0 8H7Z" />
      <path d="M7 12h7a4 4 0 0 1 0 8H7Z" />
    </Svg>
  )
}

/** 斜体：字形 I（带倾角的竖笔） */
export function IconItalic(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.5 4h-5" />
      <path d="M14.5 20h-5" />
      <path d="M14 4 10 20" />
    </Svg>
  )
}

/** 无序列表：三行，行首为圆点 */
export function IconBulletList(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="5" cy="7" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1.4" fill="currentColor" stroke="none" />
      <path d="M10 7h9M10 12h9M10 17h9" />
    </Svg>
  )
}

/** 有序列表：三行，行首为数字 */
export function IconOrderedList(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5.5 5.5 4.5V9" />
      <path d="M4 12.5h2.2L4 15h2.2" />
      <path d="M4 17h1.6a1.2 1.2 0 0 1 0 2.4H4" />
      <path d="M10 7h9M10 12h9M10 17h9" />
    </Svg>
  )
}

/** 分隔线：一条横线，两侧短竖线示意「上下断开」 */
export function IconDivider(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 12h18" />
      <path d="M7 7v2M12 7v2M17 7v2" opacity="0.35" />
      <path d="M7 15v2M12 15v2M17 15v2" opacity="0.35" />
    </Svg>
  )
}

/** 复制：两层叠放的方框（与跟随栏「复制」同一形状，语义一致） */
export function IconCopyText(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="9" width="11" height="11" rx="1.6" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </Svg>
  )
}

/** 全屏编辑：四角向外（进入）/ 向内（退出）由调用方翻转 */
export function IconExpand(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9V5a1 1 0 0 1 1-1h4" />
      <path d="M20 9V5a1 1 0 0 0-1-1h-4" />
      <path d="M4 15v4a1 1 0 0 0 1 1h4" />
      <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
    </Svg>
  )
}

/**
 * 新建节点：**加号**（用户 2026-09-22）。
 *
 * 为什么必须是 SVG 而不是文本 `＋`：旧版用全角加号，靠 `rotate(45deg)` 变成 ×。
 * 但**字体的字形位置不可控**——全角 `＋` 在字体盒里是偏上/偏左放置的，
 * 实测文字盒 36×46、而真实字形只占其中一部分，于是旋转时字形绕的是一颗
 * **偏心的点**，看起来「没绕自己的中心转」（用户实测反馈）。
 *
 * 换成 SVG 后，笔画由坐标定义，`viewBox` 的几何中心就是字形中心，
 * `rotate(45deg)` 绕任何容器中心转都精确——旋转中心这件事从此是确定的。
 *
 * 形状：两条等长的正交线段，端点圆头——与工具栏其它线性图标同一套约定。
 */
export function IconPlus(props: IconProps) {
  return (
    <Svg {...props} strokeWidth={2}>
      {/* 字形占 24×24 viewBox 的 5..19（居中，四周各留 5）。
          视觉大小由调用方的尺寸 + CSS 的 padding 决定，这里只保证**几何居中**：
          5..19 的中点正是 12，与 viewBox 中心重合——旋转时绕的就是自己的中心。 */}
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Svg>
  )
}
