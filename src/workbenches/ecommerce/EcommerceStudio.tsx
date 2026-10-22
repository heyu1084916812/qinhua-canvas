import {
  useEffect,
  useMemo,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from 'react'
import { EcommerceRequestError, buildEcommercePlan } from '../../domain/ecommerce/plan'
import {
  ECOMMERCE_PLATFORM_ORDER,
  ECOMMERCE_PLATFORMS,
  type EcommercePlatform,
} from '../../domain/ecommerce/platforms'
import type { EcommerceIntentDraft } from '../../domain/ecommerce/chatParse'
import type { EcommercePlanSession } from '../../domain/ecommerce/sessions'
import type { EcommerceTaskRecord } from '../../domain/ecommerce/tasks'
import {
  shouldExpandShots,
  type ShotPlanResult,
} from '../../domain/ecommerce/chatShots'
import type { EcommerceGenerationStage } from '../../domain/ecommerce/progress'
import {
  ECOMMERCE_COUNT_MAX,
  ecommerceLanguageOptionLabel,
  ecommerceLanguageOptions,
  ecommerceRatioLabel,
  ecommerceRatioOptions,
  usageLabel,
  type EcommerceLanguage,
  type EcommerceModeOptions,
  type EcommerceRequest,
  type EcommerceUsage,
} from '../../domain/ecommerce/types'
import { ECOMMERCE_NOTE_MAX } from '../../domain/ecommerce/prompt'
import type { EcommerceShot } from '../../domain/ecommerce/prompt'
import {
  AGE_OPTIONS,
  BODY_OPTIONS,
  DETAIL_HIGHLIGHT_OPTIONS,
  ETHNICITY_OPTIONS,
  GENDER_OPTIONS,
  PRODUCT_SET_COUNT_OPTIONS,
  RETOUCH_OPTIONS,
  VIDEO_TYPE_OPTIONS,
  WEAR_DETAIL_OPTIONS,
  WEAR_TYPE_OPTIONS,
  WHITE_BG_ANGLE_OPTIONS,
  batchWhiteOutputError,
  buildEcommerceModeOptionsPrompt,
  defaultEcommerceModeOptions,
  ecommerceModeCount,
  modeOptionCounts,
  modeOptionString,
  modeOptionStrings,
  normalizeEcommerceModeOptions,
  whiteBgCountsOf,
} from '../../domain/ecommerce/modeOptions'
import {
  DEFAULT_ECOMMERCE_FORM_DRAFT,
  type EcommerceModeFormState,
  type EcommerceFormDraft,
} from '../../domain/ecommerce/draft'
import {
  ECOMMERCE_UPSCALE_OPTIONS,
  ECOMMERCE_UPSCALE_SCALES,
  type EcommerceUpscaleProfile,
  type EcommerceUpscaleScale,
} from '../../domain/ecommerce/upscale'
import { presetOf } from '../../domain/project/modelCatalog'
import { ModelIcon } from '../../features/shared/modelIcon/ModelIcon'
import { EcommerceSelect, type EcommerceSelectOption } from './EcommerceSelect'
import styles from './EcommerceStudio.module.css'

/**
 * 电商工作台 A 版（对账 #384）：**固定表单 → 出图**。
 *
 * 与 `workbenches/canvas` 保持零互引：这个组件**只描述界面**，
 * 「上传到哪、怎么生成、结果从哪读」全部由 `pages/EcommercePage` 注入
 * （页面才是装配层，它可以同时认识画布与电商两侧）。直接好处是这个文件
 * 可以在没有画布 store 的情况下被单测 / 陈列室渲染。
 *
 * A 版**明确不做**：风格推荐、长图编辑器。
 *
 * **对账 #422 起多了一块**：左栏顶部「一句话 → 待确认方案」——
 * 那是 #380b 专业版里 agent 对话的**第一片**。口径是「先给你看它听懂了什么，
 * 确认了才填表」：解析结果只是**草稿**，表单始终是唯一真相。
 * 调模型的事不在这里（这个组件不认识渠道）——页面注入 `onParseIntent`，不传就不渲染。
 */

export interface EcommerceUpload {
  nodeId: string
  hash: string
  preview: ReactNode
  width?: number
  height?: number
}

export interface EcommerceImageParamOptions {
  resolutions: readonly string[]
  qualities: readonly string[]
}

export interface EcommerceResultItem {
  nodeId: string
  /** 电商结果表的真实 id；工作台操作按它回查。 */
  resultId?: string
  status: 'running' | 'done' | 'failed'
  /** 产物 MIME；视频结果据此使用播放器而不是 img。 */
  mime?: string
  /** 失败原因（`status === 'failed'` 时必须有 —— 不许静默） */
  error?: string
  preview?: ReactNode
  /** AI 编辑结果的原图预览；普通生成结果为空 */
  sourcePreview?: ReactNode
  /** 结果的实际提示词 / 模型 / 比例 / 任务要求，用于解释这张图怎么来的 */
  prompt?: string
  model?: string
  ratio?: string
  shotTitle?: string
  brief?: string
  headline?: string
  subheadline?: string
  visualSystem?: string
  note?: string
  createdAt?: number
  /**
   * 产物素材 hash（对账 #420）：长图拼合要靠它把像素画进一张 canvas。
   *
   * 与 `preview`（ReactNode）的分工：那个只给**单张**看；拼长图要的是 hash 本身。
   * 没有产物（跑着 / 失败）时为空 —— 长图会把它跳过并如实报出来。
   */
  imageHash?: string
  /** 产物的真实像素（长按等比缩放要用；未知就别拼，不许按"大概比例"塞高度） */
  pixelSize?: { width: number; height: number } | null
  /** 下载出口；没有产物时为 undefined */
  onDownload?: () => void
  /**
   * **只重跑这一张**（页面注入；跑着的那张不给按钮）。
   *
   * 为什么值得单开一个入口：一套图里往往只有一两张不满意 —— 整批重来既慢又费额度。
   * 失败的那张尤其需要它（失败原因就写在旁边，重试不必回头改参数）。
   */
  onRerun?: () => Promise<void> | void
  /** 失败结果专用：移除这条失败记录，不动同批次成功结果。 */
  onRemoveFailed?: () => void
  /**
   * **原地换掉这一格**（对账 #413）：产物写回同一个节点，画布上**不多一个节点**。
   *
   * 与 `onRerun` 的区别就是"抽卡 vs 换掉"：
   * - `onRerun`：再抽一张，旧的留着（画布多一个承载节点）——适合比稿；
   * - `onReplace`：这次的结果直接替换这一格 —— 适合"就这一张不行，换一张"。
   *
   * 运行记录照常 +1（换掉的是画面，不是历史）。
   */
  onReplace?: () => Promise<void> | void
  /** 收藏到素材库（只写收藏关系，不复制字节） */
  onSaveToLibrary?: () => Promise<void> | void
}

type StudioCategory = 'product' | 'video' | 'wear'

interface StudioMode {
  id: string
  category: StudioCategory
  label: string
  usage: EcommerceUsage
  count: number
  mediaKind: 'image' | 'video'
  ratio?: string
  promptPrefix?: string
}

const STUDIO_CATEGORIES: readonly {
  id: StudioCategory
  label: string
}[] = [
  { id: 'product', label: '商品' },
  { id: 'video', label: '视频' },
  { id: 'wear', label: '穿戴' },
]

const STUDIO_MODES: readonly StudioMode[] = [
  {
    id: 'product-set',
    category: 'product',
    label: '商品套图',
    usage: 'set',
    count: 8,
    mediaKind: 'image',
  },
  {
    id: 'product-detail',
    category: 'product',
    label: 'A+ 详情页',
    usage: 'detail',
    count: 4,
    mediaKind: 'image',
  },
  {
    id: 'product-recreate',
    category: 'product',
    label: '爆款复刻',
    usage: 'recreate',
    count: 4,
    mediaKind: 'image',
  },
  {
    id: 'product-white',
    category: 'product',
    label: '白底图',
    usage: 'white-bg',
    count: 1,
    mediaKind: 'image',
    ratio: '1:1',
  },
  {
    id: 'product-retouch',
    category: 'product',
    label: '产品精修',
    usage: 'main',
    count: 1,
    mediaKind: 'image',
    promptPrefix:
      '做专业商品精修：只优化产品本身的光泽、瑕疵、清晰度与透视，保持产品外观、颜色、材质和结构不变。',
  },
  {
    id: 'product-recolor',
    category: 'product',
    label: '产品换色',
    usage: 'main',
    count: 1,
    mediaKind: 'image',
    promptPrefix:
      '只替换产品的主色，保持产品造型、材质、结构、镜头、背景和画面文字不变；不要新增品牌标识。',
  },
  {
    id: 'video-recreate',
    category: 'video',
    label: '视频复刻',
    usage: 'recreate',
    count: 1,
    mediaKind: 'video',
    ratio: '9:16',
    promptPrefix:
      '参考素材只借镜头、节奏、景别、转场和光线；商品主体必须来自产品图，不复制品牌、人物身份和水印。',
  },
  {
    id: 'video-commerce',
    category: 'video',
    label: '带货视频',
    usage: 'set',
    count: 1,
    mediaKind: 'video',
    ratio: '9:16',
    promptPrefix:
      '生成一条简洁的电商带货短视频：开头快速展示商品，随后展示核心卖点与使用场景，镜头自然连续。',
  },
  {
    id: 'wear-set',
    category: 'wear',
    label: '服装组图',
    usage: 'set',
    count: 6,
    mediaKind: 'image',
    promptPrefix:
      '保持服装版型、颜色、面料、图案和结构不变，生成完整的服装电商展示组图。',
  },
  {
    id: 'wear-model',
    category: 'wear',
    label: '模特穿搭',
    usage: 'set',
    count: 4,
    mediaKind: 'image',
    promptPrefix:
      '让模特自然穿着产品图里的服装，保持服装版型、颜色、图案和细节一致；可用参考图控制模特形象。',
  },
  {
    id: 'wear-tryon',
    category: 'wear',
    label: '试穿换装',
    usage: 'main',
    count: 1,
    mediaKind: 'image',
    promptPrefix:
      '把产品图里的服装自然穿到参考人物身上，保持服装颜色、图案、版型和材质一致，不改变人物身份。',
  },
  {
    id: 'wear-detail',
    category: 'wear',
    label: '服装细节',
    usage: 'detail',
    count: 4,
    mediaKind: 'image',
    promptPrefix:
      '围绕服装的领口、袖口、走线、面料纹理和版型生成细节展示图，保持与产品图完全一致。',
  },
]

function OptionContent({ option }: { option: (typeof DETAIL_HIGHLIGHT_OPTIONS)[number] }) {
  return (
    <span className={styles.optionText}>
      <span className={styles.optionLabel}>{option.label}</span>
      {option.hint ? (
        <span className={styles.optionHint} data-ecommerce-option-hint>
          {option.hint}
        </span>
      ) : null}
    </span>
  )
}

function modelIconFor(label: string): ReactNode {
  const logicalName = label.split(' · ').at(-1)?.trim() ?? label.trim()
  const preset = presetOf(logicalName)
  return preset ? <ModelIcon vendor={preset.vendor} size={19} /> : undefined
}

function OptionCheck({ checked }: { checked: boolean }) {
  return (
    <span className={styles.optionMark} aria-hidden="true">
      {checked ? (
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m3.2 8.2 3.1 3.1 6.5-6.6" />
        </svg>
      ) : null}
    </span>
  )
}

export function ResultStatusOverlay({ item }: { item: EcommerceResultItem }) {
  const running = item.status === 'running'
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!running) {
      setElapsed(0)
      return
    }
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 500)
    return () => window.clearInterval(timer)
  }, [running])

  if (item.status === 'failed') {
    return (
      <div
        className={`${styles.resultOverlay} ${styles.resultOverlayError}`}
        data-ecommerce-result-overlay="failed"
        role="alert"
      >
        <span className={styles.resultFailure}>
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7.5v5.5" />
            <path d="M12 16.8h.01" />
          </svg>
          <span className={styles.resultFailureTitle}>生成失败</span>
          <span
            className={styles.resultFailureText}
            data-ecommerce-result-error
            title={item.error}
          >
            {item.error ?? '没有收到失败原因，请查看画布运行日志'}
          </span>
        </span>
      </div>
    )
  }

  return (
    <div
      className={styles.resultOverlay}
      data-ecommerce-result-overlay={item.status}
    >
      <span className={styles.resultRunning}>
        <span
          className={styles.resultOrbit}
          data-ecommerce-result-orbit
          aria-hidden="true"
        />
        <span
          className={styles.resultRunningText}
          data-ecommerce-result-elapsed={elapsed}
        >
          生成中 {elapsed}s
        </span>
      </span>
    </div>
  )
}

