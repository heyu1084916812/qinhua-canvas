import { uiScaleFactor, type UiScale } from '../../domain/ui/appearance'

export interface FontScaleRoot {
  style: Pick<CSSStyleDeclaration, 'removeProperty' | 'setProperty'>
}

/**
 * 把界面字号档位应用到根节点。
 *
 * 必须先移除本 Provider 上一次写入的内联值，再从 tokens.css 的计算值重新缩放。
 * 若直接拿当前计算值做乘法，热更新或 Provider 重挂会把上一档再次乘进去，
 * 多刷几次后整套设置界面会变成两倍字号。
 */
export function applyUiFontScale(args: {
  root: FontScaleRoot
  tokens: readonly string[]
  scale: UiScale
  readComputed: (token: string) => string
}): void {
  for (const token of args.tokens) args.root.style.removeProperty(token)
  const bases = args.tokens.map((token) => {
    const value = Number.parseFloat(args.readComputed(token))
    return Number.isFinite(value) && value > 0 ? value : null
  })
  const factor = uiScaleFactor(args.scale)
  args.tokens.forEach((token, index) => {
    const base = bases[index]
    if (base === null) return
    args.root.style.setProperty(
      token,
      `${Math.round(base * factor * 100) / 100}px`,
    )
  })
}
