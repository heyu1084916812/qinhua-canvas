import { useEffect, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import {
  DEFAULT_HOSTING,
  HOSTING_EXPIRES,
  HOSTING_FIELDS,
  HOSTING_PROVIDERS,
  HOSTING_REGIONS,
  HOSTING_ROW_ID,
  hostingConfigOf,
  hostingNeedsSecret,
  hostingReadiness,
  hostingRowOf,
  hostingSecretRef,
  qiniuEndpointForRegion,
  type HostingConfig,
  type HostingProviderId,
} from '../../domain/shared/hosting'
import { ChoicePicker } from '../../features/shared/choicePicker/ChoicePicker'
import styles from './HostingPage.module.css'

/** 测试上传用的一张 32×32 真 PNG（免去让用户先去挑文件） */
const PROBE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAOUlEQVR42u3PQQ0AAAgDMLZ/aAgcbC6gSTfX0gEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwYwGmvQABlbzXrQAAAABJRU5ErkJggg=='

/**
 * **素材传输（图床）设置页**（用户 2026-10-03：「图床设置页单独设置一个页面出来，
 * 然后给我找到可用的设置上去」）。
 *
 * 为什么单独一页而不是塞进渠道配置：图床与**渠道无关**（同一张图可能要给 Agnes、
 * 也可能要给别家），写进渠道会出现「两条渠道各配一遍同一个图床」。这与技能库
 * 从设置页拆出去是同一个理由：一类配置回答一个问题。
 */
export function HostingPage() {
  const platform = usePlatform()
  const [config, setConfig] = useState<HostingConfig>(DEFAULT_HOSTING)
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState('')
  const [testedUrl, setTestedUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** 密钥只在**凭据层**：这里只记"存过没有"，用来提示用户（绝不把明文放进 state） */
  const [secretSaved, setSecretSaved] = useState(false)
  const [probeResult, setProbeResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [probing, setProbing] = useState(false)

  useEffect(() => {
    let alive = true
    void platform.storage
      .query('presets', { id: HOSTING_ROW_ID })
      .then((rows) => {
        if (!alive) return
        setConfig(hostingConfigOf(rows[0]))
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
    return () => {
      alive = false
    }
  }, [platform])

  /** 换服务时重查一次"这家存过密钥没有"（密钥按服务分开引用，不串用） */
  useEffect(() => {
    let alive = true
    void platform.credentials
      .load(hostingSecretRef(config.provider))
      .then((value) => {
        if (alive) setSecretSaved(!!value)
      })
      .catch(() => {
        if (alive) setSecretSaved(false)
      })
    return () => {
      alive = false
    }
  }, [platform, config.provider])

  const save = async (next: HostingConfig) => {
    setConfig(next)
    setTestedUrl(null)
    setProbeResult(null)
    setStatus('')
    try {
      await platform.storage.put('presets', hostingRowOf(next))
      setStatus('已保存')
    } catch {
      setStatus('保存失败')
    }
  }

  /** 密钥不进 `presets`：单独写进凭据层（桌面端是 OS 加密库） */
  const saveSecret = async (secret: string) => {
    try {
      if (secret.trim() === '') {
        await platform.credentials.remove(hostingSecretRef(config.provider))
        setSecretSaved(false)
        setStatus('已清除密钥')
        return
      }
      await platform.credentials.save(hostingSecretRef(config.provider), secret.trim())
      setSecretSaved(true)
      setStatus('密钥已保存到本机凭据库')
    } catch {
      setStatus('密钥保存失败')
    }
  }

  const runProbe = async () => {
    setProbing(true)
    setProbeResult(null)
    try {
      setProbeResult(await platform.hosting.test())
    } catch (err) {
      setProbeResult({ ok: false, message: `测不了：${String((err as Error)?.message ?? err).slice(0, 120)}` })
    } finally {
      setProbing(false)
    }
  }

  const runTest = async () => {
    setBusy(true)
    setTestedUrl(null)
    setStatus('上传中…')
    try {
      const bytes = Uint8Array.from(atob(PROBE_PNG_B64), (c) => c.charCodeAt(0))
      const out = await platform.hosting.upload({
        blob: new Blob([bytes], { type: 'image/png' }),
        name: 'qinghua-probe.png',
      })
      if (!out) {
        setStatus('当前是「关闭」：不会上传。参考类生成会改用内联 Base64。')
        return
      }
      setTestedUrl(out.url)
      setStatus('上传成功：这条直链可以被上游抓取')
    } catch (err) {
      setStatus(`上传失败：${String((err as Error)?.message ?? err).slice(0, 120)}`)
    } finally {
      setBusy(false)
    }
  }

  const active = HOSTING_PROVIDERS.find((p) => p.id === config.provider)
  /** 这家要填哪些字段 / 还缺什么 —— 都来自 domain，页面不重复判断 */
  const fields = HOSTING_FIELDS[config.provider]
  const readiness = hostingReadiness(config)

  return (
    <div className={styles.page} data-hosting-page>
      <p className={styles.lead}>默认以内联方式发送；配置图床后改用公网直链。</p>

      <section className={styles.card} data-hosting-card>
        <div className={styles.row}>
          <span className={styles.rowLabel}>服务</span>
          <div className={styles.segmented} role="group" aria-label="图床服务">
            {HOSTING_PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={config.provider === p.id ? styles.segOn : styles.segOff}
                data-hosting-provider={p.id}
                aria-pressed={config.provider === p.id}
                disabled={!loaded}
                onClick={() => {
                  const provider = p.id as HostingProviderId
                  const regionOptions = HOSTING_REGIONS[provider]
                  const region = config.region || regionOptions?.[0]?.value
                  void save({
                    ...config,
                    provider,
                    ...(region ? { region } : {}),
                    ...(provider === 'qiniu' && region
                      ? { endpoint: qiniuEndpointForRegion(region) }
                      : {}),
                  })
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {active && <p className={styles.hint}>{active.hint}</p>}

        {/* 「保留时长」只有 tmpfiles 认（其余服务是永久对象，寿命由用户自己的生命周期规则管） */}
        {config.provider === 'tmpfiles' && (
          <div className={styles.row}>
            <span className={styles.rowLabel}>保留时长</span>
            <div className={styles.segmented} role="group" aria-label="保留时长">
              {HOSTING_EXPIRES.map((e) => (
                <button
                  key={e.seconds}
                  type="button"
                  className={config.expireSeconds === e.seconds ? styles.segOn : styles.segOff}
                  data-hosting-expire={e.seconds}
                  aria-pressed={config.expireSeconds === e.seconds}
                  onClick={() => void save({ ...config, expireSeconds: e.seconds })}
                >
                  {e.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/*
          各家的字段（用户 2026-10-06 第 4 条：「其他的可以自己填写」）。
          字段表在 domain（`HOSTING_FIELDS`）—— 页面不为六家各写一遍表单。
          密钥类字段：输入框**不回显**，只显示"存过没有"；值直接写进凭据层。
        */}
        {fields.length > 0 && (
          <div className={styles.fields} data-hosting-fields>
            {fields.map((field) => (
              <label
                className={styles.field}
                key={field.key}
                data-hosting-field={field.key === 'region' ? field.key : undefined}
              >
                <span className={styles.fieldLabel}>
                  {field.label}
                  {field.optional && <span className={styles.fieldOptional}>选填</span>}
                </span>
                {field.key === 'region' && HOSTING_REGIONS[config.provider] ? (
                  <ChoicePicker
                    name={`hosting-${config.provider}-region`}
                    value={config.region ?? ''}
                    ariaLabel={`${field.label}区域`}
                    placeholder="选择区域"
                    options={HOSTING_REGIONS[config.provider]!.map((region) => ({
                      value: region.value,
                      label: region.label,
                    }))}
                    onChange={(region) =>
                      void save({
                        ...config,
                        region,
                        ...(config.provider === 'qiniu'
                          ? { endpoint: qiniuEndpointForRegion(region) }
                          : {}),
                      })
                    }
                  />
                ) : field.secret ? (
                  <input
                    className={styles.input}
                    type="password"
                    autoComplete="off"
                    placeholder={secretSaved ? '已保存（留空即不改动）' : field.placeholder}
                    data-hosting-field={field.key}
                    onBlur={(event) => void saveSecret(event.target.value)}
                  />
                ) : (
                  <input
                    className={styles.input}
                    type="text"
                    spellCheck={false}
                    placeholder={field.placeholder}
                    value={(config[field.key as keyof HostingConfig] as string | undefined) ?? ''}
                    data-hosting-field={field.key}
                    onChange={(event) => void save({ ...config, [field.key]: event.target.value })}
                  />
                )}
                {field.hint && <span className={styles.fieldHint}>{field.hint}</span>}
              </label>
            ))}
          </div>
        )}

        {/*
          「缺什么」明着说（不是把按钮灰掉让用户猜）：就绪校验在 domain，
          这里只是把它的 `missing` 打出来。
        */}
        {config.provider !== 'off' && readiness.missing.length > 0 && (
          <p className={styles.readiness} data-hosting-readiness>
            还缺：{readiness.missing.join('、')}
          </p>
        )}
        {config.provider !== 'off' && hostingNeedsSecret(config.provider) && !secretSaved && readiness.missing.length === 0 && (
          <p className={styles.readiness} data-hosting-readiness>
            还缺：密钥（{config.provider === 'cloudinary' ? 'API Secret' : 'AccessKey Secret'}）
          </p>
        )}

        <div className={styles.actions}>
          {/*
            两个按钮分工不同，`title` 里写清：
            ① 测连通 —— **只读**探测（不上传，不在用户桶里留东西）；
            ② 测试上传 —— 真的传一张 32×32 上去，会占桶里一个对象（tmpfiles 那种匿名图床适合它）。
          */}
          <button
            type="button"
            className={styles.secondary}
            data-hosting-probe
            disabled={probing || !loaded || config.provider === 'off'}
            title="只发一次只读请求：验端点 / 桶 / 云名与凭据格式，不往桶里写东西"
            onClick={() => void runProbe()}
          >
            {probing ? '测试中…' : '测连通性'}
          </button>
          <button
            type="button"
            className={styles.primary}
            data-hosting-test
            disabled={busy || !loaded}
            title="真的上传一张 32×32 的测试图（会在你的桶里留下一个对象）"
            onClick={() => void runTest()}
          >
            {busy ? '上传中…' : '测试上传'}
          </button>
          {status && (
            <span className={styles.status} data-hosting-status>
              {status}
            </span>
          )}
        </div>

        {probeResult && (
          <p
            className={probeResult.ok ? styles.probeOk : styles.probeBad}
            data-hosting-probe-result={probeResult.ok ? 'ok' : 'fail'}
          >
            {probeResult.message}
          </p>
        )}

        {testedUrl && (
          <p className={styles.url} data-hosting-url>
            {testedUrl}
          </p>
        )}
      </section>
    </div>
  )
}
