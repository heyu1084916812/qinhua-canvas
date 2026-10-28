/**
 * 生成配方的读写（用户 2026-09-17 提，2026-09-18 收口为**按渠道一份**）。
 *
 * 只做两件事：把配方存进 `presets` 表、按渠道读回来。
 * 「什么时候记」「失效了怎么兜底」都在 domain/project/generationPreset，
 * 这里不重复那份规则——它只是那个纯函数的存储适配器。
 *
 * 键为什么是 `channelId` 而不是 `projectId`：见 generationPreset 的模块注释——
 * 本项目统一走渠道，参考项目按执行模式分桶的那一层在这里天然等价于渠道这一层。
 */
import type { StoragePort } from '../../platform/ports'
import {
  DEFAULT_AGENT_DELIVERY_MODE,
  isAgentDeliveryMode,
  type AgentDeliveryMode,
} from '../../domain/agent/delivery'
import {
  isRecipeRowId,
  NO_RECIPE,
  presetRowId,
  recipeFromRow,
  recipeToRow,
  type GenerationRecipe,
} from '../../domain/project/generationPreset'
import { ROUTE_STRATEGIES, type RouteStrategy } from '../../domain/project/modelRouting'
import type { PresetModel } from '../../domain/project/modelPresets'

/**
 * 全局选路策略的保留行 id。
 *
 * 策略与生成配方同住 `presets` 表（用户 2026-09-29 第 12 轮）：两者都是
 * 「一行一个 UI 偏好」，再为它单开一张表只会多一处要同步的存储。
 * 前缀 `routing:` 与配方的 `recipe:` 分开，读回时各自只认自己那一类行。
 */
const ROUTE_STRATEGY_ROW_ID = 'routing:strategy'

/**
 * Agent 默认模型的保留行 id（设计文档 §8）。
 *
 * 它是**UI 偏好**（新建会话时用哪个模型），所以按既有口径住 `presets`；
 * 而会话历史是业务数据、会一直增长，住单独一张 `agentSessions`（§12）。
 * 两者不要混为一谈 —— 混了就会出现「聊得越多，偏好表越大」。
 */
const AGENT_DEFAULT_ROW_ID = 'agent:default'
const AGENT_DEFAULT_SKILL_ROW_ID = 'agent:skill'
const AGENT_DELIVERY_ROW_ID = 'agent:delivery'

/**
 * **技能收藏**的保留行 id（用户 2026-10-03：对话窗的技能菜单要按参考产品分成
 * 「通用 / 收藏 / 我的」）。
 *
 * 为什么收藏不放技能自己那一行：内置技能是**只读**的（随包同步，改了会被覆盖回去），
 * 用户技能删了也不该把「收藏过」这件事一起删掉。收藏是**用户与技能的关系**，
 * 和「素材库收藏」一样，单独记一份 id 列表最省事。
 *
 * 与前面两项同理：它是 UI 偏好，住 `presets`。读全量配方那支（`loadAll`）**只认
 * `recipe:` 前缀**，所以这行不会被误当成配方（这条曾经真出过事，见那一处的注释）。
 */
const SKILL_FAVORITES_ROW_ID = 'skill:favorites'

/**
 * 「记住上次参数」开关的保留行 id（对账 #386 的 E4）。
 *
 * 与配方同表：它管的就是「配方要不要跟着面板改动走」。
 * 默认**开**（开 = 现状：改了参数就记住），关掉之后面板改动不再改默认值 ——
 * 这正是"我要一套固定默认，别被随手一改带走"的场景。
 */
const RECIPE_MEMORY_ROW_ID = 'ui:recipeMemory'
const CUSTOM_MODELS_ROW_ID = 'models:custom'
const UNCOMMON_MODELS_ROW_ID = 'models:uncommon'

export interface AgentDefaultModel {
  channelId: string
  model: string
}

/** 未知 / 缺字段 / 读失败时回落 `priority`（手工排的优先度，行为最可预测） */
function routeStrategyFromRow(row: unknown): RouteStrategy {
  if (!row || typeof row !== 'object') return 'priority'
  const value = (row as Record<string, unknown>).strategy
  return ROUTE_STRATEGIES.some((s) => s.value === value) ? (value as RouteStrategy) : 'priority'
}

