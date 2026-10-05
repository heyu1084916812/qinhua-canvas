import { invoke } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import { exists, readDir, readFile, writeFile } from '@tauri-apps/plugin-fs'
import { assetMimeOfName } from '../../domain/shared/assetLocation'
import type { AssetFolderPort } from '../ports'

/**
 * 素材文件夹的**桌面壳实现**（Tauri 2 · 方案 §4.3）。
 *
 * 与浏览器实现（`web/assetFolder.ts`，File System Access）**同一个端口**，语义只有一处刻意不同：
 *
 * | | 浏览器 | 桌面壳 |
 * | --- | --- | --- |
 * | 目录句柄 | 只在内存里，刷新后要用户重选（浏览器不允许静默恢复权限） | **记住路径**（`localStorage`），每次启动由 Rust 侧重新授权 |
 *
 * 为什么壳里必须记住：迁移的整套承诺就是"素材放在文件夹里、应用读它"；
 * 每次启动都要用户重选一次目录的话，所有素材会先显示「缺失」——那是把迁移做成了摆设。
 *
 * 其余三条与浏览器侧一致：
 * 1. **`read` 读不到返回 `null`**（＝素材缺失），不是抛"读取失败"；
 * 2. **mime 从文件名反推**（`<hash>.<ext>` 的内容寻址命名 ⇒ 扩展名就是类型）——
 *    桌面侧**必须**这么做：`readFile` 没有 `File.type`，而导入链路靠 mime 判断
 *    「这是不是画布能吃的素材」（`isImportableMedia`）；
 * 3. **目录不在了 = 当作没选目录**（如实回落内置库，而不是每次读都报错）。
 */

/** 记住的目录路径（前端自己的数据；Rust 侧只按它重新打开 fs 作用域） */
export const ASSET_FOLDER_PATH_KEY = 'qinghua:assetFolder:path'

function readRemembered(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(ASSET_FOLDER_PATH_KEY) || null
  } catch {
    return null // 隐私模式 / 存储不可用：记不住不影响本次使用
  }
}

function remember(path: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(ASSET_FOLDER_PATH_KEY, path)
  } catch {
    /* 同上：记不住只是"下次要重选"，不该让选目录这件事失败 */
  }
}

function forget(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(ASSET_FOLDER_PATH_KEY)
  } catch {
    /* 同上 */
  }
}

/** 路径 → 显示用的目录名（同步：`current()` 是同步接口，而 `basename` 是异步的） */
export function folderNameOf(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

export function createTauriAssetFolder(): AssetFolderPort {
  let root: string | null = readRemembered()
  /** 本次运行是否已为 `root` 重新授权过（fs 作用域每次运行一份，重启后要再来一次） */
  let granted = false

  /** 用之前先确保"这次运行"授权过；目录已经不在了就当作没选 */
  const usableRoot = async (): Promise<string | null> => {
    if (!root) return null
    if (!granted) {
      const ok = await invoke<boolean>('grant_folder', { path: root }).catch(() => false)
      if (!ok) {
        root = null
        forget()
        return null
      }
      granted = true
    }
    return root
  }

  return {
    /** 桌面壳里一定有原生目录选择器 */
    supported() {
      return true
    },

    current() {
      return root ? { name: folderNameOf(root) } : null
    },

    async pick() {
      const picked = await invoke<string | null>('pick_folder')
      if (!picked) return null // 用户取消：不是错误
      root = picked
      granted = true // pick_folder 已经授权过
      remember(picked)
      return { name: folderNameOf(picked) }
    },

    async has(name) {
      const dir = await usableRoot()
      if (!dir) return false
      try {
        return await exists(await join(dir, name))
      } catch {
        return false
      }
    },

    async read(name) {
      const dir = await usableRoot()
      if (!dir) return null
      try {
        const bytes = await readFile(await join(dir, name))
        return new Blob([bytes], { type: assetMimeOfName(name) ?? '' })
      } catch {
        return null
      }
    },

    async write(name, blob) {
      const dir = await usableRoot()
      if (!dir) throw new Error('[assetFolder] 尚未选择素材文件夹')
      await writeFile(await join(dir, name), new Uint8Array(await blob.arrayBuffer()))
    },

    async list() {
      const dir = await usableRoot()
      if (!dir) return []
      const entries = await readDir(dir)
      return entries.filter((entry) => entry.isFile).map((entry) => entry.name)
    },
  }
}
