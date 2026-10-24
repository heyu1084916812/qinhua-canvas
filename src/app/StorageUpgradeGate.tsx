import { useCallback, useEffect, useRef, useState } from 'react'
import { usePlatform } from './providers/PlatformProvider'
import type {
  StorageReplaceResult,
  StorageStartupState,
  StorageUpgradeResult,
  StorageV2Verification,
} from '../platform/ports'
import styles from './StorageUpgradeGate.module.css'

type Phase =
  | 'checking'
  | 'v1-upgrade'
  | 'cleanup'
  | 'missing'
  | 'blocked'
  | 'error'
  | 'hidden'

export function StorageUpgradeGate() {
  const platform = usePlatform()
  const admin = platform.storageAdmin
  const startupPromise = useRef<Promise<StorageStartupState> | null>(null)
  const [phase, setPhase] = useState<Phase>('checking')
  const [state, setState] = useState<StorageStartupState | null>(null)
  const [message, setMessage] = useState('正在检查资源目录…')
  const [detail, setDetail] = useState('')
  const [result, setResult] = useState<
    StorageUpgradeResult | StorageReplaceResult | StorageV2Verification | null
  >(null)
  const [choosing, setChoosing] = useState(false)

  const reloadUi = useCallback(() => {
    setMessage('校验完成，正在载入新存储…')
    window.setTimeout(() => window.location.reload(), 300)
  }, [])

  const runCleanup = useCallback(async () => {
    if (!admin?.finalizeStorageUpgrade) {
      setPhase('hidden')
      return
    }
    setPhase('cleanup')
    setMessage('正在确认 V2 完整性并清理旧 V1…')
    try {
      const verification = await admin.finalizeStorageUpgrade()
      setResult(verification)
      setPhase('hidden')
    } catch (error) {
      setPhase('error')
      setMessage('V2 已可继续使用，但旧 V1 没有自动清理')
      setDetail(String(error))
    }
  }, [admin])

  const runAutoUpgrade = useCallback(async () => {
    if (!admin?.autoUpgradeStorage) {
      setPhase('hidden')
      return
    }
    setPhase('v1-upgrade')
    setMessage('正在自动升级存储结构…')
    setDetail('迁移、媒体拆分、完整哈希校验和引用检查完成后才会切换。')
    try {
      const next = await admin.autoUpgradeStorage()
      setResult(next)
      reloadUi()
    } catch (error) {
      setPhase('error')
      setMessage('自动升级没有完成，V1 已保留')
      setDetail(String(error))
    }
  }, [admin, reloadUi])

  useEffect(() => {
    if (!admin?.startupStorageState) {
      setPhase('hidden')
      return
    }
    let cancelled = false
    startupPromise.current ??= admin.startupStorageState()
    void startupPromise.current
      .then((next) => {
        if (cancelled) return
        setState(next)
        if (next.kind === 'ready') {
          setPhase('hidden')
        } else if (next.kind === 'v1Upgrade') {
          void runAutoUpgrade()
        } else if (next.kind === 'cleanupPending') {
          void runCleanup()
        } else if (next.kind === 'missing') {
          setPhase('missing')
          setMessage('原资源目录不存在，可能已经被手动移动')
          setDetail(next.sourceRoot ?? '')
        } else {
          setPhase('blocked')
          setMessage('存储升级需要处理')
          setDetail(next.reason || '当前资源目录状态无法自动升级')
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setPhase('blocked')
        setMessage('无法检查存储目录')
        setDetail(String(error))
      })
    return () => {
      cancelled = true
    }
  }, [admin, runAutoUpgrade, runCleanup])

  const chooseMovedRoot = async () => {
    if (!admin?.pickDataDir || !admin.inspectRoot || !admin.replaceDataDir) return
    setChoosing(true)
    setDetail('')
    try {
      const picked = await admin.pickDataDir()
      if (!picked) return
      const info = await admin.inspectRoot(picked)
      if (info.kind !== 'v2' || !info.ready) {
        setDetail(info.reason || '选择的目录不是完整 V2 资源根')
        return
      }
      setMessage('正在核对移动后的 V2 数据…')
      const replaced = await admin.replaceDataDir(picked)
      setResult(replaced)
      reloadUi()
    } catch (error) {
      setPhase('error')
      setMessage('移动后的目录无法启用')
      setDetail(String(error))
    } finally {
      setChoosing(false)
    }
  }

  if (phase === 'hidden') return null

  return (
    <div className={styles.scrim} data-storage-upgrade-gate>
      <section className={styles.panel} role="dialog" aria-modal="true" aria-live="polite">
        <div className={styles.mark} aria-hidden>
          {phase === 'v1-upgrade' || phase === 'cleanup' ? <Spinner /> : '!'}
        </div>
        <div className={styles.body}>
          <h2 className={styles.title}>
            {phase === 'missing' ? '定位移动后的资源目录' : '存储升级'}
          </h2>
          <p className={styles.message} data-storage-upgrade-status>
            {message}
          </p>
          {detail && <p className={styles.detail}>{detail}</p>}
          {state?.targetRoot && phase === 'v1-upgrade' && (
            <code className={styles.path}>{state.targetRoot}</code>
          )}
          {result && 'verification' in result && (
            <p className={styles.summary}>
              素材 {result.verification.assetsTotal} / 引用 {result.verification.assetReferences} /
              缩略图 {result.verification.thumbFiles} / 预览图 {result.verification.previewFiles}
            </p>
          )}
        </div>

        <div className={styles.actions}>
          {phase === 'missing' && (
            <button
              type="button"
              className={styles.primary}
              data-storage-recovery-pick
              disabled={choosing}
              onClick={() => void chooseMovedRoot()}
            >
              {choosing ? '正在核对…' : '选择移动后的 data'}
            </button>
          )}
          {phase === 'error' && (
            <>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  if (result) reloadUi()
                  else if (state?.kind === 'v1Upgrade') void runAutoUpgrade()
                  else if (state?.kind === 'missing') setPhase('missing')
                  else void runCleanup()
                }}
              >
                重试
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => setPhase('hidden')}
              >
                暂时关闭
              </button>
            </>
          )}
          {phase === 'blocked' && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => setPhase('hidden')}
            >
              稍后处理
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

function Spinner() {
  return <span className={styles.spinner} />
}
