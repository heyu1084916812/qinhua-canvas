/**
 * 陈列室素材造数据（架构 §5.7）。
 *
 * 对比节点（§6.10）需要真实的两张图才能在陈列室看到「双图上叠 + 分割线」，
 * 而陈列室的 platform 是内存实现、assets 表默认空。这里生成两张尺寸相同、
 * 内容可区分的 PNG（纯 canvas 绘制，不依赖外部文件），并在 PreviewShell 挂载时
 * 写入 assets 表（走命令层 asset.put，与真实生成路径一致）。
 *
 * 注意：canvas.toBlob 在 jsdom 下不可用，故本模块只在浏览器（陈列室）中被调用。
 */

export interface PreviewAsset {
  hash: string
  mime: string
  bytes: Uint8Array
  width: number
  height: number
}

const SIZE = 480

function drawPanel(ctx: CanvasRenderingContext2D, variant: 'A' | 'B') {
  const w = SIZE
  const h = SIZE
  if (variant === 'A') {
    const g = ctx.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, '#3b82f6')
    g.addColorStop(1, '#a855f7')
    ctx.fillStyle = g
  } else {
    const g = ctx.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, '#f97316')
    g.addColorStop(1, '#eab308')
    ctx.fillStyle = g
  }
  ctx.fillRect(0, 0, w, h)

  // 网格线：便于肉眼判断「上叠区域」与分割线位置
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = 1
  for (let x = 40; x < w; x += 40) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
  for (let y = 40; y < h; y += 40) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }

  // 大字母，肉眼可辨 A / B
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.font = 'bold 220px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(variant, w / 2, h / 2)
}

async function makePng(variant: 'A' | 'B'): Promise<PreviewAsset> {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('[preview assets] 无法获取 2D 上下文')
  drawPanel(ctx, variant)
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 失败'))), 'image/png')
  })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return { hash: `preview-${variant.toLowerCase()}-asset`, mime: 'image/png', bytes, width: SIZE, height: SIZE }
}

/** 生成两张可区分的对比素材（A 蓝紫 / B 橙黄） */
export async function buildPreviewAssets(): Promise<[PreviewAsset, PreviewAsset]> {
  const [a, b] = await Promise.all([makePng('A'), makePng('B')])
  return [a, b]
}

/** 对比节点陈列室用「上游素材 hash 顺序」 */
export const PREVIEW_ASSET_HASHES = ['preview-a-asset', 'preview-b-asset'] as const