export interface PresetStore {
  /** 读取该渠道的配方；没有 / 数据不可信时返回空配方 */
  load(channelId: string): Promise<GenerationRecipe>
  /** 写入该渠道的配方 */
  save(recipe: GenerationRecipe): Promise<void>
  /** 「记住上次参数」开关（缺行 / 脏值都当**开** —— 默认与现状一致） */
  loadRecipeMemory(): Promise<boolean>
  saveRecipeMemory(enabled: boolean): Promise<void>
  /** 一次读回全部配方，供面板兜底时同步查表（避免逐个 await） */
  loadAll(): Promise<Map<string, GenerationRecipe>>
  /** 读取全局选路策略；没有 / 数据不可信时回落 `priority` */
  loadRoutingStrategy(): Promise<RouteStrategy>
  /** 写入全局选路策略 */
  saveRoutingStrategy(strategy: RouteStrategy): Promise<void>
  /** 读 Agent 默认模型；没设过返回 null（由界面回落「第一个可用」） */
  loadAgentDefault(): Promise<AgentDefaultModel | null>
  /** 写 Agent 默认模型。**只影响之后新建的会话**，不回头改已有会话（§8） */
  saveAgentDefault(value: AgentDefaultModel): Promise<void>
  /** 读 Agent 默认技能（单技能，技能库「添加到 Agent」写入） */
  loadAgentDefaultSkill(): Promise<string | null>
  /** 写 Agent 默认技能；空值表示不设置默认技能 */
  saveAgentDefaultSkill(skillId: string | null): Promise<void>
  /** Agent 运行中发送偏好；缺省必须是“引导”。 */
  loadAgentDeliveryMode(): Promise<AgentDeliveryMode>
  /** 写入 Agent 运行中发送偏好。 */
  saveAgentDeliveryMode(mode: AgentDeliveryMode): Promise<void>
  /** 读技能收藏（技能 id 列表）；没收藏过返回空数组 */
  loadSkillFavorites(): Promise<string[]>
  /** 写技能收藏（整份覆盖） */
  saveSkillFavorites(ids: readonly string[]): Promise<void>
  loadCustomModels(): Promise<PresetModel[]>
  saveCustomModels(models: readonly PresetModel[]): Promise<void>
  /** 前端模型里标记为“不常用”的逻辑名；画布默认不消费这些模型。 */
  loadUncommonModels(): Promise<string[]>
  saveUncommonModels(names: readonly string[]): Promise<void>
}

