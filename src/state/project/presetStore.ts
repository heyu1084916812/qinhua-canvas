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
  isRecipeRowId,
  NO_RECIPE,
  presetRowId,
  recipeFromRow,
  recipeToRow,
  type GenerationRecipe,
} from '../../domain/project/generationPreset'
import { ROUTE_STRATEGIES, type RouteStrategy } from '../../domain/project/modelRouting'

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
  }
}
