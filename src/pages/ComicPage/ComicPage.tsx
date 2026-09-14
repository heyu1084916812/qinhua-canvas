import { useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { createStore } from '../../state/createStore'
import type { ComicStore } from '../../state/workbenches/comic/store'
import { emptyComicProject, normalizeComicProject } from '../../domain/comic/model/comicProject'
import { ComicStoreProvider } from '../../workbenches/comic/storeContext'
import { ComicExecutionProvider } from '../../workbenches/comic/execution/ComicExecutionProvider'
import { ComicSurface } from '../../workbenches/comic/surface/ComicSurface'
import styles from './ComicPage.module.css'

/**
 * 漫画剧工作台页面容器（架构 §4.7：只接线，不放规则）。
 *
 * 与 CanvasPage 同构：路由参数 projectId 决定打开哪个项目；
 * 用 projectId 作 key 确保切换项目时整棵子树重新挂载（store 重建）。
 *
 * 数据读回（M6-0，M6-2 补归一化）：优先读 `comics` 表（漫画剧创作数据的唯一真源）；
 * 首次进入（表里还没有该项目的记录）时用 projects 行的名称初始化标题。
 * 行一律先过 `normalizeComicProject` 再 hydrate —— 保证上游无论存的是哪个版本的
 * 形状，进 store 的都是当前 `ComicProject`（缺字段补默认，不抛错）。
 * comic 页面不 import 任何 canvas/* —— 由 depcruiser 跨工作台规则强制。
 */
export function ComicPage() {
  const { projectId = 'demo' } = useParams<{ projectId?: string }>()
  return <ComicProject key={projectId} projectId={projectId} />
}

function ComicProject({ projectId }: { projectId: string }) {
  const platform = usePlatform()
  const navigate = useNavigate()
  const location = useLocation()
  const storeRef = useRef<ComicStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = createStore({
      workbench: 'comic',
      platform,
      projectId,
    })
  }
  const store = storeRef.current

  // 读回创作数据：comics 表优先，无记录则按 projects 行的名称建初始项目
  useEffect(() => {
    if (projectId === 'demo') return
    let cancelled = false
    void (async () => {
      await platform.storage.open()
      const saved = await platform.storage.query('comics', { id: projectId })
      if (cancelled) return
      if (saved.length) {
        // 读回迁移（M6-2）：模型升级后旧文档缺字段，归一化补齐默认值再 hydrate
        store.hydrate(normalizeComicProject(saved[0]))
        return
      }
      const projRows = await platform.storage.query('projects', { id: projectId })
      if (cancelled) return
      const title = String((projRows[0] as { name?: unknown } | undefined)?.name ?? '未命名漫画剧')
      store.hydrate(emptyComicProject(projectId, title))
    })()
    return () => {
      cancelled = true
    }
  }, [platform, projectId, store])

  // 卸载时冲刷防抖中的写库（返回首页 / 切项目时不丢最近一次操作）
  useEffect(() => () => store.dispose(), [store])

  // 关闭标签页 / 切到后台前冲刷
  useEffect(() => {
    const onHide = () => void store.flush()
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [store])

  return (
    <ComicStoreProvider store={store}>
      <ComicExecutionProvider>
        <div className={styles.page}>
          <header className={styles.topbar}>
            <button
              type="button"
              className={styles.back}
              data-comic-back
              onClick={() => navigate('/')}
            >
              ← 返回
            </button>
            <span className={styles.brand}>轻画 · 漫画剧</span>
            {/* 漫画的生成同样要渠道；顶栏是工作台里唯一的导航出口（与画布顶栏对称） */}
            <button
              type="button"
              className={styles.back}
              data-comic-settings
              onClick={() => navigate('/settings', { state: { from: location.pathname } })}
            >
              后台设置
            </button>
            <span className={styles.spacer} />
          </header>
          <ComicSurface />
        </div>
      </ComicExecutionProvider>
    </ComicStoreProvider>
  )
}