export function createPresetStore(storage: StoragePort): PresetStore {
  return {
    async load(channelId) {
      // 表可能还不存在（老库未升级）；读失败一律当「没配方」，不阻塞建节点
      try {
        const rows = await storage.query('presets', { id: presetRowId(channelId) })
        return recipeFromRow(rows[0])
      } catch {
        return NO_RECIPE
      }
    },
    async save(recipe) {
      try {
        await storage.put('presets', recipeToRow(recipe) as never)
      } catch {
        // 偏好写不进去不该打断生成流程：最坏情况只是下次还得手选
      }
    },
    async loadRecipeMemory() {
      try {
        const rows = await storage.query('presets', { id: RECIPE_MEMORY_ROW_ID })
        const raw = (rows[0] as { enabled?: unknown } | undefined)?.enabled
        /* 只有**明确的 false** 才算关；缺行 / 脏值一律当开（与"现状就是记住"一致） */
        return raw !== false
      } catch {
        return true
      }
    },
    async saveRecipeMemory(enabled) {
      try {
        await storage.put('presets', { id: RECIPE_MEMORY_ROW_ID, enabled } as never)
      } catch {
        /* 同上：写不进去只影响下次启动的默认值 */
      }
    },
    async loadAll() {
      const out = new Map<string, GenerationRecipe>()
      try {
        const rows = await storage.query('presets', {})
        for (const row of rows) {
          /**
           * ⚠️ **只认 `recipe:` 前缀的行**。
           *
           * 同表还住着 `routing:strategy` 与 `agent:default`，而后者恰好也带
           * `channelId` + `model` —— 不挡的话它会被当成一条生成配方读进来，
           * 于是用户点完「设为默认模型」，画布新建的**生成节点**就带上了那个
           * 对话模型，点生成静默失败（2026-10-02 冒烟 G95 实测：出图那一步
           * 报「没有渠道提供模型「Agnes 2.5 Pro」」）。
           */
          if (!isRecipeRowId((row as { id?: unknown }).id)) continue
          const recipe = recipeFromRow(row)
          if (recipe.channelId) out.set(recipe.channelId, recipe)
        }
      } catch {
        // 同上：读不到就退化为「谁都没记过」，由解析链兜底
      }
      return out
    },
    async loadRoutingStrategy() {
      try {
        const rows = await storage.query('presets', { id: ROUTE_STRATEGY_ROW_ID })
        return routeStrategyFromRow(rows[0])
      } catch {
        // 表可能还不存在（老库未升级）：读不到就按缺省策略
        return 'priority'
      }
    },
    async saveRoutingStrategy(strategy) {
      try {
        await storage.put('presets', { id: ROUTE_STRATEGY_ROW_ID, strategy } as never)
      } catch {
        // 偏好写不进去不该打断使用：最坏情况只是下次仍按缺省策略
      }
    },
    async loadAgentDefault() {
      try {
        const rows = await storage.query('presets', { id: AGENT_DEFAULT_ROW_ID })
        const row = rows[0] as { channelId?: unknown; model?: unknown } | undefined
        if (!row || typeof row.channelId !== 'string' || typeof row.model !== 'string') return null
        if (!row.channelId || !row.model) return null
        return { channelId: row.channelId, model: row.model }
      } catch {
        // 表可能还不存在（老库未升级）：当作没设过
        return null
      }
    },
    async saveAgentDefault(value) {
      try {
        await storage.put('presets', { id: AGENT_DEFAULT_ROW_ID, ...value } as never)
      } catch {
        // 偏好写不进去不该打断对话：最坏情况只是下次还得重选
      }
    },
    async loadAgentDefaultSkill() {
      try {
        const rows = await storage.query('presets', { id: AGENT_DEFAULT_SKILL_ROW_ID })
        const row = rows[0] as { skillId?: unknown } | undefined
        return typeof row?.skillId === 'string' && row.skillId ? row.skillId : null
      } catch {
        return null
      }
    },
    async saveAgentDefaultSkill(skillId) {
      try {
        await storage.put(
          'presets',
          { id: AGENT_DEFAULT_SKILL_ROW_ID, skillId: skillId || null } as never,
        )
      } catch {
        // 偏好写不进去不该打断使用；最坏情况只是下次仍需手选
      }
    },
    async loadAgentDeliveryMode() {
      try {
        const rows = await storage.query('presets', { id: AGENT_DELIVERY_ROW_ID })
        const mode = (rows[0] as { mode?: unknown } | undefined)?.mode
        return isAgentDeliveryMode(mode) ? mode : DEFAULT_AGENT_DELIVERY_MODE
      } catch {
        return DEFAULT_AGENT_DELIVERY_MODE
      }
    },
    async saveAgentDeliveryMode(mode) {
      try {
        await storage.put(
          'presets',
          { id: AGENT_DELIVERY_ROW_ID, mode } as never,
        )
      } catch {
        // 偏好写不进去不该打断对话；当前会话仍按内存里的选择生效
      }
    },
    async loadSkillFavorites() {
      try {
        const rows = await storage.query('presets', { id: SKILL_FAVORITES_ROW_ID })
        const row = rows[0] as { skillIds?: unknown } | undefined
        if (!row || !Array.isArray(row.skillIds)) return []
        return row.skillIds.filter((x): x is string => typeof x === 'string' && x !== '')
      } catch {
        // 表可能还不存在（老库未升级）：当作没收藏过
        return []
      }
    },
    async saveSkillFavorites(ids) {
      try {
        const clean = [...new Set(ids.filter((x) => typeof x === 'string' && x !== ''))]
        await storage.put('presets', { id: SKILL_FAVORITES_ROW_ID, skillIds: clean } as never)
      } catch {
        // 同上：收藏写不进去不该打断使用
      }
    },
    async loadCustomModels() {
      try {
        const rows = await storage.query('presets', { id: CUSTOM_MODELS_ROW_ID })
        const raw = (rows[0] as { models?: unknown } | undefined)?.models
        if (!Array.isArray(raw)) return []
        const categories = new Set(['image', 'chat', 'video', 'audio'])
        return raw.filter((item): item is PresetModel => {
          if (!item || typeof item !== 'object') return false
          const row = item as Record<string, unknown>
          return (
            typeof row.id === 'string' &&
            row.id.trim() !== '' &&
            typeof row.vendor === 'string' &&
            typeof row.category === 'string' &&
            categories.has(row.category)
          )
        })
      } catch {
        return []
      }
    },
    async saveCustomModels(models) {
      try {
        const clean = models.filter(
          (model) => model.id.trim() && model.vendor && model.category,
        )
        await storage.put(
          'presets',
          { id: CUSTOM_MODELS_ROW_ID, models: clean } as never,
        )
      } catch {
        // 偏好写不进去只影响下次启动；当前内存列表仍可继续使用
      }
    },
    async loadUncommonModels() {
      try {
        const rows = await storage.query('presets', { id: UNCOMMON_MODELS_ROW_ID })
        const row = rows[0] as { names?: unknown } | undefined
        if (!row || !Array.isArray(row.names)) return []
        return [...new Set(row.names.filter((name): name is string => typeof name === 'string'))]
      } catch {
        return []
      }
    },
    async saveUncommonModels(names) {
      try {
        const clean = [...new Set(names.map((name) => name.trim()).filter(Boolean))]
        await storage.put('presets', { id: UNCOMMON_MODELS_ROW_ID, names: clean } as never)
      } catch {
        // 偏好写不进去不阻断生成；最坏情况只是下次仍显示为常用
      }
    },
  }
}
