import { invoke } from '@tauri-apps/api/core'
import { basename } from '@tauri-apps/api/path'
import { readFile, writeFile } from '@tauri-apps/plugin-fs'
import { openUrl } from '@tauri-apps/plugin-opener'
import { assetExtensionsOfMime, assetMimeOfName } from '../../domain/shared/assetLocation'
import type { FilePort, PickedFile } from '../ports'

/**
 * `FilePort` 的**桌面壳实现**（Tauri 2 · 方案 §4.3）。
 *
 * 为什么"另存为/打开"要放 Rust 侧：WebView2 里 `showSaveFilePicker` 的行为与 Chrome 不完全一致
 * （方案 §4.3 明确要复验并兜底），而原生对话框在壳里是**确定可用**的那条路。
 * 权限与作用域同 `tauriAssetFolder`：Rust 侧弹框 → 顺手把选中的路径加进 fs 作用域 → 前端读写。
 */

/**
 * `accept` 串 → 对话框的扩展名清单。
 *
 * `accept` 里**两种写法混着来**（既有 mime 也有裸扩展名）：如项目导入传的是
 * `.json,application/json`。两种都要认；认不出来的**丢掉**（一个都不认就不过滤）——
 * 猜一个扩展名塞进去，用户会在自己的文件里选不到东西。
 */
export function acceptToExtensions(accept?: string): string[] {
  const out = new Set<string>()
  for (const raw of (accept ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (raw.startsWith('.')) {
      out.add(raw.slice(1))
      continue
    }
    for (const ext of assetExtensionsOfMime(raw)) out.add(ext)
  }
  return [...out]
}

function mimeOf(name: string): string {
  return assetMimeOfName(name) ?? ''
}

export function createTauriFiles(): FilePort {
  /** 已有 Blob 的落盘：两条入口（本地字节 / 远端取回字节）共用一份 */
  async function saveBlob(name: string, blob: Blob): Promise<void> {
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
    const path = await invoke<string | null>('save_file_dialog', {
      name,
      extensions: ext ? [ext] : [],
    })
    // 用户在保存框里点了取消：不写盘、也不报错（与浏览器侧点掉"另存为"同一口径）
    if (!path) return
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()))
  }

  return {
    async pickFile(accept): Promise<PickedFile | null> {
      const path = await invoke<string | null>('pick_file', {
        title: '选择文件',
        extensions: acceptToExtensions(accept),
      })
      if (!path) return null
      const bytes = await readFile(path)
      let name = path
      try {
        name = await basename(path)
      } catch {
        /* 拿不到文件名就用路径兜底（至少不丢） */
      }
      return { name, size: bytes.byteLength, mime: mimeOf(name), blob: new Blob([bytes], { type: mimeOf(name) }) }
    },

    async saveFile(name, blob) {
      await saveBlob(name, blob)
    },

    /**
     * 远端素材落盘（视频成片那类只有 url 的行）。
     *
     * 与浏览器侧同一条口径：先试 `fetch`（托管域放行时能真拿到字节）；拿不到就把地址
     * **交给系统默认浏览器**（`openUrl`）——桌面壳里那才是"用户自己去下载"的正确出口，
     * 而不是在应用内新开一个窗口。
     */
    async saveFromUrl(url, name) {
      try {
        const res = await fetch(url)
        if (res.ok) {
          await saveBlob(name, await res.blob())
          return 'saved'
        }
      } catch {
        /* 被 CORS 拦下：字节这条路走不通，落到下面的"交给系统浏览器" */
      }
      await openUrl(url)
      return 'opened'
    },
  }
}
