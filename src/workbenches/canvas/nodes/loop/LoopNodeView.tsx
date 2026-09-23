/**
 * 循环节点视图（产品文档 §6.22）。
 *
 * 2026-09-23 按「信息层级」重做一版。要解决的问题：
 * 240px 宽里塞不下「运行方式 + 两个通道 + 三个数字 + 多条提示词 + 进度」，
 * 上一版靠把面板拉长、字挤成两行硬塞，实测到处溢出。
 *
 * ## 这一版的信息分层
 *
 * | 层 | 内容 | 位置 |
 * | --- | --- | --- |
 * | 常驻 | 运行方式、两个通道开关（带数量）、三个数字、**结果摘要**、运行按钮 | 节点本体 |
 * | 二级 | 多条提示词的增删改、变量插入 | 点「编辑」开的抽屉 |
 *
 * 关键决策是**把提示词收进抽屉**（用户给的 AI 设计稿里的思路，本实现采纳）：
 * 提示词是这张卡里唯一「条目数不确定」的内容，内联列表会让节点高度随提示词条数
 * 无限增长；收进固定层后，节点本体高度是**确定的**，其余控件的空间才有保障。
 * 本体上只留一行「当前生效的那条」摘要，信息也没丢。
 *
 * ## 与执行的关系
 *
 * **「一键运行」尚未接执行引擎**（`expandLoopRounds` 写好了但没人调用）。
 * 本轮把按钮做成**如实的禁用态 + 说明**，而不是留一个点了没反应的主按钮——
 * 「点了没反应」是项目里反复出现的缺陷类型（见对账清单「点了没反应」各条）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { NodeViewProps } from '../registry'
import type { LoopData } from '../../../../domain/canvas/model/node'
import { normalizeLoopParams } from '../../../../domain/canvas/loop/loopPlan'
import { loopSummary } from '../../../../domain/canvas/loop/loopSummary'
import { useAsset } from '../../hooks/useAsset'
import styles from './LoopNodeView.module.css'

/** 变量芯片：点一下插到当前聚焦的输入框末尾 */
const TOKENS = [
  { label: '[计数]', hint: '当前轮次' },
  { label: '[总数]', hint: '总轮次' },
  { label: '[进度]', hint: '形如 3/10' },
] as const

