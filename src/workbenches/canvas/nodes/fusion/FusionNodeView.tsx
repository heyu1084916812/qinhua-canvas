/**
 * 融合节点视图（产品文档 §6.23，2026-09-29）。
 *
 * ## 它是什么
 *
 * 一张**完整原图** + 若干张**局部修改图**，在本地叠成一张新图交给下游。
 * 界面只做三件事：看原图、框选区、点融合。
 *
 * ## 为什么框选在节点里、而不是弹一个编辑灯箱
 *
 * 框选需要「一眼看到原图全貌 + 手上立刻能改」。灯箱会把画布挤掉、还要
 * 处理「打开时节点被删了」这类边界；而节点本身就是这张图的持有者，
 * 就地框选少一层状态同步。
 *
 * ## 与其他节点视图的两处刻意不同
 *
 * 1. **端口不止一对**（左原图 / 右上局部修改图 / 右中输出），所以上游素材
 *    走 `inputPortAssets`（按口分组）而不是 `upstreamAssetHashes`（并集）——
 *    后者会把原图算成第 1 张补丁。
 * 2. **高度跟随内容**（同循环节点）：框选预览 + 选区列表 + 底栏，
 *    哪一块出现 / 消失都会改变高度，写死常数迟早对不上。
 */
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { NodeViewProps } from '../registry'
import type { FusionData, FusionRect } from '../../../../domain/canvas/model/node'
import {
  FUSION_MIN_EDGE,
  contextFromSelection,
  contextsForSource,
  fitInside,
  ratioValueOf,
} from '../../../../domain/canvas/fusion/fusionPlan'
import { createId } from '../../../../shared/id'
import { useAsset } from '../../hooks/useAsset'
import styles from './FusionNodeView.module.css'

/**
 * 「按模型现有比例提取」可选的比例档。
 *
 * 与生图面板的九档**同一批比例**（产品文档 §6.8），但刻意不是同一个常量：
 * 那边在 `workbenches/canvas/panels` 里，是 UI 模块；domain 不能反向依赖 UI。
 * 两处若哪天对不上，用户会看到「生图面板有 21:9、融合这里没有」——
 * 那时该做的是把比例表下沉到 domain 共用，而不是在这里悄悄多加一档。
 */
const RATIO_CHOICES: readonly { label: string; value: string }[] = [
  { label: '自由', value: '' },
  { label: '1:1', value: '1:1' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '3:2', value: '3:2' },
  { label: '2:3', value: '2:3' },
  { label: '21:9', value: '21:9' },
]

/** 预览框高度（世界像素）：定值才能把「图在框内的实际位置」算准（见 fitInside） */
const PREVIEW_H = 200

interface UnitRect {
  x: number
  y: number
  w: number
  h: number
}

/** 原图像素矩形 → 0..1 的单位矩形（与显示尺寸无关，存的是语义坐标） */
function toUnit(rect: FusionRect, size: { w: number; h: number }): UnitRect {
  return { x: rect.x / size.w, y: rect.y / size.h, w: rect.w / size.w, h: rect.h / size.h }
}

/** 融合按钮点不动时，把原因说出来（而不是摆一个灰按钮让人猜） */
function runHint(input: {
  hasOriginal: boolean
  patchCount: number
  contextCount: number
  usableCount: number
}): string {
  if (!input.hasOriginal) return '先把一张完整原图连到左侧'
  if (input.patchCount === 0) return '把局部修改图连到右上角的接口'
  if (input.contextCount === 0) return '先在原图上拖一个框，选出要融合的局部'
  if (input.usableCount !== input.patchCount) {
    return '原图换了：请重新框选（旧选区对不上新图）'
  }
  return `把 ${input.patchCount} 张局部修改图融回原图`
}

