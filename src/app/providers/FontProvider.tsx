import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { usePlatform } from './PlatformProvider'
import { createFontStore, type FontStore } from '../../state/project/fontStore'
import {
  accentTokens,
  DEFAULT_APPEARANCE,
  letterSpacingValue,
  readAppearance,
  uiScaleFactor,
  writeAppearance,
  type AppearancePrefs,
  type AccentId,
  type LetterSpacing,
  type MotionPref,
  type UiScale,
} from '../../domain/ui/appearance'
import {
  fontFaceRule,
  fontStackFor,
  type FontChoice,
  type UserFont,
} from '../../domain/ui/fonts'
import { useTheme } from '../ThemeProvider'

/**
 * 自定义字体 + 界面外观的运行时（用户 2026-10-09）。
 *
 * ## 它做三件事
 *
 * 1. **把字体注册进浏览器**：读字节 → `URL.createObjectURL` → `new FontFace()` →
 *    `document.fonts.add()`，并把 `@font-face` 规则注入 `document.head`；
 * 2. **把选中的字族写进 `--font-sans`**：界面全局字体（`ui/base.css`）读的就是它；
 * 3. **应用界面字号与字距**：改 `--fs-*` 与 `--ls-body` 两个变量。
 *
 * ## 三条不能违反的边界
 *
 * - **不碰生成参数**：只改 CSS 变量，不写任何节点数据；
 * - **组件 CSS 一行不改**：组件全都通过令牌取值，所以这里改变量就够了；
 * - **字体不出本机**：字节从本地库读、blob 只在内存里，卸载时统一释放。
 *
 * ## 为什么字号用"基准 × 系数"而不是读当前值
 *
 * 读当前计算值会**逐次累积**（改三次字号就偏了一大截）。这里维护
 * 「上一次用的系数」，每次用 `当前值 ÷ 上次系数 × 新系数` 反推基准，
 * 因此来回切换永远回到同一个值（与令牌里的设计值一致）。
 */

/** 参与缩放的令牌：与 `ui/tokens.css` 的 `--fs-*` 一一对应 */
const SCALED_TOKENS = [
  '--fs-body',
  '--fs-nav',
  '--fs-page-title',
  '--fs-title',
  '--fs-label',
  '--fs-panel-title',
  '--fs-chip',
] as const

const FONT_STYLE_ID = 'qh-user-fonts'

export interface FontApi {
  /** 已导入的自定义字体（元数据） */
  fonts: UserFont[]
  loading: boolean
  /** 当前生效的界面偏好 */
  appearance: AppearancePrefs
  addFont: (file: { name: string; size: number; bytes: ArrayBuffer }) => Promise<
    { ok: true } | { ok: false; reason: string }
  >
  removeFont: (id: string) => Promise<void>
  renameFont: (id: string, name: string) => Promise<void>
  /** 选一个界面字族；字体不存在时调用方应当回落系统（这里也会兜底） */
  chooseFont: (choice: FontChoice) => void
  setScale: (scale: UiScale) => void
  setLetterSpacing: (value: LetterSpacing) => void
  /** 强调色档位（#379 剩余项） */
  setAccent: (accent: AccentId) => void
  /** 减少动效（时长令牌归零，状态变化仍保留） */
  setMotion: (motion: MotionPref) => void
  /** 显示 / 隐藏画布小地图 */
  setShowMinimap: (show: boolean) => void
  /** 恢复默认外观（不动已导入的字体文件） */
  reset: () => void
}

const FontContext = createContext<FontApi | null>(null)

