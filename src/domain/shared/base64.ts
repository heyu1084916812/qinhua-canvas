/**
 * 字节 ⇄ base64（**纯函数**，可单测；浏览器与 node 都能跑）。
 *
 * 为什么单独成文件：导出 .flow.json 时素材字节必须能过 JSON（`Uint8Array` 直接 `JSON.stringify`
 * 会变成 `{"0":137,"1":80,…}` —— 又大一倍、导入时也还原不回来），而"怎么编码"这件事
 * 不该散在导出、导入、将来别的导出（比如漫画）里各写一遍。
 */

/** 一次处理多少字节：`String.fromCharCode(...args)` 的参数个数有上限，大图必须分块 */
const CHUNK = 0x8000

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  // 浏览器与 node≥16 都有 btoa/atob（本项目两个环境都要跑）
  return btoa(binary)
}

/**
 * base64 → 字节。**输入不合法时抛**（不许静默给一段空字节）：
 * 导出文件被手改坏时，宁可让导入如实报错，也不要写进一条"有行没图"的素材。
 */
export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}
