import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { usePlatform } from './PlatformProvider'
import {
  createPresetTextStore,
  type PresetTextStore,
} from '../../state/project/presetTextStore'
import type { PromptToolAction } from '../../domain/prompt/presetText'

/**
 * 功能预设词（后台中枢，用户 2026-09-25）。
 *
 * ## 为什么要有 Provider，而不是页面自己读库
 *
 * 预设词的**消费者在画布上**（提示词节点的「优化 / 翻译 / 反推」要按用户改过的指令发请求），
 * 而**编辑入口在后台设置页**。两处隔着路由，若各自读库，就会出现
 * 「后台改完、切回画布仍按旧指令跑」这类**改了没生效**的缺陷 —— 最难查的一类。
 *
 * 所以由应用级 Provider 持有唯一一份，并在写操作后重读：内存态与库态同源。
 * （与 `SkillStoreProvider` 同一条纪律：不维护增量状态，一次全量重读更省心也不会漂移。）
 *
 * ## 覆盖值为空 = 用默认
 *
 * 库里只存**用户改过的**那几项；没改过的动作不占行。执行侧一律经
 * `effectivePresetText(action, overrides)` 取值 —— 缺失回落默认，
 * 于是「用户从没进过后台」与「用户把某项恢复了默认」结果一致。
 */

export interface PresetTextApi {
  /** 用户改过的覆盖值；缺项表示该项仍是默认 */
  overrides: Partial<Record<PromptToolAction, string>>
  loading: boolean
  reload: () => Promise<void>
  /** 保存一项；`content = null` 表示恢复默认（清除覆盖） */
  save: (action: PromptToolAction, content: string | null) => Promise<void>
}

export const PresetTextContext = createContext<PresetTextApi | null>(null)

export function PresetTextProvider({ children }: { children?: ReactNode }) {
  const platform = usePlatform()
  const store: PresetTextStore = useMemo(
    () => createPresetTextStore(platform.storage),
    [platform],
  )
  const [overrides, setOverrides] = useState<Partial<Record<PromptToolAction, string>>>({})
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setOverrides(await store.load())
  }, [store])

  useEffect(() => {
    let alive = true
    void (async () => {
      const loaded = await store.load()
      if (!alive) return
      setOverrides(loaded)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [store])

  const api = useMemo<PresetTextApi>(
    () => ({
      overrides,
      loading,
      reload,
      save: async (action, content) => {
        await store.save(action, content)
        await reload()
      },
    }),
    [overrides, loading, reload, store],
  )

  return <PresetTextContext.Provider value={api}>{children}</PresetTextContext.Provider>
}

export function usePresetText(): PresetTextApi {
  const s = useContext(PresetTextContext)
  if (!s) throw new Error('PresetTextProvider 未挂载')
  return s
}

/**
 * 与 `usePresetText` 相同，但 **Provider 缺席时返回全默认**而不是抛错。
 *
 * 给「预设词只是可选增强」的消费方用：画布的提示词工具、以及大量
 * 不关心预设词的单测 —— 漏挂 Provider 的表现应当是「按出厂默认跑」，
 * 而不是整棵树被一个 throw 带下去（那就成了全屏黑屏）。
 */
export function usePresetTextOptional(): PresetTextApi {
  const s = useContext(PresetTextContext)
  return (
    s ?? {
      overrides: {},
      loading: false,
      reload: async () => {},
      save: async () => {
        throw new Error('PresetTextProvider 未挂载')
      },
    }
  )
}