export function FusionNodeView(props: NodeViewProps) {
  const data = props.node.data as FusionData
  const contexts = data.contexts ?? []

  /**
   * 上游素材**按口**取：`input` = 完整原图，`patch` = 局部修改图。
   * 由 NodeLayer 按端口分组注入（多口节点才有这个字段）。
   */
  const portAssets = props.inputPortAssets ?? {}
  const originalHash = (portAssets.input ?? [])[0]
  const patchHashes = portAssets.patch ?? []
  const resultHash = data.assetHash

  /** 预览区显示原图还是产物：「对比原图」打开时（或还没有产物时）显示原图 */
  const showingOriginal = !resultHash || data.compare === true
  const displayHash = showingOriginal ? originalHash : resultHash
  const displayUrl = useAsset(displayHash)

  /** 原图的真实像素：由预览 `<img>` 的 onLoad 给出（不信任上游节点里的元数据） */
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    setNatural(null)
  }, [originalHash])

  /** 预览框的布局尺寸（世界像素）：算「图在框里的实际位置」要用 */
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState({ w: 0, h: PREVIEW_H })
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    /**
     * 用 `offsetWidth / offsetHeight`（布局尺寸）而不是 `getBoundingClientRect()`：
     * 画布缩放是 CSS `scale`，后者返回的是**缩放后**的屏幕像素。
     * 拿它去算百分比会随缩放漂移（循环节点 2026-09-24 的黑屏就是这个坑）。
     */
    const sync = () => setBox({ w: el.offsetWidth, h: el.offsetHeight })
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** 图在框里的实际显示矩形（框内坐标） */
  const fit = fitInside(box, natural ?? { w: box.w, h: box.h })

  /** 拖框进行中的单位矩形（不进 store：纯视觉，松手才提交） */
  const [draftRect, setDraftRect] = useState<UnitRect | null>(null)
  /**
   * 同一个矩形也留一份在 ref 里，松手时**从 ref 读**、不要在 `setState` 的更新
   * 函数里提交。
   *
   * 为什么（实测踩到，开发服务器控制台报 `Cannot update a component (NodeLayer)
   * while rendering a different component (FusionNodeView)`）：**传给 `setState`
   * 的更新函数是在 React 的渲染阶段求值的**，在它里面调用 `emit`（→ 派发命令 →
   * 父组件 `NodeLayer` 更新）就是「渲染期间更新别的组件」—— React 会告警，
   * 而且更新时机变得不可预测。
   */
  const draftRef = useRef<UnitRect | null>(null)
  /** 拖框的起点（单位坐标） */
  const dragRef = useRef<{ ax: number; ay: number } | null>(null)

  const emit = (patch: Partial<FusionData>) => {
    props.emit({ type: 'updateData', patch: patch as never, transient: false })
  }

  /** 指针位置 → 原图上的单位坐标（0..1，已夹住） */
  const unitAt = (e: { clientX: number; clientY: number }): { u: number; v: number } | null => {
    const el = boxRef.current
    if (!el || !fit.w || !fit.h) return null
    const r = el.getBoundingClientRect()
    // 屏幕像素 → 框内布局像素：除以缩放比，与画布 zoom 无关
    const kx = box.w / (r.width || box.w)
    const ky = box.h / (r.height || box.h)
    const x = (e.clientX - r.left) * kx
    const y = (e.clientY - r.top) * ky
    const u = Math.max(0, Math.min(1, (x - fit.x) / fit.w))
    const v = Math.max(0, Math.min(1, (y - fit.y) / fit.h))
    return { u, v }
  }

  /** 提交一次框选：太小的框直接丢掉（否则会留下一个点不到的选区） */
  const commitSelection = (unit: UnitRect) => {
    if (!natural || !originalHash) return
    const rect: FusionRect = {
      x: Math.round(unit.x * natural.w),
      y: Math.round(unit.y * natural.h),
      w: Math.round(unit.w * natural.w),
      h: Math.round(unit.h * natural.h),
    }
    if (Math.min(rect.w, rect.h) < FUSION_MIN_EDGE) return
    const ctx = contextFromSelection({
      contextId: createId('fctx'),
      source: { assetHash: originalHash, width: natural.w, height: natural.h },
      rect,
      // 「按模型比例提取」选中时才吸附；自由档保持用户框出来的形状
      ratio: ratioValueOf(data.ratio),
    })
    emit({ contexts: [...contexts, ctx], activeContextId: ctx.id })
  }

  const startSelect = (e: ReactPointerEvent) => {
    // 只在**原图**上框选：产物是融合结果，在它上面框没有任何含义
    if (!showingOriginal || !originalHash || !natural) return
    const p = unitAt(e)
    if (!p) return
    e.stopPropagation()
    dragRef.current = { ax: p.u, ay: p.v }
    const first: UnitRect = { x: p.u, y: p.v, w: 0, h: 0 }
    draftRef.current = first
    setDraftRect(first)

    const move = (ev: PointerEvent) => {
      const q = unitAt(ev)
      const a = dragRef.current
      if (!q || !a) return
      const next: UnitRect = {
        x: Math.min(a.ax, q.u),
        y: Math.min(a.ay, q.v),
        w: Math.abs(q.u - a.ax),
        h: Math.abs(q.v - a.ay),
      }
      draftRef.current = next
      setDraftRect(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      dragRef.current = null
      // 先收起草稿框，再提交选区：提交是**事件处理**（不在渲染阶段），
      // 故可以安全地派发命令（见 draftRef 的说明）
      const rect = draftRef.current
      draftRef.current = null
      setDraftRect(null)
      if (rect) commitSelection(rect)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const removeContext = (id: string) => {
    const next = contexts.filter((c) => c.id !== id)
    emit({
      contexts: next,
      activeContextId: data.activeContextId === id ? (next[0]?.id ?? null) : data.activeContextId,
    })
  }

  const usable = natural
    ? contextsForSource(contexts, {
        assetHash: originalHash ?? '',
        width: natural.w,
        height: natural.h,
      })
    : []
  const canRun =
    !!originalHash && patchHashes.length > 0 && usable.length === patchHashes.length && !props.running
  const hint = runHint({
    hasOriginal: !!originalHash,
    patchCount: patchHashes.length,
    contextCount: contexts.length,
    usableCount: usable.length,
  })

  /** 框选拖拽中 / 已存在的选区，都按同一套换算画到预览框里（框内 px → 百分比） */
  const rectStyle = (r: UnitRect) => ({
    left: `${((fit.x + r.x * fit.w) / (box.w || 1)) * 100}%`,
    top: `${((fit.y + r.y * fit.h) / (box.h || 1)) * 100}%`,
    width: `${((r.w * fit.w) / (box.w || 1)) * 100}%`,
    height: `${((r.h * fit.h) / (box.h || 1)) * 100}%`,
  })

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
        {/* ① 预览区：原图（可框选）/ 产物（对比时切换） */}
        <div className={styles.preview} ref={boxRef} data-fusion-preview onPointerDown={startSelect}>
          {displayUrl ? (
            <img
              className={styles.image}
              src={displayUrl}
              alt=""
              draggable={false}
              data-fusion-image={showingOriginal ? 'original' : 'result'}
              onLoad={(e) => {
                const el = e.currentTarget
                // 产物与原图同尺寸，故只在看原图时记录真实像素（它是选区的坐标系）
                if (showingOriginal && el.naturalWidth && el.naturalHeight) {
                  setNatural({ w: el.naturalWidth, h: el.naturalHeight })
                }
              }}
            />
          ) : (
            <span className={styles.empty} data-fusion-empty>
              {originalHash ? '原图读取中…' : '把一张完整原图连到左侧'}
            </span>
          )}

          {/* 已保存的选区（当前那条高亮） */}
          {showingOriginal &&
            natural &&
            contexts.map((c, i) => (
              <span
                key={c.id}
                className={c.id === data.activeContextId ? styles.selectionActive : styles.selection}
                style={rectStyle(toUnit(c.rect, natural))}
                data-fusion-selection={c.id}
                data-fusion-selection-index={i}
              />
            ))}

          {/* 正在拖的那个框 */}
          {draftRect && (
            <span className={styles.selectionDraft} style={rectStyle(draftRect)} data-fusion-draft />
          )}
        </div>

        {/* ② 选区列表：切换 / 删除 */}
        <div className={styles.row} data-fusion-contexts>
          {contexts.length === 0 ? (
            <span className={styles.note} data-fusion-context-empty>
              {originalHash ? '在原图上拖一个框，选出要修改的局部' : '还没有选区'}
            </span>
          ) : (
            contexts.map((c, i) => (
              <ContextChip
                key={c.id}
                index={i + 1}
                active={c.id === data.activeContextId}
                usable={usable.some((u) => u.id === c.id)}
                onClick={() => emit({ activeContextId: c.id })}
                onDelete={() => removeContext(c.id)}
              />
            ))
          )}
        </div>

        {/* ③ 局部修改图：按连线顺序编号，让「第几张对应哪个选区」看得见 */}
        <div className={styles.row} data-fusion-patches>
          {patchHashes.length === 0 ? (
            <span className={styles.note} data-fusion-patch-empty>
              局部修改图接到右上角的接口
            </span>
          ) : (
            patchHashes.map((hash, i) => (
              <PatchThumb key={`${hash}-${i}`} hash={hash} index={i + 1} />
            ))
          )}
        </div>

        {/* ④ 底栏：比例 + 颜色匹配 / 对比原图 + 融合（分两排，窄节点里才放得下） */}
        <div className={styles.footer} data-fusion-footer>
          <div className={styles.optionRow}>
            <RatioChip value={data.ratio ?? ''} onChange={(v) => emit({ ratio: v || undefined })} />
            {/*
              颜色匹配开关（参考实现的融合卡片上就是这个复选框，默认开）。
              用原生 checkbox + `appearance: none` 自绘：**不要**用 clip / 1px 隐藏
              原生控件 —— 那样 Playwright 的 check() 会静默失败（项目踩过这个坑）。
            */}
            <label
              className={styles.check}
              data-fusion-color-match
              title="用外扩框边缘环的均值色差，把局部图的色偏拉回原图（每通道最多 ±24）"
            >
              <input
                type="checkbox"
                className={styles.checkBox}
                checked={data.colorMatch !== false}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => emit({ colorMatch: e.target.checked })}
              />
              <span>颜色匹配</span>
            </label>
          </div>
          <div className={styles.actionRow}>
            <button
              type="button"
              className={styles.toggle}
              data-fusion-compare
              aria-pressed={data.compare === true}
              disabled={!resultHash}
              title={resultHash ? '在原图与融合结果之间切换' : '还没有融合结果'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => emit({ compare: !data.compare })}
            >
              <IconCompare />
              <span>对比原图</span>
            </button>
            <button
              type="button"
              className={styles.run}
              data-fusion-run
              disabled={!canRun}
              title={hint}
              aria-label="融合"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => props.emit({ type: 'requestRun', mode: 'single' })}
            >
              <IconFuse />
              <span>融合</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 选区芯片：编号 + 删除。编号与补丁缩略图上的编号一一对应 */
function ContextChip({
  index,
  active,
  usable,
  onClick,
  onDelete,
}: {
  index: number
  active: boolean
  /** 这条选区的原图与当前原图还一致吗（换图后旧选区会被标灰） */
  usable: boolean
  onClick: () => void
  onDelete: () => void
}) {
  return (
    <span className={styles.chipWrap}>
      <button
        type="button"
        className={active ? styles.chipActive : styles.chip}
        data-fusion-context={index}
        aria-pressed={active}
        title={usable ? `第 ${index} 个选区` : `第 ${index} 个选区的原图已换，需要重新框选`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onClick}
      >
        {index}
      </button>
      <button
        type="button"
        className={styles.chipDelete}
        data-fusion-context-delete={index}
        aria-label={`删除第 ${index} 个选区`}
        title="删除这个选区"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onDelete}
      >
        <IconClose />
      </button>
    </span>
  )
}

