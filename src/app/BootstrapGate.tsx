import { useEffect, useState, type ReactNode } from 'react'
import { checkIndexedDbAvailable } from './session'
import styles from './BootstrapGate.module.css'

/**
 * 启动门禁（产品文档 §2.4 / §12）：首次进入校验 IndexedDB 可用性，
 * 不可用时渲染可读性提示，阻断后续页面（避免静默写入失败）。
 * - available === null：尚未出结果，直接渲染 children（SSR 冒烟 / 测试不受影响）
 * - available === false：渲染降级提示
 */
export function BootstrapGate({ children }: { children: ReactNode }) {
  const [available, setAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    void checkIndexedDbAvailable().then((ok) => {
      if (!cancelled) setAvailable(ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (available === false) return <DatabaseUnavailable />
  return <>{children}</>
}

function DatabaseUnavailable() {
  return (
    <div className={styles.wrap} role="alert">
      <div className={styles.card}>
        <h1 className={styles.title}>无法使用本地存储</h1>
        <p className={styles.body}>
          本应用依赖浏览器的 IndexedDB 保存项目与画布数据，当前环境不可用
          （可能是浏览器版本过低、隐私模式禁用了站点存储，或磁盘配额已满）。
        </p>
        <p className={styles.hint}>
          请使用 Chrome / Edge 120+ 并允许本站存储，或关闭隐私模式后重试。
        </p>
      </div>
    </div>
  )
}
