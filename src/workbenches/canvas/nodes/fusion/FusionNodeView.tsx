/**
 * 融合节点视图（产品文档 §6.23）。
 *
 * ## 卡片结构（用户 2026-09-29 给的参考图）
 *
 * ```
 * ┌──────────────────────────────┐
 * │  ┌────────┬────────────┐     │  上：左边原图 | 右边局部修改
 * │  │        │  局部修改 1 │     │     局部图**上下排列**、不往右长
 * │  │  原图   ├────────────┤     │     （用户 2026-09-30，照大雄）
 * │  │        │  局部修改 2 │     │     各自带深色胶囊标签
 * │  └────────┴────────────┘     │
 * │  ✓ 原图   ○ 未连接局部修改 0 张 │  中：连接状态提醒
 * │  ☑ 颜色匹配                   │
 * │  ┌──────────────────────────┐ │
 * │  │       开始融合            │ │  下：全宽主按钮
 * │  └──────────────────────────┘ │
 * └──────────────────────────────┘
 * ```
 *
 * 局部图**为什么纵向排、而且不撑高**：一个「原图 + N 个局部选区」的语义就是
 * 「左右两块」——横向铺开会把节点越撑越宽、把左边那张原图挤小；纵向排则原图列
 * 宽度恒定。而右列的高度**锁死在左原图那一格**里，几张就等分几份：张数变多只是
 * 每张变小，节点宽高都不动（用户 2026-09-30：「不要一直叠加叠高，要自动适应缩小，
 * 保持整体的局部图外部容器不发生改变」）。
 *
 * ## 这一版**删掉**了什么（用户：「之前的那个东西删掉，都不对」）
 *
 * 旧卡片是「单张预览 + 在原图上拖框选 + 选区芯片 + 比例芯片 + 对比原图切换」——
 * 那一整套都建立在一个错误前提上：**选区存在融合节点里**。现在选区跟着图片走
 * （在图片节点的素材灯箱里「提取选区」产生，见 `features/canvas/extractSelection`），
 * 所以融合节点里不该再有框选、也不该有选区芯片；产物也不再写回它自己，
 * 而是**落成右侧一个新节点**（`fuseNode`）。
 *
 * 于是这个节点只剩「看两块输入 + 一个开关 + 一个按钮」。
 */
import type { NodeViewProps } from '../registry'
import type { FusionData } from '../../../../domain/canvas/model/node'
import { useAsset } from '../../hooks/useAsset'
import styles from './FusionNodeView.module.css'

export function FusionNodeView(props: NodeViewProps) {
  const data = props.node.data as FusionData

  /**
   * 上游素材**按口**取：`input` = 完整原图，`patch` = 局部修改图。
   * 由 画布表面 按端口分组注入（多口节点才有这个字段）。
   */
  const portAssets = props.inputPortAssets ?? {}
  const original = (portAssets.input ?? [])[0] ?? null
  const patches = portAssets.patch ?? []
  const colorMatch = data.colorMatch !== false
  /** 原图预览（单张，直接在这里取；局部图数量会变，必须在子组件里取，否则违反 hook 规则） */
  const originalUrl = useAsset(original?.hash)
  /**
   * 双击预览大图（用户 2026-09-30：「局部融合节点里面的图片也可以进行双击灯箱预览」）。
   * 与生成节点同一个事件口径（`emit({ type:'openLightbox' })` → `useCanvasPageEvents` 翻译成
   * `store.openLightbox`），不另开一条预览链路。
   */
  const openPane = (hash: string) => props.emit({ type: 'openLightbox', assetHash: hash })

  /** 每张局部图能不能回贴：上下文跟着图片走（画布表面 沿上游解析后注入） */
  const missingContextAt = patches.findIndex((p) => !p.hasContext)
  const canRun = !!original && patches.length > 0 && missingContextAt < 0 && !props.running
  const hint = !original
    ? '先把一张完整原图连到左侧'
    : patches.length === 0
      ? '把局部修改图连到右侧那只端点'
      : missingContextAt >= 0
        ? `第 ${missingContextAt + 1} 张局部图没有选区上下文：请在它的原图上用「提取选区」得到局部图`
        : `把 ${patches.length} 张局部修改图融回原图`

  /**
   * **不做「节点高度跟随内容」**（与循环节点相反，2026-09-30 实修）。
   *
   * 循环节点是**参数卡**：内容高度由参数条数决定，节点该跟着内容长，所以它量高度写回。
   * 融合卡是**看图的地方**：预览区本来就该吃掉节点里剩下的空间。上一版照搬了循环节点
   * 那套 `ResizeObserver` 写回高度，结果与「用户手动拉右下角」直接打架 ——
   * 拖拽中节点高度被拖大，紧接着自适应又把高度按内容写回，松手那一刻还会再补一跳
   * （实测：拖到 h=306，松手后跳到 332）。用户报的就是这个跳动。
   *
   * 现在改成**内容跟节点**：`.content` 撑满，`.panes` 用 flex 吃掉剩余高度，
   * 左右两块填满各自格子。拖多大就是多大，没有任何写回。
   */

  return (
    <div className={styles.card} data-fusion-node>
      <div className={styles.content} data-fusion-content>
        {/* ① 两块预览：左原图 | 右局部修改（多张**上下排列**） */}
        <div className={styles.panes} data-fusion-panes>
          <Pane
            label="原图"
            url={originalUrl}
            hash={original?.hash ?? null}
            onOpen={openPane}
            testId="original"
            extraClass={styles.paneOriginal}
          />
          <div className={styles.patchStack} data-fusion-patch-stack>
            {patches.length === 0 ? (
              <Pane label="局部修改" url={null} testId="patch-empty" />
            ) : (
              patches.map((p, i) => (
                <PatchPane key={`${p.hash}-${i}`} hash={p.hash} index={i + 1} onOpen={openPane} />
              ))
            )}
          </div>
        </div>

        {/* ② 连接状态提醒 */}
        <div className={styles.chips} data-fusion-chips>
          <span
            className={original ? styles.chipOk : styles.chipOff}
            data-fusion-chip="original"
          >
            {original ? <IconCheck /> : <IconDot />}
            {original ? '原图' : '未连接原图'}
          </span>
          <span
            className={patches.length > 0 ? styles.chipOk : styles.chipOff}
            data-fusion-chip="patch"
          >
            {patches.length > 0 ? <IconCheck /> : <IconDot />}
            {patches.length > 0 ? `局部修改 ${patches.length} 张` : '未连接局部修改 0 张'}
          </span>
        </div>

        {/* ③ 颜色匹配开关（参考实现融合卡片上的那个复选框，默认开） */}
        <label
          className={styles.check}
          data-fusion-color-match
          title="用外扩框边缘环的均值色差，把局部图的色偏拉回原图（每通道最多 ±24）"
        >
          <input
            type="checkbox"
            className={styles.checkBox}
            checked={colorMatch}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) =>
              props.emit({
                type: 'updateData',
                patch: { colorMatch: e.target.checked } as never,
                transient: false,
              })
            }
          />
          <span>颜色匹配</span>
        </label>

        {/* ④ 全宽主按钮 */}
        <button
          type="button"
          className={styles.run}
          data-fusion-run
          disabled={!canRun}
          title={hint}
          aria-label="开始融合"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => props.emit({ type: 'requestRun', mode: 'single' })}
        >
          <IconBlend />
          <span>{props.running ? '融合中…' : '开始融合'}</span>
        </button>
      </div>
    </div>
  )
}

