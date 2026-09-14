/**
 * 分镜格 → 生成请求 / 生成计划的纯函数（M6-5）。
 *
 * 它对应画布工作台的 `buildRunPlan`，但**刻意简单**：格没有图结构、没有上下游、
 * 没有槽位、没有集合展开——一次生成请求就是「这一格」的一次调用。
 * 因此结果落位也不需要槽位计划（`CanvasRunTask.slot` 那类东西）；
 * 共享引擎只要求「怎么落」由适配器回答，而 comic 的答案永远是「落回这一格」。
 *
 * 提示词组装（调研稿 §6「三层分离」的兑现）：
 *   ① 画面描述 `scene`（用户写的自然语言）
 *   ② 镜头语言 `shot`（字段化 → 英文片段，生图模型对英文镜头词更稳）
 *   ③ 角色卡（名字 + 外观描述 → 一段角色约束；参考图另作 asset 输入）
 * 对白层**不进提示词**——它是不烘进图的贴纸（重生成画面不丢对白）。
 *
 * 纯函数：不读时间、不产生副作用，可脱离 React 单测。
 */

import type { ComicCharacter, ComicPanel, ComicProject, ShotAngle, ShotFraming } from '../model/comicProject'
import type { NodeInput, RunRequest } from '../../shared/execution/types'
import type { RunPlan, RunTask } from '../../shared/execution/plan'
import {
  DEFAULT_ANGLE,
  DEFAULT_FRAMING,
  SHOT_ANGLES,
  SHOT_FRAMINGS,
  findPanel,
  pickFrom,
} from '../model/comicProject'
import { fingerprintHex } from '../../shared/hash'
import { createId } from '../../../shared/id'

/** 景别 → 提示词片段 */
const FRAMING_TEXT: Record<ShotFraming, string> = {
  'extreme-wide': 'extreme wide shot',
  wide: 'wide shot',
  medium: 'medium shot',
  'close-up': 'close-up',
  'extreme-close-up': 'extreme close-up',
}

/** 机位角度 → 提示词片段 */
const ANGLE_TEXT: Record<ShotAngle, string> = {
  'eye-level': 'eye level',
  high: 'high angle',
  low: 'low angle',
  dutch: 'dutch angle',
  'birds-eye': "bird's eye view",
  'worms-eye': "worm's eye view",
}

/**
 * 一张格的生成参数快照（进 `RunRecord.params`）。
 * 只收「影响产出」的字段；`assetHash` / `balloons` 属于展示与对白层，不进快照。
 */
export interface ComicPanelParams {
  scene: string
  framing: ShotFraming
  angle: ShotAngle
  characterIds: string[]
  channelId: string
  model: string
}

/** 生成配置是否齐全（缺渠道 / 模型 / 画面描述则不参与生成） */
export function panelCanGenerate(panel: ComicPanel): boolean {
  return !!panel.channelId && !!panel.model && panel.scene.trim().length > 0
}

function charactersOf(project: ComicProject, panel: ComicPanel): ComicCharacter[] {
  const byId = new Map(project.characters.map((c) => [c.id, c]))
  const out: ComicCharacter[] = []
  for (const id of panel.characterIds) {
    const c = byId.get(id)
    if (c) out.push(c)
  }
  return out
}

/** 角色约束片段：`名字：外观描述`，多角色用「；」连接；全空则返回空串 */
function characterClause(chars: ComicCharacter[]): string {
  return chars
    .map((c) => [c.name, c.description].filter((s) => s.trim().length > 0).join('：'))
    .join('；')
}

/** 组提示词：画面描述 + 景别 + 机位 + 角色约束（空片段自动剔除） */
export function panelPromptOf(project: ComicProject, panel: ComicPanel): string {
  return [
    panel.scene.trim(),
    FRAMING_TEXT[panel.shot.framing],
    ANGLE_TEXT[panel.shot.angle],
    characterClause(charactersOf(project, panel)),
  ]
    .filter((s) => s.length > 0)
    .join('，')
}

/**
 * 角色参考图 → asset 输入。
 *
 * 说明：角色卡的 `referenceHashes` 未带 mime（模型里只有 hash 列表），此处统一用
 * `image/png` 占位——这个 mime 只参与渠道层的「是不是图」判定（`imageInputsOf`
 * 只看 `image/` 前缀），**不参与指纹**；真正上传时渠道按 hash 去 `assets` 表读
 * **真实** mime（M6-12 `openaiImages.readImageFiles`），所以占位不会把 JPEG 说成 PNG。
 *
 * 生效链路（M6-12 打通 / M6-13 起界面上可填）：参考图 hash → 角色 `referenceHashes`
 * → 本函数的 asset 输入 → 渠道读字节 → `POST /v1/images/edits`（图生图）。
 */
