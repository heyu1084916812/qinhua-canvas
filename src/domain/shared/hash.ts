/** SHA-1（纯 TS，无 IO）。用于素材内容哈希、节点指纹与请求去重 */
function rotl(n: number, s: number): number {
  return (n << s) | (n >>> (32 - s))
}

function toHex(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0')
}

export function sha1Bytes(bytes: Uint8Array): string {
  const ml = bytes.length * 8
  // 补位：0x80 + 补 0 至 56 mod 64 + 8 字节长度
  const withOne = bytes.length + 1
  const paddedLen = (withOne + 8 <= 64 ? 64 : Math.ceil((withOne + 8) / 64) * 64)
  const buf = new Uint8Array(paddedLen)
  buf.set(bytes)
  buf[bytes.length] = 0x80

  const view = new DataView(buf.buffer)
  // 长度按 2^32 取模写入最后 8 字节（大端）
  view.setUint32(paddedLen - 8, Math.floor(ml / 0x100000000), false)
  view.setUint32(paddedLen - 4, ml >>> 0, false)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0

  const w = new Uint32Array(80)
  for (let i = 0; i < paddedLen; i += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = view.getUint32(i + t * 4, false)
    for (let t = 16; t < 80; t += 1) {
      w[t] = rotl(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1)
    }

    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4

    for (let t = 0; t < 80; t += 1) {
      let f: number
      let k: number
      if (t < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (t < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (t < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const temp = (rotl(a, 5) + (f >>> 0) + e + k + w[t]) >>> 0
      e = d
      d = c
      c = rotl(b, 30)
      b = a
      a = temp
    }

    h0 = (h0 + a) >>> 0
    h1 = (h1 + b) >>> 0
    h2 = (h2 + c) >>> 0
    h3 = (h3 + d) >>> 0
    h4 = (h4 + e) >>> 0
  }

  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3) + toHex(h4)
}

export function sha1Hex(input: string): string {
  return sha1Bytes(new TextEncoder().encode(input))
}

/** 截断到 8 字节（16 个 hex 字符 = 64 bit），用于节点指纹 */
export function fingerprintHex(input: string): string {
  return sha1Hex(input).slice(0, 16)
}

/**
 * 同步版**内容指纹**（对字节取 SHA-1 前 16 hex）。
 *
 * 与异步 `fingerprintBytes` 的区别只在「是否让出主线程」：两者都是标准 SHA-1、
 * **哈希值完全一致**。同步版用于**字节很小**且调用方是纯函数/同步路径的场合
 * （如 mock 通道造的几十字节 PNG），避免为等一个微任务把链路改成 async。
 *
 * 字节较大时仍应走异步版（纯 JS sha1 对 7MB 实测阻塞主线程 233ms）。
 */
export function fingerprintBytesSync(bytes: Uint8Array): string {
  return sha1Bytes(bytes).slice(0, 16)
}

function hexFromBytes(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 1) s += bytes[i].toString(16).padStart(2, '0')
  return s
}

/**
 * 按**字节内容**取指纹（M6-13）：上传素材的内容寻址。
 *
 * 与 `fingerprintHex` 同口径（同样截 16 hex），使「生成产物」与「用户上传的图」
 * 在 `assets` 表里长得一样——id 即内容哈希，同一张图重复上传自然去重
 * （再写一次是幂等 upsert，不产生第二行）。
 *
 * 注意与 `fingerprintHex(model|prompt|idx)` 的区别：那是**请求指纹**（同参同果），
 * 这是**内容指纹**（同图同 id）。
 *
 * ## 为什么是异步
 *
 * 纯 JS 的 `sha1Bytes` 要对**全部字节**跑 80 轮且同步执行——7MB 的上传图实测
 * 阻塞主线程 233ms，连传几张就是肉眼可见的卡死（还会顺带推迟持久化计时器，
 * 让素材更晚可见）。这里优先走 `crypto.subtle`：哈希在原生线程算，主线程零阻塞。
 *
 * 环境没有 `crypto.subtle`（非安全上下文、老运行时、部分 node 环境）时回落到
 * 纯 JS 实现。**两者都是标准 SHA-1，哈希值完全一致**，回落不会有第二个 id。
 */
/**
 * `crypto.subtle` 只收 `ArrayBuffer`，而 `Uint8Array` 的 `buffer` 在类型上是
 * `ArrayBufferLike`（可能是 `SharedArrayBuffer`）且视图可能只是其中一段。
 * 视图 = 整块 buffer 时零拷贝；否则拷一份，免得把相邻字节也算进哈希。
 */
function toDigestSource(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer
  }
  return bytes.slice().buffer as ArrayBuffer
}

export async function fingerprintBytes(bytes: Uint8Array): Promise<string> {
  const subtle = typeof crypto === 'object' && crypto !== null ? crypto.subtle : undefined
  if (subtle && typeof subtle.digest === 'function') {
    try {
      const digest = await subtle.digest('SHA-1', toDigestSource(bytes))
      return hexFromBytes(new Uint8Array(digest)).slice(0, 16)
    } catch {
      // 某些实现对空 / 超大 buffer 会抛，回落到纯 JS（结果等价）
    }
  }
  return sha1Bytes(bytes).slice(0, 16)
}
