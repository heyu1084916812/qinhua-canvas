import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ECOMMERCE_DEFAULT_COUNT } from '../../domain/ecommerce/plan'
import { ECOMMERCE_PLATFORMS, type EcommercePlatform } from '../../domain/ecommerce/platforms'
import { intentRows, type EcommerceIntentDraft } from '../../domain/ecommerce/chatParse'
import {
  shotKeyOf,
  shouldExpandShots,
  type ShotPlanResult,
} from '../../domain/ecommerce/chatShots'
import {
  ECOMMERCE_COUNT_MAX,
  ECOMMERCE_LANGUAGES,
  ECOMMERCE_RATIOS,
  ECOMMERCE_USAGES,
  languageLabel,
  usageLabel,
  type EcommerceLanguage,
  type EcommerceRequest,
  type EcommerceUsage,
} from '../../domain/ecommerce/types'
import { ECOMMERCE_NOTE_MAX } from '../../domain/ecommerce/prompt'
import type { EcommerceShot } from '../../domain/ecommerce/prompt'
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
}

export interface EcommerceResultItem {
  nodeId: string
  status: 'pending' | 'running' | 'done' | 'failed'
  /** 失败原因（`status === 'failed'` 时必须有 —— 不许静默） */
  error?: string
  preview?: ReactNode
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
  /**
   * 「在画布里改这一张」（对账 #424）：跳到画布并把**这个节点**选中 + 居中。
   * 由页面注入（路由是页面的事）；不传就不渲染这个入口。
   */
  onFocusInCanvas?: () => void
}

export interface EcommerceStudioProps {
  projectName: string
  /**
   * 平台清单：默认用内置那份；页面可以把**扩展包带进来的规则**合并后传进来
   * （对账 #386 的 E3：平台规则可发扩展包更新，不必等应用发版）。
   */
  platforms?: readonly EcommercePlatform[]
  /** 上传一张图：由页面落到画布（assets + 节点），返回节点 id 与预览 */
  onUpload: (file: File, kind: 'product' | 'reference') => Promise<EcommerceUpload | null>
  /**
   * 点「开始生成」并在二次确认之后调用；页面负责建节点 + 跑引擎。
   *
   * `shotPlan` = 用户**先看过并确认**的那份分镜（对账 #423）。传了它，
   * 页面就**不再多花一次对话额度**去问模型 —— 直接用这份。
   */
  onGenerate: (request: EcommerceRequest, shotPlan?: readonly EcommerceShot[]) => Promise<void>
  /** 可选出图模型（前端显示名，来自固定清单）；空数组时只显示"默认（按渠道解析）" */
  models?: readonly string[]
  /** 当前选中的模型；空串 = 用默认解析出来的那一个 */
  model: string
  onModelChange: (model: string) => void
  running: boolean
  results: readonly EcommerceResultItem[]
  /** 在画布里打开这个项目（结果已经是画布节点，这是"发送到画布"的落点） */
  onOpenCanvas: () => void
  /**
   * 「拼成长图」（对账 #420）：由页面注入 —— 长图要读素材字节（`loadAssetUrl`）与落盘
   * （`files.saveFile`），那是**装配层**的活。不传就不渲染这个入口。
   */
  onOpenLongImage?: () => void
  /** 长图面板本身（页面注入的 ReactNode）；为空就不渲染 */
  longImage?: ReactNode
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
  /** 解析失败 / 没配对话模型时的如实说法 */
  intentError?: string
  /** 用户点了「应用到表单」——页面据此收起确认卡 */
  onIntentApplied?: () => void
  /** 用户点了「丢弃」 */
  onIntentDiscard?: () => void
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
}

