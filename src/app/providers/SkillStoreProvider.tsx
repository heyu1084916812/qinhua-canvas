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
import type { BuiltinSkill, SkillEntity, UserSkill } from '../../domain/prompt/skill'

/**
 * 技能库共享状态。
 *
 * `builtinSkills` 与 `userSkills` 分开保存；`skills` 是画布选择器实际使用的
 * 合并列表。这样设置页能看到来源，执行层只关心“有哪些技能可选”。
 */
export interface SkillStoreApi {
  /** 内置 + 用户技能，供画布技能选择器直接消费。 */
  skills: SkillEntity[]
  builtinSkills: BuiltinSkill[]
  userSkills: UserSkill[]
  loading: boolean
  reload: () => Promise<void>
  create: SkillStore['create']
  save: SkillStore['save']
  remove: SkillStore['remove']
  copyBuiltin: SkillStore['copyBuiltin']
  restoreBuiltin: SkillStore['restoreBuiltin']
}

export const SkillStoreContext = createContext<SkillStoreApi | null>(null)

export function SkillStoreProvider({ children }: { children?: ReactNode }) {
  const platform = usePlatform()
  const store = useMemo(() => createSkillStore(platform.storage), [platform])
  const [builtinSkills, setBuiltinSkills] = useState<BuiltinSkill[]>([])
  const [userSkills, setUserSkills] = useState<UserSkill[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const [builtins, users] = await Promise.all([store.loadBuiltin(), store.loadUser()])
    setBuiltinSkills(builtins)
    setUserSkills(users)
  }, [store])

  useEffect(() => {
    let alive = true
    void (async () => {
      const [builtins, users] = await Promise.all([store.loadBuiltin(), store.loadUser()])
      if (!alive) return
      setBuiltinSkills(builtins)
      setUserSkills(users)
      setLoading(false)
    })()
    return () => {
      alive = false
    }
  }, [store])

  const api = useMemo<SkillStoreApi>(
    () => ({
      skills: [...builtinSkills, ...userSkills],
      builtinSkills,
      userSkills,
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
      copyBuiltin: async (builtin) => {
        const copied = await store.copyBuiltin(builtin)
        await reload()
        return copied
      },
      restoreBuiltin: async (builtin) => {
        const restored = await store.restoreBuiltin(builtin)
        await reload()
        return restored
      },
    }),
    [builtinSkills, userSkills, loading, reload, store],
  )

  return <SkillStoreContext.Provider value={api}>{children}</SkillStoreContext.Provider>
}

export function useSkills(): SkillStoreApi {
  const s = useContext(SkillStoreContext)
  if (!s) throw new Error('SkillStoreProvider 未挂载')
  return s
}

/**
 * 与 `useSkills` 相同的读取，但 Provider 缺失时返回空列表而不是抛错。
 *
 * 给“技能只是可选增强”的消费方用；真正依赖技能的技能库页仍用 `useSkills`。
 */
export function useSkillsOptional(): SkillStoreApi {
  const s = useContext(SkillStoreContext)
  return (
    s ?? {
      skills: [],
      builtinSkills: [],
      userSkills: [],
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
      copyBuiltin: async () => {
        throw new Error('SkillStoreProvider 未挂载')
      },
      restoreBuiltin: async () => {
        throw new Error('SkillStoreProvider 未挂载')
      },
    }
  )
}
