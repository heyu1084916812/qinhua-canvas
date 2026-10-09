import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useChannels } from '../../app/providers/ChannelStoreProvider'
import { capabilityOfLogical } from '../../domain/project/modelCatalog'
import { presetModelsOf } from '../../domain/project/modelPresets'
import { RATIO_CHOICES } from '../../domain/canvas/layout/ratioChoices'
import styles from './DefaultParamsPanel.module.css'

/**
 * 「生成 → 默认参数」面板（对账 #386 的 E4）。
 *
 * ## 它改的是哪一份数据
 *
 * **就是画布那条解析链上的配方**（`presets` 表里 `recipe:<渠道 id>` 那一行）——
 * 所以"下一个新建的节点会用什么"与这里显示的是**同一个函数算出来的**
 * （`channels.defaultForNewNode`，与创建节点时调的是它）。
 * 不另开一套"全局默认值"：两套并存必然出现"设置里写 A、节点出来是 B"。
 *
 * ## 与「记住上次参数」的关系
 *
 * - 开关**开**（默认）= 现状：画布上随手改一次参数，以后新节点就继承它；
 * - 开关**关** = 默认值只认这里保存的这一份，随手改动不再带走它。
 *
 * 关掉开关**不影响这里的保存** —— 用户在设置里明确点保存当然要生效，
 * 否则"关掉记忆"就变成"再也改不动默认值"了。
 */
type DefaultCategory = 'generate' | 'chat'

