/** 漫剧镜头视频字幕擦除：只列官方真实端点，不把普通视频编辑冒充擦除。 */
export const VIDEO_ERASE_MODEL_IDS = [
  '火山字幕擦除 标准版',
  '火山字幕擦除 精细化版',
] as const

export type VideoEraseModelId = (typeof VIDEO_ERASE_MODEL_IDS)[number]

export function isVideoEraseModel(model: string): model is VideoEraseModelId {
  return (VIDEO_ERASE_MODEL_IDS as readonly string[]).includes(model)
}
