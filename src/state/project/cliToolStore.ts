import type { StoragePort } from '../../platform/ports'
import { mergeTools, toolPatchOf, type CliTool } from '../../domain/shared/cliTools'

/**
 * 本机 CLI 工具配置的读写（对账 #308）。
 *
 * ## 为什么复用 `presets` 表
 *
 * 与功能预设词（`presetTextStore`）同一条理由：`presets` 就是「按 id 存一条 JSON」，
 * 而新建表要动 Dexie schema —— schema 升级不可逆，为一张同构的表付这个代价不值得。
 * id 前缀区分来源：`recipe:|channelId`、`presetText:|action`、`cli:tools`（本文件）。
 *
 * ## 为什么整份存一行
 *
 * 工具数量恒定（目录在代码里），改动的是"某几个字段"。整份覆盖让读只有一次查询，
 * 也天然原子 —— 不会出现"Codex 存进去了、Gemini 没存进去"的半份状态。
 *
 * ## 与平台端口的关系
 *
 * 这里**只**管配置，不管"能不能跑"：`CliPort` 缺席（浏览器）时配置照样能读能写，
 * 面板如实说"本机 CLI 只在桌面应用里可用"。
 */

const CLI_TOOLS_ROW_ID = 'cli:tools'

export interface CliToolStore {
  /** 读回工具列表（库里没有 = 全默认） */
  load(): Promise<CliTool[]>
  /** 整份覆盖（失败不抛：偏好写不进不该打断主流程） */
  save(tools: CliTool[]): Promise<void>
}

export function createCliToolStore(storage: StoragePort): CliToolStore {
  return {
    async load() {
      try {
        const rows = await storage.query('presets', { id: CLI_TOOLS_ROW_ID })
        return mergeTools(rows[0])
      } catch {
        // 表可能不存在（极老的库）；读失败一律当"全默认"，别把设置页卡住
        return mergeTools(null)
      }
    },

    async save(tools) {
      try {
        await storage.put('presets', {
          id: CLI_TOOLS_ROW_ID,
          tools: tools.map(toolPatchOf),
        } as never)
      } catch {
        /* 与配方 / 技能 / 预设词同一口径：偏好写不进不打断主流程 */
      }
    },
  }
}