export function FontProvider({ children }: { children?: ReactNode }) {
  const platform = usePlatform()
  /** 强调色要按**当前主题**取那一套值 —— 所以本 Provider 必须挂在 ThemeProvider 之内 */
  const { resolved: theme } = useTheme()
  const store: FontStore = useMemo(() => createFontStore(platform.storage), [platform])

  const [fonts, setFonts] = useState<UserFont[]>([])
  const [loading, setLoading] = useState(true)
  const [appearance, setAppearance] = useState<AppearancePrefs>(() => readAppearance())

  /** 上一次应用的缩放系数（用于反推基准字号，见文件头注释） */
  const lastFactor = useRef(1)
  /** 已创建的 blob URL，按字体 id 索引；替换或卸载时要 revoke */
  const blobUrls = useRef(new Map<string, string>())

  const reload = useCallback(async () => setFonts(await store.list()), [store])

  useEffect(() => {
    let alive = true
    void (async () => {
      const list = await store.list()
      if (!alive) return
      setFonts(list)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [store])

  /**
   * 字体列表变化 → 重新注册。
   *
   * 每次先**清掉旧的**（规则 + blob），再按新列表注册：
   * 因为"改了什么"很难精确 diff，而字体数量上限是 20，全量重注册代价可忽略。
   */
  useEffect(() => {
    const head = document.head
    let style = document.getElementById(FONT_STYLE_ID) as HTMLStyleElement | null
    if (!style) {
      style = document.createElement('style')
      style.id = FONT_STYLE_ID
      head.appendChild(style)
    }

    for (const url of blobUrls.current.values()) URL.revokeObjectURL(url)
    blobUrls.current.clear()
    const rules: string[] = []
    let cancelled = false

    void (async () => {
      for (const font of fonts) {
        const buffer = await store.readBytes(font.id)
        if (cancelled || !buffer) continue
        const url = URL.createObjectURL(new Blob([buffer]))
        blobUrls.current.set(font.id, url)
        rules.push(fontFaceRule(font, url))
        try {
          const face = new FontFace(font.family, buffer)
          await face.load()
          if (cancelled) continue
          document.fonts.add(face)
        } catch {
          // 字体坏掉就只当它不存在：界面回落系统栈，不阻断启动
        }
      }
      if (!cancelled) style.textContent = rules.join('\n')
    })()

    return () => {
      cancelled = true
      style.textContent = ''
    }
  }, [fonts, store])

  /** 卸载时释放所有 blob */
  useEffect(() => {
    const urls = blobUrls.current
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
    }
  }, [])

  /** 应用偏好 → 覆盖 `:root` 上的令牌（组件 CSS 不认识这些设置） */
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--font-sans', fontStackFor(appearance.font, fonts))

    const factor = uiScaleFactor(appearance.scale)
    const previous = lastFactor.current
    const computed = getComputedStyle(root)
    // 先把当前值全部读出来，再写回去 —— 边写边读会让同一个元素上的读取看到中间态
    const currents = SCALED_TOKENS.map((token) => parseFloat(computed.getPropertyValue(token)))
    SCALED_TOKENS.forEach((token, index) => {
      const current = currents[index]
      if (!Number.isFinite(current) || current <= 0) return
      const base = current / previous
      root.style.setProperty(token, `${Math.round(base * factor * 100) / 100}px`)
    })
    lastFactor.current = factor

    root.style.setProperty('--ls-body', letterSpacingValue(appearance.letterSpacing))
    root.dataset.uiScale = appearance.scale

    /*
     * 强调色：内联样式写在 :root 上 ⇒ 优先于 tokens.css 里的主题块；
     * 切换主题时这个 effect 会因为 `theme` 变化重跑、换成另一套值。
     */
    const accent = accentTokens(appearance.accent, theme)
    root.style.setProperty('--accent', accent.accent)
    root.style.setProperty('--accent-text', accent.text)
    /* 减少动效：只翻一个属性，具体把哪些时长归零由 tokens.css 决定 */
    root.dataset.motion = appearance.motion
  }, [appearance, fonts, theme])

  const persist = useCallback((next: AppearancePrefs) => {
    setAppearance(next)
    writeAppearance(next)
  }, [])

  const api = useMemo<FontApi>(
    () => ({
      fonts,
      loading,
      appearance,
      addFont: async (file) => {
        const result = await store.add(file)
        if (!result.ok) return result
        await reload()
        // 导入即启用：用户点"导入字体"就是想看到它生效
        persist({ ...appearance, font: { kind: 'custom', fontId: result.font.id } })
        return { ok: true }
      },
      removeFont: async (id) => {
        await store.remove(id)
        await reload()
        // 删掉的正是当前选中的那个 → 回落系统字体，别留一个指不到的引用
        if (appearance.font.kind === 'custom' && appearance.font.fontId === id) {
          persist({ ...appearance, font: { kind: 'system' } })
        }
      },
      renameFont: async (id, name) => {
        await store.rename(id, name)
        await reload()
      },
      chooseFont: (choice) => persist({ ...appearance, font: choice }),
      setScale: (scale) => persist({ ...appearance, scale }),
      setLetterSpacing: (letterSpacing) => persist({ ...appearance, letterSpacing }),
      setAccent: (accent) => persist({ ...appearance, accent }),
      setMotion: (motion) => persist({ ...appearance, motion }),
      setShowMinimap: (showMinimap) => persist({ ...appearance, showMinimap }),
      reset: () => persist({ ...DEFAULT_APPEARANCE }),
    }),
    [appearance, fonts, loading, persist, reload, store],
  )

  return <FontContext.Provider value={api}>{children}</FontContext.Provider>
}

export function useFonts(): FontApi {
  const api = useContext(FontContext)
  if (!api) throw new Error('FontProvider 未挂载')
  return api
}
