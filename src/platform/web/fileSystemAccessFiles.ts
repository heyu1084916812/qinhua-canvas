import type { FilePort, PickedFile } from '../ports'

interface FilePickerWindow extends Window {
  showOpenFilePicker?: (opts: unknown) => Promise<FileSystemFileHandleLike[]>
  showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandleLike>
}

interface FileSystemFileHandleLike {
  getFile(): Promise<File>
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>
}

/** 常见 mime → 扩展名（File System Access 的 accept 要求「mime → 扩展名列表」，不是逗号串） */
const EXT_BY_MIME: Record<string, string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
  'video/quicktime': ['.mov'],
  'video/*': ['.mp4', '.webm', '.mov'],
  'application/json': ['.json'],
  'text/plain': ['.txt'],
}

/**
 * HTML `accept` 逗号串 → File System Access 的 `types`。
 *
 * **绝不能把整串当成一个 mime key**（`{ 'image/png,image/jpeg': [] }`）：
 * Chrome 会直接抛 `TypeError: Invalid type: image/png,image/jpeg`，若再被
 * `catch` 一律吞成 null，用户看到的就是**点了上传按钮毫无反应**——
 * 静默失败是这类 bug 最难排查的地方（控制台都不报错）。
 * 映射表里没有的类型直接跳过；一个都不认识时返回空数组（= 不过滤）。
 */
export function acceptToTypes(accept?: string): { accept: Record<string, string[]> }[] {
  if (!accept) return []
  const map: Record<string, string[]> = {}
  for (const mime of accept.split(',').map((s) => s.trim()).filter(Boolean)) {
    const ext = EXT_BY_MIME[mime]
    if (ext) map[mime] = ext
  }
  return Object.keys(map).length > 0 ? [{ accept: map }] : []
}

/** 用户主动取消：不该再弹一次框；其余错误（含参数非法）要退回 <input> 兜底 */
function isUserCancel(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError'
}

function useInputFallback(accept?: string): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (accept) input.accept = accept
    input.onchange = () => {
      const file = input.files?.[0]
      resolve(file ? { name: file.name, size: file.size, mime: file.type, blob: file } : null)
    }
    // 现代浏览器在用户取消时会派发 cancel；不接的话这个 Promise 永远不 resolve，
    // 调用方的 await 就挂在那儿（既不返回也不报错）
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

/** File System Access API 优先，不支持或出错时退回 <input type=file> */
export function createFileAccessFiles(): FilePort {
  /** 已有 Blob 的落盘：两条入口（本地字节 / 远端取回字节）共用一份 */
  async function saveBlob(name: string, blob: Blob): Promise<void> {
    const w = window as FilePickerWindow
    if (w.showSaveFilePicker) {
      const handle = await w.showSaveFilePicker({ suggestedName: name })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }

  return {
    async pickFile(accept) {
      const w = window as FilePickerWindow
      if (!w.showOpenFilePicker) return useInputFallback(accept)
      try {
        const types = acceptToTypes(accept)
        const [handle] = await w.showOpenFilePicker({
          ...(types.length > 0 ? { types } : {}),
          multiple: false,
        })
        if (!handle) return null
        const file = await handle.getFile()
        return { name: file.name, size: file.size, mime: file.type, blob: file }
      } catch (err) {
        if (isUserCancel(err)) return null
        // 兜底而非返回 null：参数写错、权限限制、无用户激活……任何一种都不该
        // 表现为「点了没反应」。用户还能通过 <input> 把文件选出来。
        return useInputFallback(accept)
      }
    },

    async saveFile(name, blob) {
      await saveBlob(name, blob)
    },

    /**
     * 远端素材落盘（用户 2026-10-03：「节点的下载功能无法下载，显示素材不在素材库」）。
     *
     * 视频成片托管在 Agnes 的产物域（`cos-platform-outputs.agnes-ai.cn` /
     * `platform-outputs.agnes-ai.space`），**没有 CORS 头**：页面里的 `fetch` 一律
     * `net::ERR_FAILED`，字节进不来。所以这里两条路都要留：
     *
     * 1. 先试 `fetch` —— 托管域放行时能真拿到字节，走正常的「另存为」；
     * 2. 拿不到就把地址交回浏览器（新标签页）：浏览器自己去取不受 CORS 限制，
     *    用户在自带的播放器里点下载即可。
     *
     * **绝不能**用 `<a download>` 裸点：跨域时 `download` 会被忽略，等于把
     * 整个画布页面导航走（浏览器实测：当前页直接跳到视频地址）。
     */
    async saveFromUrl(url, name) {
      try {
        const res = await fetch(url)
        if (res.ok) {
          await saveBlob(name, await res.blob())
          return 'saved'
        }
      } catch {
        /* 被 CORS 拦下：字节这条路走不通，落到下面的新标签页 */
      }
      const a = document.createElement('a')
      a.href = url
      a.target = '_blank'
      a.rel = 'noopener'
      a.download = name
      a.click()
      return 'opened'
    },
  }
}
