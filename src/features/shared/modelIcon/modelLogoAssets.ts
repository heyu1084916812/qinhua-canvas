import type { PresetVendor } from '../../../domain/project/modelPresets'

import anthropic from '../../../assets/model-logos/anthropic.svg'
import baidu from '../../../assets/model-logos/baidu.svg'
import bfl from '../../../assets/model-logos/bfl.svg'
import cohere from '../../../assets/model-logos/cohere.svg'
import doubao from '../../../assets/model-logos/doubao.svg'
import elevenlabs from '../../../assets/model-logos/elevenlabs.svg'
import flux from '../../../assets/model-logos/flux.svg'
import huggingface from '../../../assets/model-logos/huggingface.svg'
import ideogram from '../../../assets/model-logos/ideogram.svg'
import jimeng from '../../../assets/model-logos/jimeng.svg'
import kling from '../../../assets/model-logos/kling.svg'
import luma from '../../../assets/model-logos/luma.svg'
import mistral from '../../../assets/model-logos/mistral.svg'
import modelscope from '../../../assets/model-logos/modelscope.svg'
import moonshot from '../../../assets/model-logos/moonshot.svg'
import ollama from '../../../assets/model-logos/ollama.svg'
import openrouter from '../../../assets/model-logos/openrouter.svg'
import perplexity from '../../../assets/model-logos/perplexity.svg'
import recraft from '../../../assets/model-logos/recraft.svg'
import runway from '../../../assets/model-logos/runway.svg'
import siliconcloud from '../../../assets/model-logos/siliconcloud.svg'
import stability from '../../../assets/model-logos/stability.svg'
import suno from '../../../assets/model-logos/suno.svg'
import volcengine from '../../../assets/model-logos/volcengine.svg'
import xai from '../../../assets/model-logos/xai.svg'

/** 后补厂商统一走 CSS mask：同一份单色 SVG 可随主题 `currentColor` 反转。 */
export const MODEL_LOGO_ASSETS: Partial<Record<PresetVendor, string>> = {
  anthropic,
  xai,
  mistral,
  moonshot,
  baidu,
  cohere,
  perplexity,
  stability,
  runway,
  luma,
  ideogram,
  bfl,
  recraft,
  kling,
  suno,
  elevenlabs,
  ollama,
  huggingface,
  openrouter,
  siliconcloud,
  modelscope,
  doubao,
  volcengine,
  flux,
  jimeng,
}
