/**
 * 生图提示词的模型适配层。
 *
 * 目标不是改写画面内容，而是按 image-prompt skill 的模型模板补齐可执行格式：
 * GPT Image 用目标 / 主体 / 构图 / 约束分段；Nano Banana 保持叙述式段落；
 * Midjourney 用单行短语流与参数。语言只跟随原 prompt，绝不把英文正文后拼中文约束。
 */
import { ECOMMERCE_SMART_RATIO, ecommerceAspectRatio } from './types'

export type ImagePromptFamily =
  | 'gpt-image'
  | 'nano-banana'
  | 'midjourney'
  | 'seedream'
  | 'generic'

export interface ImagePromptProfileInput {
  prompt: string
  model?: string
  ratio?: string
  headline?: string
  subheadline?: string
}

export function imagePromptFamilyOf(model: string | undefined): ImagePromptFamily {
  const value = (model ?? '').trim()
  if (!value) return 'generic'
  if (/(?:gpt\s*image|gpt[\s-]*2(?:\.5)?|sunburst|flare|image-2)/i.test(value)) {
    return 'gpt-image'
  }
  if (/(?:nano[\s-]*banana|gemini[\s-]*(?:pro[\s-]*)?image|banana)/i.test(value)) {
    return 'nano-banana'
  }
  if (/(?:midjourney|(?:^|[^a-z])mj(?:[^a-z]|$))/i.test(value)) return 'midjourney'
  if (/(?:seedream|jimeng|即梦|doubao[\s-]*image)/i.test(value)) return 'seedream'
  return 'generic'
}

function promptUsesChinese(prompt: string): boolean {
  return /[\u3400-\u9fff]/.test(prompt)
}

function exactCopyLine(input: ImagePromptProfileInput, chinese: boolean): string | null {
  const headline = input.headline?.trim()
  const subheadline = input.subheadline?.trim()
  if (!headline && !subheadline) return null
  if (chinese) {
    return [
      headline ? `主文案必须逐字排为「${headline}」，只出现一次。` : '',
      subheadline ? `辅助文案必须逐字排为「${subheadline}」，只出现一次。` : '',
      '不要添加其他文字、错字、水印或无关 Logo。',
    ]
      .filter(Boolean)
      .join(' ')
  }
  return [
    headline ? `Render the headline exactly once, verbatim: "${headline}".` : '',
    subheadline ? `Render the subheadline exactly once, verbatim: "${subheadline}".` : '',
    'No other text, no misspellings, no watermark, no unrelated logo.',
  ]
    .filter(Boolean)
    .join(' ')
}

function ratioOf(input: ImagePromptProfileInput): string | null {
  if (!input.ratio || input.ratio === ECOMMERCE_SMART_RATIO) return null
  const ratio = ecommerceAspectRatio(input.ratio)
  return /^\d+:\d+$/.test(ratio) ? ratio : null
}

/**
 * 把已经写好的画面描述包成目标模型更容易执行的格式；不翻译、不混语言。
 */
export function imagePromptForModel(input: ImagePromptProfileInput): string {
  const prompt = input.prompt.trim()
  if (!prompt) return ''
  const family = imagePromptFamilyOf(input.model)
  const chinese = promptUsesChinese(prompt)
  const ratio = ratioOf(input)
  const copy = exactCopyLine(input, chinese)

  if (family === 'midjourney') {
    return [
      prompt.replace(/\s+/g, ' ').trim(),
      ratio ? `--ar ${ratio}` : '',
      '--raw',
      '--no watermark, extra text, unrelated logo',
    ]
      .filter(Boolean)
      .join(' ')
  }

  if (family === 'gpt-image') {
    return chinese
      ? [
          prompt,
          ratio ? `画幅：${ratio}。` : '',
          copy ?? '',
          '限制：严格保留输入商品的外观、颜色、材质与结构；不编造参数、认证、功效或价格；不出现水印和无关 Logo。',
        ]
          .filter(Boolean)
          .join('\n')
      : [
          prompt,
          ratio ? `Aspect ratio: ${ratio}.` : '',
          copy ?? '',
          'Constraints: Preserve the exact visible product shape, color, material, and structure from the input image. No fabricated specifications, certifications, claims, prices, watermarks, or unrelated logos.',
        ]
          .filter(Boolean)
          .join('\n')
  }

  if (family === 'nano-banana' || family === 'seedream') {
    return chinese
      ? [
          `${prompt} 画面采用${ratio ? ` ${ratio} ` : '当前'}画幅。`,
          copy ?? '',
          '严格保留输入商品的外观、颜色、材质和结构；不添加水印、无关 Logo、错误文字或无法核实的信息。',
        ]
          .filter(Boolean)
          .join(' ')
      : [
          `${prompt} Frame the final image in ${ratio ? `${ratio} aspect ratio` : 'the requested aspect ratio'}.`,
          copy ?? '',
          'Preserve the product shape, color, material, and structure exactly. No watermark, unrelated logo, misspelled text, or unverifiable claims.',
        ]
          .filter(Boolean)
          .join(' ')
  }

  return prompt
}
