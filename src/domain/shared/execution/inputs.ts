import type { NodeInput } from './types'

/**
 * 输入项的「渠道视角」提纯（M6-12）。
 *
 * 背景：`RunRequest.inputs` 自 M2 起就已完整携带文本 / 素材 / 集合三类输入，
 * canvas 的分组 / 批量节点、comic 的角色参考图都在往里塞 `asset` 项，
 * 但**渠道适配层从未读过它**——`openaiImages.generateImage` 只把 `prompt`
 * 发给 `/v1/images/generations`。于是图生图与角色参考图在数据模型里「已接好」，
 * 在真实链路里却从未生效。
 *
 * 本文件把「从 inputs 里挑出要上传的图像」这件事做成纯函数：
 * - 渠道层只消费结果，不再各自写一遍过滤 / 去重 / 截断；
 * - 规则可单测（上限、去重、集合展开都在这里定死）；
 * - domain 不认识 FormData / Blob，也不认识任何渠道协议。
 *
 * 纯度：只依赖 `./types`，无副作用、无时间、无 IO（架构 §2.2）。
 */

/** 一张待上传的参考图：只要「哪个素材」与「什么类型」 */
export interface ImageInput {
  assetHash: string
  mime: string
}

/**
 * 单次调用最多上传几张图。
 *
 * 不是拍脑袋：OpenAI `/v1/images/edits`（gpt-image-1）实际接受多图，但绝大多数
 * 中转站对多图的支持参差不齐，且每张图都要按 base64 计入请求体——4 张是
 * 「够用（一个角色多角度 + 一张底图）又不至于把请求撑爆」的折中。
 * 超限**丢弃后面的**（保前面的），因为 inputs 的顺序是上游连线的自然顺序，
 * 前面的更可能是主参考图。
 */
export const MAX_IMAGE_INPUTS = 4

/**
 * 摊平集合：把 `collection` 项替换成它的 items（递归，应对批量接批量）。
 *
 * 集合卡在执行计划阶段（`expandInputs`）就已展开成 N 次调用，正常情况下
 * 渠道层拿到的是摊平后的输入。这里仍做摊平，是给「未经展开直接调用渠道」
 * 的路径兜底（单测 / 未来的直接调用），保证渠道层的语义不依赖调用顺序。
 */
export function flattenInputs(inputs: readonly NodeInput[]): NodeInput[] {
  const out: NodeInput[] = []
  const walk = (list: readonly NodeInput[]): void => {
    for (const input of list) {
      if (input.kind === 'collection') walk(input.items)
      else out.push(input)
    }
  }
  walk(inputs)
  return out
}

function isImageMime(mime: string): boolean {
  return mime.toLowerCase().startsWith('image/')
}

/**
 * 挑出图像素材**项本身**（保留 `nodeId`，`ImageInput` 丢了它）。
 *
 * 与 `imageInputsOf` 规则完全一致（摊平 → 只留图像 → 按 hash 去重 → 截断），
 * 只差返回值带不带 `nodeId`。分开成两个函数而非给 `imageInputsOf` 加参数：
 * 上传（渠道侧只要 hash + mime）与请求溯源（要知道图来自哪个节点）是两种用途，
 * 混在一个开关里迟早有人传错。
 */
export function imageAssetInputsOf(
  inputs: readonly NodeInput[],
  max: number = MAX_IMAGE_INPUTS,
): Extract<NodeInput, { kind: 'asset' }>[] {
  const seen = new Set<string>()
  const out: Extract<NodeInput, { kind: 'asset' }>[] = []
  for (const input of flattenInputs(inputs)) {
    if (input.kind !== 'asset') continue
    if (!isImageMime(input.mime)) continue
    if (seen.has(input.assetHash)) continue
    seen.add(input.assetHash)
    out.push(input)
    if (out.length >= max) break
  }
  return out
}

/**
 * 挑出要随请求上传的图像素材：摊平 → 只留图像 → 按 hash 去重 → 截断。
 *
 * 去重按 `assetHash` 而非 `nodeId`：同一张素材被两条连线引到同一个节点时，
 * 上传两次毫无意义（渠道不会因此「更参考」它），反而白白增大请求体。
 *
 * 反向注意：`collectionItemId` **不参与去重**——它区分的是「同一次生成里的第几次调用」，
 * 而这里处理的是**单次调用**内部的输入，该字段在此语境下无意义。
 */
export function imageInputsOf(
  inputs: readonly NodeInput[],
  max: number = MAX_IMAGE_INPUTS,
): ImageInput[] {
  const seen = new Set<string>()
  const out: ImageInput[] = []
  for (const input of flattenInputs(inputs)) {
    if (input.kind !== 'asset') continue
    if (!isImageMime(input.mime)) continue
    if (seen.has(input.assetHash)) continue
    seen.add(input.assetHash)
    out.push({ assetHash: input.assetHash, mime: input.mime })
    if (out.length >= max) break
  }
  return out
}
