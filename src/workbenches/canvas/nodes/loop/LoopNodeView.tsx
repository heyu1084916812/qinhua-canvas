/**
 * 循环节点视图（产品文档 §6.22）。
 *
 * 2026-09-23：按用户要求**复刻「大雄无限画布」的 smart-loop UI**。
 * 参考实现：`static/js/smart-canvas.js` 的 `smartLoopBodyHtml`，
 * 以及 `static/css/smart-canvas.css` 的 `.loop-smart-*` 一组规则。
 *
 * ## 抄什么、不抄什么
 *
 * **抄结构与交互**（这是用户要的部分）：
 *
 * | 大雄 | 本实现 |
 * | --- | --- |
 * | 顶部两格分段（循环 / 并发） | `Seg` |
 * | 带图标的开关按钮（图片 / 提示词） | `Toggle` |
 * | 图片面板：缩略图 + 批次 + 说明 | 同 |
 * | 提示词面板：上游预览 + 编号输入行 + 变量行 | 同 |
 * | **数字控件 = 胶囊 + 悬停浮出的快捷面板**（1/2/3/4…+ 自定义） | `NumberControl` |
 * | 底栏三格（起始 / 次数 / 运行），运行按钮带图标 | 同 |
 * | 编号圆点**骑在输入行左上角**（`translate(-30%,-30%)`） | 同 |
 *
 * **不抄的**（换成轻画的口径，理由都写在下面对应处）：
 *  - 颜色：大雄用 rgba 硬编码 + `.theme-dark` 逐个覆写；轻画一律走 CSS 变量，
 *    明暗两套自动跟随，且主题守卫会拦截硬编码色值；
 *  - 图标：大雄用 lucide 字体/图标库；轻画用内联 SVG（有明确教训：
 *    字体图标的字形位置由字体决定，旋转与居中不可控）；
 *  - 运行按钮：大雄那个能真跑；轻画**循环执行尚未接引擎**，
 *    故做成如实禁用 + 说明，不留「点了没反应」（本项目反复出现的缺陷类型）。
 *
 * ## 语义（用户口述钉死，未变）
 *
 * - **起始计数**同时控制两件事：①从上游第几张素材开始取；②`《计数》`变量的起始值；
 * - **次数** = 从起始计数起跑几轮（起始 2 + 次数 2 → 跑第 2、3 张）；
 * - **批次** = 一轮取几张。
 */
import { useEffect, useRef, useState } from 'react'
import type { NodeViewProps } from '../registry'
import type { LoopData } from '../../../../domain/canvas/model/node'
import { normalizeLoopParams } from '../../../../domain/canvas/loop/loopPlan'
import { useAsset } from '../../hooks/useAsset'
import styles from './LoopNodeView.module.css'

/**
 * 数字控件的快捷档位（照抄大雄的 `quick:[1,2,3,4,5,6,8,10]`）。
 *
 * 大雄把常用值做成浮层里的 4 列网格，比「必须点加减或手输」快得多；
 * 档位也照顾到「每轮 6 / 8 / 10 张」这类批量场景。
 */
const QUICK_VALUES = [1, 2, 3, 4, 5, 6, 8, 10] as const

