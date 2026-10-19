/**
 * 电商结果的 AI 超清配置。
 *
 * 这些不是提示词模板，而是 RunningHub / Topaz 的真实超分端点及各自适用场景。
 * 页面只允许从这里选 profile，避免把前端显示名和上游模型名各写一份。
 */

export type EcommerceUpscaleScale = '2x' | '4x' | '6x'
export type EcommerceUpscaleProfile =
  | 'standard'
  | 'high-fidelity'
  | 'low-resolution'
  | 'cgi'
  | 'text-refine'

export interface EcommerceUpscaleOption {
  id: EcommerceUpscaleProfile
  label: string
  model: string
  hint: string
}

export const ECOMMERCE_UPSCALE_SCALES: readonly EcommerceUpscaleScale[] = [
  '2x',
  '4x',
  '6x',
]

export const ECOMMERCE_UPSCALE_OPTIONS: readonly EcommerceUpscaleOption[] = [
  {
    id: 'standard',
    label: '通用',
    model: 'Topaz 图像超清 Standard',
    hint: '大多数商品图；速度与细节平衡',
  },
  {
    id: 'high-fidelity',
    label: '高保真',
    model: 'Topaz 图像超清 High Fidelity',
    hint: '强调纹理与细节保真',
  },
  {
    id: 'low-resolution',
    label: '低清修复',
    model: 'Topaz 图像超清 Low Resolution',
    hint: '压缩痕迹、模糊和低清原图',
  },
  {
    id: 'cgi',
    label: 'CGI / 渲染',
    model: 'Topaz 图像超清 CGI',
    hint: '3D 渲染图和干净几何边缘',
  },
  {
    id: 'text-refine',
    label: '文字优先',
    model: 'Topaz 图像超清 Text Refine',
    hint: '带卖点文案的商品图，优先保护文字边缘',
  },
]

export function isUpscaleScale(value: unknown): value is EcommerceUpscaleScale {
  return typeof value === 'string' && ECOMMERCE_UPSCALE_SCALES.includes(value as EcommerceUpscaleScale)
}

export function upscaleOptionOf(profile: EcommerceUpscaleProfile): EcommerceUpscaleOption {
  const option = ECOMMERCE_UPSCALE_OPTIONS.find((item) => item.id === profile)
  if (!option) throw new Error(`不认识的 AI 超清方案：${profile}`)
  return option
}

export function upscaleNoteOf(
  profile: EcommerceUpscaleProfile,
  scale: EcommerceUpscaleScale,
): string {
  const option = upscaleOptionOf(profile)
  return `AI 超清：${option.label}，${scale} 无损放大。保持商品、构图、颜色和画面文字内容不变，只提升清晰度与细节。`
}
