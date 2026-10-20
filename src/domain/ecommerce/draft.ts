import { ECOMMERCE_DEFAULT_COUNT } from './plan'
import { normalizeEcommerceModeOptions } from './modeOptions'
import { ECOMMERCE_NOTE_MAX } from './prompt'
import {
  ECOMMERCE_COUNT_MAX,
  ECOMMERCE_FORM_USAGES,
  ECOMMERCE_LANGUAGES,
  ECOMMERCE_RATIOS,
  type EcommerceLanguage,
  type EcommerceModeOptions,
  type EcommerceUsage,
} from './types'

/**
 * 电商工作台的**左侧草稿**（对账 #477）。
 *
 * 这一份不是请求，也不是结果：它回答的是"用户刚才把表单填成了什么样"。
 * 结果已经能按批次从节点恢复；表单如果还只活在 React state 里，
 * 刷新 / 切走后就会回到默认，用户得重新上传两张图、重选平台语言 ——
 * 那就不算一个独立工作区。
 *
 * 这里只存**节点 id**，不存图片字节：图片本来就在 `assets` 里，
 * 草稿只负责记住"是哪几张"。
 */
export interface EcommerceFormDraft {
  /** 当前工作台功能的稳定显示名；空 = 按 usage 回落。 */
  modeLabel: string
  mediaKind: 'image' | 'video'
  videoDuration: number
  usage: EcommerceUsage
  platformId: string
  language: EcommerceLanguage
  count: number
  ratio: string
  note: string
  model: string
  /** 当前功能的专属参数；稳定 id，不把显示文案写进草稿。 */
  modeOptions: EcommerceModeOptions
  /** 每个顶部工具各自保存的平台 / 语言 / 比例 / 要求，切换工具互不覆盖 */
  modeStates: Record<string, EcommerceModeFormState>
  productNodeId: string | null
  /** 多角度产品图；顺序决定第一张主产品图，最多 3 张 */
  productNodeIds: string[]
  referenceNodeIds: string[]
}

export interface EcommerceModeFormState {
  platformId: string
  language: EcommerceLanguage
  ratio: string
  note: string
}