export function LoopNodeView(props: NodeViewProps) {
  const data = props.node.data as LoopData
  /** 上游素材数（NodeLayer 注入）；上游提示词节点数（NodeLayer 注入） */
  const upstreamImages = (props.upstreamAssetHashes ?? []).length
  const upstreamPrompts = props.upstreamPromptCount ?? 0
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  /**
   * 提示词数组的统一兜底。
   *
   * 类型上 `prompts` 必填，但**老库数据 / 别的创建路径**都可能缺它。
   * 本文件多处读 `.length`，只要有一处没防就会崩、并把整棵树带下去
   * （同项目的 PromptNodeView 就因为 `data.text.length` 黑屏过，2026-09-23）。
   * 收成一个变量，让「缺字段」只在一处处理。
   */
  const prompts = data.prompts ?? []
  /** 至少留一行（大雄的 `visiblePromptFields` 也是这么兜的），否则用户没地方输入 */
  const promptRows = prompts.length ? prompts : ['']

  const patchNow = (patch: Partial<LoopData>) => {
    props.emit({ type: 'updateData', patch: patch as never, transient: false })
  }
  const patchLater = (patch: Partial<LoopData>, key: string) => {
    clearTimeout(timers.current[key])
    timers.current[key] = setTimeout(() => {
      props.emit({ type: 'updateData', patch: patch as never, transient: false })
    }, 300)
  }
  const updatePrompt = (i: number, text: string) => {
    const next = [...promptRows]
    next[i] = text
    patchLater({ prompts: next }, `prompt:${i}`)
  }

  /**
   * 切换通道时**同步收放节点高度**（用户 2026-09-23：「节点的上下的距离完全自适应，
   * 目前取消选中图片或者提示词的时候，下方会空很多出来」）。
   *
   * 实测四态的内容自然高度（`scripts/probe-loop-states.mjs`）：
   *   两者都关 129 / 仅图片 211 / 仅提示词 252 / 两者都开 334
   * 而节点固定 380 ⇒ 关掉通道后最多空出 251px。
   *
   * 做法：切换时按**目标状态**算出内容高度，把节点收到那个高度（加 16 余量）。
   * 为什么不直接量 DOM：切换的一拍 DOM 还是旧状态，量到的是旧高度。
   * 用查表 + 实测校准的常数，比「setTimeout 等下一帧再量」稳，
   * 也避免因动画/字体加载造成的高度抖动。
   *
   * ⚠️ 这里**按目标状态直接设高**，不写「只在变矮时才改」。
   * 曾那么写过，结果出现「仅提示词」被压到 137 而内容需要 252 —— 因为切到
   * 提示词时节点还沿用着上一个更矮的状态。通道开关是**结构变化**，
   * 结构变了就该按新结构给高度；用户的自由缩放仍可在之后随时进行。
   */
  const CHROME_H = 31 + 30 + 36 + 8 * 3 // 分段 + 开关行 + 底栏 + 三处间距
  const heightFor = (useImage: boolean, usePrompt: boolean) => {
    let h = CHROME_H
    if (useImage) h += 74 + 8 // 图片面板（含批次与说明）+ 间距
    if (usePrompt) h += 115 + 8 // 提示词面板 + 间距
    return h + 16 // 上下各留 8 的余量，避免贴边
  }

  const toggleChannel = (which: 'image' | 'prompt') => {
    const nextImage = which === 'image' ? !data.useImageInput : data.useImageInput
    const nextPrompt = which === 'prompt' ? !data.usePrompt : data.usePrompt
    const want = heightFor(nextImage, nextPrompt)
    const patch: Partial<LoopData> =
      which === 'image' ? { useImageInput: nextImage } : { usePrompt: nextPrompt }
    props.emit({
      type: 'updateData',
      patch: patch as never,
      transient: false,
      size: { w: props.node.w, h: want },
    })
  }

  const p = normalizeLoopParams(data)
  /** 本轮会输出的素材张数（最后一轮可能不足 batch） */
  const willOutput = data.useImageInput
    ? Math.max(0, Math.min(p.batch, upstreamImages - (p.loopStart - 1)))
    : 0
  const promptHint = upstreamPrompts
    ? `识别到 ${upstreamPrompts} 条上游提示词，按计数轮流输出`
    : '可使用 [计数] 作为变量'

  /**
   * 能否一键运行：**下游要有可运行的生成节点**（由 NodeLayer 按图算好注入）。
   *
   * 循环节点不产图，它的产物来自下游那一趟。下游没配好渠道 / 模型时，
   * 跑起来只会得到「无法构建请求」——那种情况按钮该是禁用的。
   */
  const canRun = !!props.hasRunnableDownstream

  return (
    <div className={styles.card} data-loop-node>
      {/* ① 循环 / 并发：两格分段 */}
      <div className={styles.row}>
        <div className={styles.seg} role="group" aria-label="循环方式">
          <button
            type="button"
            className={data.mode !== 'parallel' ? styles.segActive : styles.segBtn}
            data-loop-mode="serial"
            aria-pressed={data.mode !== 'parallel'}
            onClick={() => patchNow({ mode: 'serial' })}
          >
            循环
          </button>
          <button
            type="button"
            className={data.mode === 'parallel' ? styles.segActive : styles.segBtn}
            data-loop-mode="parallel"
            aria-pressed={data.mode === 'parallel'}
            title="多轮同时发起（受执行层并发上限约束）"
            onClick={() => patchNow({ mode: 'parallel' })}
          >
            并发
          </button>
        </div>
      </div>

      {/* ② 图片 / 提示词：带图标的开关 */}
      <div className={styles.row}>
        <button
          type="button"
          className={data.useImageInput ? styles.toggleActive : styles.toggle}
          data-loop-toggle="image"
          aria-pressed={data.useImageInput}
          onClick={() => toggleChannel('image')}
        >
          <IconImage />
          <span>图片</span>
        </button>
        <button
          type="button"
          className={data.usePrompt ? styles.toggleActive : styles.toggle}
          data-loop-toggle="prompt"
          aria-pressed={data.usePrompt}
          onClick={() => toggleChannel('prompt')}
        >
          <IconTextCursor />
          <span>提示词</span>
        </button>
      </div>

      {/* ③ 图片面板：上游缩略图 + 批次 + 说明 */}
      {data.useImageInput && (
        <div className={styles.panel} data-loop-image-panel>
          {upstreamImages > 0 && (
            <div className={styles.thumbRow} data-loop-thumbs>
              {(props.upstreamAssetHashes ?? []).map((hash, i) => (
                <UpstreamThumb key={hash} hash={hash} index={i + 1} />
              ))}
            </div>
          )}
          {/*
            批次放回图片面板里（用户 2026-09-23 第二次调整）。
            「批次」说的是「每轮取几张**图**」，它属于图片通道；放进底栏那一排后
            与「起始计数 / 次数」混在一起，反而看不出它只作用于图片。
            底栏那排留给两个**全局**参数 + 运行按钮。
          */}
          <div className={styles.mini}>
            <NumberControl
              label="批次"
              value={data.batch}
              max={100}
              dataKey="batch"
              onChange={(v) => patchLater({ batch: v }, 'batch')}
            />
          </div>
          <div className={styles.note} data-loop-image-note>
            {willOutput > 0 ? `当前会输出 ${willOutput} 张图片` : '上游没有可用的图片'}
          </div>
        </div>
      )}

      {/* ④ 提示词面板：上游预览 + 编号输入行 + 变量行 */}
      {data.usePrompt && (
        <div className={`${styles.panel} ${styles.promptPanel}`} data-loop-prompt-panel>
          {upstreamPrompts > 0 && (
            <div className={styles.upstream} data-loop-upstream-preview>
              <div className={styles.upstreamLabel}>{promptHint}</div>
            </div>
          )}
          <div className={styles.promptList} data-loop-prompt-list>
            {promptRows.map((text, i) => (
              <div className={styles.promptItem} key={i}>
                {/* 编号圆点**骑在左上角**（照抄大雄的 translate(-30%,-30%)） */}
                <span className={styles.promptIndex}>{i + 1}</span>
                <textarea
                  className={styles.promptText}
                  data-loop-prompt={i}
                  rows={2}
                  value={text}
                  placeholder="例如：现在生成第 [计数] 个卖点"
                  onChange={(e) => updatePrompt(i, e.target.value)}
                  onPointerDown={(e) => e.stopPropagation()}
                />
                <button
                  type="button"
                  className={styles.iconBtn}
                  data-loop-prompt-delete={i}
                  disabled={promptRows.length <= 1}
                  title="删除这一条"
                  aria-label="删除这一条"
                  onClick={() => patchNow({ prompts: promptRows.filter((_, k) => k !== i) })}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className={styles.promptActions}>
            <button
              type="button"
              className={styles.counterToken}
              data-loop-insert-counter
              title="在第一条提示词末尾插入 [计数] 变量"
              onClick={() => {
                const next = [...promptRows]
                next[0] = `${next[0] ?? ''}[计数]`
                patchNow({ prompts: next })
              }}
            >
              计数
            </button>
            <span className={styles.note} title={promptHint}>
              {promptHint}
            </span>
            <button
              type="button"
              className={styles.addPrompt}
              data-loop-prompt-add
              title="新增一条提示词"
              aria-label="新增一条提示词"
              onClick={() => patchNow({ prompts: [...promptRows, ''] })}
            >
              ＋
            </button>
          </div>
        </div>
      )}

      {/*
        ⑤ 底栏：**起始计数 / 次数 / 一键运行 三格一排**
        （用户 2026-09-23 第二次调整：「一键运行和起始计数和次数放在同一排」）。

        批次已放回图片面板（它只作用于图片通道），底栏留给两个全局参数 + 主操作。
      */}
      <div className={styles.footer} data-loop-footer>
        <NumberControl
          label="起始计数"
          value={p.loopStart}
          max={9999}
          dataKey="loopStart"
          onChange={(v) => patchLater({ loopStart: v }, 'loopStart')}
        />
        <NumberControl
          label="次数"
          value={p.count}
          max={100}
          dataKey="count"
          onChange={(v) => patchLater({ count: v }, 'count')}
        />
        {/*
          一键运行（用户 2026-09-23：「下方链接好生成节点的时候他就可以一键运行了，
          走的就是生成节点的参数」）。

          可点条件 = **下游有可运行的生成节点**（下游渠道 / 模型都配好）。
          循环节点自己不产图，下游没配好时点它必然空跑 —— 那种情况如实禁用并说明，
          而不是留一个点了没反应的按钮（本项目反复出现的缺陷类型）。
        */}
        <button
          type="button"
          className={styles.run}
          data-loop-run
          disabled={!canRun}
          title={
            canRun
              ? `按当前参数跑 ${p.count} 轮（下游生成节点的渠道与模型已就绪）`
              : !data.useImageInput && !data.usePrompt
                ? '先把图片或提示词打开'
                : '下游还没有配置好的生成节点：先连一个，并选好渠道与模型'
          }
          onClick={() => props.emit({ type: 'requestRun', mode: 'single' })}
        >
          <IconWorkflow />
          <span>一键运行</span>
        </button>
      </div>
    </div>
  )
}

/** 上游素材缩略图（大雄：`smartNodeInputThumbsHtml`，带序号角标） */
function UpstreamThumb({ hash, index }: { hash: string; index: number }) {
  const url = useAsset(hash)
  return (
    <span className={styles.thumb} data-loop-thumb={hash}>
      {url ? <img src={url} alt="" draggable={false} /> : <span className={styles.thumbEmpty} />}
      <span className={styles.thumbBadge}>{index}</span>
    </span>
  )
}

/**
 * 数字控件（复刻大雄的 `loopNumberControlHtml` / `.loop-number-control`）。
 *
 * 形态：胶囊显示「标签 + 当前值」，**悬停或聚焦时向上浮出**一个快捷面板 ——
 * 4 列网格放常用档位（1/2/3/4/5/6/8/10），下面一行自定义输入 + 应用按钮。
 *
 * 为什么值得做这一层：循环的三个数字天天要调（批次 1→4、次数 3→9），
 * 光靠加减按钮要点十几次，光靠手输又要先点进去再打字。快捷档位一按到位、
 * 长尾用自定义输入兜住——这是大雄那套里最实用的一处交互。
 */
function NumberControl({
  label,
  value,
  max,
  dataKey,
  onChange,
}: {
  label: string
  value: number
  max: number
  dataKey: string
  onChange: (v: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(String(value))
  const clampSet = (n: number) => onChange(Math.max(1, Math.min(max, Math.floor(n))))

  /**
   * 面板收起时把草稿同步回当前值。
   *
   * 不这么做的话：用户输入「15」没提交、又点到别处，下次打开会看到残留的 15，
   * 而胶囊上显示的是真实值（比如 3）—— 又是一处「显示与实际不一致」。
   */
  useEffect(() => {
    if (!open) setDraft(String(value))
  }, [open, value])

  const applyDraft = () => {
    const n = Number(draft)
    if (Number.isFinite(n)) clampSet(n)
  }

  return (
    <div
      className={styles.numControl}
      data-loop-number-bar={dataKey}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={styles.numTrigger}
        data-loop-number-trigger={dataKey}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span>{label}</span>
        {/* 数值单独包一层并带 data 锚点：自动化与既有冒烟都按它读当前值 */}
        <strong data-loop-number={dataKey}>{value}</strong>
      </button>
      {open && (
        <div className={styles.numPopover} data-loop-number-popover={dataKey}>
          <div className={styles.numGrid}>
            {QUICK_VALUES.filter((v) => v <= max).map((v) => (
              <button
                key={v}
                type="button"
                className={v === value ? styles.numCellActive : styles.numCell}
                data-loop-quick={`${dataKey}:${v}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => clampSet(v)}
              >
                {v}
              </button>
            ))}
          </div>
          <div className={styles.numCustom}>
            <input
              className={styles.numCustomInput}
              data-loop-number-input={dataKey}
              type="number"
              min={1}
              max={max}
              value={draft}
              onPointerDown={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyDraft()
              }}
            />
            <button
              type="button"
              className={styles.numApply}
              data-loop-number-apply={dataKey}
              aria-label={`应用${label}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={applyDraft}
            >
              ＋
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── 内联 SVG 图标 ──
 * 大雄用 lucide 图标库；轻画一律内联 SVG —— 本项目有明确教训：字体图标的
 * 字形位置由字体决定，旋转与居中不可控（曾导致「加号没绕自己中心转」）。
 * 形状照 lucide 手写，笔画由坐标定义。 */

function IconImage() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.5-3.5L9 20" />
    </svg>
  )
}

function IconTextCursor() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M4 7V5h16v2" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </svg>
  )
}

function IconWorkflow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <path d="M10 6.5h4a3 3 0 0 1 3 3v4" />
    </svg>
  )
}
