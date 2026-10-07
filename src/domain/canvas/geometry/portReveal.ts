/**
 * 端点的**位置与出场**（第 14 批第 4 条 + 第 15 批澄清）。
 *
 * ## 用户口径（两批合起来才是完整定义）
 *
 * **第 15 批（最新，以此为准）**：
 * - 「端点只是我的一个**动效连接点**和动效而已，他只负责动效和连出的线与另外的端点连接，
 *   只要连接到另外一个端点，或者下游节点本身的话就可以连接，
 *   然后**线的起始位置是节点的边缘**，而不是端点」；
 * - 「右边的链接点…改成**节点本身的边界**」（图三）；
 * - 「这个符号都不好看，你直接参考我画布工作区左侧功能栏的第一个按钮的静态显示，
 *   而且**大小要放大三倍**」（图一）；
 * - 「我选择悬停左边的节点的时候，**右边也会出现端点**」（图二 ⇒ 一次只露一个节点的端点）；
 * - 第 14 批留下的距离口径：「0-50 吸附…50 开始收回，70 完全收回」。
 *
 * ## 于是这里定三件事（都由本模块回答，别在各层各写一份）
 *
 * 1. **线从节点边缘起步**（`portAnchorWorld` / RF 的 Handle 都钉在边缘上）；
 *    **圆点静止时浮在边缘外面 20px**（`PORT_CENTER_OFFSET` = 20 + 半直径）——
 *    「线接在哪」与「动效点画在哪」是两件事（第 15 批澄清 + 第 16 批第 3 条把它要了回来）。
 * 2. **出场 = 从节点边缘沿横向渐显弹出**：贴住边缘（看不见）→ 滑到静止位并放大到满尺寸，
 *    收回时反过来（`pop` 管位移、`scale` 管大小、`progress` 管不透明度）。
 * 3. **一次只有一个节点的端点露出来**（`activePortNode`）：指针停在哪个节点上（或离哪个
 *    节点最近），就只露那个节点的端点 —— 否则两个挨得近的节点会一起冒端点（图二）。
 *
 * 单位只有一套：**画布自己的像素**（世界单位）。用户说的 20/50/70 都是在 100% 缩放下量的，
 * 而节点尺寸（240×160）也是这套单位；换到屏幕的 `× zoom` 由视图层做，别掺进来
 * （掺进来就会出现"放大到 300% 时指针正戳在端点上却被判成已经离开"的自相矛盾）。
 */

/**
 * 端点直径（世界单位）。
 *
 * 演进：14（第 14 批，与缩放手柄同尺寸）→ 42（第 15 批「放大三倍」）→ **21**
 *（第 16 批：「端点太大了，要缩小一半」= 42 ÷ 2）。视觉与命中区共用这一个值。
 *
 * ⚠️ RF 那个**不可见锚点盒子**不吃这个值（它有自己的公式约束，见
 * `FlowSurface.module.css` 里 `.react-flow__handle` 那一段）。
 */
export const PORT_SIZE = 21
/**
 * 静止时端点的**近边**距节点边缘多远（世界单位）—— 用户第 14 批点名的 20px。
 *
 * 第 15 批一度被撤掉（圆点骑到边缘上），第 16 批用户点名「没有保持端点的几个动效和规则」
 * ⇒ 恢复。**它与"线从哪起步"是两件事**：线一律从**节点边缘**起步（第 15 批澄清 + 第 16 批
 * 「线没有在边界」），圆点只是那个"动效连接点"，静止时浮在边缘外面 20px。
 */
export const PORT_EDGE_GAP = 20
/** 端点**圆心**相对节点边缘的外移量（世界单位）：静止位 = 20 + 半直径 */
export const PORT_CENTER_OFFSET = PORT_EDGE_GAP + PORT_SIZE / 2
/**
 * 端点**命中半径**（世界单位，从圆心算）：21 的圆点再外扩 8px，
 * 于是"按住端点"不必精确点在圆心上（与老表面 `.port::after { inset: -8px }` 同一口径）。
 */
