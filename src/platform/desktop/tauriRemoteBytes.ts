import { invoke } from '@tauri-apps/api/core'
import { base64ToBytes } from '../../domain/shared/base64'
import type { RemoteBytesPort } from '../ports'

/**
 * Rust `fetch_bytes` 的返回形状（见 `src-tauri/src/lib.rs` 同名命令）。
 *
 * `content_type` 是 `Option<String>`，站点没给这个头就是 `null` —— 这里如实转成空串，
 * 让调用方只需要处理一种"没给"的形态。
 */
interface RawFetchedBytes {
  status: number
  content_type: string | null
  bytes: number[] | string
}

/**
 * **取远端字节的壳实现**（对账 #396）：一条转发，不做判断。
 *
 * 为什么不在这一层"顺手校验是不是图片"：端口只承诺"把字节取回来"，
 * "这算不算一张能用的图标"归调用方（`features/shared/channelIcon/siteIcon.ts`）——
 * 两处都判就会分出两套口径（谁改了另一处不知道）。
 *
 * `bytes` 兼容两种回来的形态：正常是 JSON 数字数组（`Vec<u8>`），
 * 但 Tauri 的 IPC 在某些通道下会把二进制给成 base64 字符串 —— 都收下，
 * 免得将来换通道时这里静默坏掉（坏法会是"图标全黑"这种最难查的样子）。
 */
export function createTauriRemoteBytes(): RemoteBytesPort {
  return {
    get: async (req) => {
      const raw = await invoke<RawFetchedBytes>('fetch_bytes', {
        url: req.url,
        timeoutMs: req.timeoutMs,
      })
      return {
        status: raw.status,
        contentType: raw.content_type ?? '',
        bytes: typeof raw.bytes === 'string' ? base64ToBytes(raw.bytes) : Uint8Array.from(raw.bytes),
      }
    },
  }
}
