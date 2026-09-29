/**
 * 节点「产物像素」的**取值规则**（用户 2026-09-17）。
 *
 * 为什么是纯函数：这个读数要挂在 NodeFrame 的标题排（节点**外部**右上角），
 * 而 NodeFrame 只认 `NodeSnapshot`、不认各类型的 data 结构；
 * 把「哪个类型有像素、像素从哪个字段读」收敛成一个纯函数，
 * frame 就不必知道 generation / compare / …各自的字段布局，
 * 也可以直接单测（渲染截图很难断言「这个数字到底是不是真实像素」）。
 *
 * 取 `naturalSize` 而不是「请求像素」：它是从**产物字节的文件头**读出来的
 * （见 `domain/shared/imageSize`），即渠道真的给了多大；
 * 而请求像素只是「我们问渠道要了多大」——两个数合成一个时恒等，
 * 看着对上了、其实什么都没证明（§6.18 把两者分组的理由）。
 */
import type { NodeSnapshot, NodeData } from '../../../domain/canvas/model/node'

export interface AssetPixels {
  width: number
  height: number
}

/** 带产物尺寸字段的 data（生成 / 融合节点；视频未解码时该字段缺失） */
type WithNaturalSize = { assetHash?: string; naturalSize?: { width: number; height: number } }

/**
 * 该节点此刻**该不该显示**像素：有素材 + 真实尺寸已知。
 *
 * 缺任一条就不显示——**不猜、不拿请求值顶替**。空节点顶着一个 `0×0`
 * 或拿「请求了 1024×1024」冒充「收到了 1024×1024」，都是假读数。
 */
export function assetPixelsOf(node: NodeSnapshot): AssetPixels | null {
  /**
   * 只有**持有图片**的节点才显示这个读数。融合节点不在其列（§6.23）：
   * 它自己不存产物 —— 产物落成右侧一个新节点，读数归那个节点显示。
   */
  if (node.type !== 'generation') return null
  const data = node.data as unknown as WithNaturalSize & NodeData
  if (!data.assetHash) return null
  const n = data.naturalSize
  if (!n || !Number.isFinite(n.width) || !Number.isFinite(n.height)) return null
  if (n.width <= 0 || n.height <= 0) return null
  return { width: Math.round(n.width), height: Math.round(n.height) }
}

/** 展示文案：`1024×1024`。乘号用 U+00D7（×），不用字母 x */
export function formatPixels(p: AssetPixels): string {
  return `${p.width}×${p.height}`
}