export const PORT_HIT_RADIUS = PORT_SIZE / 2 + 8
/**
 * 命中块**往节点里再探**多少（世界单位）—— 取 `PORT_HIT_RADIUS`，不是"刚好够到边缘"。
 *
 * 为什么非要探进来：从"节点边缘往外拖"也得起得了手势，而**节点边缘那条线本身**
 * 也要罩住 —— 冒烟 / 探针是从 RF 那个 `[data-port]` 锚点盒的**中心**起拖的，
 * 而那个盒子的中心落在边界**内侧** 1px（盒子 2px 宽、`left/right: 0`，
 * 见 `FlowSurface.module.css` 的 `.react-flow__handle`）。
 *
 * 为什么留 18.5px 这么多：DOM 与 store 的坐标在个别情况下会差几像素
 *（`FlowSurface` 里那条"锚点取 DOM 的 rect、不取 store 的 x/y"的注释说的就是它），
 * 容错留小了整段手势会**起不来**（不是连错，是没反应）。第 15 批"圆点骑在边缘上"时
 * 内侧容错正好也是这个数 —— 这次只是把外侧那 20px 还给了圆点。
 * 实测（2026-10-07）：容错只留 4px 时，融合节点那组第 ⑦ 步"按住上游输出端"
 * 连 `[drop]` 日志都没有（手势根本没开始）。
 */
export const PORT_HIT_INNER_PAD = PORT_HIT_RADIUS
/** 0-50：完全弹出 + 吸附鼠标 */
export const PORT_REVEAL_FULL = 50
/** ≥70：完全收回（50→70 之间线性收回，60 正好收到一半 —— 用户点名的缓冲） */
export const PORT_REVEAL_END = 70
/** 纵向允许范围：节点上下边各再放宽这么多，超出就当作"鼠标已经离开这个节点" */
export const PORT_VERTICAL_PAD = 20
/** 收回到底时还剩多少（0 = 缩成一个点，看不出"弹出来"这件事） */
export const PORT_MIN_SCALE = 0.45

export interface PortReveal {
  /** 展开度 0..1：1 = 完全弹出，0 = 完全收回 */
  progress: number
  /** 是否"感应到"：完全展开（可以吸附鼠标） */
  hot: boolean
  /** 缩放到多大（`PORT_MIN_SCALE` → 1）：出场就是它从贴住边缘的小点"弹"到满尺寸 */
  scale: number
  /**
   * 这一帧要**沿横向收回多少**（世界单位，未带方向）：
   * `PORT_EDGE_GAP` → 0。0 = 停在静止位，`PORT_EDGE_GAP` = 缩回"贴住节点边缘"。
   *
   * 出场动画就是它：端点从**贴住节点边缘**的位置（看不见）沿着横向滑出来、渐显
   *（用户第 14 批第 4 条：「出场动画改成从节点边缘向左或右渐显弹出」）。
   * 方向由视图层按 `side` 定（左 +、右 −）—— 这里只给长度。
   */
  pop: number
}

