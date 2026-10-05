import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ASSET_FOLDER_PATH_KEY, createTauriAssetFolder, folderNameOf } from './tauriAssetFolder'

/**
 * 素材文件夹的**桌面壳实现**（对账 #218 / #219 · P1）。
 *
 * 这里钉死四件最容易"看起来对"的事：
 * ① 路径一定要**拼在已选目录之下**（拼错就等于往用户磁盘别处写文件）；
 * ② `read` 读不到 = **`null`（素材缺失）**，不是抛"读取失败"；
 * ③ mime **从扩展名反推**（桌面侧没有 `File.type`，不给的话导入链路会把图判成"不是素材"）；
 * ④ **记住的目录**：重启后先重新授权再读（作用域每次运行一份），目录不在了就当作没选。
 */
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  exists: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readDir: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: mocks.exists,
  readFile: mocks.readFile,
  writeFile: mocks.writeFile,
  readDir: mocks.readDir,
}))
vi.mock('@tauri-apps/api/path', () => ({
  join: async (...parts: string[]) => parts.join('\\'),
}))

/** 一个够用的 localStorage 替身（node 环境没有它） */
function stubLocalStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  return store
}

describe('素材文件夹（桌面壳）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubLocalStorage()
  })

  it('目录名从路径取（同步接口要用的那个）', () => {
    expect(folderNameOf('D:\\我的素材\\画布素材')).toBe('画布素材')
    expect(folderNameOf('C:/assets/')).toBe('assets')
  })

  it('没选目录时：不读不写（与浏览器侧"选过才算授权"同一口径）', async () => {
    const folder = createTauriAssetFolder()
    expect(folder.current()).toBeNull()
    expect(await folder.has('h1.png')).toBe(false)
    expect(await folder.read('h1.png')).toBeNull()
    expect(await folder.list()).toEqual([])
    await expect(folder.write('h1.png', new Blob(['x']))).rejects.toThrow()
    expect(mocks.writeFile).not.toHaveBeenCalled()
  })

  it('选目录：拿到绝对路径，显示目录名，并**记住**它；取消（null）不改状态', async () => {
    const store = stubLocalStorage()
    const folder = createTauriAssetFolder()
    mocks.invoke.mockResolvedValueOnce(null)
    expect(await folder.pick()).toBeNull()
    expect(folder.current()).toBeNull()

    mocks.invoke.mockResolvedValueOnce('D:\\我的素材\\画布素材')
    expect(await folder.pick()).toEqual({ name: '画布素材' })
    expect(mocks.invoke).toHaveBeenLastCalledWith('pick_folder')
    expect(folder.current()).toEqual({ name: '画布素材' })
    expect(store.get(ASSET_FOLDER_PATH_KEY)).toBe('D:\\我的素材\\画布素材')
  })

  it('★ 写盘路径拼在已选目录之下，内容是字节', async () => {
    const folder = createTauriAssetFolder()
    mocks.invoke.mockResolvedValueOnce('D:\\素材')
    await folder.pick()
    await folder.write('abc.png', new Blob([new Uint8Array([1, 2, 3])]))
    const [path, data] = mocks.writeFile.mock.calls[0] as [string, Uint8Array]
    expect(path).toBe('D:\\素材\\abc.png')
    expect(Array.from(data)).toEqual([1, 2, 3])
  })

  it('★★ 读素材：mime 从扩展名反推（桌面侧没有 File.type）', async () => {
    const folder = createTauriAssetFolder()
    mocks.invoke.mockResolvedValueOnce('D:\\素材')
    await folder.pick()
    mocks.readFile.mockResolvedValueOnce(new Uint8Array([9]))
    expect((await folder.read('abc.jpeg'))?.type).toBe('image/jpeg')
    mocks.readFile.mockResolvedValueOnce(new Uint8Array([9]))
    expect((await folder.read('v.mp4'))?.type).toBe('video/mp4')
  })

  it('★★ 读不到（文件被删/移走）= null（素材缺失），而不是抛', async () => {
    const folder = createTauriAssetFolder()
    mocks.invoke.mockResolvedValueOnce('D:\\素材')
    await folder.pick()
    mocks.readFile.mockRejectedValueOnce(new Error('NotFound'))
    expect(await folder.read('abc.png')).toBeNull()
    mocks.exists.mockRejectedValueOnce(new Error('boom'))
    expect(await folder.has('abc.png')).toBe(false)
  })

  it('目录清单只收文件（子目录不进"素材清单"）', async () => {
    const folder = createTauriAssetFolder()
    mocks.invoke.mockResolvedValueOnce('D:\\素材')
    await folder.pick()
    mocks.readDir.mockResolvedValueOnce([
      { name: 'a.png', isFile: true, isDirectory: false, isSymlink: false },
      { name: 'sub', isFile: false, isDirectory: true, isSymlink: false },
    ])
    expect(await folder.list()).toEqual(['a.png'])
    expect(mocks.readDir).toHaveBeenCalledWith('D:\\素材')
  })

  it('★★ 记住的目录：重启后先重新授权（只授一次），之后照常读', async () => {
    stubLocalStorage({ [ASSET_FOLDER_PATH_KEY]: 'D:\\素材' })
    const folder = createTauriAssetFolder()
    expect(folder.current()).toEqual({ name: '素材' })
    mocks.invoke.mockResolvedValueOnce(true) // grant_folder
    mocks.readFile.mockResolvedValueOnce(new Uint8Array([1]))
    expect(await folder.read('a.png')).not.toBeNull()
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith('grant_folder', { path: 'D:\\素材' })

    mocks.readFile.mockResolvedValueOnce(new Uint8Array([2]))
    await folder.read('b.png')
    expect(mocks.invoke).toHaveBeenCalledTimes(1) // 不重复授权
  })

  it('★★ 记住的目录**已经不在了**（被移动/删除）：当作没选，并清掉记忆', async () => {
    const store = stubLocalStorage({ [ASSET_FOLDER_PATH_KEY]: 'E:\\拔掉的盘\\素材' })
    const folder = createTauriAssetFolder()
    mocks.invoke.mockResolvedValueOnce(false) // grant_folder: 目录不存在
    expect(await folder.read('a.png')).toBeNull()
    expect(folder.current()).toBeNull()
    expect(store.has(ASSET_FOLDER_PATH_KEY)).toBe(false)
    expect(await folder.list()).toEqual([])
  })

  it('重新授权抛错（权限被拒）：也当作没选，别让读取链路炸掉', async () => {
    stubLocalStorage({ [ASSET_FOLDER_PATH_KEY]: 'D:\\素材' })
    const folder = createTauriAssetFolder()
    mocks.invoke.mockRejectedValueOnce(new Error('denied'))
    expect(await folder.has('a.png')).toBe(false)
    expect(folder.current()).toBeNull()
  })
})