export function panelInputsOf(project: ComicProject, panel: ComicPanel): NodeInput[] {
  const inputs: NodeInput[] = []
  for (const c of charactersOf(project, panel)) {
    for (const hash of c.referenceHashes) {
      inputs.push({ kind: 'asset', nodeId: c.id, assetHash: hash, mime: 'image/png' })
    }
  }
  return inputs
}

/** 单次生成请求；配置不全返回 null（不入计划） */
export function panelToRunRequest(project: ComicProject, panel: ComicPanel): RunRequest | null {
  if (!panelCanGenerate(panel)) return null
  return {
    kind: 'image',
    channelId: panel.channelId!,
    model: panel.model!,
    prompt: panelPromptOf(project, panel),
    inputs: panelInputsOf(project, panel),
    params: {},
  }
}

/**
 * 格的生成指纹：`画面描述 + 镜头 + 角色 + 渠道/模型 + 参考图` 的确定性摘要。
 * 与画布 `fingerprintOf` 同源思路（输入 + 参数，排除产物与对白）——
 * 因此「改对白不改指纹」（重生成不会因对白而判定过期）、「改画面描述则指纹变化」。
 */
export function panelFingerprintOf(project: ComicProject, panel: ComicPanel): string {
  const canonical = [
    panel.scene,
    panel.shot.framing,
    panel.shot.angle,
    panel.shot.transition ?? '',
    panel.channelId ?? '',
    panel.model ?? '',
    panel.characterIds.join(','),
    panelInputsOf(project, panel)
      .map((i) => (i.kind === 'asset' ? `${i.nodeId}:${i.assetHash}` : i.kind))
      .join(';'),
  ].join('|')
  return fingerprintHex(canonical)
}

/** 参数快照（与提示词同源，供 RunRecord 留痕） */
export function panelParamsOf(panel: ComicPanel): ComicPanelParams {
  return {
    scene: panel.scene,
    framing: panel.shot.framing,
    angle: panel.shot.angle,
    characterIds: panel.characterIds,
    channelId: panel.channelId ?? '',
    model: panel.model ?? '',
  }
}

/**
 * `RunRecord.params` → `ComicPanelParams`（M6-15）。
 *
 * 为什么需要它：共享执行词里 `RunRecord.params` 是 **`unknown`**——引擎刻意不解读
 * 工作台的参数快照（架构 §5.5）。当留痕要把这次生成的参数写进格的历史时，
 * 「收窄」这一步就必须有人做，而**只有 comic 自己知道自己的 params 长什么样**，
 * 所以它落在这里。
 *
 * 用**逐字段回落**而不是 `as ComicPanelParams`：`as` 在字段缺失时会把 `undefined`
 * 一路带进留痕，等某天用户点「回退」时，被写回的就是一个 `scene: undefined` 的格
 * ——错误从「读的时候」推迟到了「写回的时候」，中间的日志、界面全都看不出异常。
 * 逐字段回落最坏只是丢信息，不会传播假值。
 */
export function asComicPanelParams(raw: unknown): ComicPanelParams {
  const r: Record<string, unknown> = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const asString = (v: unknown): string => (typeof v === 'string' ? v : '')
  return {
    scene: asString(r.scene),
    framing: pickFrom(r.framing, SHOT_FRAMINGS, DEFAULT_FRAMING),
    angle: pickFrom(r.angle, SHOT_ANGLES, DEFAULT_ANGLE),
    characterIds: Array.isArray(r.characterIds)
      ? r.characterIds.filter((x): x is string => typeof x === 'string')
      : [],
    channelId: asString(r.channelId),
    model: asString(r.model),
  }
}

/**
 * 单格生成计划：一个 task，scope = 'node'，mode = 'single'。
 * 落点由 `ComicPlacement` 解读为「就是这一格」。
 */
export function buildPanelRunPlan(project: ComicProject, panelId: string): RunPlan | null {
  const panel = findPanel(project, panelId)
  if (!panel) return null
  const request = panelToRunRequest(project, panel)
  if (!request) return null
  const task: RunTask = {
    id: createId('task'),
    nodeId: panel.id,
    request,
    dependsOn: [],
    fingerprint: panelFingerprintOf(project, panel),
    params: panelParamsOf(panel),
    collectionItemId: null,
    seq: 0,
  }
  return { id: createId('plan'), tasks: [task], scope: 'node', mode: 'single', newDownstream: false }
}