export function EcommerceStudio({
  projectName,
  platforms = ECOMMERCE_PLATFORMS,
  onUpload,
  onGenerate,
  models = [],
  model,
  onModelChange,
  running,
  results,
  onOpenCanvas,
  onOpenLongImage,
  longImage,
  onParseIntent,
  parsingIntent = false,
  intent = null,
  chatTargetLabel = '',
  intentError = '',
  onIntentApplied,
  onIntentDiscard,
  onPlanShots,
  shotPlanNote = '',
}: EcommerceStudioProps) {
  const [usage, setUsage] = useState<EcommerceUsage>('main')
  const [platformId, setPlatformId] = useState<string>('amazon')
  const [language, setLanguage] = useState<EcommerceLanguage>('en')
  const [count, setCount] = useState<number>(ECOMMERCE_DEFAULT_COUNT.main)
  const [ratio, setRatio] = useState<string>('1:1')
  const [note, setNote] = useState('')
  const [product, setProduct] = useState<EcommerceUpload | null>(null)
  const [references, setReferences] = useState<EcommerceUpload[]>([])
  /** 二次确认：点生成先算出"预计 N 张"，确认后才真的发请求（#384 的 D6） */
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState('')
  /** 「一句话生成方案」的输入框（#422）：纯 UI 态，不进表单、不落库 */
  const [intentText, setIntentText] = useState('')
  /**
   * 「先出一份方案」（对账 #423）：**方案 + 它是对着哪组参数写的**。
   *
   * 存 `key` 而不是只存 shots：用户改完表单再看那份方案，它就已经是对着旧参数写的了。
   * 继续拿它出图会出现"方案上写着 3 张、实际出 4 张"这种错位 —— 所以比一比键，
   * 不相等就**当场作废**（界面上明说），出图时重新问一次。
   */
  const [shotPlan, setShotPlan] = useState<{
    key: string
    shots: readonly EcommerceShot[]
  } | null>(null)
  const [planningShots, setPlanningShots] = useState(false)
  const [planError, setPlanError] = useState('')

  /** 换用途时把张数带到该用途的默认值（用户仍可改）——"带示例"的一半 */
  useEffect(() => {
    setCount(ECOMMERCE_DEFAULT_COUNT[usage])
  }, [usage])

  const platform = useMemo(
    () => platforms.find((p) => p.id === platformId) ?? null,
    [platforms, platformId],
  )

  const onPick = async (file: File | undefined, kind: 'product' | 'reference') => {
    if (!file) return
    setError('')
    const uploaded = await onUpload(file, kind)
    if (!uploaded) {
      setError('这张图没能读进来（格式不支持或读取失败），换一张再试')
      return
    }
    if (kind === 'product') setProduct(uploaded)
    else setReferences((prev) => [...prev, uploaded].slice(0, 4))
  }

  const buildRequest = (): EcommerceRequest => ({
    usage,
    platformId: platformId || undefined,
    language,
    count,
    ratio,
    productNodeId: product?.nodeId ?? '',
    referenceNodeIds: references.map((r) => r.nodeId),
    note,
    /* 空串不写进请求：让页面按"默认解析"那条路走（与没选过完全一致） */
    ...(model ? { model } : {}),
  })

  const start = () => {
    if (!product) {
      setError('先上传一张产品图 —— 没有产品图就没有可改的主体')
      return
    }
    setError('')
    setConfirming(true)
  }

  /**
   * 「先出一份方案」（对账 #423）。
   *
   * ⚠️ 存进 state 的 `key` 取自**这一次发出去的请求**，不是"回来时的表单"：
   * 请求在路上时用户完全可能又改了字，那时回来的是**旧参数**的方案 ——
   * 按当时的表单记键，这份方案会被当成有效的（正是 #419 那条教训的反面）。
   */
  const makePlan = async () => {
    if (!onPlanShots) return
    const request = buildRequest()
    const key = shotKeyOf(request)
    setPlanningShots(true)
    setPlanError('')
    try {
      const result = await onPlanShots(request)
      if (result.ok) setShotPlan({ key, shots: result.shots })
      else {
        setShotPlan(null)
        setPlanError(result.error)
      }
    } finally {
      setPlanningShots(false)
    }
  }

  /** 当前表单对应的分镜键（只有影响分镜的那几项进键） */
  const currentShotKey = shotKeyOf({ usage, platformId, language, count, ratio, note })
  /** 方案还作不作数：键不等 = 表单改过了，那份方案作废 */
  const activeShotPlan = shotPlan && shotPlan.key === currentShotKey ? shotPlan.shots : null
  const planStale = !!shotPlan && activeShotPlan === null
  /** 这一趟值不值得出方案：与 #406"真去调用模型"是**同一个纯函数** */
  const canPlanShots = !!onPlanShots && !!chatTargetLabel && shouldExpandShots({ usage, count, note })

  const confirm = async () => {
    setConfirming(false)
    setError('')
    try {
      /* 只把**没过期**的那份带过去；过期等于没有（页面会重新问一次） */
      await onGenerate(buildRequest(), activeShotPlan ?? undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败，原因见下方结果区')
    }
  }

  /**
   * 把**待确认**草稿真的填进表单（#422）。
   *
   * 只覆盖草稿里**真有**的那几项 —— 没认出来的键在草稿里根本不存在，
   * 于是表单里原有（或被用户手改过）的值一个不动。这就是"不猜"在界面上的落点。
   */
  const applyIntent = () => {
    if (!intent) return
    if (intent.usage) setUsage(intent.usage)
    if (intent.platformId) setPlatformId(intent.platformId)
    if (intent.language) setLanguage(intent.language)
    if (intent.count !== undefined) setCount(intent.count)
    if (intent.ratio) setRatio(intent.ratio)
    if (intent.note) setNote(intent.note)
    onIntentApplied?.()
  }

  return (
    <div className={styles.wrap} data-ecommerce-studio>
      {/* 左：参数（用户 2026-10-09：左边传图 + 选参数，右边出图） */}
      <aside className={styles.form} data-ecommerce-form>
        <header className={styles.head}>
          <h1 className={styles.title}>电商出图</h1>
          <p className={styles.sub}>{projectName}</p>
        </header>

        {/*
          一句话 → 待确认方案（对账 #422，用户 2026-10-11：「先说清楚它听懂了什么，
          确认了再填表」）。三件事刻意分开：
            ① 输入与"会用谁解析"如实写出来（没配对话模型时按钮是灰的 + 说明原因）；
            ② 解析结果只进**这张卡片**，表单一点没动；
            ③ 点「应用到表单」才真的覆盖 —— 且只覆盖草稿里真有的那几项。
        */}
        {onParseIntent ? (
          <section className={styles.block} data-ecommerce-intent>
            <span className={styles.blockTitle}>用一句话生成方案</span>
            <textarea
              className={styles.textarea}
              value={intentText}
              placeholder="例：给我做一套亚马逊英文详情页，4 张，3:4，突出防水材质"
              data-ecommerce-intent-input
              onChange={(e) => setIntentText(e.target.value)}
            />
            <div className={styles.intentRow}>
              <button
                type="button"
                className={styles.linkBtn}
                data-ecommerce-intent-parse
                disabled={parsingIntent || !chatTargetLabel || intentText.trim().length === 0}
                onClick={() => void onParseIntent(intentText)}
              >
                {parsingIntent ? '解析中…' : '解析成方案'}
              </button>
              <span className={styles.hint} data-ecommerce-intent-note>
                {chatTargetLabel
                  ? `会用 ${chatTargetLabel} 解析`
                  : '还没有可用的对话模型：先去「设置 → 渠道配置」给一条渠道勾上对话模型'}
              </span>
            </div>
            {intentError ? (
              <p className={styles.error} role="alert" data-ecommerce-intent-error>
                {intentError}
              </p>
            ) : null}
            {intent ? (
              <div className={styles.intentCard} data-ecommerce-intent-card>
                <p className={styles.intentLead}>听懂了这些，确认后才会填进表单：</p>
                <ul className={styles.intentList}>
                  {intentRows(intent, platforms).map((row) => (
                    <li key={row.label} className={styles.intentItem} data-ecommerce-intent-row>
                      <span className={styles.intentLabel}>{row.label}</span>
                      <span className={styles.intentValue}>{row.value}</span>
                    </li>
                  ))}
                </ul>
                <div className={styles.intentActions}>
                  <button
                    type="button"
                    className={styles.linkBtn}
                    data-ecommerce-intent-discard
                    onClick={() => onIntentDiscard?.()}
                  >
                    丢弃
                  </button>
                  <button
                    type="button"
                    className={`${styles.generate} ${styles.intentApply}`}
                    data-ecommerce-intent-apply
                    onClick={applyIntent}
                  >
                    应用到表单
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        <section className={styles.block}>
          <label className={styles.blockTitle} htmlFor="ecommerce-product">
            产品图（必填）
          </label>
          <input
            id="ecommerce-product"
            className={styles.file}
            type="file"
            accept="image/*"
            data-ecommerce-product-input
            onChange={(e) => void onPick(e.target.files?.[0], 'product')}
          />
          <div className={styles.slotRow}>
            {product ? (
              <div className={styles.slot} data-ecommerce-product-preview>
                {product.preview}
              </div>
            ) : (
              <label className={styles.emptySlot} htmlFor="ecommerce-product">
                <span>点这里上传产品图</span>
                <span className={styles.emptyHint}>白底 / 场景图都行，越清楚越好</span>
              </label>
            )}
          </div>
        </section>

        <section className={styles.block}>
          <label className={styles.blockTitle} htmlFor="ecommerce-reference">
            参考图（可选，最多 4 张）
          </label>
          <input
            id="ecommerce-reference"
            className={styles.file}
            type="file"
            accept="image/*"
            multiple
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
              <div key={r.nodeId} className={styles.slot}>
                {r.preview}
              </div>
            ))}
            <label
              className={styles.addSlot}
              htmlFor="ecommerce-reference"
              data-ecommerce-reference-add
            >
              +
            </label>
          </div>
        </section>

        <section className={styles.block}>
          <span className={styles.blockTitle}>用途</span>
          <div className={styles.segments} role="radiogroup" aria-label="用途">
            {ECOMMERCE_USAGES.map((u) => (
              <button
                key={u}
                type="button"
                role="radio"
                aria-checked={usage === u}
                className={usage === u ? `${styles.seg} ${styles.segOn}` : styles.seg}
                data-ecommerce-usage={u}
                onClick={() => setUsage(u)}
              >
                {usageLabel(u)}
              </button>
            ))}
          </div>
        </section>

        <section className={styles.block}>
          <span className={styles.blockTitle}>平台与语言</span>
          <div className={styles.twoCols}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>平台</span>
              <select
                className={styles.select}
                value={platformId}
                data-ecommerce-platform
                onChange={(e) => setPlatformId(e.target.value)}
              >
                <option value="">不指定（通用）</option>
                {platforms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {/*
              出图模型（用户 2026-10-10 #2：「左边的参数栏没有模型相关的参数选择」）。
              渠道**不在这里选** —— 与画布同一条口径：模型定下来，谁提供它由选路决定。
            */}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>模型</span>
              <select
                className={styles.select}
                value={model}
                data-ecommerce-model
                onChange={(e) => onModelChange(e.target.value)}
              >
                <option value="">默认（按渠道解析）</option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>文案语言</span>
              <select
                className={styles.select}
                value={language}
                data-ecommerce-language
                onChange={(e) => setLanguage(e.target.value as EcommerceLanguage)}
              >
                {ECOMMERCE_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {languageLabel(l)}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>张数</span>
              <input
                className={styles.input}
                type="number"
                min={1}
                max={ECOMMERCE_COUNT_MAX}
                value={count}
                data-ecommerce-count
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>比例</span>
              <select
                className={styles.select}
                value={ratio}
                data-ecommerce-ratio
                onChange={(e) => setRatio(e.target.value)}
              >
                {ECOMMERCE_RATIOS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {platform ? (
            <p className={styles.hint} data-ecommerce-platform-hint>
              {platform.countHint}；比例常见 {platform.ratios.join(' / ')}
            </p>
          ) : null}
        </section>

        <section className={styles.block}>
          <label className={styles.blockTitle} htmlFor="ecommerce-note">
            补充要求（可选）
          </label>
          <textarea
            id="ecommerce-note"
            className={styles.textarea}
            value={note}
            maxLength={ECOMMERCE_NOTE_MAX}
            placeholder="例：突出防水材质；模特手持场景；不要出现文字"
            data-ecommerce-note
            onChange={(e) => setNote(e.target.value)}
          />
        </section>

        {/*
          先出一份方案（对账 #423）。

          为什么非要"出图之前"看见：分镜一直在**确认生成之后**才由模型现编 ——
          用户花钱之前根本不知道那 N 张会被写成什么。这份方案是**草稿**：
          看过了就按它出图（不再多花对话额度），改过表单它就当场作废。
        */}
        {canPlanShots ? (
          <section className={styles.block} data-ecommerce-shot-plan-block>
            <span className={styles.blockTitle}>设计方案</span>
            <div className={styles.intentRow}>
              <button
                type="button"
                className={styles.linkBtn}
                data-ecommerce-shot-plan-make
                disabled={planningShots || running}
                onClick={() => void makePlan()}
              >
                {planningShots ? '正在出方案…' : shotPlan ? '重新生成方案' : '先出一份方案'}
              </button>
              <span className={styles.hint}>
                {shotPlan
                  ? `重新生成会再花一次对话额度（用 ${chatTargetLabel}）`
                  : `用 ${chatTargetLabel} 把这几张拍什么写出来，看过再决定要不要出图`}
              </span>
            </div>
            {planError ? (
              <p className={styles.error} role="alert" data-ecommerce-shot-plan-error>
                {planError}
              </p>
            ) : null}
            {planStale ? (
              <p className={styles.hint} data-ecommerce-shot-plan-stale>
                表单改过了，这份方案作废 —— 出图时会重新问一次。
              </p>
            ) : null}
            {activeShotPlan ? (
              <div className={styles.intentCard} data-ecommerce-shot-plan-card>
                <p className={styles.intentLead}>这 {activeShotPlan.length} 张会这样拍：</p>
                <ul className={styles.intentList}>
                  {activeShotPlan.map((shot, i) => (
                    <li
                      key={`${i}-${shot.title}`}
                      className={styles.intentItem}
                      data-ecommerce-shot-plan-row
                    >
                      <span className={styles.intentLabel}>{i + 1}</span>
                      <span className={styles.intentValue}>
                        {shot.title} —— {shot.brief}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className={styles.intentActions}>
                  <button
                    type="button"
                    className={styles.linkBtn}
                    data-ecommerce-shot-plan-discard
                    onClick={() => setShotPlan(null)}
                  >
                    丢掉方案
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

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
          {running ? '生成中…' : '开始生成'}
        </button>

        {/* 这一次的分镜从哪来的（对账 #406）：跑完如实说，回落也如实说是为什么 */}
        {shotPlanNote ? (
          <p className={styles.hint} data-ecommerce-shot-plan>
            {shotPlanNote}
          </p>
        ) : null}
      </aside>

      {/* 右：结果 */}
      <section className={styles.results} data-ecommerce-results>
        <header className={styles.resultsHead}>
          <span className={styles.blockTitle}>结果</span>
          <span className={styles.headTools}>
            {onOpenLongImage ? (
              <button
                type="button"
                className={styles.linkBtn}
                data-ecommerce-longimage-open
                disabled={!results.some((r) => r.status === 'done' && r.imageHash)}
                title="把这一批已完成的图按 1920 宽等比拼成一张详情页长图"
                onClick={onOpenLongImage}
              >
                拼成长图
              </button>
            ) : null}
            <button
              type="button"
              className={styles.linkBtn}
              data-ecommerce-open-canvas
              onClick={onOpenCanvas}
            >
              在画布里打开
            </button>
          </span>
        </header>
        {results.length === 0 ? (
          <p className={styles.empty} data-ecommerce-empty>
            还没有结果。上传产品图、选好参数后点「开始生成」—— 图片会落到这个项目里，
            每一张都能单独下载，也能在画布里继续改。
          </p>
        ) : (
          <div className={styles.grid} data-ecommerce-grid>
            {results.map((r) => (
              <figure
                key={r.nodeId}
                className={styles.cell}
                data-ecommerce-result
                data-ecommerce-result-id={r.nodeId}
                data-status={r.status}
              >
                <div className={styles.cellBody}>
                  {r.preview ?? (
                    <span className={styles.cellState}>
                      {r.status === 'failed' ? '失败' : r.status === 'done' ? '已完成' : '生成中…'}
                    </span>
                  )}
                </div>
                <figcaption className={styles.cellFoot}>
                  {r.status === 'failed' ? (
                    <span className={styles.cellError}>{r.error ?? '失败（没有原因记录）'}</span>
                  ) : null}
                  <span className={styles.cellActions}>
                    {r.onRerun ? (
                      <button
                        type="button"
                        className={styles.linkBtn}
                        data-ecommerce-rerun
                        disabled={r.status === 'running' || r.status === 'pending'}
                        onClick={() => {
                          /** 失败要说话：重跑抛错时把原因摆到表单上方那条错误行（与生成同一条出口） */
                          void (async () => {
                            try {
                              await r.onRerun?.()
                            } catch (err) {
                              setError(err instanceof Error ? err.message : String(err))
                            }
                          })()
                        }}
                      >
                        {r.status === 'running' || r.status === 'pending' ? '生成中…' : '重跑这一张'}
                      </button>
                    ) : null}
                    {r.onReplace ? (
                      <button
                        type="button"
                        className={styles.linkBtn}
                        data-ecommerce-replace
                        disabled={r.status === 'running' || r.status === 'pending'}
                        title="产出的新图直接替换这一格（不会多出一个节点）"
                        onClick={() => {
                          void (async () => {
                            try {
                              await r.onReplace?.()
                            } catch (err) {
                              setError(err instanceof Error ? err.message : String(err))
                            }
                          })()
                        }}
                      >
                        原地换掉
                      </button>
                    ) : null}
                    {r.status !== 'failed' ? (
                      <button
                        type="button"
                        className={styles.linkBtn}
                        disabled={!r.onDownload}
                        data-ecommerce-download
                        onClick={r.onDownload}
                      >
                        下载
                      </button>
                    ) : null}
                    {/*
                      在画布里改这一张（对账 #424）：跳过去之后画布**选中并居中**这个节点。
                      以前只有结果区顶部那个「在画布里打开」—— 它只到项目级，
                      图一多就得自己在一堆节点里找（这正是用户在漫剧那边也提过的同一件事）。
                    */}
                    {r.onFocusInCanvas ? (
                      <button
                        type="button"
                        className={styles.linkBtn}
                        data-ecommerce-focus-canvas
                        onClick={r.onFocusInCanvas}
                      >
                        在画布里改这一张
                      </button>
                    ) : null}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
        {longImage}
      </section>

      {/* 付费确认（D6）：先报"预计 N 张"，确认后才发请求 */}
      {confirming ? (
        <div className={styles.confirm} role="dialog" aria-modal="true" data-ecommerce-confirm>
          <div className={styles.confirmCard}>
            <h2 className={styles.confirmTitle}>确认生成</h2>
            <p className={styles.confirmText}>
              将生成 <b>{count}</b> 张{usageLabel(usage)}，比例 {ratio}
              {platform ? `，面向 ${platform.name}` : ''}。会调用你的渠道，产生真实用量。
            </p>
            {/*
              分镜会怎么来（对账 #406）：这件事必须在**点生成之前**说清楚 ——
              让模型现写分镜是**一次额外的付费调用**，不许悄悄多花。
              条件与页面里"真去调用"的条件是**同一个纯函数**（`shouldExpandShots`），
              两处各写一份迟早对不上（说花了没花 / 花了没说）。
            */}
            {shouldExpandShots({ usage, count, note }) ? (
              <p
                className={styles.hint}
                data-ecommerce-confirm-shots={
                  activeShotPlan ? 'confirmed' : chatTargetLabel ? 'model' : 'script'
                }
              >
                {activeShotPlan
                  ? '这几张的镜头用你刚确认的那份方案 —— 不再多花对话额度。'
                  : chatTargetLabel
                    ? `这几张的镜头会先让 ${chatTargetLabel} 按你的要求展开 —— 这一趟会多花一次对话额度（失败就用默认脚本，不会耽误出图）。`
                    : '没配对话模型：这几张会用默认镜头脚本（每张不同，但不按你写的要求调整）。'}
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
                确认生成 {count} 张
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
