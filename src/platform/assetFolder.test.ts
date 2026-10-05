import { describe, expect, it } from 'vitest'
import { createMemoryAssetFolder } from './memory/index'

/**
 * 素材文件夹端口的**契约测试**（对账 #196）。
 *
 * 用内存实现钉住行为：浏览器实现（FSA）与桌面壳实现（原生目录）都必须满足同一套约定，
 * 尤其是「文件不存在返回 null」——它与「读取失败」必须能被上层区分开，
 * 否则界面会把"素材缺失"显示成"读取出错"，或反过来假装有图。
 */
describe('素材文件夹端口契约', () => {
  it('没授权时 current 为空；pick 之后拿到目录名', async () => {
    const folder = createMemoryAssetFolder()
    expect(folder.current()).toBe(null)
    const picked = await folder.pick()
    expect(picked?.name).toBeTruthy()
    expect(folder.current()?.name).toBe(picked?.name)
  })

  it('写入 → 存在 → 读回同一个 blob；同名覆盖是幂等的', async () => {
    const folder = createMemoryAssetFolder()
    await folder.pick()
    expect(await folder.has('h1.png')).toBe(false)
    expect(await folder.read('h1.png')).toBe(null)

    const a = new Blob(['a'], { type: 'image/png' })
    await folder.write('h1.png', a)
    expect(await folder.has('h1.png')).toBe(true)
    expect(await (await folder.read('h1.png'))?.text()).toBe('a')

    // 同名即同 hash ⇒ 覆盖（重传同一张图不该产生新文件）
    await folder.write('h1.png', new Blob(['b'], { type: 'image/png' }))
    expect(await (await folder.read('h1.png'))?.text()).toBe('b')
    expect(await folder.list()).toEqual(['h1.png'])
  })

  it('可以预置目录内容（测试"加载某个文件夹的内容"）', async () => {
    const folder = createMemoryAssetFolder({
      assetFolderFiles: {
        'aaa.png': new Blob(['x'], { type: 'image/png' }),
        'bbb.mp4': new Blob(['y'], { type: 'video/mp4' }),
      },
    })
    expect((await folder.list()).sort()).toEqual(['aaa.png', 'bbb.mp4'])
    expect(await (await folder.read('bbb.mp4'))?.text()).toBe('y')
  })
})
