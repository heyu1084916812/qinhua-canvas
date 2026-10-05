import { beforeEach, describe, expect, it, vi } from 'vitest'
import { acceptToExtensions, createTauriFiles } from './tauriFiles'

/**
 * `FilePort` 的**桌面壳实现**（对账 #218 · P1）。
 *
 * 两个必须钉住的点：
 * ① `pickFile` 交回来的 Blob **必须带对的 mime** —— 导入链路用 `isImportableMedia(mime)` 判
 *    "这是不是画布能吃的素材"，mime 空着用户就会看到"选中的图不是素材"；
 * ② 远端素材（`saveFromUrl`）拿不到字节时**交给系统浏览器**并如实报 `'opened'`，
 *    不能假装存好了，也不能在应用内新开一个窗口。
 */
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  openUrl: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true }))
vi.mock('@tauri-apps/plugin-fs', () => ({ readFile: mocks.readFile, writeFile: mocks.writeFile }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: mocks.openUrl }))
vi.mock('@tauri-apps/api/path', () => ({
  basename: async (p: string) => p.split('\\').filter(Boolean).pop() ?? p,
}))

describe('accept → 对话框扩展名', () => {
  it('mime 与裸扩展名混排都要认；认不出的丢掉（不过滤，别猜）', () => {
    expect(acceptToExtensions('image/png,image/jpeg')).toEqual(['png', 'jpg', 'jpeg'])
    expect(acceptToExtensions('.json,application/json')).toEqual(['json'])
    expect(acceptToExtensions('image/*')).toEqual(['png', 'jpg', 'jpeg', 'webp', 'gif'])
    expect(acceptToExtensions('application/pdf,text/wat')).toEqual([])
    expect(acceptToExtensions(undefined)).toEqual([])
  })
})

describe('文件读写（桌面壳）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('★ 选文件：mime 由扩展名反推并写进 Blob（否则导入链路会判"不是素材"）', async () => {
    const files = createTauriFiles()
    mocks.invoke.mockResolvedValueOnce('D:\\图\\小猫.jpeg')
    mocks.readFile.mockResolvedValueOnce(new Uint8Array([1, 2]))
    const picked = await files.pickFile('image/png,image/jpeg')
    expect(mocks.invoke).toHaveBeenCalledWith('pick_file', {
      title: '选择文件',
      extensions: ['png', 'jpg', 'jpeg'],
    })
    expect(picked).toMatchObject({ name: '小猫.jpeg', size: 2, mime: 'image/jpeg' })
    expect(picked?.blob.type).toBe('image/jpeg')
  })

  it('用户取消（返回 null）→ null，且不去读文件', async () => {
    const files = createTauriFiles()
    mocks.invoke.mockResolvedValueOnce(null)
    expect(await files.pickFile('image/*')).toBeNull()
    expect(mocks.readFile).not.toHaveBeenCalled()
  })

  it('另存为：先弹保存框（带建议文件名），再按返回路径写字节', async () => {
    const files = createTauriFiles()
    mocks.invoke.mockResolvedValueOnce('D:\\导出\\项目.flow.json')
    await files.saveFile('项目.flow.json', new Blob([new Uint8Array([7])]))
    expect(mocks.invoke).toHaveBeenCalledWith('save_file_dialog', {
      name: '项目.flow.json',
      extensions: ['json'],
    })
    const [path, data] = mocks.writeFile.mock.calls[0] as [string, Uint8Array]
    expect(path).toBe('D:\\导出\\项目.flow.json')
    expect(Array.from(data)).toEqual([7])
  })

  it('保存框里点取消（null）→ 不写盘、也不报错', async () => {
    const files = createTauriFiles()
    mocks.invoke.mockResolvedValueOnce(null)
    await files.saveFile('a.png', new Blob(['x']))
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('★★ 远端素材：能取到字节就 saved；被 CORS 拦下就交给系统浏览器并如实报 opened', async () => {
    const files = createTauriFiles()
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob([new Uint8Array([1])], { type: 'video/mp4' }),
    })
    vi.stubGlobal('fetch', fetchMock)
    mocks.invoke.mockResolvedValueOnce('D:\\导出\\成片.mp4')
    expect(await files.saveFromUrl('https://x/a.mp4', '成片.mp4')).toBe('saved')
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)
    expect(mocks.openUrl).not.toHaveBeenCalled()

    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('CORS')))
    expect(await files.saveFromUrl('https://x/a.mp4', '成片.mp4')).toBe('opened')
    expect(mocks.openUrl).toHaveBeenCalledWith('https://x/a.mp4')
    vi.unstubAllGlobals()
  })
})
