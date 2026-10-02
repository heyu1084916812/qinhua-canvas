/**
 * 字节 → base64（**分块**，别写 `String.fromCharCode(...bytes)`：几 MB 的图会爆栈）。
 *
 * 用途：参考图 / 首尾帧要以 `data:image/png;base64,…` 的形式进请求体 ——
 * 2026-10-03 实测 Agnes 的图片与视频接口都收这种形态（对账清单 #115）。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
