import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { usePlatform } from './PlatformProvider'
import {
  DEFAULT_CANVAS_STYLE,
  cloneCanvasStyle,
  type CanvasStyle,
} from '../../domain/project/canvasStyle'
import { loadCanvasStyle, saveCanvasStyle } from '../../state/project/canvasStyle'

/**
 * 当前项目的画布外观偏好的**唯一运行时来源**（对账 #379 的 C 步）。
 *
 * ## 为什么需要它，而不是画布页自己读一次
 *
 * 改这份偏好的入口在**全局设置浮层**里，而浮层与画布是两棵子树
 * （浮层挂在 `AppShell`，画布在路由页里）。谁都不认识谁，所以要有第三个地方：
 * 从**路由**认出当前项目、把偏好加载进来的 provider —— 画布与设置面板都订阅它。
 *
 * 判据是 `location.pathname` 里的 `/canvas/:projectId`，而不是"当前选中的项目"：
 * 项目页 / 技能页也会打开设置浮层，那时**没有当前项目**，
 * 面板应当如实显示"打开一个项目后可调"，而不是糊一个上一次的项目上去。
 *
 * ## 为什么立刻改内存、异步落库
 *
 * 设置面板里每点一下色板都等一次 IndexedDB，手感会拖泥带水（与渠道开关那条
 * 「乐观更新」同一口径）。落库失败只影响"下次还记不记得"，
 * 这一次的观感已经生效 —— 所以 `update` 不抛错、也不回滚。
 */

/** 从 `/canvas/<id>` 里取项目 id；不在画布路由上返回 null */
export function projectIdFromPath(pathname: string): string | null {
  const m = /^\/canvas\/([^/?#]+)/.exec(pathname)
  return m?.[1] ? decodeURIComponent(m[1]) : null
}

export interface CanvasStyleApi {
  /** 当前画布路由上的项目 id；不在画布路由 / 打开的是 demo 时为 null */
  projectId: string | null
  style: CanvasStyle
  /** 是否已经把这个项目的偏好读回来（读回来之前不要用它覆盖用户看到的画布） */
  ready: boolean
  /** 改一项：内存当帧生效，异步落库 */
  update: (patch: Partial<CanvasStyle>) => void
  /** 恢复默认（只影响当前项目） */
  reset: () => void
}

const Ctx = createContext<CanvasStyleApi | null>(null)

export function CanvasStyleProvider({ children }: { children?: ReactNode }) {
  const platform = usePlatform()
  const location = useLocation()
  const rawId = projectIdFromPath(location.pathname)
  const projectId = rawId && rawId !== 'demo' ? rawId : null

  const [style, setStyle] = useState<CanvasStyle>(DEFAULT_CANVAS_STYLE)
  const [ready, setReady] = useState(false)
  /** 事件回调里读最新值（setState 的 updater 里做副作用会被 StrictMode 双调） */
  const styleRef = useRef(style)

  const apply = useCallback((next: CanvasStyle) => {
    styleRef.current = next
    setStyle(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!projectId) {
      apply(cloneCanvasStyle(DEFAULT_CANVAS_STYLE))
      setReady(false)
      return
    }
    setReady(false)
    void (async () => {
      await platform.storage.open()
      const next = await loadCanvasStyle(platform.storage, projectId)
      if (cancelled) return
      apply(next)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [platform, projectId, apply])

  const update = useCallback(
    (patch: Partial<CanvasStyle>) => {
      const next = { ...styleRef.current, ...patch }
      apply(next)
      if (projectId) void saveCanvasStyle(platform.storage, projectId, next)
    },
    [platform, projectId, apply],
  )

  const reset = useCallback(() => {
    update({ ...DEFAULT_CANVAS_STYLE })
  }, [update])

  /**
   * 值对象进 context（memo）：`update`/`reset` 引用稳定，
   * 只有 style / projectId / ready 变才让订阅者重渲。
   */
  const value: CanvasStyleApi = {
    projectId,
    style,
    ready,
    update,
    reset,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCanvasStyle(): CanvasStyleApi {
  const api = useContext(Ctx)
  if (!api) throw new Error('CanvasStyleProvider 未挂载')
  return api
}
