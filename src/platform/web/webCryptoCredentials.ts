import type { CredentialPort } from '../ports'

const SALT_STORAGE_KEY = 'qinghua.cred.salt'
const REF_PREFIX = 'qinghua.cred.'
const PASSPHRASE = 'qinghua.local'
const PBKDF2_ROUNDS = 100_000

interface StoredCredential {
  iv: number[]
  ciphertext: number[]
}

/**
 * WebCrypto AES-GCM 凭据存储。
 *
 * 安全边界说明（与产品文档 §2.3 一致）：密钥由本机随机盐派生、盐也存本机，
 * 因此它能防止明文散落在业务表与日志里被直接检索，**不能**抵抗拿到本机数据的人。
 * 文档把它写为「仅用于本机开发与使用」，这里不使用更强措辞。
 */
function encode(bytes: ArrayBuffer): number[] {
  return [...new Uint8Array(bytes)]
}

function decode(values: number[]): Uint8Array {
  return new Uint8Array(values)
}

export function createWebCryptoCredentials(
  backing: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage,
): CredentialPort {
  const subtle = globalThis.crypto?.subtle

  const getSalt = (): Uint8Array => {
    const existing = backing.getItem(SALT_STORAGE_KEY)
    if (existing) return decode(JSON.parse(existing) as number[])
    const salt = crypto.getRandomValues(new Uint8Array(16))
    backing.setItem(SALT_STORAGE_KEY, JSON.stringify(encode(salt.buffer as ArrayBuffer)))
    return salt
  }

  const deriveKey = async (): Promise<CryptoKey> => {
    if (!subtle) throw new Error('[credentials] 当前环境不支持 WebCrypto')
    const material = await subtle.importKey(
      'raw',
      new TextEncoder().encode(PASSPHRASE),
      'PBKDF2',
      false,
      ['deriveKey'],
    )
    return subtle.deriveKey(
      { name: 'PBKDF2', salt: getSalt() as BufferSource, iterations: PBKDF2_ROUNDS, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  }

  return {
    async save(ref, secret) {
      const key = await deriveKey()
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ciphertext = await subtle!.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(secret),
      )
      const stored: StoredCredential = { iv: encode(iv.buffer as ArrayBuffer), ciphertext: encode(ciphertext) }
      backing.setItem(REF_PREFIX + ref, JSON.stringify(stored))
    },

    async load(ref) {
      const raw = backing.getItem(REF_PREFIX + ref)
      if (!raw) return null
      const parsed = JSON.parse(raw) as StoredCredential
      const key = await deriveKey()
      const plain = await subtle!.decrypt(
        { name: 'AES-GCM', iv: decode(parsed.iv) as BufferSource },
        key,
        decode(parsed.ciphertext) as BufferSource,
      )
      return new TextDecoder().decode(plain)
    },

    async remove(ref) {
      backing.removeItem(REF_PREFIX + ref)
    },

    mask(secret) {
      if (secret.length <= 8) return '••••••••'
      return `${secret.slice(0, 4)}••••${secret.slice(-4)}`
    },
  }
}