export function DefaultParamsPanel() {
  const channels = useChannels()
  /**
   * 开关必须**订阅**store：只读 `channels.getState()` 的话，点一下虽然写了库，
   * 组件不重渲 ⇒ 开关弹回原样（实测：uncheck 报"点了没变"）。
   */
  const recipeMemory = useSyncExternalStore(
    channels.subscribe,
    () => channels.getState().recipeMemory,
    () => true,
  )
  const [category, setCategory] = useState<DefaultCategory>('generate')
  const [resolved, setResolved] = useState<{
    channelId: string
    model: string
    params: Record<string, unknown>
  } | null>(null)
  const [model, setModel] = useState('')
  const [ratio, setRatio] = useState('')
  const [quality, setQuality] = useState('')
  const [count, setCount] = useState(1)
  const [busy, setBusy] = useState(true)
  const [status, setStatus] = useState('')

  const options = useMemo(
    () =>
      category === 'chat'
        ? presetModelsOf('chat')
        : [...presetModelsOf('image'), ...presetModelsOf('video')],
    [category],
  )

  /** 读"新节点会用什么" —— 与创建节点同一条解析链 */
  const reload = useCallback(async () => {
    setBusy(true)
    setStatus('')
    const next = await channels.defaultForNewNode({}, category === 'chat' ? 'chat' : undefined)
    setResolved(next)
    setModel(next?.model ?? '')
    setRatio(typeof next?.params.ratio === 'string' ? next.params.ratio : '')
    setQuality(typeof next?.params.quality === 'string' ? next.params.quality : '')
    setCount(typeof next?.params.count === 'number' ? Math.max(1, next.params.count) : 1)
    setBusy(false)
  }, [channels, category])

  useEffect(() => {
    void reload()
  }, [reload])

  /** 模型能力表：比例 / 画质 / 张数上限都按它来（与画布面板同源） */
  const cap = useMemo(
    () =>
      model
        ? capabilityOfLogical(channels.getState().channels, model, resolved?.channelId)
        : undefined,
    [channels, model, resolved?.channelId],
  )
  const ratios = cap?.aspectRatios?.length
    ? cap.aspectRatios
    : RATIO_CHOICES.map((c) => c.value).filter((v) => v !== '')
  const qualities = cap?.qualities ?? []
  const maxCount = cap?.maxCount ?? 4

  const channelName =
    channels.getState().channels.find((c) => c.id === resolved?.channelId)?.name ?? '未指定'

  const save = async () => {
    if (!resolved?.channelId || !model) {
      setStatus('还没有可用的渠道或模型 —— 先去「渠道配置」配一条、勾上模型')
      return
    }
    const params: Record<string, unknown> = { ...resolved.params }
    if (category === 'chat') {
      /* 对话模型没有比例 / 画质 / 张数这几档，别把生成参数塞进对话那条默认里 */
      await channels.setDefaultRecipe(resolved.channelId, model, params)
      setStatus('已保存：以后新建的对话节点默认用这个模型')
      return
    }
    const picked = options.find((m) => m.id === model)
    if (picked?.category === 'image' || picked?.category === 'video') params.mode = picked.category
    if (ratio) params.ratio = ratio
    if (quality) params.quality = quality
    params.count = count
    await channels.setDefaultRecipe(resolved.channelId, model, params)
    setStatus('已保存：下一个新建的生成节点会用这套')
  }

  return (
    <div className={styles.panel} data-defaults-panel>
      <section className={styles.block}>
        <h3 className={styles.title}>默认参数</h3>
        <p className={styles.caption}>
          这里保存的是<b>下一个新建节点</b>的默认值（与画布新建时走同一条解析链）。
          参数存在本机、按渠道各记一份。
        </p>

        <div className={styles.row}>
          <span className={styles.rowLabel}>类别</span>
          <div className={styles.segments} role="radiogroup" aria-label="默认参数类别">
            {(
              [
                ['generate', '生成（图片 / 视频）'],
                ['chat', '对话'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={category === id}
                className={category === id ? `${styles.seg} ${styles.segOn}` : styles.seg}
                data-defaults-category={id}
                onClick={() => setCategory(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <p className={styles.current} data-defaults-current>
          当前默认：{channelName} · {model || '（还没有可用模型）'}
          {category === 'generate' && model
            ? ` · ${ratio || '未设比例'} · ${quality || '未设画质'} · ${count} 张`
            : ''}
        </p>

        <div className={styles.grid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>默认模型</span>
            <select
              className={styles.select}
              value={model}
              disabled={busy || options.length === 0}
              data-defaults-model
              onChange={(e) => {
                const next = e.target.value
                setModel(next)
                setStatus('')
                /* 换模型时把比例/画质换成新模型的第一档，避免留一个它不支持的档位 */
                const nextCap = capabilityOfLogical(
                  channels.getState().channels,
                  next,
                  resolved?.channelId,
                )
                setRatio(nextCap?.aspectRatios?.[0] ?? '')
                setQuality(nextCap?.qualities?.[0] ?? '')
                setCount(1)
              }}
            >
              {options.length === 0 ? <option value="">（这个类别还没有模型）</option> : null}
              {options.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
          </label>

          {category === 'generate' ? (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>默认比例</span>
                <select
                  className={styles.select}
                  value={ratio}
                  data-defaults-ratio
                  onChange={(e) => setRatio(e.target.value)}
                >
                  <option value="">不指定</option>
                  {ratios.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>默认画质</span>
                <select
                  className={styles.select}
                  value={quality}
                  disabled={qualities.length === 0}
                  data-defaults-quality
                  onChange={(e) => setQuality(e.target.value)}
                >
                  {qualities.length === 0 ? <option value="">模型未声明</option> : null}
                  {qualities.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>默认张数</span>
                <input
                  className={styles.input}
                  type="number"
                  min={1}
                  max={maxCount}
                  value={count}
                  data-defaults-count
                  onChange={(e) =>
                    setCount(Math.min(maxCount, Math.max(1, Math.floor(Number(e.target.value) || 1))))
                  }
                />
              </label>
            </>
          ) : null}
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.save}
            disabled={busy || !model}
            data-defaults-save
            onClick={() => void save()}
          >
            保存为默认
          </button>
          {status ? (
            <span className={styles.status} role="status" data-defaults-status>
              {status}
            </span>
          ) : null}
        </div>
      </section>

      <section className={styles.block}>
        <h4 className={styles.blockTitle}>记住上次参数</h4>
        <p className={styles.caption}>
          开着的时候，你在画布上改一次参数，之后新建的节点会继承它；
          关掉之后默认值只认上面保存的这一份，随手改动不再带走它。
        </p>
        <label className={styles.switchRow}>
          <span className={styles.rowLabel}>记住上次参数</span>
          <span className={styles.switchBox}>
            <input
              type="checkbox"
              className={styles.switchInput}
              checked={recipeMemory}
              data-defaults-memory
              onChange={(e) => void channels.setRecipeMemory(e.target.checked)}
            />
            <span className={styles.track} aria-hidden="true" />
          </span>
        </label>
      </section>
    </div>
  )
}
