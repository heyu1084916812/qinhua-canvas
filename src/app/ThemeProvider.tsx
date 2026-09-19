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
import { parseThemeSetting, THEME_STORAGE_KEY, type ResolvedTheme, type ThemeSetting } from '../ui/theme'

export interface ThemeApi {
  /** 用户的设置（明 / 暗两档） */
  setting: ThemeSetting
  /** 实际生效的主题（两档之后恒等于 `setting`，保留字段是为免调用方到处改） */
  resolved: ResolvedTheme
  setSetting: (next: ThemeSetting) => void
}

const ThemeContext = createContext<ThemeApi | null>(null)

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** 读系统偏好；无 matchMedia（SSR / 老浏览器）时按亮色处理 */
function readSystem(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/**
 * 读持久化的设置。
 *
 * 读不到 / 值非法（含旧版本存下的 `'system'`）时回落**系统当前偏好**：
 * 这既保住了「不能瞎猜」的原意（不知道用户想要什么就看系统），
 * 又满足「只要明 / 暗两档」——落成的是一个具体档位，不会再出现第三档。
 *
 * 依赖 `readSystem`，故必须在它之后定义。
 */
function readSetting(): ThemeSetting {
  if (typeof localStorage === 'undefined') return readSystem()
  try {
    return parseThemeSetting(localStorage.getItem(THEME_STORAGE_KEY)) ?? readSystem()
  } catch {
    // 隐私模式等场景下访问 localStorage 会直接抛，回落系统偏好而不是让整个应用挂掉
    return readSystem()
  }
}

export function ThemeProvider({ children }: { children?: ReactNode }) {
  const [setting, setSettingState] = useState<ThemeSetting>(readSetting)
  /**
   * 两档之后**不再监听系统偏好**：没有任何一档需要「跟着系统动」了。
   * 系统偏好只在**首次读取**（没有已存选择、或旧值非法）时用来定初始档位。
   */
  const resolved: ResolvedTheme = setting

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
      // 存不下不影响本次生效（内存里的 state 已经变了），只是刷新后回到系统偏好
    }
  }, [])

  const api = useMemo<ThemeApi>(
    () => ({ setting, resolved, setSetting }),
    [setting, resolved, setSetting],
  )

  return <ThemeContext.Provider value={api}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeApi {
  const t = useContext(ThemeContext)
  if (!t) throw new Error('ThemeProvider 未挂载')
  return t
}
