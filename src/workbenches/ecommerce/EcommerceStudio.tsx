import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ECOMMERCE_DEFAULT_COUNT } from '../../domain/ecommerce/plan'
import { ECOMMERCE_PLATFORMS, type EcommercePlatform } from '../../domain/ecommerce/platforms'
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
import styles from './EcommerceStudio.module.css'

/**
 * 电商工作台 A 版（对账 #384）：**固定表单 → 出图**。
 *
 * 与 `workbenches/canvas` 保持零互引：这个组件**只描述界面**，
 * 「上传到哪、怎么生成、结果从哪读」全部由 `pages/EcommercePage` 注入
 * （页面才是装配层，它可以同时认识画布与电商两侧）。直接好处是这个文件
 * 可以在没有画布 store 的情况下被单测 / 陈列室渲染。
 *
 * A 版**明确不做**：agent 对话、风格推荐、长图编辑器（那些属于 #380 专业版）。
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
  /** 下载出口；没有产物时为 undefined */
  onDownload?: () => void
  /**
   * **只重跑这一张**（页面注入；跑着的那张不给按钮）。
   *
   * 为什么值得单开一个入口：一套图里往往只有一两张不满意 —— 整批重来既慢又费额度。
   * 失败的那张尤其需要它（失败原因就写在旁边，重试不必回头改参数）。
   */
  onRerun?: () => Promise<void> | void
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
  /** 点「开始生成」并在二次确认之后调用；页面负责建节点 + 跑引擎 */
  onGenerate: (request: EcommerceRequest) => Promise<void>
  /** 可选出图模型（前端显示名，来自固定清单）；空数组时只显示"默认（按渠道解析）" */
  models?: readonly string[]
  /** 当前选中的模型；空串 = 用默认解析出来的那一个 */
  model: string
  onModelChange: (model: string) => void
  running: boolean
  results: readonly EcommerceResultItem[]
  /** 在画布里打开这个项目（结果已经是画布节点，这是"发送到画布"的落点） */
  onOpenCanvas: () => void
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

  const confirm = async () => {
    setConfirming(false)
    setError('')
    try {
      await onGenerate(buildRequest())
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成失败，原因见下方结果区')
    }
  }

  return (
    <div className={styles.wrap} data-ecommerce-studio>
      {/* 左：参数（用户 2026-10-09：左边传图 + 选参数，右边出图） */}
      <aside className={styles.form} data-ecommerce-form>
        <header className={styles.head}>
          <h1 className={styles.title}>电商出图</h1>
          <p className={styles.sub}>{projectName}</p>
        </header>

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
      </aside>

      {/* 右：结果 */}
      <section className={styles.results} data-ecommerce-results>
        <header className={styles.resultsHead}>
          <span className={styles.blockTitle}>结果</span>
          <button
            type="button"
            className={styles.linkBtn}
            data-ecommerce-open-canvas
            onClick={onOpenCanvas}
          >
            在画布里打开
          </button>
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
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
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
