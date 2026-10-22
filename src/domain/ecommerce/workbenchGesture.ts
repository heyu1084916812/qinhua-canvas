export type WorkbenchBlankDragIntent = 'pan' | 'marquee' | 'none'

/**
 * 电商工作台空白处的手势，与无限画布保持一致：
 * - 左键拖 = 平移
 * - Ctrl / Cmd + 左键拖 = 框选
 * - 中键、手型工具、空格 + 左键拖 = 平移
 */
export function workbenchBlankDragIntent(input: {
  button: number
  tool: 'select' | 'hand'
  spaceHeld: boolean
  ctrlKey: boolean
  metaKey: boolean
}): WorkbenchBlankDragIntent {
  if (input.button === 1 || input.tool === 'hand' || input.spaceHeld) return 'pan'
  if (input.button !== 0) return 'none'
  return input.ctrlKey || input.metaKey ? 'marquee' : 'pan'
}
