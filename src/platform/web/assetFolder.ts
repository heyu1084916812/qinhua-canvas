import type { AssetFolderPort } from '../ports'

/**
 * 素材文件夹的**浏览器实现**（File System Access）。
 *
 * 与 `fileSystemAccessFiles.ts` 同款做法：TS 的 lib 里不一定带 FSA 的目录类型，
 * 所以这里只声明"用得上的那几个方法"的 Like 接口，而不是依赖全局类型。
 * 封装成桌面壳（Tauri）后换成 Rust 侧目录读写，**这个文件整个被替换**，上层不动。
 */

interface WritableLike {
  write(data: Blob): Promise<void>
  close(): Promise<void>
}

interface FileHandleLike {
  getFile(): Promise<File>
  createWritable(): Promise<WritableLike>
}

interface DirHandleLike {
  name: string
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileHandleLike>
  entries?(): AsyncIterableIterator<[string, { kind: string }]>
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: (opts?: unknown) => Promise<DirHandleLike>
}

function pickerWindow(): DirectoryPickerWindow | null {
  return typeof window === 'undefined' ? null : (window as DirectoryPickerWindow)
}

function isAbort(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError'
}

export function createWebAssetFolder(): AssetFolderPort {
  /** 句柄只活在内存里：浏览器不允许静默恢复目录权限，刷新后由用户重新授权 */
  let root: DirHandleLike | null = null

  return {
    supported() {
      return typeof pickerWindow()?.showDirectoryPicker === 'function'
    },

    current() {
      return root ? { name: root.name } : null
    },

    async pick() {
      const picker = pickerWindow()?.showDirectoryPicker
      if (typeof picker !== 'function') return null
      try {
        root = await picker({ mode: 'readwrite', id: 'qinghua-assets' })
        return { name: root.name }
      } catch (err) {
        // 用户取消不是错误（与 FilePort 的 AbortError 处理同一口径）
        if (isAbort(err)) return null
        throw err
      }
    },

    async has(name) {
      if (!root) return false
      try {
        await root.getFileHandle(name)
        return true
      } catch {
        return false
      }
    },

    async read(name) {
      if (!root) return null
      try {
        const handle = await root.getFileHandle(name)
        return await handle.getFile()
      } catch {
        // 文件不在 = 素材缺失（与"读取失败"同一条返回，调用方按缺失呈现）
        return null
      }
    },

    async write(name, blob) {
      if (!root) throw new Error('[assetFolder] 尚未授权素材文件夹')
      const handle = await root.getFileHandle(name, { create: true })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
    },

    async list() {
      if (!root?.entries) return []
      const out: string[] = []
      for await (const [name, handle] of root.entries()) {
        if (handle?.kind === 'file') out.push(name)
      }
      return out
    },
  }
}