export function LoopNodeView(props: NodeViewProps) {
  const data = props.node.data as LoopData
  const upstreamImages = (props.upstreamAssetHashes ?? []).length
  const upstreamPrompts = props.upstreamPromptCount ?? 0
  const [drawerOpen, setDrawerOpen] = useState(false)
  /**
   * 抽屉展开时**把节点临时撑高**，收起时还原（用户 2026-09-23）。
   *
   * 为什么必须这么做：节点高度是数据决定的，视图不能凭空长高。
   * 而抽屉（多条提示词的输入框）展开后内容会超过默认的 300 高，
   * 实测后果是**输入框被压扁到 41px**（正常 60+），文字挤成一团——
   * 正是「文字不许被压扁」这条约束要防的情况。
   *
   * 数值来自实测（探针量 `scrollHeight`，不靠估）：
   * 抽屉展开时内容需要 470，而节点框的 `clientHeight` 比 `height` 少 2px
   * （上下 1px 边框）。所以撑高值取 **474** = 470 + 2 + 2px 余量，
   * 否则会差那么一点点、仍然产生 2px 滚动。
   * **不写「默认高度」常量**：收起时还原的是撑高前的原值，用户手动拉高过的尺寸不会被抹掉。
   */
  const DRAWER_H = 474
  /** 变量插入的目标：用户最后聚焦的那个输入框（没聚焦过就插第一条） */
  const focusedRef = useRef(0)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const patchNow = (patch: Partial<LoopData>) => {
    props.emit({ type: 'updateData', patch: patch as never, transient: false })
  }
  const patchLater = (patch: Partial<LoopData>, key: string) => {
    clearTimeout(timers.current[key])
    timers.current[key] = setTimeout(() => {
      props.emit({ type: 'updateData', patch: patch as never, transient: false })
    }, 300)
  }

  const p = normalizeLoopParams(data)
  const summary = useMemo(
    () => loopSummary(data, { images: upstreamImages, prompts: upstreamPrompts }),
    [data, upstreamImages, upstreamPrompts],
  )

  /** 关掉某个通道时，把抽屉一并收起——抽屉里是提示词，开关一关它就没意义了 */
  useEffect(() => {
    if (!data.usePrompt) setDrawerOpen(false)
  }, [data.usePrompt])

  /**
   * 抽屉开合 ⇒ 节点高度跟着变。
   *
   * 收起时**还原到撑高之前的那个值**（而不是写死 DEFAULT_H）：
   * 用户可能已经手动把节点拉高过，直接改回 300 等于替他做了决定、还丢了尺寸。
   * 用 ref 记住撑高前的原始高度，只在「开 → 关」这一次还原。
   */
  const heightBeforeDrawer = useRef<number | null>(null)
  useEffect(() => {
    const h = props.node.h
    const emit = props.emit
    if (drawerOpen) {
      heightBeforeDrawer.current = h
      if (h < DRAWER_H) {
        emit({ type: 'updateData', patch: {}, transient: true, size: { w: props.node.w, h: DRAWER_H } } as never)
      }
    } else if (heightBeforeDrawer.current !== null) {
      const back = heightBeforeDrawer.current
      heightBeforeDrawer.current = null
      if (h !== back) {
        emit({ type: 'updateData', patch: {}, transient: true, size: { w: props.node.w, h: back } } as never)
      }
    }
    // 依赖数组**刻意只有 drawerOpen**：`props.node.h` 会在我们 emit 之后变化，
    // 若把它加进来，撑高 → 重渲染 → effect 重跑 → 又比较一次，会来回打架。
  }, [drawerOpen])

  const updatePrompt = (i: number, text: string) => {
    const next = [...data.prompts]
    next[i] = text
    patchLater({ prompts: next }, `prompt:${i}`)
  }

  const insertToken = (token: string) => {
    const i = Math.min(focusedRef.current, data.prompts.length - 1)
    if (i < 0) return
    const next = [...data.prompts]
    next[i] = `${next[i] ?? ''}${token}`
    patchNow({ prompts: next })
  }

  /** 本体上显示「当前生效的那条」：第 1 轮用哪条提示词 */
  const activePrompt = useMemo(() => {
    const own = data.prompts.find((s) => s.trim())
    if (own) return own
    return upstreamPrompts > 0 ? '（来自上游提示词节点）' : ''
  }, [data.prompts, upstreamPrompts])

  const runnable = data.useImageInput || data.usePrompt

  return (
    <div className={styles.body} data-loop-node>
      {/* ① 运行方式 */}
      <div className={styles.segmented} role="group" aria-label="运行方式">
        <button
          type="button"
          className={data.mode !== 'parallel' ? styles.segOn : styles.segBtn}
          data-loop-mode="serial"
          aria-pressed={data.mode !== 'parallel'}
          title="一轮跑完再跑下一轮"
          onClick={() => patchNow({ mode: 'serial' })}
        >
          串行
        </button>
        <button
          type="button"
          className={data.mode === 'parallel' ? styles.segOn : styles.segBtn}
          data-loop-mode="parallel"
          aria-pressed={data.mode === 'parallel'}
          title="多轮同时发起（受并发上限约束）"
          onClick={() => patchNow({ mode: 'parallel' })}
        >
          并发
        </button>
      </div>

      {/* ② 两个通道：开关 + 数量。数量直接写在标题里，省一行空态文案 */}
      <div className={styles.channels}>
        <ChannelRow
          kind="image"
          label="图片"
          count={upstreamImages}
          on={data.useImageInput}
          onToggle={() => patchNow({ useImageInput: !data.useImageInput })}
        />
        <ChannelRow
          kind="prompt"
          label="提示词"
          count={upstreamPrompts + data.prompts.filter((s) => s.trim()).length}
          on={data.usePrompt}
          onToggle={() => patchNow({ usePrompt: !data.usePrompt })}
        />
      </div>

      {/* ③ 图片通道展开时：上游缩略图（一屏最多露 4 张，其余横滚） */}
      {data.useImageInput && upstreamImages > 0 && (
        <div className={styles.thumbRow} data-loop-thumbs>
          {(props.upstreamAssetHashes ?? []).slice(0, 6).map((hash, i) => (
            <UpstreamThumb key={hash} hash={hash} index={i + 1} />
          ))}
        </div>
      )}

      {/* ④ 提示词通道展开时：摘要 + 编辑入口（真正的编辑在抽屉里） */}
      {data.usePrompt && (
        <div className={styles.promptRow} data-loop-prompt-summary>
          <span className={styles.promptText} title={activePrompt}>
            {activePrompt || '还没有提示词'}
          </span>
          <button
            type="button"
            className={styles.editBtn}
            data-loop-prompt-edit
            onClick={() => setDrawerOpen((v) => !v)}
            aria-expanded={drawerOpen}
          >
            编辑
          </button>
        </div>
      )}

      {/* ⑤ 三个数字：2 列网格，标签在上、加减在下，避免 240px 里挤成一行 */}
      <div className={styles.params} data-loop-params>
        <NumberCell
          label="起始"
          hint="从上游第几张开始取，也是 [计数] 的起始值"
          value={p.loopStart}
          max={9999}
          dataKey="loopStart"
          onChange={(v) => patchLater({ loopStart: v }, 'loopStart')}
        />
        <NumberCell
          label="次数"
          hint="从这里开始跑几轮"
          value={p.count}
          max={100}
          dataKey="count"
          onChange={(v) => patchLater({ count: v }, 'count')}
        />
        <NumberCell
          label="批次"
          hint="每一轮取几张素材"
          value={p.batch}
          max={100}
          dataKey="batch"
          disabled={!data.useImageInput}
          onChange={(v) => patchLater({ batch: v }, 'batch')}
        />
      </div>

      {/* ⑥ 结果摘要：把三个数字翻译成一句人话 */}
      <div className={styles.summary} data-loop-summary={summary.tone} title={summary.text}>
        {summary.text}
      </div>

      {/* ⑦ 运行：未接执行引擎，如实禁用并说明 */}
      <button
        type="button"
        className={styles.runBtn}
        data-loop-run
        disabled
        title={
          runnable
            ? '循环执行还没接上，当前只能配置'
            : '先把图片或提示词通道打开'
        }
      >
        一键运行（尚未接执行）
      </button>

      {/* 抽屉：多条提示词的增删改 + 变量插入 */}
      {drawerOpen && data.usePrompt && (
        <div className={styles.drawer} data-loop-drawer>
          <div className={styles.drawerHead}>
            <span className={styles.drawerTitle}>提示词</span>
            <button
              type="button"
              className={styles.drawerClose}
              data-loop-drawer-close
              aria-label="关闭"
              title="关闭"
              onClick={() => setDrawerOpen(false)}
            >
              ×
            </button>
          </div>

          <div className={styles.tokenRow}>
            <span className={styles.tokenLabel}>插入</span>
            {TOKENS.map((t) => (
              <button
                key={t.label}
                type="button"
                className={styles.tokenBtn}
                data-loop-token={t.label}
                title={`${t.hint}（也可写成全角 ${t.label.replace('[', '《').replace(']', '》')}）`}
                onClick={() => insertToken(t.label)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className={styles.drawerList} data-loop-drawer-list>
            {data.prompts.map((text, i) => (
              <div className={styles.drawerItem} key={i}>
                <div className={styles.drawerItemHead}>
                  <span className={styles.drawerIndex}>#{i + 1}</span>
                  <button
                    type="button"
                    className={styles.drawerDel}
                    data-loop-prompt-delete={i}
                    disabled={data.prompts.length <= 1}
                    title="删除这一条"
                    aria-label={`删除第 ${i + 1} 条`}
                    onClick={() => patchNow({ prompts: data.prompts.filter((_, k) => k !== i) })}
                  >
                    ×
                  </button>
                </div>
                <textarea
                  className={styles.drawerInput}
                  data-loop-prompt={i}
                  rows={2}
                  value={text}
                  placeholder="例如：第 [计数] 组，自然光散射"
                  onFocus={() => { focusedRef.current = i }}
                  onChange={(e) => updatePrompt(i, e.target.value)}
                  onPointerDown={(e) => e.stopPropagation()}
                />
              </div>
            ))}
          </div>

          <button
            type="button"
            className={styles.drawerAdd}
            data-loop-prompt-add
            onClick={() => patchNow({ prompts: [...data.prompts, ''] })}
          >
            ＋ 添加一条
          </button>
        </div>
      )}
    </div>
  )
}

/** 通道行：图标 + 名称 + 数量 + 开关 */
function ChannelRow({
  kind,
  label,
  count,
  on,
  onToggle,
}: {
  kind: 'image' | 'prompt'
  label: string
  count: number
  on: boolean
  onToggle: () => void
}) {
  return (
    <div className={on ? styles.channel : styles.channelOff} data-loop-channel={kind}>
      <span className={styles.channelName}>
        {label}
        <span className={styles.channelCount}>{count > 0 ? ` (${count})` : ''}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${label}通道`}
        className={on ? styles.switchOn : styles.switchOff}
        data-loop-toggle={kind}
        onClick={onToggle}
      >
        <span className={on ? styles.knobOn : styles.knobOff} />
      </button>
    </div>
  )
}

/** 上游素材缩略图（带「图 N」角标，编号与起始计数的口径一致） */
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
 * 数字格：标签在上、值居中、加减在两侧。
 *
 * 为什么不做成「标签 + 输入框」一行：240px 里三格并排时每格只有 ~70px，
 * 「起始」两个字加输入框必然挤成两行（上一版实测）。改成**纵向**后每格宽度够，
 * 标签也能完整显示；三格用 3 列网格并排，高度反而更省。
 */
function NumberCell({
  label,
  hint,
  value,
  max,
  dataKey,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  value: number
  max: number
  dataKey: string
  disabled?: boolean
  onChange: (v: number) => void
}) {
  const clampSet = (n: number) => onChange(Math.max(1, Math.min(max, Math.floor(n))))
  return (
    <div className={disabled ? styles.numCellOff : styles.numCell} data-loop-number-bar={dataKey} title={`${label}：${hint}`}>
      <span className={styles.numLabel}>{label}</span>
      <div className={styles.numRow}>
        <button
          type="button"
          className={styles.stepBtn}
          data-loop-step={`${dataKey}-down`}
          disabled={disabled || value <= 1}
          aria-label={`${label}减一`}
          onClick={() => clampSet(value - 1)}
        >
          −
        </button>
        <input
          className={styles.numInput}
          data-loop-number={dataKey}
          type="number"
          min={1}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (!Number.isFinite(n)) return
            clampSet(n)
          }}
        />
        <button
          type="button"
          className={styles.stepBtn}
          data-loop-step={`${dataKey}-up`}
          disabled={disabled || value >= max}
          aria-label={`${label}加一`}
          onClick={() => clampSet(value + 1)}
        >
          ＋
        </button>
      </div>
    </div>
  )
}