export const DEFAULT_ECOMMERCE_FORM_DRAFT: EcommerceFormDraft = {
  modeLabel: '商品套图',
  mediaKind: 'image',
  videoDuration: 5,
  usage: 'set',
  platformId: 'amazon',
  language: 'en',
  count: ECOMMERCE_DEFAULT_COUNT.set,
  ratio: '1:1',
  note: '',
  model: '',
  modeOptions: {},
  modeStates: {},
  productNodeId: null,
  productNodeIds: [],
  referenceNodeIds: [],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringOf(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function usageOf(value: unknown): EcommerceUsage {
  return ECOMMERCE_FORM_USAGES.includes(value as EcommerceUsage)
    ? (value as EcommerceUsage)
    : DEFAULT_ECOMMERCE_FORM_DRAFT.usage
}

function languageOf(value: unknown): EcommerceLanguage {
  return ECOMMERCE_LANGUAGES.includes(value as EcommerceLanguage)
    ? (value as EcommerceLanguage)
    : DEFAULT_ECOMMERCE_FORM_DRAFT.language
}

function normalizeModeStates(value: unknown): Record<string, EcommerceModeFormState> {
  if (!isRecord(value)) return {}
  const out: Record<string, EcommerceModeFormState> = {}
  for (const [rawKey, rawState] of Object.entries(value).slice(0, 40)) {
    const key = stringOf(rawKey, 80)
    if (!key || !isRecord(rawState)) continue
    const ratio =
      typeof rawState.ratio === 'string' && ECOMMERCE_RATIOS.includes(rawState.ratio)
        ? rawState.ratio
        : DEFAULT_ECOMMERCE_FORM_DRAFT.ratio
    out[key] = {
      platformId:
        stringOf(rawState.platformId, 100) || DEFAULT_ECOMMERCE_FORM_DRAFT.platformId,
      language: languageOf(rawState.language),
      ratio,
      note: stringOf(rawState.note, ECOMMERCE_NOTE_MAX),
    }
  }
  return out
}

/**
 * 把库里读到的任意值收敛成可用草稿。
 *
 * 脏字段逐项回落，**不让坏数据把表单打不开**：用途 / 语言 / 比例只认白名单，
 * 张数夹在 1..12，文字截到各自上限；节点 id 只留非空字符串。
 */
export function normalizeEcommerceFormDraft(value: unknown): EcommerceFormDraft {
  const raw = isRecord(value) ? value : {}
  const usage = usageOf(raw.usage)
  const rawCount = typeof raw.count === 'number' ? Math.floor(raw.count) : Number.NaN
  const count = Number.isFinite(rawCount)
    ? Math.min(Math.max(rawCount, 1), ECOMMERCE_COUNT_MAX)
    : ECOMMERCE_DEFAULT_COUNT[usage]
  const ratio =
    typeof raw.ratio === 'string' && ECOMMERCE_RATIOS.includes(raw.ratio)
      ? raw.ratio
      : DEFAULT_ECOMMERCE_FORM_DRAFT.ratio
  const referenceNodeIds = Array.isArray(raw.referenceNodeIds)
    ? [...new Set(raw.referenceNodeIds.filter((id): id is string => typeof id === 'string' && !!id))]
        .slice(0, 4)
    : []
  const legacyProductNodeId =
    typeof raw.productNodeId === 'string' && raw.productNodeId ? raw.productNodeId : null
  const productNodeIds = Array.isArray(raw.productNodeIds)
    ? [
        ...new Set(
          raw.productNodeIds.filter((id): id is string => typeof id === 'string' && !!id),
        ),
      ].slice(0, 3)
    : legacyProductNodeId
      ? [legacyProductNodeId]
      : []
  const productNodeId = productNodeIds[0] ?? legacyProductNodeId

  return {
    modeLabel: stringOf(raw.modeLabel, 80),
    mediaKind: raw.mediaKind === 'video' ? 'video' : 'image',
    videoDuration:
      typeof raw.videoDuration === 'number' && Number.isFinite(raw.videoDuration)
        ? Math.min(Math.max(Math.round(raw.videoDuration), 1), 30)
        : 5,
    usage,
    platformId: stringOf(raw.platformId, 100) || DEFAULT_ECOMMERCE_FORM_DRAFT.platformId,
    language: languageOf(raw.language),
    count,
    ratio,
    note: stringOf(raw.note, ECOMMERCE_NOTE_MAX),
    model: stringOf(raw.model, 200),
    modeOptions: normalizeEcommerceModeOptions(raw.modeOptions),
    modeStates: normalizeModeStates(raw.modeStates),
    productNodeId: productNodeId ?? null,
    productNodeIds,
    referenceNodeIds,
  }
}

/** 读项目行 `extra.ecommerce.draft`；没有这一笔时返回 null（调用方用默认值）。 */
export function readEcommerceFormDraft(extra: unknown): EcommerceFormDraft | null {
  if (!isRecord(extra)) return null
  const ecommerce = isRecord(extra.ecommerce) ? extra.ecommerce : null
  if (!ecommerce || !isRecord(ecommerce.draft)) return null
  return normalizeEcommerceFormDraft(ecommerce.draft)
}

/** 把草稿合并回 `extra`，不碰同一层里的 `ecommerce.batchId` 等其它键。 */
export function withEcommerceFormDraft(
  extra: unknown,
  draft: EcommerceFormDraft,
): Record<string, unknown> {
  const base = isRecord(extra) ? { ...extra } : {}
  const ecommerce = isRecord(base.ecommerce) ? { ...base.ecommerce } : {}
  return {
    ...base,
    ecommerce: {
      ...ecommerce,
      draft: normalizeEcommerceFormDraft(draft),
    },
  }
}

/**
 * 按"这些节点现在还存在且有素材"清理草稿里的上传引用。
 *
 * 页面读草稿时会先建一张可用节点表；不在这里查库，保持纯函数可单测。
 * 产品图悬空就置空，参考图悬空就丢掉；留下的一定是可恢复的节点 id。
 */
export function cleanEcommerceDraftRefs(
  draft: EcommerceFormDraft,
  validNodeIds: ReadonlySet<string>,
): EcommerceFormDraft {
  const productNodeIds = [...new Set([
    ...(draft.productNodeId ? [draft.productNodeId] : []),
    ...(draft.productNodeIds ?? []),
  ])]
    .filter((id) => validNodeIds.has(id))
    .slice(0, 3)
  const productNodeId = productNodeIds[0] ?? null
  return {
    ...draft,
    productNodeId,
    productNodeIds,
    referenceNodeIds: draft.referenceNodeIds.filter((id) => validNodeIds.has(id)).slice(0, 4),
  }
}
