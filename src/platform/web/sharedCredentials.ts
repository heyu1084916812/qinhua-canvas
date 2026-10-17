import type { CredentialPort } from '../ports'
import { sharedKvDelete, sharedKvGet, sharedKvPut } from './sharedStorage'

const SALT_KEY = 'qinghua.cred.salt'
const REF_PREFIX = 'qinghua.cred.'
const PASSPHRASE = 'qinghua.local'
const PBKDF2_ROUNDS = 100_000

interface StoredCredential {
  iv: number[]
  ciphertext: number[]
}

function encode(bytes: ArrayBuffer): number[] {
  return [...new Uint8Array(bytes)]
}

function decode(values: number[]): Uint8Array {
  return new Uint8Array(values)
}

export function createSharedCredentials(): CredentialPort {
  const subtle = globalThis.crypto?.subtle

  const getSalt = async (): Promise<Uint8Array> => {
    const existing = await sharedKvGet<number[]>(SALT_KEY)
    if (existing) return decode(existing)
    const salt = crypto.getRandomValues(new Uint8Array(16))
    await sharedKvPut(SALT_KEY, encode(salt.buffer as ArrayBuffer))
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
      {
        name: 'PBKDF2',
        salt: (await getSalt()) as BufferSource,
        iterations: PBKDF2_ROUNDS,
        hash: 'SHA-256',
      },
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
      const stored: StoredCredential = {
        iv: encode(iv.buffer as ArrayBuffer),
        ciphertext: encode(ciphertext),
      }
      await sharedKvPut(REF_PREFIX + ref, stored)
    },

    async load(ref) {
      const stored = await sharedKvGet<StoredCredential>(REF_PREFIX + ref)
      if (!stored) return null
      const key = await deriveKey()
      const plain = await subtle!.decrypt(
        { name: 'AES-GCM', iv: decode(stored.iv) as BufferSource },
        key,
        decode(stored.ciphertext) as BufferSource,
      )
      return new TextDecoder().decode(plain)
    },

    async remove(ref) {
      await sharedKvDelete(REF_PREFIX + ref)
    },

    mask(secret) {
      if (secret.length <= 8) return '••••••••'
      return `${secret.slice(0, 4)}••••••••${secret.slice(-4)}`
    },
  }
}
