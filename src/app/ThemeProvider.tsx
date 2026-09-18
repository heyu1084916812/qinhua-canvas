/**
 * 主题注入（明 / 暗）。
 *
 * ## 为什么必须赶在首屏**之前**落地
 *
 * 只在 React effect 里写 `data-theme` 的话，第一帧必然是亮色（token 的默认值），
 * effect 跑完才翻成深色——暗色用户每次刷新都先被闪一下白。故 `index.html` 里
 * 有一段同步的内联脚本先按 localStorage 打上 `data-theme`，本组件只负责
 * **接管之后的变化**（用户切换、系统偏好变更）。两者共用 ui/theme.ts 的判定口径。
 *
 * ## 为什么用 `<html data-theme>` 而不是给每页套 class
 *
 * token 定义在 `:root`，只有挂在 `<html>` 上才能一次覆盖整棵树；且画布 /
 * 漫画剧是路由级 lazy，逐页套 class 会让「chunk 还没加载完的那几百毫秒」漏在
 * 主题之外。原生 `color-scheme` 也要求写在根元素上才对滚动条生效。
 *
 * ## 存储为什么用 localStorage 而不是 IndexedDB
 *
 * 它不是业务数据，不进 `presets` 表（那个表由 platform 端口管，异步读）：
 * 首屏脚本必须**同步**拿到它，异步存储从原理上做不到不闪。代价是换机不同步，
 * 主题本就是本机偏好，可以接受。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  parseThemeSetting,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemeSetting,
} from '../ui/theme'

export interface ThemeApi {
  /** 用户的设置（三档） */
  setting: ThemeSetting
  /** 实际生效的主题（已把「跟随系统」解析掉） */
  resolved: ResolvedTheme
  /** 系统当前偏好（供 UI 显示「跟随系统（当前深色）」） */
  system: ResolvedTheme
  setSetting: (next: ThemeSetting) => void
}

const ThemeContext = createContext<ThemeApi | null>(null)

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** 读系统偏好；无 matchMedia（SSR / 老浏览器）时按亮色处理 */
function readSystem(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/** 读持久化的设置；读不到 / 禁用存储时回落「跟随系统」 */
function readSetting(): ThemeSetting {
  if (typeof localStorage === 'undefined') return 'system'
  try {
    return parseThemeSetting(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    // 隐私模式等场景下访问 localStorage 会直接抛，回落「跟随系统」而不是让整个应用挂掉
    return 'system'
  }
}

export function ThemeProvider({ children }: { children?: ReactNode }) {
  const [setting, setSettingState] = useState<ThemeSetting>(readSetting)
  const [system, setSystem] = useState<ResolvedTheme>(readSystem)
  const resolved = resolveTheme(setting, system)

  /**
   * 系统偏好可能随时变（用户在系统设置里切深浅）。只有「跟随系统」这一档
   * 需要跟着动——显式选了明 / 暗的用户不该被系统覆盖。
   */
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(DARK_QUERY)
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? 'dark' : 'light')
    // addEventListener 在 Safari < 14 上没有，退回 addListener；两者都缺就只认当前值
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    }
    mq.addListener(onChange)
    return () => mq.removeListener(onChange)
  }, [])

  /** 落到 DOM：实际主题写在根元素上，同时用 data-theme-setting 暴露「用户选了什么」 */
  useEffect(() => {
    if (typeof document === 'undefined') return
    const root = document.documentElement
    root.dataset.theme = resolved
    root.dataset.themeSetting = setting
  }, [resolved, setting])

  const setSetting = useCallback((next: ThemeSetting) => {
    setSettingState(next)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // 存不下不影响本次生效（内存里的 state 已经变了），只是刷新后回到「跟随系统」
    }
  }, [])

  const api = useMemo<ThemeApi>(
    () => ({ setting, resolved, system, setSetting }),
    [setting, resolved, system, setSetting],
  )

  return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeApi {
  const t = useContext(ThemeContext)
  if (!t) throw new Error('ThemeProvider 未挂载')
  return t
}
