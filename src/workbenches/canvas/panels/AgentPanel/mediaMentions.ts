export interface ExplicitMediaModels {
  image?: string
  video?: string
}

/**
 * 本轮正文中明确引用的生成模型。一个类别只认第一个，避免模型重复出现时
 * 让后一个 chip 静默覆盖前一个。
 */
export function explicitMediaModelsFromMentions(
  mentions: readonly { kind: string; id: string }[],
  categoryOf: (model: string) => string | undefined,
): ExplicitMediaModels {
  const out: ExplicitMediaModels = {}
  for (const mention of mentions) {
    if (mention.kind !== 'model') continue
    const category = categoryOf(mention.id)
    if (category === 'image' && !out.image) out.image = mention.id
    else if (category === 'video' && !out.video) out.video = mention.id
  }
  return out
}

/** 生成节点最终模型的优先级；空串一律视为“没有这一层”。 */
export function preferredGeneratedModel(layers: {
  explicit?: string
  planned?: string
  sessionPicked?: string
  sticky?: string
  selected?: string
}): string | undefined {
  return [
    layers.explicit,
    layers.planned,
    layers.sessionPicked,
    layers.sticky,
    layers.selected,
  ].find((value): value is string => typeof value === 'string' && value.trim() !== '')
}
