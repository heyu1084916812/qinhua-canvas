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
import { createSkillStore, type SkillStore } from '../../state/project/skillStore'
import type { Skill } from '../../domain/prompt/skill'

/**
 * 技能库（用户 2026-09-24）。
 *
 * ## 为什么这里比渠道那层多一个「变更订阅」
 *
 * 渠道配置在设置页改完、回画布时通常已经重挂页面，**慢一拍看不出来**。
 * 技能不同：用户很可能在画布上选中技能试一下、回设置页改两个字、
 * 再切回画布 —— 若没有订阅，面板上还是旧内容（改了没生效，最难查的一类）。
 *
 * 所以这里用一个极简的版本号订阅：任何写操作 +1，消费方用
 * `useSkills()` 拿到的那份列表会在版本变化时重建。
 *
 * 不引状态库：技能总量小（软上限 100）、变更低频（人手动改），
 * 一次全量重读比维护增量状态更省心，也不会漂移。
 */

export interface SkillStoreApi {
  skills: Skill[]
  loading: boolean
  reload: () => Promise<void>
  create: SkillStore['create']
  save: SkillStore['save']
  remove: SkillStore['remove']
}

export const SkillStoreContext = createContext<SkillStoreApi | null>(null)

export function SkillStoreProvider({ children }: { children?: ReactNode }) {
  const platform = usePlatform()
  const store = useMemo(() => createSkillStore(platform.storage), [platform])
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const list = await store.loadAll()
    setSkills(list)
  }, [store])

  useEffect(() => {
    let alive = true
    void (async () => {
      const list = await store.loadAll()
      if (!alive) return
      setSkills(list)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [store])

  /** 每次写操作后重读整表：内存态与库态同源，不做本地猜测（与渠道 store 同一条纪律） */
  const api = useMemo<SkillStoreApi>(
    () => ({
      skills,
      loading,
      reload,
      create: async (input) => {
        const created = await store.create(input)
        await reload()
        return created
      },
      save: async (skill) => {
        await store.save(skill)
        await reload()
      },
      remove: async (id) => {
        await store.remove(id)
        await reload()
      },
    }),
    [skills, loading, reload, store],
  )

  return <SkillStoreContext.Provider value={api}>{children}</SkillStoreContext.Provider>
}

export function useSkills(): SkillStoreApi {
  const s = useContext(SkillStoreContext)
  if (!s) throw new Error('SkillStoreProvider 未挂载')
  return s
}

/**
 * 与 `useSkills` 相同的读取，但**Provider 缺席时返回空列表**而不是抛错。
 *
 * 给「技能只是可选增强」的消费方用（如画布执行层：没选技能就完全不走这条路）。
 * 好处有二：
 *  - 那些只关心节点渲染、不关心技能的单测不必为了一个可选依赖补 Provider
 *    （这是本项目吃过一次的坑：给共享组件加一个 context 依赖，
 *     等于给所有渲染它的测试加了前置条件）；
 *  - 真有漏挂 Provider 的路径也只是「技能列表为空」，
 *     而不是整棵树被一个 throw 带下去（那就是全屏黑屏）。
 *
 * 需要「必须挂载」语义的地方仍用 `useSkills`（技能库页自己）。
 */
export function useSkillsOptional(): SkillStoreApi {
  const s = useContext(SkillStoreContext)
  return (
    s ?? {
      skills: [],
      loading: false,
      reload: async () => {},
      create: async () => {
        throw new Error('SkillStoreProvider 未挂载')
      },
      save: async () => {
        throw new Error('SkillStoreProvider 未挂载')
      },
      remove: async () => {
        throw new Error('SkillStoreProvider 未挂载')
      },
    }
  )
}
