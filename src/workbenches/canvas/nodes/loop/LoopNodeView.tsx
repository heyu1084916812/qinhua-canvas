/**
 * 循环节点视图（产品文档 §6.22，2026-09-22，按用户参考图重做）。
 *
 * 用户给的四张参考图确定了形态与交互：
 *
 * - 顶部「循环 / 并发」分段（对应 `mode: serial | parallel`）；
 * - 第二行「图片 / 提示词」两个**开关按钮**（点亮 = 打开）；
 * - **内容区由开关 + 上游驱动**：
 *   · 连了图片（或开关开）→ 显示上游缩略图 + 「批次 N」+「当前会输出 N 张图片」；
 *   · 连了提示词（或开关开）→ 显示上游提示词预览（滚动）+ 编号的提示词输入行
 *     + 「计数 / 可使用 [计数] 作为变量」行；
 *   · 两者都开 → 两块上下堆叠（参考图四）；
 * - 底部「起始计数 N | 次数 N | 一键运行」三件套。
 *
 * 语义（用户口述钉死）：
 * - **起始计数**同时控制两件事：①从上游第几张素材开始取；②`《计数》`变量的起始值；
 * - **次数** = 从起始计数起跑几轮（起始 2 + 次数 2 → 跑第 2、3 张）；
 * - **批次** = 一轮的"范围"（每轮取几张）。
 *
 * 自动展开（方案 A）：上游连了对应类型 → 对应面板**自动打开**，用户仍可手动关。
 */
import { useRef } from 'react'
import type { NodeViewProps } from '../registry'
import type { LoopData } from '../../../../domain/canvas/model/node'
import { normalizeLoopParams } from '../../../../domain/canvas/loop/loopPlan'
import { useAsset } from '../../hooks/useAsset'
import styles from './LoopNodeView.module.css'

export function LoopNodeView(props: NodeViewProps) {
  const data = props.node.data as LoopData
  /** 上游素材数（NodeLayer 注入）；上游提示词节点数（NodeLayer 注入） */
  const upstreamImages = (props.upstreamAssetHashes ?? []).length
  const upstreamPrompts = props.upstreamPromptCount ?? 0
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

  const updatePrompt = (i: number, text: string) => {
    const next = [...data.prompts]
    next[i] = text
    patchLater({ prompts: next }, `prompt:${i}`)
  }

  /** 展开预览（节选自 loopPlan 的数学，用于底部提示文字） */
  const p = normalizeLoopParams(data)
  /** 本轮会输出的素材张数（最后一轮可能不足 batch） */
  const willOutput = data.useImageInput
    ? Math.max(0, Math.min(p.batch, upstreamImages - (p.loopStart - 1)))
    : 0

  return (
    <div className={styles.body} data-loop-node>
      {/* ① 循环 / 并发 */}
      <div className={styles.segmented} role="group" aria-label="循环方式">
        <button
          type="button"
          className={data.mode !== 'parallel' ? styles.segOn : styles.segBtn}
          data-loop-mode="serial"
          aria-pressed={data.mode !== 'parallel'}
          onClick={() => patchNow({ mode: 'serial' })}
        >
          循环
        </button>
        <button
          type="button"
          className={data.mode === 'parallel' ? styles.segOn : styles.segBtn}
          data-loop-mode="parallel"
          aria-pressed={data.mode === 'parallel'}
          title="多轮同时发起（受执行层并发上限约束）"
          onClick={() => patchNow({ mode: 'parallel' })}
        >
          并发
        </button>
      </div>

      {/* ② 图片 / 提示词 两个开关（点亮 = 打开该面板） */}
      <div className={styles.switchRow}>
        <button
          type="button"
          className={data.useImageInput ? styles.switchOn : styles.switchBtn}
          data-loop-toggle="image"
          aria-pressed={data.useImageInput}
          onClick={() => patchNow({ useImageInput: !data.useImageInput })}
        >
          图片
        </button>
        <button
          type="button"
          className={data.usePrompt ? styles.switchOn : styles.switchBtn}
          data-loop-toggle="prompt"
          aria-pressed={data.usePrompt}
          onClick={() => patchNow({ usePrompt: !data.usePrompt })}
        >
          提示词
        </button>
      </div>

      {/* ③ 素材面板：上游缩略图 + 批次 + 输出提示 */}
      {data.useImageInput && (
        <div className={styles.panel} data-loop-image-panel>
          {upstreamImages > 0 ? (
            <div className={styles.thumbRow} data-loop-thumbs>
              {(props.upstreamAssetHashes ?? []).map((hash, i) => (
                <UpstreamThumb key={hash} hash={hash} index={i + 1} />
              ))}
            </div>
          ) : (
            <div className={styles.empty} data-loop-image-empty>
              连线上游图片节点
            </div>
          )}
          <NumberBar label="批次" value={data.batch} max={100} dataKey="batch" onChange={(v) => patchLater({ batch: v }, 'batch')} />
          <div className={styles.note} data-loop-image-note>
            {willOutput > 0 ? `当前会输出 ${willOutput} 张图片` : '上游没有可用的图片'}
          </div>
        </div>
      )}

      {/* ④ 提示词面板：上游预览 + 编号输入 + 计数行 */}
      {data.usePrompt && (
        <div className={styles.panel} data-loop-prompt-panel>
          {upstreamPrompts > 0 && (
            <div className={styles.preview} data-loop-upstream-preview>
              识别到 {upstreamPrompts} 条提示词，按计数轮流输出
            </div>
          )}
          <div className={styles.promptList} data-loop-prompt-list>
            {data.prompts.map((text, i) => (
              <div className={styles.promptRow} key={i}>
                <span className={styles.promptIndex}>{i + 1}</span>
                <input
                  className={styles.promptInput}
                  data-loop-prompt={i}
                  value={text}
                  placeholder="例如：现在生成第[计数]个卖点"
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
          <div className={styles.counterRow}>
            <button
              type="button"
              className={styles.counterBtn}
              data-loop-insert-counter
              title="在第一条提示词末尾插入 [计数] 变量"
              onClick={() => {
                const next = [...data.prompts]
                next[0] = `${next[0] ?? ''}[计数]`
                patchNow({ prompts: next })
              }}
            >
              计数
            </button>
            <span className={styles.counterNote}>可使用 [计数] 作为变量</span>
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

      {/* ⑤ 起始计数 / 次数 / 一键运行 */}
      <div className={styles.footer} data-loop-footer>
        <NumberBar label="起始计数" value={data.loopStart} max={9999} dataKey="loopStart" onChange={(v) => patchLater({ loopStart: v }, 'loopStart')} />
        <NumberBar label="次数" value={data.count} max={100} dataKey="count" onChange={(v) => patchLater({ count: v }, 'count')} />
        <button type="button" className={styles.runBtn} data-loop-run title="一键运行整个循环">
          一键运行
        </button>
      </div>
    </div>
  )
}

/** 上游素材缩略图（参考图二：带「图 N」角标） */
function UpstreamThumb({ hash, index }: { hash: string; index: number }) {
  const url = useAsset(hash)
  return (
    <span className={styles.thumb} data-loop-thumb={hash}>
      {url ? <img src={url} alt="" draggable={false} /> : <span className={styles.thumbEmpty} />}
      <span className={styles.thumbBadge}>图{index}</span>
    </span>
  )
}
/** 数字条：参考图里的「批次 1 / 起始计数 1 / 次数 1」——标签与数字并排的一个胶囊 */
function NumberBar({
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
    <label className={styles.numBar} data-loop-number-bar={dataKey}>
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
