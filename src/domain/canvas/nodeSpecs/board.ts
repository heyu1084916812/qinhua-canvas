import type { BoardData } from '../model/node'
import type { NodeSpec } from './types'
import { NODE_MINIMUMS } from '../layout/constants'

/**
 * 画板节点规格（M0 只落结构与默认数据）。
 * 画板无端点（架构 §4.1），内部走独立流水线，可承载任意节点作为子级。
 * generate 留空：画板内生图属于 M2。
 */
export const boardSpec: NodeSpec<BoardData> = {
  type: 'board',
  label: '画板',
  sizing: { min: NODE_MINIMUMS.board },
  ports: { input: false, output: false },
  accepts: { upstream: [] },
  createDefaultData(): BoardData {
    return { bg: { color: '#ffffff', opacity: 1 }, strokes: [], texts: [] }
  },
  collectInputs() {
    return []
  },
}