export interface PortRevealInput {
  /** 指针到节点**这一侧边缘**的横向距离（世界单位）；负数 = 指针在节点内 */
  edgeGap: number
  /** 指针的纵坐标（世界单位） */
  pointerY: number
  /** 节点**上下边**的纵坐标（世界单位） */
  nodeTop: number
  nodeBottom: number
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * 这一刻端点该露多少。
 *
 * 三条边界（全部来自用户原话）：
 * - `edgeGap ≤ 50` ⇒ 完全展开（含负数：**指针在节点内**时保持悬停）；
 * - `50 < edgeGap < 70` ⇒ 线性收回（60 收到一半）；
 * - `edgeGap ≥ 70` ⇒ 完全收回，看不见。
 *
 * 纵向另有一条：指针必须还在节点上下边附近（±`PORT_VERTICAL_PAD`），
 * 否则算"鼠标已经离开这个节点" —— 少了它，鼠标在节点正上方 300px 处、
 * 只要横向距离够近，端点也会冒出来。
 */
export function portReveal(input: PortRevealInput): PortReveal {
  const { edgeGap, pointerY, nodeTop, nodeBottom } = input
  const inBand = pointerY >= nodeTop - PORT_VERTICAL_PAD && pointerY <= nodeBottom + PORT_VERTICAL_PAD
  if (!inBand) return { progress: 0, hot: false, scale: PORT_MIN_SCALE, pop: PORT_EDGE_GAP }
  const span = PORT_REVEAL_END - PORT_REVEAL_FULL
  const progress = clamp01((PORT_REVEAL_END - edgeGap) / span)
  return {
    progress,
    hot: edgeGap <= PORT_REVEAL_FULL,
    scale: PORT_MIN_SCALE + (1 - PORT_MIN_SCALE) * progress,
    pop: PORT_EDGE_GAP * (1 - progress),
  }
}

/** 一个节点在世界坐标下的矩形（`activePortNode` 只要这四个数，不必认识 NodeSnapshot） */
export interface PortNodeRect {
  id: string
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * 指针这一刻"属于"哪个节点 —— **只有它的端点可以露出来**（用户 2026-10-07 图二：
 * 「我选择悬停左边的节点的时候，右边也会出现端点」）。
 *
 * 判据三条，按优先级：
 * 1. **指针正戳在某个端点身上**（到**锚点** = 节点边缘上那个起点的距离 ≤ `PORT_HIT_RADIUS`）
 *    ⇒ 就是**它所属的节点**。
 *    这条必须排第一：端点离节点边缘 20px、命中块又宽，节点挨着时它会盖到**邻居的框里**，
 *    按"指针在谁的框里"判就会把落点算给邻居（实测：G91 第二次从同一个输出端拖线时，
 *    指针明明戳在那只端点上，露出判定的却是旁边压过来的节点 ⇒ 端点不亮、拖不起来）。
 *    ⚠️ 传进来的 `ports` 是**锚点**不是圆心：用户是按住**节点边缘**起拖的，
 *    拿圆心（边缘外 20px）当判据，那一下会离圆心 30px 开外 ⇒ 这条永远不成立。
 * 2. **指针落在某个节点矩形里** ⇒ 就是它（`rects` 里**靠后**的在上层，从后往前找）；
 * 3. 指针在节点外面 ⇒ 取"横向最贴边"的那一个（`edgeGap` 最小，且不超过
 *    `PORT_REVEAL_END`、纵向在 `PORT_VERTICAL_PAD` 之内）。两个节点挨着时，
 *    离得近的那个赢 —— 于是不会两个节点的端点一起冒出来。
 */
export function activePortNode(
  point: { x: number; y: number },
  rects: readonly PortNodeRect[],
  /** 所有端点的**锚点**（世界坐标 = 节点边缘上、线的起点）；不传就只按矩形判（老调用方 / 单测用） */
  ports: readonly { nodeId: string; x: number; y: number }[] = [],
): string | null {
  let nearestPortNode: string | null = null
  let nearestPortDist = PORT_HIT_RADIUS
  for (const p of ports) {
    const d = Math.hypot(p.x - point.x, p.y - point.y)
    if (d <= nearestPortDist) {
      nearestPortDist = d
      nearestPortNode = p.nodeId
    }
  }
  if (nearestPortNode) return nearestPortNode

  for (let i = rects.length - 1; i >= 0; i -= 1) {
    const r = rects[i]
    if (point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom) {
      return r.id
    }
  }
  let best: string | null = null
  let bestGap = Infinity
  for (const r of rects) {
    if (point.y < r.top - PORT_VERTICAL_PAD || point.y > r.bottom + PORT_VERTICAL_PAD) continue
    const gap =
      point.x < r.left ? r.left - point.x : point.x > r.right ? point.x - r.right : 0
    if (gap > PORT_REVEAL_END) continue
    if (gap < bestGap) {
      bestGap = gap
      best = r.id
    }
  }
  return best
}
