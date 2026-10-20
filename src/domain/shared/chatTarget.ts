import type { Channel } from '../project/channel'
import { channelIsRoutable } from '../project/channel'
import { toLogicalName } from '../project/modelCatalog'
import { isBuiltinChannelId } from '../project/builtinChannels'

/**
 * **挑一条真有对话模型的已启用渠道**（对账 #414 抽出来，对账 #422 起两家共用）。
 *
 * 原来它住在 `domain/storyboard/breakdown.ts` 里（拆镜先用上）。电商「一句话 →
 * 待确认方案」也要同一件事，而让 `domain/ecommerce` 反向 import
 * `domain/storyboard` 是跨域耦合 —— 所以搬到 `domain/shared`，
 * 漫剧那边原路径仍可 import（breakdown.ts 里留了 re-export）。
 */
export interface ChatTarget {
  channelId: string
  model: string
  /** 界面上如实显示"会用谁" */
  label: string
}
export interface SpeechTarget {
  channelId: string
  model: string
  label: string
  voices: string[]
}

/**
 * Channels the user configured themselves. Built-ins and the offline mock
 * channel must not appear as production model choices.
 */
export function userConfiguredChannels(channels: readonly Channel[]): Channel[] {
  return channels.filter(
    (channel) => !isBuiltinChannelId(channel.id) && channel.protocol !== 'mock',
  )
}

/**
 * 挑一条**真有对话模型**的已启用渠道（列表顺序 = 用户排的优先顺序）。
 *
 * 为什么不用 `defaultForNewNode({}, 'chat')`：那条解析链的最后一档会给一个
 * **预设名兜底**（渠道上一个模型都没勾也能返回「Agnes 2.5 Flash」）。对生成节点那是对的
 * （渠道真能跑，名字由上游兜），对"拿模型读需求"不行 —— 用户点下去会拿着一个不存在的模型
 * 去请求，得到一句难懂的渠道错误。这里只认"用户勾过的对话模型"，找不到就**如实说没配**。
 */
export function chatTargetOptions(
  channels: readonly Channel[],
): Array<{ value: string; channelId: string; model: string; label: string }> {
  const out: Array<{ value: string; channelId: string; model: string; label: string }> = []
  const seen = new Set<string>()
  for (const ch of channels) {
    if (!channelIsRoutable(ch)) continue
    for (const model of ch.models ?? []) {
      if (model.category !== 'chat') continue
      const key = `${ch.id}\u0000${model.id}`
      if (seen.has(key)) continue
      seen.add(key)
      const shown = toLogicalName(channels, model.id) || model.id
      out.push({
        value: `${ch.id}::${model.id}`,
        channelId: ch.id,
        model: model.id,
        label: `${ch.name} · ${shown}`,
      })
    }
  }
  return out
}

/**
 * `preferredModel` 允许用户显式指定解析模型；它可以是渠道里存的上游 id，
 * 也可以是前端显示名。找不到时仍回落到第一条可路由对话模型，由界面如实展示。
 */
export function resolveChatTarget(
  channels: readonly Channel[],
  preferredModel = '',
): ChatTarget | null {
  if (preferredModel) {
    const preferred = chatTargetOptions(channels).find(
      (item) =>
        item.value === preferredModel ||
        item.model === preferredModel ||
        toLogicalName(channels, item.model) === preferredModel ||
        item.label === preferredModel,
    )
    if (preferred) {
      return {
        channelId: preferred.channelId,
        model: preferred.model,
        label: preferred.label,
      }
    }
  }
  for (const ch of channels) {
    if (!channelIsRoutable(ch)) continue
    const model = (ch.models ?? []).find((m) => m.category === 'chat')
    if (!model) continue
    /**
     * 给用户看的是**前端显示名**（`mock-chat-1` → `GPT-6 Astra`），发给渠道的仍是
     * 渠道行里存的那个 id —— 与画布下拉同一口径（对账 #371：裸 ID 不进界面）。
     * 认不出来的 id 原样显示（`toLogicalName` 自己会回落），不硬编一张对照表。
     */
    const shown = toLogicalName(channels, model.id) || model.id
    return { channelId: ch.id, model: model.id, label: `${ch.name} · ${shown}` }
  }
  return null
}

/** 挑一条真有配音模型的已启用渠道；只认用户勾过的 audio 模型。 */
export function resolveSpeechTarget(channels: readonly Channel[]): SpeechTarget | null {
  for (const ch of channels) {
    if (!channelIsRoutable(ch)) continue
    const model = (ch.models ?? []).find((m) => m.category === 'audio')
    if (!model) continue
    const shown = toLogicalName(channels, model.id) || model.id
    return {
      channelId: ch.id,
      model: model.id,
      label: `${ch.name} · ${shown}`,
      voices: model.voices?.length ? model.voices : ['alloy', 'nova'],
    }
  }
  return null
}