export function GenerationStageView({ stage }: { stage: EcommerceGenerationStage | null }) {
  if (!stage) return null
  return (
    <div
      className={styles.generationStage}
      data-ecommerce-generation-stage={stage.phase}
      data-current={stage.current}
      data-total={stage.total}
      role={stage.phase === 'failed' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span className={styles.generationStageDot} aria-hidden="true" />
      <span className={styles.generationStageCopy}>
        <strong>{stage.label}</strong>
        {stage.detail ? <span title={stage.detail}>{stage.detail}</span> : null}
      </span>
      {stage.total ? (
        <span className={styles.generationStageCount}>
          {stage.current ?? 0}/{stage.total}
        </span>
      ) : null}
    </div>
  )
}

function textOptions(
  items: readonly { id: string; label: string }[],
): EcommerceSelectOption[] {
  return items.map((item) => ({ value: item.id, label: item.label }))
}

function defaultModeFormState(mode: StudioMode): EcommerceModeFormState {
  return {
    platformId: 'amazon',
    language: 'en',
    ratio:
      mode.id === 'product-set'
        ? 'smart'
        : mode.usage === 'detail'
        ? 'aplus-premium-web'
        : (mode.ratio ?? '1:1'),
    resolution: 'auto',
    quality: 'auto',
    note: '',
  }
}

function ModeSpecificParameters({
  modeId,
  options,
  setOption,
  toggleOption,
}: {
  modeId: string
  options: EcommerceModeOptions
  setOption: (key: string, value: string | string[] | Record<string, number>) => void
  toggleOption: (key: string, id: string) => void
}) {
  const setCounts = modeOptionCounts(options)
  const updateSetCount = (id: string, delta: number) => {
    const next = Math.min(
      Math.max((setCounts[id] ?? 0) + delta, 0),
      ECOMMERCE_COUNT_MAX,
    )
    setOption('setCounts', { ...setCounts, [id]: next })
  }
  const toggleSetCount = (id: string) => {
    const next = (setCounts[id] ?? 0) > 0 ? 0 : 1
    setOption('setCounts', { ...setCounts, [id]: next })
  }
  const selected = (key: string, id: string) => modeOptionStrings(options, key).includes(id)

  if (modeId === 'product-set') {
    const strategy = modeOptionString(options, 'setStrategy', 'smart')
    return (
      <section className={styles.block} data-ecommerce-mode-params="product-set">
        <span className={styles.blockTitle}>套图结构配置</span>
        <div className={styles.choiceGroup} role="radiogroup" aria-label="套图结构配置">
          <button
            type="button"
            role="radio"
            aria-checked={strategy === 'smart'}
            className={
              strategy === 'smart'
                ? `${styles.choiceCard} ${styles.choiceCardOn}`
                : styles.choiceCard
            }
            data-ecommerce-option="set-strategy-smart"
            onClick={() => setOption('setStrategy', 'smart')}
          >
            <span className={styles.choiceRadio} aria-hidden />
            <span>
              <span className={styles.choiceTitle}>智能匹配</span>
              <span className={styles.choiceHint}>AI 智能分析商品图，匹配最佳 Listing 套图</span>
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={strategy === 'custom'}
            className={
              strategy === 'custom'
                ? `${styles.choiceCard} ${styles.choiceCardOn}`
                : styles.choiceCard
            }
            data-ecommerce-option="set-strategy-custom"
            onClick={() => setOption('setStrategy', 'custom')}
          >
            <span className={styles.choiceRadio} aria-hidden />
            <span>
              <span className={styles.choiceTitle}>自定义配置</span>
              <span className={styles.choiceHint}>可自由调整各类型图片数量，至少选择 1 张</span>
            </span>
          </button>
        </div>
        {strategy === 'custom' ? (
          <div className={styles.setCountList} data-ecommerce-set-counts>
            {PRODUCT_SET_COUNT_OPTIONS.map((item) => {
              const count = setCounts[item.id] ?? 0
              return (
                <div
                  key={item.id}
                  className={styles.setCountItem}
                  data-ecommerce-set-item={item.id}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={count > 0}
                    aria-label={`${item.label}${count > 0 ? '已启用' : '未启用'}`}
                    className={
                      count > 0
                        ? `${styles.setCheck} ${styles.setCheckOn}`
                        : styles.setCheck
                    }
                    data-ecommerce-set-enabled={item.id}
                    onClick={() => toggleSetCount(item.id)}
                  >
                    {count > 0 ? (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="m3.2 8.2 3.1 3.1 6.5-6.6" />
                      </svg>
                    ) : null}
                  </button>
                  <span className={styles.setCountBody}>
                    <span className={styles.setCountTitleRow}>
                      <span className={styles.setCountTitle}>{item.label}</span>
                      {item.id === 'other' ? (
                        <span className={styles.setAiBadge}>AI 智能匹配</span>
                      ) : null}
                    </span>
                    {item.hint ? (
                      <span className={styles.setCountHint}>{item.hint}</span>
                    ) : null}
                  </span>
                  <span className={styles.stepper}>
                    <button
                      type="button"
                      aria-label={`${item.label}减少一张`}
                      data-ecommerce-set-step={`${item.id}:-1`}
                      onClick={() => updateSetCount(item.id, -1)}
                    >
                      -
                    </button>
                    <span data-ecommerce-set-count={item.id}>{count}</span>
                    <button
                      type="button"
                      aria-label={`${item.label}增加一张`}
                      data-ecommerce-set-step={`${item.id}:1`}
                      onClick={() => updateSetCount(item.id, 1)}
                    >
                      +
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        ) : null}
      </section>
    )
  }

  if (modeId === 'product-detail') {
    return (
      <section className={styles.block} data-ecommerce-mode-params="product-detail">
        <span className={styles.blockTitle}>快速优化项</span>
        <span className={styles.hint}>选择常用的优化方向，可多选</span>
        <div className={styles.optionGrid}>
          {DETAIL_HIGHLIGHT_OPTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={selected('detailHighlights', item.id)}
              className={
                selected('detailHighlights', item.id)
                  ? `${styles.optionTile} ${styles.optionTileOn}`
                  : styles.optionTile
              }
              data-ecommerce-option={`detail-${item.id}`}
              onClick={() => toggleOption('detailHighlights', item.id)}
            >
              <OptionCheck checked={selected('detailHighlights', item.id)} />
              <OptionContent option={item} />
            </button>
          ))}
        </div>
      </section>
    )
  }

  if (modeId === 'product-recreate') {
    const level = modeOptionString(options, 'recreateLevel', 'style')
    return (
      <section className={styles.block} data-ecommerce-mode-params="product-recreate">
        <span className={styles.blockTitle}>复刻程度</span>
        <div className={styles.choiceGroup} role="radiogroup" aria-label="复刻程度">
          {[
            ['style', '参考风格', '参考整体风格与结构，自动调整色彩和重构场景'],
            ['high', '高度复刻', '参考构图与视觉结构替换产品，场景细节略有差异'],
          ].map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={level === id}
              className={
                level === id
                  ? `${styles.choiceCard} ${styles.choiceCardOn}`
                  : styles.choiceCard
              }
              data-ecommerce-option={`recreate-${id}`}
              onClick={() => setOption('recreateLevel', id)}
            >
              <span className={styles.choiceRadio} aria-hidden />
              <span>
                <span className={styles.choiceTitle}>{label}</span>
                <span className={styles.choiceHint}>{hint}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    )
  }

  if (modeId === 'product-white') {
    const counts = whiteBgCountsOf(options)
    const total = WHITE_BG_ANGLE_OPTIONS.reduce(
      (sum, item) => sum + Math.max(0, counts[item.id] ?? 0),
      0,
    )
    const setCount = (id: string, next: number) => {
      setOption('whiteBgCounts', {
        ...counts,
        [id]: Math.min(Math.max(next, 0), ECOMMERCE_COUNT_MAX),
      })
    }
    return (
      <section className={styles.block} data-ecommerce-mode-params="product-white">
        <span className={styles.blockTitle}>白底模式</span>
        <div className={styles.segments} role="radiogroup" aria-label="白底模式">
          {[
            ['off', '单张白底'],
            ['on', '批量白底'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={modeOptionString(options, 'whiteBatch', 'off') === id}
              className={
                modeOptionString(options, 'whiteBatch', 'off') === id
                  ? `${styles.seg} ${styles.segOn}`
                  : styles.seg
              }
              data-ecommerce-white-batch={id}
              onClick={() => setOption('whiteBatch', id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.blockHead}>
          <span className={styles.blockTitle}>白底角度</span>
          <span className={styles.hint} data-ecommerce-white-total>
            共 {total} 张 · 每个角度独立生成
          </span>
        </div>
        <div className={styles.setCountList} data-ecommerce-white-angles>
          {WHITE_BG_ANGLE_OPTIONS.map((item) => {
            const count = counts[item.id] ?? 0
            return (
              <div className={styles.setCountItem} key={item.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={count > 0}
                  aria-label={`${item.label}${count > 0 ? '已启用' : '未启用'}`}
                  className={
                    count > 0
                      ? `${styles.setCheck} ${styles.setCheckOn}`
                      : styles.setCheck
                  }
                  data-ecommerce-white-enabled={item.id}
                  onClick={() => setCount(item.id, count > 0 ? 0 : 1)}
                >
                  {count > 0 ? (
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="m3.2 8.2 3.1 3.1 6.5-6.6" />
                    </svg>
                  ) : null}
                </button>
                <span className={styles.setCountBody}>
                  <span className={styles.setCountTitle}>{item.label}</span>
                  {item.hint ? (
                    <span className={styles.setCountHint}>{item.hint}</span>
                  ) : null}
                </span>
                <span className={styles.stepper}>
                  <button
                    type="button"
                    aria-label={`${item.label}减少一张`}
                    data-ecommerce-white-step={`${item.id}:-1`}
                    onClick={() => setCount(item.id, count - 1)}
                  >
                    -
                  </button>
                  <span data-ecommerce-white-count={item.id}>{count}</span>
                  <button
                    type="button"
                    aria-label={`${item.label}增加一张`}
                    data-ecommerce-white-step={`${item.id}:1`}
                    onClick={() => setCount(item.id, count + 1)}
                  >
                    +
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      </section>
    )
  }

  if (modeId === 'product-retouch') {
    return (
      <section className={styles.block} data-ecommerce-mode-params="product-retouch">
        <span className={styles.blockTitle}>快速优化项</span>
        <span className={styles.hint}>选择常用优化方向，可多选</span>
        <div className={styles.optionGrid}>
          {RETOUCH_OPTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={selected('retouchActions', item.id)}
              className={
                selected('retouchActions', item.id)
                  ? `${styles.optionTile} ${styles.optionTileOn}`
                  : styles.optionTile
              }
              data-ecommerce-option={`retouch-${item.id}`}
              onClick={() => toggleOption('retouchActions', item.id)}
            >
              <OptionCheck checked={selected('retouchActions', item.id)} />
              <OptionContent option={item} />
            </button>
          ))}
        </div>
      </section>
    )
  }

  if (modeId === 'product-recolor') {
    return (
      <section className={styles.block} data-ecommerce-mode-params="product-recolor">
        <span className={styles.blockTitle}>目标颜色</span>
        <span className={styles.hint}>选择要替换成的目标颜色</span>
        <div className={styles.colorControl}>
          <input
            type="color"
            value={modeOptionString(options, 'targetColor', '#ff6b00')}
            data-ecommerce-color
            onChange={(e) => setOption('targetColor', e.target.value)}
          />
          <input
            className={styles.input}
            value={modeOptionString(options, 'targetColor', '#ff6b00')}
            data-ecommerce-color-hex
            onChange={(e) => setOption('targetColor', e.target.value)}
          />
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            颜色容差 {modeOptionString(options, 'colorTolerance', '60')}%
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={modeOptionString(options, 'colorTolerance', '60')}
            data-ecommerce-color-tolerance
            onChange={(e) => setOption('colorTolerance', e.target.value)}
          />
        </label>
      </section>
    )
  }

  if (modeId === 'video-recreate') {
    const replicate = modeOptionString(options, 'videoReplicateMode', 'full')
    return (
      <section className={styles.block} data-ecommerce-mode-params="video-recreate">
        <span className={styles.blockTitle}>视频复刻模式</span>
        <div className={styles.choiceGroup} role="radiogroup" aria-label="视频复刻模式">
          {[
            ['full', '完全复刻', '完全复刻视频中的商品、构图、镜头与节奏'],
            ['similar', '相似复刻', '参考镜头结构与风格，允许画面自然变化'],
          ].map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={replicate === id}
              className={
                replicate === id
                  ? `${styles.choiceCard} ${styles.choiceCardOn}`
                  : styles.choiceCard
              }
              data-ecommerce-option={`video-replicate-${id}`}
              onClick={() => setOption('videoReplicateMode', id)}
            >
              <span className={styles.choiceRadio} aria-hidden />
              <span>
                <span className={styles.choiceTitle}>{label}</span>
                <span className={styles.choiceHint}>{hint}</span>
              </span>
            </button>
          ))}
        </div>
        <PersonSettings options={options} setOption={setOption} />
      </section>
    )
  }

  if (modeId === 'video-commerce') {
    return (
      <section className={styles.block} data-ecommerce-mode-params="video-commerce">
        <span className={styles.blockTitle}>视频类型</span>
        <span className={styles.hint}>选择常用优化方向，可多选</span>
        <div className={styles.optionGrid}>
          {VIDEO_TYPE_OPTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={selected('videoTypes', item.id)}
              className={
                selected('videoTypes', item.id)
                  ? `${styles.optionTile} ${styles.optionTileOn}`
                  : styles.optionTile
              }
              data-ecommerce-option={`video-${item.id}`}
              onClick={() => toggleOption('videoTypes', item.id)}
            >
              <OptionCheck checked={selected('videoTypes', item.id)} />
              <OptionContent option={item} />
            </button>
          ))}
        </div>
        <PersonSettings options={options} setOption={setOption} />
      </section>
    )
  }

  if (modeId === 'wear-set') {
    return (
      <section className={styles.block} data-ecommerce-mode-params="wear-set">
        <span className={styles.blockTitle}>生成类型</span>
        <div className={styles.optionGrid}>
          {WEAR_TYPE_OPTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={selected('wearTypes', item.id)}
              className={
                selected('wearTypes', item.id)
                  ? `${styles.optionTile} ${styles.optionTileOn}`
                  : styles.optionTile
              }
              data-ecommerce-option={`wear-${item.id}`}
              onClick={() => toggleOption('wearTypes', item.id)}
            >
              <OptionCheck checked={selected('wearTypes', item.id)} />
              <OptionContent option={item} />
            </button>
          ))}
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>展示面</span>
          <EcommerceSelect
            ariaLabel="展示面"
            name="wear-side"
            value={modeOptionString(options, 'wearSide', 'front')}
            onChange={(value) => setOption('wearSide', value)}
            options={[
              { value: 'front', label: '正面' },
              { value: 'back', label: '背面' },
              { value: 'both', label: '正面与背面' },
            ]}
            dataAttributes={{ 'data-ecommerce-option': 'wear-side' }}
          />
        </div>
      </section>
    )
  }

  if (modeId === 'wear-model') {
    return (
      <section className={styles.block} data-ecommerce-mode-params="wear-model">
        <span className={styles.blockTitle}>模特形象</span>
        <PersonSettings options={options} setOption={setOption} />
      </section>
    )
  }

  if (modeId === 'wear-tryon') {
    return (
      <section className={styles.block} data-ecommerce-mode-params="wear-tryon">
        <span className={styles.blockTitle}>试穿配置</span>
        <div className={styles.twoCols}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>人物保留</span>
            <EcommerceSelect
              ariaLabel="人物保留"
              name="person-preserve"
              value={modeOptionString(options, 'personPreserve', 'high')}
              onChange={(value) => setOption('personPreserve', value)}
              options={[
                { value: 'high', label: '自然保持' },
                { value: 'strict', label: '严格保持' },
              ]}
              dataAttributes={{ 'data-ecommerce-option': 'person-preserve' }}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>服装版型</span>
            <EcommerceSelect
              ariaLabel="服装版型"
              name="outfit-preserve"
              value={modeOptionString(options, 'outfitPreserve', 'on')}
              onChange={(value) => setOption('outfitPreserve', value)}
              options={[
                { value: 'on', label: '严格保持' },
                { value: 'off', label: '允许微调' },
              ]}
              dataAttributes={{ 'data-ecommerce-option': 'outfit-preserve' }}
            />
          </div>
        </div>
        <PersonSettings options={options} setOption={setOption} />
      </section>
    )
  }

  if (modeId === 'wear-detail') {
    return (
      <section className={styles.block} data-ecommerce-mode-params="wear-detail">
        <span className={styles.blockTitle}>细节类型</span>
        <div className={styles.optionGrid}>
          {WEAR_DETAIL_OPTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={selected('wearDetails', item.id)}
              className={
                selected('wearDetails', item.id)
                  ? `${styles.optionTile} ${styles.optionTileOn}`
                  : styles.optionTile
              }
              data-ecommerce-option={`wear-detail-${item.id}`}
              onClick={() => toggleOption('wearDetails', item.id)}
            >
              <OptionCheck checked={selected('wearDetails', item.id)} />
              <OptionContent option={item} />
            </button>
          ))}
        </div>
      </section>
    )
  }

  return null
}

function PersonSettings({
  options,
  setOption,
}: {
  options: EcommerceModeOptions
  setOption: (key: string, value: string | string[] | Record<string, number>) => void
}) {
  const source = modeOptionString(options, 'modelSource', 'ai')
  return (
    <div className={styles.personSettings}>
      <span className={styles.fieldLabel}>模特形象</span>
      <div className={styles.segments} role="radiogroup" aria-label="模特来源">
        {[
          ['ai', 'AI 生成'],
          ['upload', '自行上传'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={source === id}
            className={
              source === id ? `${styles.seg} ${styles.segOn}` : styles.seg
            }
            data-ecommerce-option={`model-source-${id}`}
            onClick={() => setOption('modelSource', id)}
          >
            {label}
          </button>
        ))}
      </div>
      {source === 'upload' ? (
        <span className={styles.hint}>请在上方参考素材中上传模特照片</span>
      ) : (
        <div className={styles.personGrid}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>性别</span>
            <EcommerceSelect
              ariaLabel="模特性别"
              name="model-gender"
              value={modeOptionString(options, 'modelGender', 'female')}
              onChange={(value) => setOption('modelGender', value)}
              options={textOptions(GENDER_OPTIONS)}
              dataAttributes={{ 'data-ecommerce-option': 'model-gender' }}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>年龄</span>
            <EcommerceSelect
              ariaLabel="模特年龄"
              name="model-age"
              value={modeOptionString(options, 'modelAge', 'young')}
              onChange={(value) => setOption('modelAge', value)}
              options={textOptions(AGE_OPTIONS)}
              dataAttributes={{ 'data-ecommerce-option': 'model-age' }}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>族裔</span>
            <EcommerceSelect
              ariaLabel="模特族裔"
              name="model-ethnicity"
              value={modeOptionString(options, 'modelEthnicity', 'asian')}
              onChange={(value) => setOption('modelEthnicity', value)}
              options={textOptions(ETHNICITY_OPTIONS)}
              dataAttributes={{ 'data-ecommerce-option': 'model-ethnicity' }}
            />
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>体型</span>
            <EcommerceSelect
              ariaLabel="模特体型"
              name="model-body"
              value={modeOptionString(options, 'modelBody', 'standard')}
              onChange={(value) => setOption('modelBody', value)}
              options={textOptions(BODY_OPTIONS)}
              dataAttributes={{ 'data-ecommerce-option': 'model-body' }}
            />
          </div>
        </div>
      )}
      <input
        className={styles.input}
        value={modeOptionString(options, 'modelDetails')}
        placeholder="补充细节（选填）：发型、妆容偏好等"
        data-ecommerce-option="model-details"
        onChange={(e) => setOption('modelDetails', e.target.value)}
      />
    </div>
  )
}

export interface EcommerceLongImageTools {
  /** 与结果卡同一口径：任务运行中不许再发一次付费请求 */
  busy?: boolean
  editResult?: (nodeId: string) => void
  upscaleResult?: (nodeId: string) => void
}

export interface EcommerceStudioProps {
  projectName: string
  /** 项目级草稿（对账 #477）：刷新 / 切走后把左侧表单原样放回来 */
  initialDraft?: EcommerceFormDraft | null
  /** 与草稿一起恢复的上传槽；页面按节点 id 校验后再传，悬空引用不会出现在这里 */
  initialProducts?: readonly EcommerceUpload[]
  initialReferences?: readonly EcommerceUpload[]
  /** 表单每次变化后回传；页面负责防抖落库 */
  onDraftChange?: (draft: EcommerceFormDraft) => void
  /**
   * 平台清单：默认用内置那份；页面可以把**扩展包带进来的规则**合并后传进来
   * （对账 #386 的 E3：平台规则可发扩展包更新，不必等应用发版）。
   */
  platforms?: readonly EcommercePlatform[]
  /** 上传一张图：由页面落到画布（assets + 节点），返回节点 id 与预览 */
  onUpload: (file: File, kind: 'product' | 'reference') => Promise<EcommerceUpload | null>
  /** 用当前对话模型生成一段可直接编辑的商品卖点文案。 */
  onWriteSellingPoints?: (request: EcommerceRequest) => Promise<string>
  /**
   * 点「开始生成」并在二次确认之后调用；页面负责建节点 + 跑引擎。
   *
   * `shotPlan` = 用户**先看过并确认**的那份分镜（对账 #423）。传了它，
   * 页面就**不再多花一次对话额度**去问模型 —— 直接用这份。
   */
  onGenerate: (request: EcommerceRequest, shotPlan?: readonly EcommerceShot[]) => Promise<void>
  /** 以结果图为输入做一次定向 AI 编辑；产物作为新批次，原结果保留 */
  onEditResult?: (
    nodeId: string,
    instruction: string,
    options?: { referenceNodeId?: string; model?: string },
  ) => Promise<void>
  /** 对多张结果串行执行同一套定向编辑；每张仍生成独立新批次，原结果保留 */
  onEditResults?: (
    nodeIds: readonly string[],
    instruction: string,
    options?: { referenceNodeId?: string; model?: string },
  ) => Promise<void>
  /** 以结果图为输入做真实 Topaz 超分；profile 与倍率都必须从领域常量里选 */
  onUpscaleResult?: (
    nodeId: string,
    profile: EcommerceUpscaleProfile,
    scale: EcommerceUpscaleScale,
  ) => Promise<void>
  /** 当前渠道真正启用、可路由的 Topaz profile；空数组时隐藏超清入口 */
  upscaleProfiles?: readonly EcommerceUpscaleProfile[]
  /** 可选出图模型（前端显示名，来自固定清单）；空数组时只显示"默认（按渠道解析）" */
  models?: readonly string[]
  /** 可选视频模型；视频品类只从这里选。 */
  videoModels?: readonly string[]
  /** 与无限画布同源的生图模型参数能力，按前端显示名索引。 */
  imageParamOptionsByModel?: Readonly<Record<string, EcommerceImageParamOptions>>
  /** 可做图生图编辑的模型（必须真实声明 image 输入） */
  editModels?: readonly string[]
  /** 当前选中的模型；空串 = 用默认解析出来的那一个 */
  model: string
  onModelChange: (model: string) => void
  running: boolean
  results: readonly EcommerceResultItem[]
  /** 页面装配好的无限工作台。工作台模块不反向 import 页面。 */
  workbench?: ReactNode
  /** 失败 / 取消的结果统一重试（逐张重跑） */
  onRetryFailed?: () => void
  failedCount?: number
  /** 一次下载当前批次全部已完成结果（串行，避免浏览器并发拦截） */
  onDownloadAll?: () => void
  downloadableCount?: number
  /**
   * 「拼成长图」（对账 #420）：由页面注入 —— 长图要读素材字节（`loadAssetUrl`）与落盘
   * （`files.saveFile`），那是**装配层**的活。不传就不渲染这个入口。
   */
  onOpenLongImage?: () => void
  /** 长图面板本身；工作台把内部编辑 / 超清入口交给页面渲染 */
  longImage?: (tools: EcommerceLongImageTools) => ReactNode
  /**
   * 「用一句话生成方案」（对账 #422）：页面注入 —— 只有页面拿得到渠道。
   * 不传就不渲染这一块（与长图面板同一条口径）。
   */
  onParseIntent?: (text: string) => Promise<void>
  /** 解析中：按钮禁用、文案如实变 */
  parsingIntent?: boolean
  /** 解析出来的**待确认**草稿；null / 不传 = 还没有 */
  intent?: EcommerceIntentDraft | null
  /**
   * 对话渠道（**解析需求与扩写分镜共用同一条**，都走 `resolveChatTarget`）。
   * 如实显示"会用谁"；空 = 没配，按钮禁用并说明原因。
   */
  chatTargetLabel?: string
  /** 可路由的前端对话模型显示名；空 = 没配。 */
  chatModels?: readonly string[]
  /** 用户显式选择的解析模型；空 = 默认。 */
  intentModel?: string
  onIntentModelChange?: (model: string) => void
  /** 从对话模型空态直接打开渠道配置。 */
  onConfigureChannels?: () => void
  /** 解析失败 / 没配对话模型时的如实说法 */
  intentError?: string
  /** 用户点了「应用到表单」——页面据此收起确认卡 */
  onIntentApplied?: () => void
  /** 用户点了「丢弃」 */
  onIntentDiscard?: () => void
  /**
   * **最近的方案**（对账 #433）：一次成功的解析留一条。点一条把那张确认卡放回来
   * （不直接填表单 —— 落表仍由「应用到表单」触发）。
   * 不传 `onRestorePlan` 就整块不渲染（与长图面板 / 意图块同一条口径）。
   */
  planHistory?: readonly EcommercePlanSession[]
  onRestorePlan?: (plan: EcommercePlanSession) => void
  /** 删一条历史方案（不想留的自己清） */
  onRemovePlan?: (id: string) => void
  /** 历史批次（对账 #479 的任务列表 UI）：不传 / 空数组时整块不渲染 */
  taskHistory?: readonly EcommerceTaskRecord[]
  activeTaskId?: string
  onSelectTask?: (taskId: string) => void
  /** 删一条历史批次（两下确认由工作台内部处理） */
  onRemoveTask?: (taskId: string) => void
  /**
   * 「先出一份方案」（对账 #423）：页面注入 —— 只有页面拿得到渠道。
   * 不传就不渲染这一块；失败要带**原因**回来（由工作台原样显示）。
   */
  onPlanShots?: (request: EcommerceRequest) => Promise<ShotPlanResult>
  /**
   * 这一次的**分镜来源**（对账 #406）：页面跑完一次之后如实回报 ——
   * 是"按你的要求现写的"还是"回落默认脚本（因为什么）"。空串 = 这次没这回事，不显示。
   */
  shotPlanNote?: string
  /** 当前生成阶段；页面负责推进，工作台只负责如实显示。 */
  generationStage?: EcommerceGenerationStage | null
}

export function EcommerceStudio({
  initialDraft = null,
  initialProducts = [],
  initialReferences = [],
  onDraftChange,
  platforms = ECOMMERCE_PLATFORMS,
  onUpload,
  onWriteSellingPoints,
  onGenerate,
  onEditResult,
  onEditResults,
  onUpscaleResult,
  upscaleProfiles,
  models = [],
  videoModels = [],
  imageParamOptionsByModel = {},
  editModels = [],
  model,
  onModelChange,
  running,
  results,
  workbench,
  longImage,
  chatTargetLabel = '',
  chatModels = [],
  intentModel = '',
  onIntentModelChange,
  onConfigureChannels,
  generationStage = null,
}: EcommerceStudioProps) {
  const saved = initialDraft ?? DEFAULT_ECOMMERCE_FORM_DRAFT
  const initialMode =
    STUDIO_MODES.find(
      (item) =>
        item.label === saved.modeLabel &&
        item.mediaKind === (saved.mediaKind ?? 'image'),
    ) ??
    STUDIO_MODES.find(
      (item) => item.usage === saved.usage && item.mediaKind === (saved.mediaKind ?? 'image'),
    ) ??
    STUDIO_MODES[0]
  const [category, setCategory] = useState<StudioCategory>(initialMode.category)
  const [modeId, setModeId] = useState(initialMode.id)
  const videoDuration = saved.videoDuration ?? 5
  const [usage, setUsage] = useState<EcommerceUsage>(saved.usage)
  const [modeStates, setModeStates] = useState<Record<string, EcommerceModeFormState>>(() => ({
    ...saved.modeStates,
    [initialMode.id]: {
      platformId: saved.platformId,
      language: saved.language,
      ratio: saved.ratio,
      resolution: saved.resolution,
      quality: saved.quality,
      note: saved.note,
    },
  }))
  const [modeOptionsByMode, setModeOptionsByMode] = useState<
    Record<string, EcommerceModeOptions>
  >(() => ({
    [initialMode.id]: {
      ...defaultEcommerceModeOptions(initialMode.id),
      ...normalizeEcommerceModeOptions(saved.modeOptions),
    },
  }))
  const [products, setProducts] = useState<EcommerceUpload[]>([...initialProducts])
  const [references, setReferences] = useState<EcommerceUpload[]>([...initialReferences])
  /** 二次确认：点生成先算出"预计 N 张"，确认后才真的发请求（#384 的 D6） */
  const [confirming, setConfirming] = useState(false)
  const [uploadPreview, setUploadPreview] = useState<{
    kind: 'product' | 'reference'
    index: number
  } | null>(null)
  const [error, setError] = useState('')
  const [writingSellingPoints, setWritingSellingPoints] = useState(false)
  const [sellingPointsError, setSellingPointsError] = useState('')
  /** 结果卡上的定向 AI 编辑：一次只打开一张，指令不进入左侧表单草稿 */
  const [editTarget, setEditTarget] = useState<{ nodeId: string; label: string } | null>(null)
  const [editInstruction, setEditInstruction] = useState('')
  const [editModel, setEditModel] = useState('')
  const [editError, setEditError] = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)
  const [editReference, setEditReference] = useState<EcommerceUpload | null>(null)
  const [editReferenceBusy, setEditReferenceBusy] = useState(false)
  const [selectedEditNodes, setSelectedEditNodes] = useState<Set<string>>(() => new Set())
  const [batchEditOpen, setBatchEditOpen] = useState(false)
  const [batchInstruction, setBatchInstruction] = useState('')
  const [batchEditModel, setBatchEditModel] = useState('')
  const [batchEditError, setBatchEditError] = useState('')
  const [batchEditSubmitting, setBatchEditSubmitting] = useState(false)
  const [batchReference, setBatchReference] = useState<EcommerceUpload | null>(null)
  const [batchReferenceBusy, setBatchReferenceBusy] = useState(false)
  const [compareTarget, setCompareTarget] = useState<EcommerceResultItem | null>(null)
  const [detailTarget, setDetailTarget] = useState<EcommerceResultItem | null>(null)
  const selectedImageEditCount = 0
  const [upscaleTarget, setUpscaleTarget] = useState<{
    items: readonly EcommerceResultItem[]
    batch: boolean
  } | null>(null)
  const [upscaleProfile, setUpscaleProfile] = useState<EcommerceUpscaleProfile>('standard')
  const [upscaleScale, setUpscaleScale] = useState<EcommerceUpscaleScale>('4x')
  const [upscaleSubmitting, setUpscaleSubmitting] = useState(false)
  const [upscaleError, setUpscaleError] = useState('')
  const availableUpscaleOptions = useMemo(() => {
    const available = new Set(
      upscaleProfiles ?? ECOMMERCE_UPSCALE_OPTIONS.map((option) => option.id),
    )
    return ECOMMERCE_UPSCALE_OPTIONS.filter((option) => available.has(option.id))
  }, [upscaleProfiles])

  const uploadPreviewItems =
    uploadPreview?.kind === 'product' ? products : uploadPreview?.kind === 'reference' ? references : []
  const uploadPreviewItem = uploadPreview ? uploadPreviewItems[uploadPreview.index] ?? null : null

  useEffect(() => {
    if (!uploadPreview) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setUploadPreview(null)
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setUploadPreview((current) =>
          current && current.index > 0 ? { ...current, index: current.index - 1 } : current,
        )
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        setUploadPreview((current) =>
          current && current.index < uploadPreviewItems.length - 1
            ? { ...current, index: current.index + 1 }
            : current,
        )
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [uploadPreview, uploadPreviewItems.length])

  const openEditForResult = (result: EcommerceResultItem) => {
    if (!onEditResult || running || result.mime?.startsWith('video/')) return
    setEditTarget({ nodeId: result.nodeId, label: '这张结果' })
    setEditInstruction(note.trim())
    setEditModel('')
    setEditReference(null)
    setEditError('')
  }

  const openUpscaleForResult = (result: EcommerceResultItem) => {
    if (!onUpscaleResult || running || result.mime?.startsWith('video/')) return
    const first = availableUpscaleOptions[0]
    if (!first) return
    setUpscaleTarget({ items: [result], batch: false })
    setUpscaleProfile(first.id)
    setUpscaleScale('4x')
    setUpscaleError('')
  }

  const longImageNode = longImage?.({
    busy: running,
    ...(onEditResult ? {
      editResult: (nodeId: string) => {
        const result = results.find((item) => item.nodeId === nodeId)
        if (result) openEditForResult(result)
      },
    } : {}),
    ...(onUpscaleResult && availableUpscaleOptions.length > 0 ? {
      upscaleResult: (nodeId: string) => {
        const result = results.find((item) => item.nodeId === nodeId)
        if (result) openUpscaleForResult(result)
      },
    } : {}),
  })
  /**
   * 正在往哪一块拖（对账 #427）：`null` = 没在拖。只用来画一个"松手会落这儿"的提示 ——
   * 没有提示的话，用户拖着图悬在框上不知道能不能放（画布那边早就有拖放，
   * 电商这两块一直没有：同一个应用里两种手感，是很容易被当成"坏了"的那种不一致）。
   */
  const [dragOver, setDragOver] = useState<'product' | 'reference' | null>(null)
  const mode = STUDIO_MODES.find((item) => item.id === modeId) ?? initialMode
  const modeFormState = modeStates[mode.id] ?? defaultModeFormState(mode)
  const platformId = modeFormState.platformId
  const language = modeFormState.language
  const ratio = modeFormState.ratio
  const resolution = modeFormState.resolution
  const quality = modeFormState.quality
  const note = modeFormState.note
  const updateModeFormState = (patch: Partial<EcommerceModeFormState>) => {
    setModeStates((current) => ({
      ...current,
      [mode.id]: {
        ...(current[mode.id] ?? defaultModeFormState(mode)),
        ...patch,
      },
    }))
  }
  const setPlatformId = (value: string) => updateModeFormState({ platformId: value })
  const setLanguage = (value: EcommerceLanguage) => updateModeFormState({ language: value })
  const setRatio = (value: string) => updateModeFormState({ ratio: value })
  const setResolution = (value: string) => updateModeFormState({ resolution: value })
  const setQuality = (value: string) => updateModeFormState({ quality: value })
  const setNote = (value: string) => updateModeFormState({ note: value })
  const modeOptions =
    modeOptionsByMode[mode.id] ?? defaultEcommerceModeOptions(mode.id)
  const effectiveCount = ecommerceModeCount(mode.id, mode.count, modeOptions)
  const batchWhite =
    mode.id === 'product-white' &&
    modeOptionString(modeOptions, 'whiteBatch', 'off') === 'on'
  const productLimit = batchWhite ? 12 : 3
  const batchOutputCount = batchWhite ? products.length * effectiveCount : effectiveCount
  const setModeOptions = (next: EcommerceModeOptions) => {
    setModeOptionsByMode((current) => ({
      ...current,
      [mode.id]: normalizeEcommerceModeOptions(next),
    }))
  }
  const setModeOption = (key: string, value: string | string[] | Record<string, number>) => {
    setModeOptions({ ...modeOptions, [key]: value })
  }
  const toggleModeOption = (key: string, id: string) => {
    const current = modeOptionStrings(modeOptions, key)
    setModeOption(
      key,
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }
  const categoryModes = useMemo(
    () => STUDIO_MODES.filter((item) => item.category === category),
    [category],
  )
  const visibleResults = useMemo(
    () =>
      results.filter((result) =>
        mode.mediaKind === 'video'
          ? result.mime?.startsWith('video/')
          : !result.mime?.startsWith('video/'),
      ),
    [mode.mediaKind, results],
  )

  useEffect(() => {
    const valid = new Set(
      results.filter((result) => result.status === 'done').map((result) => result.nodeId),
    )
    setSelectedEditNodes((current) => {
      const next = new Set([...current].filter((id) => valid.has(id)))
      return next.size === current.size && [...next].every((id) => current.has(id))
        ? current
        : next
    })
  }, [results])

  /**
   * 把当前表单回给页面落库。
   *
   * 只回传**可序列化**的节点 id 与参数，不回传 React 预览节点；
   * `model` 由页面控制，所以这里读 props 的最新值。
   */
  useEffect(() => {
    onDraftChange?.({
      modeLabel: mode.label,
      mediaKind: mode.mediaKind,
      videoDuration,
      usage,
      platformId,
      language,
      count: effectiveCount,
      ratio,
      resolution,
      quality,
      note,
      model,
      modeOptions,
      modeStates: { ...modeStates, [mode.id]: modeFormState },
      productNodeId: products[0]?.nodeId ?? null,
      productNodeIds: products.map((item) => item.nodeId),
      referenceNodeIds: references.map((r) => r.nodeId),
    })
  }, [
    usage,
    mode,
    videoDuration,
    platformId,
    language,
    effectiveCount,
    ratio,
    resolution,
    quality,
    note,
    model,
    modeOptions,
    modeFormState,
    modeStates,
    products,
    references,
    onDraftChange,
  ])

  const platform = useMemo(
    () => platforms.find((p) => p.id === platformId) ?? null,
    [platforms, platformId],
  )
  const orderedPlatforms = useMemo(() => {
    const rank = new Map(ECOMMERCE_PLATFORM_ORDER.map((id, index) => [id, index]))
    return [...platforms].sort(
      (left, right) =>
        (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
        left.name.localeCompare(right.name, 'zh-CN'),
    )
  }, [platforms])

  const activateMode = (next: StudioMode) => {
    const previousKind = mode.mediaKind
    setModeId(next.id)
    setCategory(next.category)
    setUsage(next.usage)
    setModeOptionsByMode((current) =>
      current[next.id]
        ? current
        : {
            ...current,
            [next.id]: defaultEcommerceModeOptions(next.id),
          },
    )
    setModeStates((current) =>
      current[next.id]
        ? current
        : {
            ...current,
            [next.id]: defaultModeFormState(next),
          },
    )
    if (previousKind !== next.mediaKind) onModelChange('')
    setError('')
  }

  const activateCategory = (next: StudioCategory) => {
    const first = STUDIO_MODES.find((item) => item.category === next)
    if (first) activateMode(first)
  }

  const onPick = async (file: File | undefined, kind: 'product' | 'reference') => {
    if (!file) return
    setError('')
    const uploaded = await onUpload(file, kind)
    if (!uploaded) {
      setError('这张图没能读进来（格式不支持或读取失败），换一张再试')
      return
    }
    if (kind === 'product') {
      setProducts((prev) => {
        if (prev.some((item) => item.nodeId === uploaded.nodeId)) return prev
        if (prev.length >= productLimit) return prev
        if (!batchWhite && prev.length + references.length >= 4) return prev
        return [...prev, uploaded]
      })
    } else {
      setReferences((prev) => {
        if (prev.some((item) => item.nodeId === uploaded.nodeId)) return prev
        if (prev.length + products.length >= 4) return prev
        return [...prev, uploaded]
      })
    }
  }

  /**
   * **拖进来的文件**（对账 #427）。
   *
   * 两条与文件选择保持一致的规矩（两条路各写一套迟早分叉）：
   * - 走的是**同一个** `onPick`（所以"不是图 / 读不出来"的提示也是同一句话）；
   * - 参考图仍然**最多 4 张**：放不下的一次**不收**，也不偷偷挤掉已有的。
   */
  const onDropFiles = (kind: 'product' | 'reference', files: FileList | null) => {
    setDragOver(null)
    const picked = [...(files ?? [])]
    if (picked.length === 0) return
    void (async () => {
      if (kind === 'product') {
        const room = Math.max(
          0,
          (batchWhite
            ? productLimit
            : Math.min(productLimit, 4 - references.length)) - products.length,
        )
        for (const file of picked.slice(0, room)) await onPick(file, 'product')
        return
      }
      const room = Math.max(0, Math.min(4 - references.length, 4 - products.length))
      for (const f of picked.slice(0, room)) await onPick(f, 'reference')
    })()
  }

  const pickEditReference = async (file: File | undefined, batch: boolean) => {
    if (!file) return
    if (batch) {
      setBatchReferenceBusy(true)
      setBatchEditError('')
    } else {
      setEditReferenceBusy(true)
      setEditError('')
    }
    try {
      const uploaded = await onUpload(file, 'reference')
      if (!uploaded) {
        const message = '参考图没能读进来（格式不支持或读取失败）'
        if (batch) setBatchEditError(message)
        else setEditError(message)
        return
      }
      if (batch) setBatchReference(uploaded)
      else setEditReference(uploaded)
    } finally {
      if (batch) setBatchReferenceBusy(false)
      else setEditReferenceBusy(false)
    }
  }

  /** 拖放的四个处理器：两块上传区共用（`kind` 决定落到哪儿） */
  const dropProps = (kind: 'product' | 'reference') => ({
    onDragOver: (e: ReactDragEvent<HTMLElement>) => {
      e.preventDefault()
      setDragOver(kind)
    },
    /* 指针在同一位块的子元素之间移动也会触发 dragleave ⇒ 先看还在不在里面 */
    onDragLeave: (e: ReactDragEvent<HTMLElement>) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setDragOver((cur) => (cur === kind ? null : cur))
    },
    onDrop: (e: ReactDragEvent<HTMLElement>) => {
      e.preventDefault()
      onDropFiles(kind, e.dataTransfer?.files ?? null)
    },
  })

  const buildRequest = (): EcommerceRequest => {
    const modePrompt = [mode.promptPrefix, buildEcommerceModeOptionsPrompt(mode.id, modeOptions)]
      .filter((item): item is string => !!item?.trim())
      .join('\n')
    return {
      mediaKind: mode.mediaKind,
      modeLabel: mode.label,
      modeOptions,
      usage,
      platformId: platformId || undefined,
      language,
      count: mode.mediaKind === 'video' ? 1 : effectiveCount,
      ratio,
      ...(mode.mediaKind === 'image' && resolution !== 'auto' ? { resolution } : {}),
      ...(mode.mediaKind === 'image' && quality !== 'auto' ? { quality } : {}),
      productNodeId: products[0]?.nodeId ?? '',
      productNodeIds: products.map((item) => item.nodeId),
      referenceNodeIds: references.map((r) => r.nodeId),
      note,
      ...(modePrompt ? { modePrompt } : {}),
      ...(mode.mediaKind === 'video' ? { durationSec: videoDuration } : {}),
      /* 空串不写进请求：让页面按"默认解析"那条路走（与没选过完全一致） */
      ...(model ? { model } : {}),
    }
  }

  const writeSellingPoints = async () => {
    if (!onWriteSellingPoints) return
    setWritingSellingPoints(true)
    setSellingPointsError('')
    try {
      const text = (await onWriteSellingPoints(buildRequest())).trim()
      if (!text) throw new Error('模型没有返回可用的卖点文案')
      setNote(text.slice(0, ECOMMERCE_NOTE_MAX))
    } catch (e) {
      setSellingPointsError(e instanceof Error ? e.message : 'AI 帮写失败，请稍后重试')
    } finally {
      setWritingSellingPoints(false)
    }
  }

  const start = () => {
    if (products.length === 0) {
      setError('先上传一张产品图 —— 没有产品图就没有可改的主体')
      return
    }
    if (!batchWhite && products.length > 3) {
      setError('单张白底模式最多用 3 张商品图；要保留更多源图，请切回批量白底')
      return
    }
    const batchLimitError = batchWhite
      ? batchWhiteOutputError(products.length, effectiveCount)
      : null
    if (batchLimitError) {
      setError(batchLimitError)
      return
    }
    if (
      (mode.id === 'product-recreate' ||
        mode.id === 'video-recreate' ||
        mode.id === 'wear-tryon') &&
      references.length === 0
    ) {
      setError(
        mode.id === 'video-recreate'
          ? '先上传一段参考视频'
          : mode.id === 'wear-tryon'
            ? '先上传一张人物参考图'
            : '先上传一张爆款参考图',
      )
      return
    }
    if (
      (mode.id === 'video-commerce' || mode.id === 'wear-model') &&
      modeOptionString(modeOptions, 'modelSource', 'ai') === 'upload' &&
      references.length === 0
    ) {
      setError('先上传一张模特参考图，或把模特来源切回 AI 生成')
      return
    }
    const request = buildRequest()
    try {
      buildEcommercePlan(request)
    } catch (e) {
      setError(e instanceof EcommerceRequestError ? e.message : '这次参数没有通过校验，请检查后再试')
      return
    }
    if (shouldExpandShots(request) && !chatTargetLabel) {
      setError(
        '这类商品图需要先用对话模型分析商品原图并写逐张提示词。请先在右侧「对话模型」配置渠道，再生成。',
      )
      return
    }
    setError('')
    setConfirming(true)
  }

  const editPresets = useMemo(
    () => [
      {
        key: 'cleanup',
        label: '清理杂物',
        instruction:
          '只去掉画面中与产品无关的杂物、污点与干扰元素，产品和画面文字保持原样。',
      },
      {
        key: 'white-bg',
        label: '纯白背景',
        instruction:
          '只把背景换成纯白背景，产品边缘保持干净，产品外观、构图与画面文字不变。',
      },
      {
        key: 'light',
        label: '统一光线',
        instruction:
          '只优化光线与清晰度，让产品受光更均匀、材质更清楚；构图、产品和文字不变。',
      },
      {
        key: 'translate',
        label: `翻译成${ecommerceLanguageOptionLabel(language, usage)}`,
        instruction:
          `只把画面中的文字翻译成${ecommerceLanguageOptionLabel(language, usage)}，保持原有排版、字号与视觉层级；` +
          '产品和背景不变，不新增无法核实的文案。',
      },
      {
        key: 'text-edit',
        label: '替换画面文字',
        instruction:
          '只把画面中明确指定的文字“旧文字”替换为“新文字”；保持原有字体风格、字号、排版位置与视觉层级。' +
          '其他文字、产品和背景不变，不新增无法核实的文案。',
      },
    ],
    [language],
  )
  const confirm = async () => {
    setConfirming(false)
    setError('')
    try {
      if (batchWhite) {
        for (const product of products) {
          await onGenerate({
            ...buildRequest(),
            productNodeId: product.nodeId,
            productNodeIds: [product.nodeId],
            referenceNodeIds: [],
          })
        }
      } else {
        await onGenerate(buildRequest())
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败，原因见下方结果区')
    }
  }

  const submitEdit = async () => {
    if (!editTarget || !onEditResult) return
    const instruction = editInstruction.trim()
    if (!instruction) {
      setEditError('先写清这一张要改什么，例如：只把背景换成海边日落，产品和文字保持不变')
      return
    }
    setEditError('')
    setEditSubmitting(true)
    try {
      await onEditResult(
        editTarget.nodeId,
        instruction,
        {
          ...(editReference ? { referenceNodeId: editReference.nodeId } : {}),
          ...(editModel ? { model: editModel } : {}),
        },
      )
      setEditTarget(null)
      setEditInstruction('')
      setEditReference(null)
      setEditModel('')
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'AI 编辑失败，原因见下方结果区')
    } finally {
      setEditSubmitting(false)
    }
  }

  const submitUpscale = async () => {
    if (!upscaleTarget?.items.length || !onUpscaleResult) return
    setUpscaleError('')
    setUpscaleSubmitting(true)
    let completed = 0
    try {
      for (const item of upscaleTarget.items) {
        await onUpscaleResult(item.nodeId, upscaleProfile, upscaleScale)
        completed += 1
      }
      if (upscaleTarget.batch) setSelectedEditNodes(new Set())
      setUpscaleTarget(null)
    } catch (e) {
      const done = completed > 0 ? `已完成 ${completed}/${upscaleTarget.items.length} 张；` : ''
      const reason = e instanceof Error ? e.message : 'AI 超清失败，原因见下方结果区'
      setUpscaleError(`${done}${reason}`)
    } finally {
      setUpscaleSubmitting(false)
    }
  }

  const submitBatchEdit = async () => {
    if (!onEditResults) return
    const instruction = batchInstruction.trim()
    if (!instruction) {
      setBatchEditError('先写清这批图要统一改什么')
      return
    }
    const imageNodeIds = results
      .filter(
        (result) =>
          result.status === 'done' &&
          selectedEditNodes.has(result.nodeId) &&
          !result.mime?.startsWith('video/'),
      )
      .map((result) => result.nodeId)
    if (imageNodeIds.length === 0) {
      setBatchEditError('先选择至少一张结果')
      return
    }
    setBatchEditError('')
    setBatchEditSubmitting(true)
    try {
      await onEditResults(
        imageNodeIds,
        instruction,
        {
          ...(batchReference ? { referenceNodeId: batchReference.nodeId } : {}),
          ...(batchEditModel ? { model: batchEditModel } : {}),
        },
      )
      setBatchEditOpen(false)
      setBatchInstruction('')
      setBatchReference(null)
      setBatchEditModel('')
      setSelectedEditNodes(new Set())
    } catch (e) {
      setBatchEditError(e instanceof Error ? e.message : '批量 AI 编辑失败')
    } finally {
      setBatchEditSubmitting(false)
    }
  }

  const referenceRequired =
    mode.id === 'product-recreate' ||
    mode.id === 'video-recreate' ||
    mode.id === 'wear-tryon'
  const showReferenceBlock =
    referenceRequired ||
    mode.id === 'wear-model' ||
    mode.id === 'video-commerce'
  const referenceLabel =
    mode.id === 'video-recreate'
      ? '参考视频'
      : mode.id === 'wear-tryon'
        ? '人物参考图'
        : mode.id === 'wear-model' || mode.id === 'video-commerce'
          ? '模特参考图'
          : '参考图（爆款图）'
  const showCommonFields = ![
    'product-retouch',
    'product-recolor',
    'wear-model',
    'wear-tryon',
    'wear-detail',
  ].includes(mode.id)
  const showSellingPoints = ![
    'product-recolor',
    'wear-model',
    'wear-tryon',
    'wear-detail',
    'product-white',
  ].includes(mode.id)
  const showPlatformAndLanguage =
    mode.id !== 'wear-set' && mode.id !== 'product-white'
  const showLanguageField = mode.id !== 'product-white'
  const showRatioField = mode.id !== 'wear-set'
  const imageParamOptions =
    imageParamOptionsByModel[model] ?? {
      resolutions: ['1K', '2K', '4K'],
      qualities: [],
    }
  const qualityLabels: Record<string, string> = {
    auto: '自动',
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '超高',
    max: '极致',
  }
  const resolutionChoices = [
    { value: 'auto', label: '自动' },
    ...imageParamOptions.resolutions
      .filter((value) => value !== 'auto')
      .map((value) => ({ value, label: value })),
  ]
  const qualityChoices = [
    { value: 'auto', label: '自动' },
    ...imageParamOptions.qualities.map((value) => ({
      value,
      label: qualityLabels[value] ?? value,
    })),
  ]
  const showResolutionField = mode.mediaKind === 'image'
  const showQualityField = mode.mediaKind === 'image' && qualityChoices.length > 1
  const handleGenerateModelChange = (next: string) => {
    const nextOptions = imageParamOptionsByModel[next] ?? {
      resolutions: ['1K', '2K', '4K'],
      qualities: [],
    }
    onModelChange(next)
    updateModeFormState({
      resolution: nextOptions.resolutions.includes(resolution) ? resolution : 'auto',
      quality: nextOptions.qualities.includes(quality) ? quality : 'auto',
    })
  }
  const carouselCases = [
    {
      id: 'case-1',
      title: mode.mediaKind === 'video' ? '短视频案例' : `${mode.label}案例`,
      tag: '商品原图',
      tiles:
        mode.mediaKind === 'video'
          ? ['开场展示', '产品演示', '卖点口播']
          : ['白底主图', '核心卖点', '细节特写'],
    },
    {
      id: 'case-2',
      title: mode.mediaKind === 'video' ? '场景短片案例' : '场景套图案例',
      tag: '场景延展',
      tiles:
        mode.mediaKind === 'video'
          ? ['场景建立', '使用过程', '收尾展示']
          : ['使用场景', '多角度图', '质感特写'],
    },
    {
      id: 'case-3',
      title: mode.mediaKind === 'video' ? '带货视频案例' : '详情页案例',
      tag: '详情结构',
      tiles:
        mode.mediaKind === 'video'
          ? ['痛点开场', '产品解决', '行动引导']
          : ['首屏主视觉', '规格参数', '售后说明'],
    },
  ]
  const confirmUsesAiPlan =
    confirming && chatTargetLabel
      ? shouldExpandShots(buildRequest())
      : false

  return (
    <div className={styles.wrap} data-ecommerce-studio>
      <aside className={styles.categoryRail} data-ecommerce-categories>
        {STUDIO_CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={
              item.id === category
                ? `${styles.categoryButton} ${styles.categoryButtonOn}`
                : styles.categoryButton
            }
            data-ecommerce-category={item.id}
            aria-pressed={item.id === category}
            onClick={() => activateCategory(item.id)}
          >
            <CategoryGlyph category={item.id} />
            <span>{item.label}</span>
          </button>
        ))}
      </aside>

      {/* 右：参数 */}
      <aside className={styles.form} data-ecommerce-form>
        <div className={styles.formScroll} data-ecommerce-param-mode={mode.id}>
        <section
          className={dragOver === 'product' ? `${styles.block} ${styles.blockDrop}` : styles.block}
          data-ecommerce-product-drop={dragOver === 'product' ? 'true' : 'false'}
          data-param-section="product"
          {...dropProps('product')}
        >
          <div className={styles.blockHead}>
            <label className={styles.blockTitle} htmlFor="ecommerce-product">
              商品原图
            </label>
            <span className={styles.hint} data-ecommerce-product-hint>
              {batchWhite
                ? `支持 1–12 张源图；每张按上方角度独立生成，最多 36 张输出`
                : '支持 1–3 张图片，多角度效果更佳'}
            </span>
          </div>
          <input
            id="ecommerce-product"
            className={styles.file}
            type="file"
            accept="image/*"
            multiple
            data-ecommerce-product-input
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              void (async () => {
                for (const file of files) await onPick(file, 'product')
              })()
              e.currentTarget.value = ''
            }}
          />
          <div className={styles.slotRow}>
            {products.map((item, index) => (
              <div key={item.nodeId} className={styles.slot} data-ecommerce-product-preview>
                <button
                  type="button"
                  className={styles.slotPreview}
                  data-ecommerce-product-open={index}
                  aria-label={`放大预览第 ${index + 1} 张商品图`}
                  onClick={() => setUploadPreview({ kind: 'product', index })}
                >
                  {item.preview}
                </button>
                <button
                  type="button"
                  className={styles.slotRemove}
                  aria-label={`移除第 ${index + 1} 张产品图`}
                  onClick={() => setProducts((prev) => prev.filter((row) => row.nodeId !== item.nodeId))}
                >
                  ×
                </button>
              </div>
            ))}
            {products.length === 0 ? (
              <label className={styles.emptySlot} htmlFor="ecommerce-product">
                <span className={styles.uploadPlus}>+</span>
                <span>上传图片</span>
              </label>
            ) : products.length < productLimit &&
              (batchWhite || products.length + references.length < 4) ? (
              <label className={styles.addSlot} htmlFor="ecommerce-product" data-ecommerce-product-add>
                +
              </label>
            ) : null}
          </div>
        </section>

        {showReferenceBlock ? (
          <section
            className={
              dragOver === 'reference' ? `${styles.block} ${styles.blockDrop}` : styles.block
            }
            data-ecommerce-reference-drop={dragOver === 'reference' ? 'true' : 'false'}
            {...dropProps('reference')}
          >
            <div className={styles.blockHead}>
              <label className={styles.blockTitle} htmlFor="ecommerce-reference">
                {referenceLabel}
              </label>
              <span className={styles.hint}>{referenceRequired ? '必填' : '选填'}</span>
            </div>
            <input
              id="ecommerce-reference"
              className={styles.file}
              type="file"
              accept={mode.id === 'video-recreate' ? 'video/*,image/*' : 'image/*'}
              multiple={mode.id !== 'video-recreate'}
              data-ecommerce-reference-input
              onChange={(e) => {
                const files = [...(e.target.files ?? [])]
                void (async () => {
                  for (const f of files) await onPick(f, 'reference')
                })()
              }}
            />
            <div className={styles.slotRow}>
              {references.map((r) => (
                <div key={r.nodeId} className={styles.slot} data-ecommerce-reference-preview>
                  <button
                    type="button"
                    className={styles.slotPreview}
                    data-ecommerce-reference-open={references.indexOf(r)}
                    aria-label="放大预览参考图"
                    onClick={() =>
                      setUploadPreview({ kind: 'reference', index: references.indexOf(r) })
                    }
                  >
                    {r.preview}
                  </button>
                  <button
                    type="button"
                    className={styles.slotRemove}
                    aria-label="移除参考图"
                    onClick={() =>
                      setReferences((prev) => prev.filter((row) => row.nodeId !== r.nodeId))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              {references.length + products.length < 4 ? (
                <label
                  className={styles.addSlot}
                  htmlFor="ecommerce-reference"
                  data-ecommerce-reference-add
                >
                  +
                </label>
              ) : null}
            </div>
            {referenceRequired && references.length === 0 ? (
              <p className={styles.hint} data-ecommerce-recreate-hint>
                {mode.id === 'video-recreate'
                  ? '先上传参考视频，再生成同款视频。'
                  : mode.id === 'wear-tryon'
                    ? '先上传人物参考图，服装和人物都会以素材为准。'
                    : '先上传爆款参考图，产品主体仍以商品原图为准。'}
              </p>
            ) : null}
          </section>
        ) : null}

        {showCommonFields ? (
        <section className={styles.block} data-param-section="common">
          <div className={styles.twoCols}>
            {showPlatformAndLanguage && mode.mediaKind === 'video' ? (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>市场地区</span>
                <EcommerceSelect
                  ariaLabel="市场地区"
                  name="market-region"
                  value={modeOptionString(modeOptions, 'marketRegion', 'us')}
                  onChange={(value) => setModeOption('marketRegion', value)}
                  options={[
                    { value: 'us', label: '美国' },
                    { value: 'uk', label: '英国' },
                    { value: 'eu', label: '欧洲' },
                    { value: 'sea', label: '东南亚' },
                    { value: 'me', label: '中东' },
                  ]}
                  dataAttributes={{ 'data-ecommerce-market-region': true }}
                />
              </div>
            ) : showPlatformAndLanguage ? (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>上架平台</span>
                <EcommerceSelect
                  ariaLabel="上架平台"
                  name="platform"
                  value={platformId}
                  onChange={setPlatformId}
                  options={[
                    { value: '', label: '不指定（通用）' },
                    ...orderedPlatforms.map((platform) => ({
                      value: platform.id,
                      label: platform.name,
                    })),
                  ]}
                  dataAttributes={{ 'data-ecommerce-platform': true }}
                />
              </div>
            ) : null}
            {showLanguageField ? (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>语言</span>
                <EcommerceSelect
                  ariaLabel="输出语言"
                  name="language"
                  value={language}
                  onChange={(value) => setLanguage(value as EcommerceLanguage)}
                  options={ecommerceLanguageOptions(mode.usage)}
                  dataAttributes={{ 'data-ecommerce-language': true }}
                />
              </div>
            ) : null}
            {showRatioField ? (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>
                  {mode.mediaKind === 'video' ? '视频比例' : '图片比例'}
                </span>
                <EcommerceSelect
                  ariaLabel={mode.mediaKind === 'video' ? '视频比例' : '图片比例'}
                  name="ratio"
                  value={ratio}
                  onChange={setRatio}
                  options={ecommerceRatioOptions(mode.usage, mode.mediaKind)}
                  dataAttributes={{ 'data-ecommerce-ratio': true }}
                />
              </div>
            ) : null}
            {showResolutionField ? (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>分辨率</span>
                <EcommerceSelect
                  ariaLabel="图片分辨率"
                  name="resolution"
                  value={resolution}
                  onChange={setResolution}
                  options={resolutionChoices}
                  dataAttributes={{ 'data-ecommerce-resolution': true }}
                />
              </div>
            ) : null}
            {showQualityField ? (
              <div className={styles.field}>
                <span className={styles.fieldLabel}>质量</span>
                <EcommerceSelect
                  ariaLabel="图片质量"
                  name="quality"
                  value={quality}
                  onChange={setQuality}
                  options={qualityChoices}
                  dataAttributes={{ 'data-ecommerce-quality': true }}
                />
              </div>
            ) : null}
          </div>
        </section>
        ) : null}

        {showSellingPoints ? (
        <section className={styles.block} data-param-section="selling">
          <div className={styles.blockHead}>
            <label className={styles.blockTitle} htmlFor="ecommerce-note">
              商品卖点 &amp; 要求
            </label>
            <button
              type="button"
              className={styles.aiWrite}
              data-ecommerce-ai-write
              disabled={writingSellingPoints || !chatTargetLabel}
              onClick={() => void writeSellingPoints()}
            >
              {writingSellingPoints ? '生成中…' : 'AI 帮写'}
            </button>
          </div>
          <textarea
            id="ecommerce-note"
            className={styles.textarea}
            value={note}
            maxLength={ECOMMERCE_NOTE_MAX}
            placeholder="例：突出防水材质；模特手持场景；不要出现文字"
            data-ecommerce-note
            onChange={(e) => setNote(e.target.value)}
          />
          {sellingPointsError ? (
            <p className={styles.error} role="alert" data-ecommerce-ai-write-error>
              {sellingPointsError}
            </p>
          ) : null}
        </section>
        ) : null}

        {mode.id !== 'product-white' ? (
        <div className={styles.field} data-param-section="plan-model">
          <span className={styles.fieldHead}>
            <span className={styles.fieldLabel}>对话模型</span>
            {onConfigureChannels ? (
              <button
                type="button"
                className={styles.fieldAction}
                data-ecommerce-configure-channels
                onClick={onConfigureChannels}
              >
                渠道配置
              </button>
            ) : null}
          </span>
          <EcommerceSelect
            ariaLabel="对话模型"
            name="intent-model"
            value={
              (chatModels.includes(intentModel) ? intentModel : undefined) ??
              (chatTargetLabel && chatModels.includes(chatTargetLabel)
                ? chatTargetLabel
                : undefined) ??
              chatModels[0] ??
              ''
            }
            onChange={(value) => onIntentModelChange?.(value)}
            placeholder="未配置对话模型"
            menuMinWidth={260}
            disabled={chatModels.length === 0}
            options={chatModels.map((item) => ({
              value: item,
              label: item,
              icon: modelIconFor(item),
            }))}
            dataAttributes={{ 'data-ecommerce-intent-model': true }}
          />
        </div>
        ) : null}

        <div className={styles.field} data-param-section="generate-model">
          <span className={styles.fieldLabel}>
            {mode.mediaKind === 'video' ? '视频模型' : '生成模型'}
          </span>
          <EcommerceSelect
            ariaLabel={mode.mediaKind === 'video' ? '视频模型' : '生成模型'}
            name="generate-model"
            value={model}
            onChange={handleGenerateModelChange}
            placeholder="默认（按渠道解析）"
            menuMinWidth={250}
            options={[
              { value: '', label: '默认（按渠道解析）' },
              ...(mode.mediaKind === 'video' ? videoModels : models).map((item) => ({
                value: item,
                label: item,
                icon: modelIconFor(item),
              })),
            ]}
            dataAttributes={{ 'data-ecommerce-model': true }}
          />
        </div>

        <div data-param-section="mode">
          <ModeSpecificParameters
            modeId={mode.id}
            options={modeOptions}
            setOption={setModeOption}
            toggleOption={toggleModeOption}
          />
        </div>

        </div>

        {error ? (
          <p className={styles.error} role="alert" data-ecommerce-error>
            {error}
          </p>
        ) : null}
        <button
          type="button"
          className={styles.generate}
          disabled={running}
          data-ecommerce-generate
          onClick={start}
        >
          {running ? '生成中…' : mode.mediaKind === 'video' ? '生成视频' : `生成${mode.label}`}
        </button>
        <GenerationStageView stage={generationStage} />

      </aside>

      {/* 中：产物 */}
      <section className={styles.results} data-ecommerce-results>
        <nav className={styles.modeBar} data-ecommerce-modes>
          {categoryModes.map((item) => (
            <button
              key={item.id}
              type="button"
              className={
                item.id === mode.id
                  ? `${styles.modeButton} ${styles.modeButtonOn}`
                  : styles.modeButton
              }
              data-ecommerce-mode={item.id}
              {...(STUDIO_MODES.find(
                (candidate) =>
                  candidate.category === item.category && candidate.usage === item.usage,
              )?.id === item.id
                ? { 'data-ecommerce-usage': item.usage }
                : {})}
              aria-pressed={item.id === mode.id}
              aria-checked={item.usage === usage}
              onClick={() => activateMode(item)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        {workbench ?? (visibleResults.length === 0 ? (
          <div className={styles.caseSection} data-ecommerce-empty>
            <div className={styles.carousel} data-ecommerce-case-carousel>
              {carouselCases.map((item, index) => (
                <article className={styles.caseCard} key={item.id}>
                  <header className={styles.caseHead}>
                    <span className={styles.caseTitle}>{item.title}</span>
                    <span className={styles.caseTag}>{item.tag}</span>
                  </header>
                  <div className={styles.caseBody}>
                    <div className={styles.caseSource}>
                      {index === 0 && products[0]?.preview ? (
                        products[0].preview
                      ) : (
                        <span>{mode.mediaKind === 'video' ? '视频' : '商品'}</span>
                      )}
                    </div>
                    <span className={styles.caseArrow}>→</span>
                    <div className={styles.caseResults}>
                      {item.tiles.map((tile) => (
                        <span key={tile}>{tile}</span>
                      ))}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.grid} data-ecommerce-grid>
            {visibleResults.map((r) => (
              <figure
                key={r.nodeId}
                className={styles.cell}
                data-ecommerce-result
                data-ecommerce-result-id={r.nodeId}
                data-status={r.status}
              >
                <div className={styles.cellBody}>
                  {r.preview ?? (
                    r.status === 'done' ? (
                      <span className={styles.cellState}>已完成</span>
                    ) : null
                  )}
                  {r.status === 'running' || r.status === 'failed' ? (
                    <ResultStatusOverlay item={r} />
                  ) : null}
                </div>
                {r.status === 'failed' ? (
                  <figcaption className={styles.cellFoot}>
                    <span className={styles.cellError}>
                      {r.error ?? '失败（没有原因记录）'}
                    </span>
                    {r.onRerun ? (
                      <button
                        type="button"
                        className={styles.cellRetry}
                        data-ecommerce-retry-result={r.nodeId}
                        disabled={running}
                        onClick={() => void r.onRerun?.()}
                      >
                        重新生成
                      </button>
                    ) : null}
                    {r.onRemoveFailed ? (
                      <button
                        type="button"
                        className={styles.cellRemove}
                        data-ecommerce-remove-failed={r.nodeId}
                        onClick={r.onRemoveFailed}
                      >
                        移除
                      </button>
                    ) : null}
                  </figcaption>
                ) : null}
              </figure>
            ))}
          </div>
        ))}
        {longImageNode}
      </section>

      {detailTarget ? (
        <div
          className={styles.confirm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ecommerce-result-detail-title"
          data-ecommerce-result-detail-dialog
        >
          <div className={styles.confirmCard}>
            <h2 className={styles.confirmTitle} id="ecommerce-result-detail-title">
              结果详情
            </h2>
            <dl className={styles.detailGrid}>
              {detailTarget.model ? (
                <>
                  <dt>模型</dt>
                  <dd>{detailTarget.model}</dd>
                </>
              ) : null}
              {detailTarget.shotTitle ? (
                <>
                  <dt>图片类型</dt>
                  <dd>{detailTarget.shotTitle}</dd>
                </>
              ) : null}
              {detailTarget.ratio ? (
                <>
                  <dt>比例</dt>
                  <dd>{ecommerceRatioLabel(detailTarget.ratio)}</dd>
                </>
              ) : null}
              {detailTarget.headline ? (
                <>
                  <dt>画面主文案</dt>
                  <dd>{detailTarget.headline}</dd>
                </>
              ) : null}
              {detailTarget.visualSystem ? (
                <>
                  <dt>视觉系统</dt>
                  <dd>{detailTarget.visualSystem}</dd>
                </>
              ) : null}
              {detailTarget.createdAt ? (
                <>
                  <dt>生成时间</dt>
                  <dd>{new Date(detailTarget.createdAt).toLocaleString('zh-CN')}</dd>
                </>
              ) : null}
              {detailTarget.note ? (
                <>
                  <dt>任务要求</dt>
                  <dd>{detailTarget.note}</dd>
                </>
              ) : null}
            </dl>
            {detailTarget.prompt ? (
              <pre className={styles.detailPrompt} data-ecommerce-result-prompt>
                {detailTarget.prompt}
              </pre>
            ) : null}
            <div className={styles.confirmActions}>
              {detailTarget.prompt ? (
                <button
                  type="button"
                  className={styles.cancel}
                  data-ecommerce-result-prompt-copy
                  onClick={() => {
                    void navigator.clipboard?.writeText(detailTarget.prompt ?? '')
                  }}
                >
                  复制提示词
                </button>
              ) : null}
              <button
                type="button"
                className={styles.cancel}
                data-ecommerce-result-detail-close
                onClick={() => setDetailTarget(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {compareTarget ? (
        <div
          className={styles.confirm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ecommerce-compare-title"
          data-ecommerce-compare-dialog
        >
          <div className={`${styles.confirmCard} ${styles.compareCard}`}>
            <h2 className={styles.confirmTitle} id="ecommerce-compare-title">
              编辑前后对比
            </h2>
            <div className={styles.compareGrid}>
              <figure className={styles.comparePane}>
                <figcaption>原图</figcaption>
                <div className={styles.compareImage} data-ecommerce-compare-source-image>
                  {compareTarget.sourcePreview}
                </div>
              </figure>
              <figure className={styles.comparePane}>
                <figcaption>编辑结果</figcaption>
                <div className={styles.compareImage} data-ecommerce-compare-result-image>
                  {compareTarget.preview}
                </div>
              </figure>
            </div>
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.cancel}
                data-ecommerce-compare-close
                onClick={() => setCompareTarget(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {batchEditOpen ? (
        <div
          className={styles.confirm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ecommerce-batch-edit-title"
          data-ecommerce-batch-edit-dialog
        >
          <div className={styles.confirmCard}>
            <h2 className={styles.confirmTitle} id="ecommerce-batch-edit-title">
              批量 AI 编辑
            </h2>
            <p className={styles.confirmText}>
              将对选中的 {selectedImageEditCount} 张图逐张执行同一套修改要求。每张都会生成独立新批次，
              原结果全部保留；会调用你的渠道，产生 {selectedImageEditCount} 次真实用量。
            </p>
            <div className={styles.editPresets} aria-label="常用批量编辑要求">
              {editPresets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={styles.editPreset}
                  data-ecommerce-batch-edit-preset={preset.key}
                  onClick={() => {
                    setBatchInstruction(preset.instruction)
                    if (batchEditError) setBatchEditError('')
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className={styles.editReferenceRow}>
              <input
                id="ecommerce-batch-edit-reference"
                type="file"
                accept="image/*"
                hidden
                data-ecommerce-batch-edit-reference-input
                disabled={batchReferenceBusy}
                onChange={(e) => {
                  void pickEditReference(e.target.files?.[0], true)
                  e.currentTarget.value = ''
                }}
              />
              <label className={styles.editPreset} htmlFor="ecommerce-batch-edit-reference">
                {batchReferenceBusy
                  ? '正在读取参考图…'
                  : batchReference
                    ? '更换参考图'
                    : '上传参考图（可选）'}
              </label>
              {batchReference ? (
                <span className={styles.editReferencePreview} data-ecommerce-batch-edit-reference-preview>
                  {batchReference.preview}
                  <button
                    type="button"
                    className={styles.linkBtn}
                    data-ecommerce-batch-edit-reference-remove
                    onClick={() => setBatchReference(null)}
                  >
                    移除
                  </button>
                </span>
              ) : null}
            </div>
            {editModels.length > 0 ? (
              <div className={styles.editModel}>
                <span>编辑模型</span>
                <EcommerceSelect
                  ariaLabel="批量编辑模型"
                  name="batch-edit-model"
                  value={batchEditModel}
                  onChange={setBatchEditModel}
                  menuMinWidth={250}
                  options={[
                    { value: '', label: '跟随原任务模型' },
                    ...editModels.map((item) => ({
                      value: item,
                      label: item,
                      icon: modelIconFor(item),
                    })),
                  ]}
                  dataAttributes={{ 'data-ecommerce-batch-edit-model': true }}
                />
              </div>
            ) : null}
            <textarea
              className={styles.editInput}
              data-ecommerce-batch-edit-instruction
              value={batchInstruction}
              maxLength={ECOMMERCE_NOTE_MAX}
              onChange={(e) => {
                setBatchInstruction(e.target.value)
                if (batchEditError) setBatchEditError('')
              }}
              placeholder="例如：只把每一张的背景都换成浅灰摄影棚背景，产品和文字保持不变"
              aria-label="这批图统一要改什么"
            />
            {batchEditError ? (
              <p className={styles.editError} data-ecommerce-batch-edit-error>
                {batchEditError}
              </p>
            ) : null}
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.cancel}
                data-ecommerce-batch-edit-cancel
                disabled={batchEditSubmitting}
                onClick={() => {
                  setBatchEditOpen(false)
                  setBatchInstruction('')
                  setBatchEditModel('')
                  setBatchReference(null)
                  setBatchEditError('')
                }}
              >
                取消
              </button>
              <button
                type="button"
                className={`${styles.generate} ${styles.editSubmit}`}
                data-ecommerce-batch-edit-submit
                disabled={
                  batchEditSubmitting ||
                  running ||
                  selectedImageEditCount === 0 ||
                  !batchInstruction.trim()
                }
                onClick={() => void submitBatchEdit()}
              >
                {batchEditSubmitting ? '正在逐张执行…' : `生成 ${selectedImageEditCount} 张编辑结果`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 单张结果定向编辑：独立批次、独立指令，不覆盖原结果 */}
      {editTarget ? (
        <div
          className={styles.confirm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ecommerce-edit-title"
          data-ecommerce-edit-dialog
        >
          <div className={styles.confirmCard}>
            <h2 className={styles.confirmTitle} id="ecommerce-edit-title">
              AI 编辑这一张
            </h2>
            <p className={styles.confirmText}>
              {editTarget.label}。只改你写明的内容，未点名的产品、人物、构图、光影和文字保持不变；
              原图与历史都不会被覆盖。
            </p>
            <div className={styles.editPresets} aria-label="常用编辑要求">
              {editPresets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  className={styles.editPreset}
                  data-ecommerce-edit-preset={preset.key}
                  onClick={() => {
                    setEditInstruction(preset.instruction)
                    if (editError) setEditError('')
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className={styles.editReferenceRow}>
              <input
                id="ecommerce-edit-reference"
                type="file"
                accept="image/*"
                hidden
                data-ecommerce-edit-reference-input
                disabled={editReferenceBusy}
                onChange={(e) => {
                  void pickEditReference(e.target.files?.[0], false)
                  e.currentTarget.value = ''
                }}
              />
              <label className={styles.editPreset} htmlFor="ecommerce-edit-reference">
                {editReferenceBusy ? '正在读取参考图…' : editReference ? '更换参考图' : '上传参考图（可选）'}
              </label>
              {editReference ? (
                <span className={styles.editReferencePreview} data-ecommerce-edit-reference-preview>
                  {editReference.preview}
                  <button
                    type="button"
                    className={styles.linkBtn}
                    data-ecommerce-edit-reference-remove
                    onClick={() => setEditReference(null)}
                  >
                    移除
                  </button>
                </span>
              ) : null}
            </div>
            {editModels.length > 0 ? (
              <div className={styles.editModel}>
                <span>编辑模型</span>
                <EcommerceSelect
                  ariaLabel="单张编辑模型"
                  name="edit-model"
                  value={editModel}
                  onChange={setEditModel}
                  menuMinWidth={250}
                  options={[
                    { value: '', label: '跟随原任务模型' },
                    ...editModels.map((item) => ({
                      value: item,
                      label: item,
                      icon: modelIconFor(item),
                    })),
                  ]}
                  dataAttributes={{ 'data-ecommerce-edit-model': true }}
                />
              </div>
            ) : null}
            <textarea
              className={styles.editInput}
              data-ecommerce-edit-instruction
              value={editInstruction}
              maxLength={ECOMMERCE_NOTE_MAX}
              onChange={(e) => {
                setEditInstruction(e.target.value)
                if (editError) setEditError('')
              }}
              placeholder="例如：只把背景换成海边日落，产品和画面文字保持不变"
              aria-label="这一张要改什么"
            />
            {editError ? (
              <p className={styles.editError} data-ecommerce-edit-error>
                {editError}
              </p>
            ) : null}
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.cancel}
                data-ecommerce-edit-cancel
                disabled={editSubmitting}
                onClick={() => {
                  setEditTarget(null)
                  setEditInstruction('')
                  setEditModel('')
                  setEditReference(null)
                  setEditError('')
                }}
              >
                取消
              </button>
              <button
                type="button"
                className={`${styles.generate} ${styles.editSubmit}`}
                data-ecommerce-edit-submit
                disabled={editSubmitting || running || !editInstruction.trim()}
                onClick={() => void submitEdit()}
              >
                {editSubmitting ? '提交中…' : '生成编辑结果'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {upscaleTarget ? (
        <div
          className={styles.confirm}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ecommerce-upscale-title"
          data-ecommerce-upscale-dialog
        >
          <div className={styles.confirmCard}>
            <h2 className={styles.confirmTitle} id="ecommerce-upscale-title">
              AI 超清
            </h2>
            <p className={styles.confirmText}>
              使用真实 Topaz 超分模型放大
              {upscaleTarget.items.length > 1
                ? `所选 ${upscaleTarget.items.length} 张结果`
                : '这张结果'}
              ，不重绘商品也不生成新画面。原图和原任务都会保留；会调用当前渠道，产生
              {upscaleTarget.items.length > 1
                ? ` ${upscaleTarget.items.length} 次真实用量。`
                : '一次真实用量。'}
            </p>
            <p className={styles.hint} data-ecommerce-upscale-count>
              本次处理 {upscaleTarget.items.length} 张
            </p>
            <div className={styles.upscaleSection}>
              <span className={styles.upscaleLabel}>方案</span>
              <div className={styles.editPresets} aria-label="AI 超清方案">
                {availableUpscaleOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={
                      option.id === upscaleProfile
                        ? `${styles.editPreset} ${styles.editPresetOn}`
                        : styles.editPreset
                    }
                    data-ecommerce-upscale-profile={option.id}
                    title={option.hint}
                    onClick={() => setUpscaleProfile(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.upscaleSection}>
              <span className={styles.upscaleLabel}>放大倍数</span>
              <div className={styles.editPresets} aria-label="AI 超清倍数">
                {ECOMMERCE_UPSCALE_SCALES.map((scale) => (
                  <button
                    key={scale}
                    type="button"
                    className={
                      scale === upscaleScale
                        ? `${styles.editPreset} ${styles.editPresetOn}`
                        : styles.editPreset
                    }
                    data-ecommerce-upscale-scale={scale}
                    onClick={() => setUpscaleScale(scale)}
                  >
                    {scale}
                  </button>
                ))}
              </div>
            </div>
            <p className={styles.hint} data-ecommerce-upscale-model>
              {
                availableUpscaleOptions.find((option) => option.id === upscaleProfile)?.model
              }
            </p>
            {upscaleError ? (
              <p className={styles.editError} data-ecommerce-upscale-error>
                {upscaleError}
              </p>
            ) : null}
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.cancel}
                data-ecommerce-upscale-cancel
                disabled={upscaleSubmitting}
                onClick={() => {
                  setUpscaleTarget(null)
                  setUpscaleError('')
                }}
              >
                取消
              </button>
              <button
                type="button"
                className={styles.generate}
                data-ecommerce-upscale-submit
                disabled={upscaleSubmitting || running}
                onClick={() => void submitUpscale()}
              >
                {upscaleSubmitting
                  ? `提交中…（${upscaleTarget.items.length} 张）`
                  : `AI 超清 ${upscaleScale}${upscaleTarget.items.length > 1 ? `（${upscaleTarget.items.length}）` : ''}`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {uploadPreview && uploadPreviewItem ? (
        <div
          className={styles.uploadLightbox}
          role="dialog"
          aria-modal="true"
          data-ecommerce-upload-lightbox
          onClick={() => setUploadPreview(null)}
        >
          <div className={styles.uploadLightboxBody} onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className={styles.uploadLightboxClose}
              aria-label="关闭预览"
              onClick={() => setUploadPreview(null)}
            >
              ×
            </button>
            <button
              type="button"
              className={`${styles.uploadLightboxArrow} ${styles.uploadLightboxPrev}`}
              aria-label="上一张"
              disabled={uploadPreview.index <= 0}
              onClick={() =>
                setUploadPreview((current) =>
                  current && current.index > 0 ? { ...current, index: current.index - 1 } : current,
                )
              }
            >
              ‹
            </button>
            <div className={styles.uploadLightboxStage}>{uploadPreviewItem.preview}</div>
            <button
              type="button"
              className={`${styles.uploadLightboxArrow} ${styles.uploadLightboxNext}`}
              aria-label="下一张"
              disabled={uploadPreview.index >= uploadPreviewItems.length - 1}
              onClick={() =>
                setUploadPreview((current) =>
                  current && current.index < uploadPreviewItems.length - 1
                    ? { ...current, index: current.index + 1 }
                    : current,
                )
              }
            >
              ›
            </button>
            <span className={styles.uploadLightboxCount} data-ecommerce-upload-position>
              {uploadPreview.index + 1} / {uploadPreviewItems.length}
            </span>
          </div>
        </div>
      ) : null}

      {/* 付费确认（D6）：先报"预计 N 张"，确认后才发请求 */}
      {confirming ? (
        <div className={styles.confirm} role="dialog" aria-modal="true" data-ecommerce-confirm>
          <div className={styles.confirmCard}>
            <h2 className={styles.confirmTitle}>确认生成</h2>
            <p className={styles.confirmText}>
              将生成 <b>{mode.mediaKind === 'video' ? 1 : batchOutputCount}</b>{' '}
              {mode.mediaKind === 'video' ? '条' : '张'}
              {mode.mediaKind === 'video' ? mode.label : usageLabel(usage)}，比例{' '}
              {ecommerceRatioLabel(ratio)}
              {platform ? `，面向 ${platform.name}` : ''}。会调用你的渠道，产生真实用量。
            </p>
            {confirmUsesAiPlan ? (
              <p className={styles.confirmFlow} data-ecommerce-confirm-ai-flow>
                确认后会先生成整批方案，再由 AI 自审并修正逐张提示词，然后交给生图模型。
                本次会多花一次对话额度。
              </p>
            ) : null}
            <div className={styles.confirmActions}>
              <button
                type="button"
                className={styles.cancel}
                data-ecommerce-confirm-cancel
                onClick={() => setConfirming(false)}
              >
                再改改
              </button>
              <button
                type="button"
                className={styles.generate}
                data-ecommerce-confirm-ok
                onClick={() => void confirm()}
              >
                确认生成 {mode.mediaKind === 'video' ? 1 : batchOutputCount}{' '}
                {mode.mediaKind === 'video' ? '条视频' : '张'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function CategoryGlyph({ category }: { category: StudioCategory }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  if (category === 'video') {
    return (
      <svg {...common} width={20} height={20} viewBox="0 0 24 24">
        <rect x="3.5" y="5" width="13" height="14" rx="2" />
        <path d="m16.5 9 4-2v10l-4-2Z" />
        <path d="m8 9 4 3-4 3Z" />
      </svg>
    )
  }
  if (category === 'wear') {
    return (
      <svg {...common} width={20} height={20} viewBox="0 0 24 24">
        <path d="M9 4.5 5 7l2 5 1.5-.7V20h7V11.3L17 12l2-5-4-2.5a3 3 0 0 1-6 0Z" />
      </svg>
    )
  }
  return (
    <svg {...common} width={20} height={20} viewBox="0 0 24 24">
      <path d="M5 8.5h14l-1 11H6Z" />
      <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" />
    </svg>
  )
}