/** 局部修改图缩略图（编号 = 它对应的选区序号） */
function PatchThumb({ hash, index }: { hash: string; index: number }) {
  const url = useAsset(hash)
  return (
    <span className={styles.thumb} data-fusion-patch={index}>
      {url ? <img src={url} alt="" draggable={false} /> : <span className={styles.thumbEmpty} />}
      <span className={styles.thumbBadge}>{index}</span>
    </span>
  )
}

/**
 * 比例芯片（「按模型现有比例提取」）。
 *
 * 点开是一个小浮层 —— 与循环节点的数字控件同一套做法（点开合、点外关、Esc 关）。
 */
function RatioChip({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span className={styles.ratioWrap} ref={rootRef}>
      <button
        type="button"
        className={styles.toggle}
        data-fusion-ratio
        aria-expanded={open}
        title="按模型现有比例提取：框选时自动吸附到该比例"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setOpen((v) => !v)}
      >
        <IconRatio />
        <span>{value || '比例自由'}</span>
      </button>
      {open && (
        <div className={styles.ratioMenu} data-fusion-ratio-menu>
          {RATIO_CHOICES.map((c) => (
            <button
              key={c.value || 'free'}
              type="button"
              className={c.value === value ? styles.ratioItemActive : styles.ratioItem}
              data-fusion-ratio-option={c.value || 'free'}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                onChange(c.value)
                setOpen(false)
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

/* ── 内联 SVG 图标 ──
 * 一律矢量、24×24 居中 viewBox（项目教训：字体字形的基线由字体决定，
 * 旋转与居中不可控，工具栏的加号为此返工过三轮）。 */

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

function IconCompare() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M12 4v16" />
      <path d="M6.5 15.5 10 9l3.5 6.5" />
    </svg>
  )
}

function IconFuse() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="6.5" width="8" height="11" rx="1.6" />
      <rect x="13.5" y="6.5" width="8" height="11" rx="1.6" />
      <path d="M10.5 12h3" />
    </svg>
  )
}

function IconRatio() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 15V9h2.2a1.6 1.6 0 0 1 0 3.2H7" />
    </svg>
  )
}
