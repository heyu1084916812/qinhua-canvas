import { useEffect, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import {
  DEFAULT_HOSTING,
  HOSTING_EXPIRES,
  HOSTING_PROVIDERS,
  HOSTING_ROW_ID,
  hostingConfigOf,
  hostingRowOf,
  type HostingConfig,
  type HostingProviderId,
} from '../../domain/shared/hosting'
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

  const save = async (next: HostingConfig) => {
    setConfig(next)
    setTestedUrl(null)
    setStatus('')
    try {
      await platform.storage.put('presets', hostingRowOf(next))
      setStatus('已保存')
    } catch {
      setStatus('保存失败')
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

  return (
    <div className={styles.page} data-hosting-page>
      <h1 className={styles.title}>素材传输</h1>
      <p className={styles.lead}>
        参考图 / 首尾帧要发给上游。默认**不上传**：素材以 Base64 内联进请求（实测上游认）。
        配了图床则先上传、改用公网直链 —— 请求体更小，链接也能给别处复用。
      </p>

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
                onClick={() => void save({ ...config, provider: p.id as HostingProviderId })}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {active && <p className={styles.hint}>{active.hint}</p>}

        {config.provider !== 'off' && (
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

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            data-hosting-test
            disabled={busy || !loaded}
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

        {testedUrl && (
          <p className={styles.url} data-hosting-url>
            {testedUrl}
          </p>
        )}
      </section>
    </div>
  )
}
