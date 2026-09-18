import type { NodeSnapshot } from '../model/node'
import type { NodeInput } from '../model/runRecord'
import { fingerprintHex } from '../../shared/hash'

/**
 * 节点指纹（架构 §9.2 / 产品文档 §6.19.5）。
 *
 * 指纹 = 「节点自身参数 + 上游输入」的确定性摘要，用来判定结果是否过期：
 * LiveFingerprint（最近一次成功生成的指纹）与当前指纹不一致 → 节点陈旧。
 *
 * 参与计算的字段见 DATA_EXCLUDED：展示态与产物本身的变化不算「输入变了」，
 * 否则拖一下缩略图顺序就会把节点标成陈旧。
 */
const DATA_EXCLUDED: ReadonlySet<string> = new Set([
  'assetHash', // 产物本体，不是输入
  /**
   * 产物的**真实像素**（§6.16），写回时一并记下，用于「拖出 / 复制出结果组时
   * 按产物比例还原」。它是**产物的描述**，不是输入：若计入指纹，「生成成功」的
   * 那一刻就自己把自己标成陈旧了（写回 naturalSize → 指纹变了 → 与刚落库的基线不符）。
   */
  'naturalSize',
  'thumbOrder', // 展示顺序
  'upstreamHidden', // 显示开关
  'hiddenIds',
  'hiddenPromptIds',
])

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

/**
 * 输入项归一化键。
 *
 * 刻意**不含** `collectionItemId`：该字段只在执行期由集合展开打上，
 * 用于区分「同一素材被调用第几次」，不代表输入内容本身。
 * 若把它算进指纹，批量展开出的 N 个 task 会各得一个指纹，
 * 集合内容变化时的陈旧判定（同一次生成共用一个指纹）就失效了。
 */
function inputKey(input: NodeInput): string {
  switch (input.kind) {
    case 'text':
      return `text:${input.nodeId}:${input.text}`
    case 'asset':
      return `asset:${input.nodeId}:${input.assetHash}`
    case 'collection':
      return `collection:${input.nodeId}:[${input.items.map(inputKey).join(',')}]`
  }
}

export function fingerprintOf(
  node: Pick<NodeSnapshot, 'type' | 'data'>,
  inputs: readonly NodeInput[],
): string {
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node.data as unknown as Record<string, unknown>)) {
    if (DATA_EXCLUDED.has(k)) continue
    data[k] = v
  }
  const canonical = `${node.type}|${stableStringify(data)}|${inputs.map(inputKey).join(';')}`
  return fingerprintHex(canonical)
}
