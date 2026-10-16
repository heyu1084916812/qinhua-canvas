import { describe, expect, it } from 'vitest'
import { clipboardMediaFiles, draggedFiles, hasDraggedFiles } from './dropImport'

/**
 * 这一组钉的是「**怎么判断这是不是一次文件拖拽**」这条判据本身。
 *
 * 背景（对账 #551）：`onDragOver` 曾用「文件列表长不长」判断，而 `dragover` 阶段
 * 浏览器**不给** `dataTransfer.files`（安全限制，恒为空）⇒ 那一支直接 return、
 * 不 `preventDefault` ⇒ 浏览器认定这里不接收 ⇒ **`drop` 永不派发**。
 * 用户看到的是「从软件外面拖不进来」，而合成事件的冒烟全绿。
 * 所以判据只能是 `types.includes('Files')`，这条测试把这个形状固定下来。
 */

/** 造一个只有 `types` / `files` / `items` 的最小 dataTransfer 替身（node 环境没有 DataTransfer） */
function dt(opts: {
  types?: string[]
  files?: File[]
  items?: { kind: string; type: string; file: File | null }[]
}): { dataTransfer: DataTransfer } {
  const dataTransfer = {
    types: opts.types ?? [],
    files: opts.files ?? [],
    items: (opts.items ?? []).map((i) => ({ ...i, getAsFile: () => i.file })),
  } as unknown as DataTransfer
  return { dataTransfer }
}

describe('拖放判据（dragover 与 drop 两阶段的形状不同）', () => {
  it('★★★ dragover 阶段：files 为空但 types 含 Files，仍必须认成文件拖拽', () => {
    const dragging = dt({ types: ['Files'], files: [] })
    expect(hasDraggedFiles(dragging)).toBe(true)
    /** 这正是当年误判的形状：用 files 判断会得到"不是文件" */
    expect(draggedFiles(dragging)).toEqual([])
  })

  it('★ 画布内的节点拖拽（没有 Files 类型）不算文件拖拽', () => {
    const nodeDrag = dt({ types: ['text/plain'], files: [] })
    expect(hasDraggedFiles(nodeDrag)).toBe(false)
    expect(draggedFiles(nodeDrag)).toEqual([])
  })

  it('drop 阶段：files 里真有文件时才取出来', () => {
    const dropped = new File([new Uint8Array([1, 2])], 'a.png', { type: 'image/png' })
    expect(draggedFiles(dt({ types: ['Files'], files: [dropped] }))).toEqual([dropped])
  })
})

describe('系统剪贴板里的媒体文件', () => {
  const png = (name = 'shot.png', bytes = [1, 2, 3]): File =>
    new File([new Uint8Array(bytes)], name, { type: 'image/png' })

  it('★ 取到图片文件', () => {
    const shot = png()
    expect(clipboardMediaFiles(dt({ files: [shot] }).dataTransfer)).toEqual([shot])
  })

  it('★★ 剪贴板里没有媒体 → 空数组（调用方据此放行默认粘贴，不吞粘文字）', () => {
    const text = new File([new Uint8Array([1])], 'a.txt', { type: 'text/plain' })
    expect(clipboardMediaFiles(dt({ files: [text] }).dataTransfer)).toEqual([])
    expect(clipboardMediaFiles(null)).toEqual([])
  })

  it('★ 有些来源只挂在 items 上（kind: file）', () => {
    const shot = png('from-items.png')
    const data = dt({ files: [], items: [{ kind: 'file', type: 'image/png', file: shot }] })
    expect(clipboardMediaFiles(data.dataTransfer)).toEqual([shot])
  })

  it('★ files 与 items 各报一遍同一个文件时按身份去重', () => {
    const shot = png('same.png')
    const data = dt({ files: [shot], items: [{ kind: 'file', type: 'image/png', file: shot }] })
    expect(clipboardMediaFiles(data.dataTransfer)).toHaveLength(1)
  })
})