function Pane({
  label,
  url,
  hash,
  onOpen,
  testId,
  extraClass,
}: {
  label: string
  url: string | null
  hash?: string | null
  onOpen?: (hash: string) => void
  testId: string
  extraClass?: string
}) {
  const openable = !!(url && hash && onOpen)
  return (
    <div
      className={extraClass ? `${styles.pane} ${extraClass}` : styles.pane}
      data-fusion-pane={testId}
      data-fusion-pane-hash={hash ?? undefined}
      title={openable ? '双击查看大图' : undefined}
      onDoubleClick={openable ? () => onOpen?.(hash as string) : undefined}
    >
      {url ? (
        <img className={styles.paneImg} src={url} alt="" draggable={false} />
      ) : (
        <span className={styles.paneEmpty} aria-label={`${label}未连接`}>
          <IconImage />
        </span>
      )}
      <span className={styles.paneLabel}>{label}</span>
    </div>
  )
}

/**
 * 局部修改图：编号从 1 起（与连线顺序一致）。
 *
 * 标签照参考图写成「局部 1 / 局部 2」（**始终带序号**，不是第一张光写「局部修改」）：
 * 参考图里几张局部图并排时，序号是唯一能跟连线顺序对上的东西（用户 2026-09-30 给的截图）。
 */
function PatchPane({
  hash,
  index,
  onOpen,
}: {
  hash: string
  index: number
  onOpen: (hash: string) => void
}) {
  const url = useAsset(hash)
  return (
    <div
      className={styles.pane}
      data-fusion-pane="patch"
      data-fusion-patch={index}
      data-fusion-pane-hash={hash}
      title="双击查看大图"
      onDoubleClick={() => onOpen(hash)}
    >
      {url ? (
        <img className={styles.paneImg} src={url} alt="" draggable={false} />
      ) : (
        <span className={styles.paneEmpty} />
      )}
      <span className={styles.paneLabel}>{`局部 ${index}`}</span>
    </div>
  )
}

/* ── 内联 SVG 图标（一律矢量、24×24 居中 viewBox） ── */

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 12.5 5 5L20 6.5" />
    </svg>
  )
}

function IconDot() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
    </svg>
  )
}

function IconImage() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m4 17 5-5 4 4 3-3 4 4" />
    </svg>
  )
}

function IconBlend() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="6.5" width="8" height="11" rx="1.6" />
      <rect x="13.5" y="6.5" width="8" height="11" rx="1.6" />
      <path d="M10.5 12h3" />
    </svg>
  )
}
