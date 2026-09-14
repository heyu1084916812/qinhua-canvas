const FALLBACK_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

function randomId(): string {
  let out = ''
  for (let i = 0; i < 16; i += 1) {
    out += FALLBACK_ALPHABET[Math.floor(Math.random() * FALLBACK_ALPHABET.length)]
  }
  return out
}

/** 生成 id。优先用 WebCrypto，不可用时退回随机串（仅测试环境会出现） */
export function createId(prefix?: string): string {
  const raw = globalThis.crypto?.randomUUID?.() ?? randomId()
  return prefix ? `${prefix}_${raw}` : raw
}
