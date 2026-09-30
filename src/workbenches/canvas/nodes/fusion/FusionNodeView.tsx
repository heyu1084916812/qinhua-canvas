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
 * 局部图**为什么纵向排**：一个「原图 + N 个局部选区」的语义就是「左右两块」，
 * 横向铺开会把节点越撑越宽、把左边那张原图挤小；纵向排则节点只长高，
 * 原图那一列的宽度稳定，多选区时也更像参考实现（左原图 / 右局部图区）。
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
import { useEffect, useRef } from 'react'
import type { NodeViewProps } from '../registry'
import type { FusionData } from '../../../../domain/canvas/model/node'
import { useAsset } from '../../hooks/useAsset'
import styles from './FusionNodeView.module.css'

export function FusionNodeView(props: NodeViewProps) {
  const data = props.node.data as FusionData

  /**
   * 上游素材**按口**取：`input` = 完整原图，`patch` = 局部修改图。
   * 由 NodeLayer 按端口分组注入（多口节点才有这个字段）。
   */
  const portAssets = props.inputPortAssets ?? {}
  const original = (portAssets.input ?? [])[0] ?? null
  const patches = portAssets.patch ?? []
  const colorMatch = data.colorMatch !== false
  /** 原图预览（单张，直接在这里取；局部图数量会变，必须在子组件里取，否则违反 hook 规则） */
  const originalUrl = useAsset(original?.hash)

  /** 每张局部图能不能回贴：上下文跟着图片走（NodeLayer 沿上游解析后注入） */
  const missingContextAt = patches.findIndex((p) => !p.hasContext)
  const canRun = !!original && patches.length > 0 && missingContextAt < 0 && !props.running
  const hint = !original
    ? '先把一张完整原图连到左侧'
    : patches.length === 0
      ? '把局部修改图连到右侧那只端点'
      : missingContextAt >= 0
        ? `第 ${missingContextAt + 1} 张局部图没有选区上下文：请在它的原图上用「提取选区」得到局部图`
        : `把 ${patches.length} 张局部修改图融回原图`

  /** 节点高度跟随内容（同循环节点：量真实高度而不是查表） */
  const contentRef = useRef<HTMLDivElement | null>(null)
  const nodeHRef = useRef(props.node.h)
  nodeHRef.current = props.node.h
  const nodeWRef = useRef(props.node.w)
  nodeWRef.current = props.node.w
  const emitRef = useRef(props.emit)
  emitRef.current = props.emit
  useEffect(() => {
    const content = contentRef.current
    if (!content || !content.closest('[data-node-id]')) return
    const sync = () => {
      const needed = content.offsetHeight + 18
      if (Math.abs(nodeHRef.current - needed) > 8) {
        emitRef.current({
          type: 'updateData',
          patch: {},
          transient: true,
          size: { w: nodeWRef.current, h: needed },
        })
      }
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(content)
    return () => ro.disconnect()
  }, [])

  return (
    <div className={styles.card} data-fusion-node>
      <div className={styles.content} ref={contentRef} data-fusion-content>
        {/* ① 两块预览：左原图 | 右局部修改（多张**上下排列**） */}
        <div className={styles.panes} data-fusion-panes>
          <Pane label="原图" url={originalUrl} testId="original" extraClass={styles.paneOriginal} />
          <div className={styles.patchStack} data-fusion-patch-stack>
            {patches.length === 0 ? (
              <Pane label="局部修改" url={null} testId="patch-empty" />
            ) : (
              patches.map((p, i) => (
                <PatchPane key={`${p.hash}-${i}`} hash={p.hash} index={i + 1} />
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
  testId,
  extraClass,
}: {
  label: string
  url: string | null
  testId: string
  extraClass?: string
}) {
  return (
    <div className={extraClass ? `${styles.pane} ${extraClass}` : styles.pane} data-fusion-pane={testId}>
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

/** 局部修改图：编号从 1 起（与连线顺序一致），多于一张时才带序号 */
function PatchPane({ hash, index }: { hash: string; index: number }) {
  const url = useAsset(hash)
  return (
    <div className={styles.pane} data-fusion-pane="patch" data-fusion-patch={index}>
      {url ? (
        <img className={styles.paneImg} src={url} alt="" draggable={false} />
      ) : (
        <span className={styles.paneEmpty} />
      )}
      <span className={styles.paneLabel}>{index > 1 ? `局部修改 ${index}` : '局部修改'}</span>
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
