/**
 * 循环节点视图（产品文档 §6.22，2026-09-22）。
 *
 * 用户能改的只有「怎么分发」这部分参数：
 * 轮数 / 起始序号 / 每轮张数 / 串并行 / 两个开关（素材、提示词）/ 多条提示词。
 *
 * **它不显示任何产物**——循环节点不产图（见 `nodeSpecs/loop.ts` 的说明）。
 * 所以这里没有媒体框，是一张纯参数的卡。
 *
 * 所有参数变更都走 `updateData`（进撤销栈），不直接改 `data`。
 */
import { useRef } from 'react'
import type { NodeViewProps } from '../registry'
import type { LoopData } from '../../../../domain/canvas/model/node'
import styles from './LoopNodeView.module.css'

export function LoopNodeView(props: NodeViewProps) {
  const data = props.node.data as LoopData
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  /**
   * 数字字段用**防抖提交**：这是输入型控件，每敲一个字符就 dispatch 一条命令
   * 会把撤销栈撑爆（敲 "12" 产生两条：1 和 12）。
   * 300ms 无输入才提交，一次编辑 = 一步撤销。
   */
  const patchLater = (patch: Partial<LoopData>, key: string) => {
    clearTimeout(timers.current[key])
    timers.current[key] = setTimeout(() => {
      props.emit({ type: 'updateData', patch: patch as never, transient: false })
    }, 300)
  }

  const patchNow = (patch: Partial<LoopData>) => {
    props.emit({ type: 'updateData', patch: patch as never, transient: false })
  }

  const updatePrompt = (i: number, text: string) => {
    const next = [...data.prompts]
    next[i] = text
    patchLater({ prompts: next }, `prompt:${i}`)
  }

  return (
    <div className={styles.body} data-loop-node>
      {/* 第一行：串行 / 并行 + 两个开关 */}
      <div className={styles.row}>
        <div className={styles.seg} role="group" aria-label="循环方式">
          <button
            type="button"
            className={data.mode !== 'parallel' ? styles.segOn : styles.segBtn}
            data-loop-mode="serial"
            aria-pressed={data.mode !== 'parallel'}
            onClick={() => patchNow({ mode: 'serial' })}
          >
            串行
          </button>
          <button
            type="button"
            className={data.mode === 'parallel' ? styles.segOn : styles.segBtn}
            data-loop-mode="parallel"
            aria-pressed={data.mode === 'parallel'}
            title="多轮同时发起（受执行层并发上限约束）"
            onClick={() => patchNow({ mode: 'parallel' })}
          >
            并行
          </button>
        </div>
      </div>

      <div className={styles.row}>
        <button
          type="button"
          className={data.useImageInput ? styles.toggleOn : styles.toggle}
          data-loop-toggle="image"
          aria-pressed={data.useImageInput}
          onClick={() => patchNow({ useImageInput: !data.useImageInput })}
        >
          素材
        </button>
        <button
          type="button"
          className={data.usePrompt ? styles.toggleOn : styles.toggle}
          data-loop-toggle="prompt"
          aria-pressed={data.usePrompt}
          onClick={() => patchNow({ usePrompt: !data.usePrompt })}
        >
          提示词
        </button>
      </div>

      {/* 提示词面板：多条，按轮次轮换 */}
      {data.usePrompt && (
        <div className={styles.panel} data-loop-prompts>
          {/* 列表独立滚动：条目多时不会把提示词行压扁，也不会把下面的按钮挤出视野 */}
          <div className={styles.promptList} data-loop-prompt-list>
            {data.prompts.map((text, i) => (
              <div className={styles.promptRow} key={i}>
                <span className={styles.promptIndex}>{i + 1}</span>
                <input
                  className={styles.promptInput}
                  data-loop-prompt={i}
                  value={text}
                  placeholder={i === 0 ? '第《计数》张，共《总数》张' : '（空着则跳过这一条）'}
                  onChange={(e) => updatePrompt(i, e.target.value)}
                  onPointerDown={(e) => e.stopPropagation()}
                />
                <button
                  type="button"
                  className={styles.iconBtn}
                  data-loop-prompt-delete={i}
                  disabled={data.prompts.length <= 1}
                  title="删除这一条"
                  aria-label="删除这一条"
                  onClick={() => patchNow({ prompts: data.prompts.filter((_, k) => k !== i) })}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className={styles.row}>
            <button
              type="button"
              className={styles.tokenBtn}
              data-loop-insert-counter
              title="在第一条提示词末尾插入「计数」变量"
              onClick={() => {
                const next = [...data.prompts]
                next[0] = `${next[0] ?? ''}《计数》`
                patchNow({ prompts: next })
              }}
            >
              计数
            </button>
            <button
              type="button"
              className={styles.addBtn}
              data-loop-prompt-add
              title="新增一条提示词"
              aria-label="新增一条提示词"
              onClick={() => patchNow({ prompts: [...data.prompts, ''] })}
            >
              ＋
            </button>
          </div>
        </div>
      )}

      {/* 底部：三个数字 + 运行 */}
      <div className={styles.footer}>
        <NumberField
          label="起始"
          value={data.loopStart}
          max={9999}
          dataKey="loopStart"
          onChange={(v) => patchLater({ loopStart: v }, 'loopStart')}
        />
        <NumberField
          label="轮数"
          value={data.count}
          max={100}
          dataKey="count"
          onChange={(v) => patchLater({ count: v }, 'count')}
        />
        <NumberField
          label="每轮"
          value={data.batch}
          max={100}
          dataKey="batch"
          onChange={(v) => patchLater({ batch: v }, 'batch')}
        />
      </div>
    </div>
  )
}

/**
 * 数字字段：一个裸的 number input + 快捷档。
 *
 * 为什么不做成下拉：循环轮数是要**频繁试不同值**的参数（3 轮还是 5 轮），
 * 输入框比点两层菜单快。快捷档只列常用值，剩下的靠直接输入。
 */
function NumberField({
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
  return (
    <label className={styles.num} title={`${label}（1 – ${max}）`}>
      <span className={styles.numLabel}>{label}</span>
      <input
        className={styles.numInput}
        data-loop-number={dataKey}
        type="number"
        min={1}
        max={max}
        step={1}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (!Number.isFinite(n)) return
          onChange(Math.max(1, Math.min(max, Math.floor(n))))
        }}
        onPointerDown={(e) => e.stopPropagation()}
      />
    </label>
  )
}
