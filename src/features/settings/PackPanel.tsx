import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { APP_VERSION } from '../../app/appVersion'
import {
  createPackStore,
  type InstalledPack,
  type PackConflictStrategy,
  type PackPreview,
} from '../../state/project/packStore'
import { packSummary, parsePack, type ExtensionPack } from '../../domain/pack/pack'
import styles from './PackPanel.module.css'

/**
 * 「生成 → 扩展包」面板（对账 #386 阶段一）。
 *
 * 三件事，顺序固定：**先看内容 → 再选冲突策略 → 最后装**。
 * 装完的包列在下面，每一项都能卸 —— 卸载只删这个包装进来的技能与平台规则。
 *
 * 界面上把安全边界写在最上面：阶段一的包**不带代码、不带权限**。
 * 这不是免责声明，是产品现状 —— 带 `permissions` 的包会在解析那一步就被拒收。
 */
const STRATEGIES: { id: PackConflictStrategy; label: string; hint: string }[] = [
  { id: 'skip', label: '跳过', hint: '已经装过的保持不变（你自己改过的正文不会被覆盖）' },
  { id: 'overwrite', label: '覆盖', hint: '用包里的内容替换同名项' },
  { id: 'copy', label: '另存为副本', hint: '两份都留下，新的那份带 .copy 后缀' },
]

export function PackPanel() {
  const platform = usePlatform()
  const store = useMemo(() => createPackStore(platform.storage), [platform])
  const [installed, setInstalled] = useState<InstalledPack[]>([])
  const [pack, setPack] = useState<ExtensionPack | null>(null)
  const [preview, setPreview] = useState<PackPreview | null>(null)
  const [strategy, setStrategy] = useState<PackConflictStrategy>('skip')
  const [errors, setErrors] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const reload = useCallback(async () => {
    setInstalled(await store.listInstalled())
  }, [store])

  useEffect(() => {
    void reload()
  }, [reload])

  /** 选了包或改了策略就重新算一次预览（"装完会变成什么样"必须眼见为实） */
  useEffect(() => {
    if (!pack) {
      setPreview(null)
      return
    }
    let cancelled = false
    void (async () => {
      const next = await store.preview(pack, strategy)
      if (!cancelled) setPreview(next)
    })()
    return () => {
      cancelled = true
    }
  }, [pack, strategy, store])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setStatus('')
    setErrors([])
    setPack(null)
    try {
      const text = await file.text()
      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        setErrors(['这个文件不是合法的 JSON'])
        return
      }
      const result = parsePack(raw, { appVersion: APP_VERSION })
      if (!result.ok || !result.pack) {
        setErrors(result.errors)
        return
      }
      setPack(result.pack)
      setStatus('')
    } catch {
      setErrors(['读不到这个文件（权限或编码问题），换一个再试'])
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const install = async () => {
    if (!pack) return
    const outcome = await store.install(pack, strategy)
    await reload()
    const parts = [`已安装「${pack.displayName}」：${outcome.installedSkills} 个技能`]
    if (outcome.installedPlatforms) parts.push(`${outcome.installedPlatforms} 条平台规则`)
    if (outcome.skipped.length) parts.push(`跳过 ${outcome.skipped.length} 个（已存在）`)
    if (outcome.replaced.length) parts.push(`覆盖 ${outcome.replaced.length} 个`)
    if (outcome.copied.length) parts.push(`另存 ${outcome.copied.length} 个副本`)
    setStatus(parts.join(' · '))
    setPack(null)
  }

  const uninstall = async (id: string) => {
    const done = await store.uninstall(id)
    await reload()
    setStatus(done ? '已卸载（只删了它装进来的内容）' : '这个包不在已装清单里')
  }

  return (
    <div className={styles.panel} data-pack-panel data-settings-panel>
      <section className={styles.block}>
        <h3 className={styles.title}>扩展包</h3>
        <p className={styles.caption}>只安装技能与平台规则，不执行代码。</p>

        <input
          ref={fileRef}
          className={styles.file}
          type="file"
          accept=".json,application/json"
          data-pack-file
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <div className={styles.row}>
          <button
            type="button"
            className={`${styles.btn} ${styles.primary}`}
            data-pack-import
            onClick={() => fileRef.current?.click()}
          >
            导入扩展包…
          </button>
          <span className={styles.hint}>当前版本 {APP_VERSION}</span>
        </div>

        {errors.length > 0 ? (
          <ul className={styles.errors} data-pack-errors>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}

        {pack ? (
          <div className={styles.pending} data-pack-pending>
            <p className={styles.summary} data-pack-summary>
              {packSummary(pack)}
            </p>
            <div className={styles.segRow}>
              <span className={styles.rowLabel}>冲突时</span>
              <div className={styles.segments} role="radiogroup" aria-label="冲突策略">
                {STRATEGIES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="radio"
                    aria-checked={strategy === s.id}
                    title={s.hint}
                    className={strategy === s.id ? `${styles.seg} ${styles.segOn}` : styles.seg}
                    data-pack-strategy={s.id}
                    onClick={() => setStrategy(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            {preview ? (
              <p className={styles.hint} data-pack-preview>
                装完会新增 {preview.adds.length} 个
                {preview.replaces.length ? `、覆盖 ${preview.replaces.length} 个` : ''}
                {preview.skips.length ? `、跳过 ${preview.skips.length} 个` : ''}。
              </p>
            ) : null}
            <div className={styles.row}>
              <button type="button" className={`${styles.btn} ${styles.primary}`} data-pack-install onClick={() => void install()}>
                安装
              </button>
              <button type="button" className={styles.linkBtn} onClick={() => setPack(null)}>
                取消
              </button>
            </div>
          </div>
        ) : null}

        {status ? (
          <p className={styles.status} role="status" data-pack-status>
            {status}
          </p>
        ) : null}
      </section>

      <section className={styles.block}>
        <h3 className={styles.title}>已安装</h3>
        {installed.length === 0 ? (
          <p className={styles.caption} data-pack-empty>
            尚未安装扩展包。
          </p>
        ) : (
          <ul className={styles.list}>
            {installed.map((p) => (
              <li key={p.id} className={styles.item} data-pack-item data-pack-id={p.id}>
                <span className={styles.itemName}>
                  {p.displayName}
                  <span className={styles.itemMeta}>
                    {' '}
                    · v{p.version} · {p.skillIds.length} 个技能
                    {p.platformIds.length ? ` / ${p.platformIds.length} 条规则` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.linkBtn}
                  data-pack-uninstall
                  onClick={() => void uninstall(p.id)}
                >
                  卸载
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
