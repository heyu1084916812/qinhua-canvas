import { describe, it, expect } from 'vitest'
import { createWebCryptoCredentials } from './webCryptoCredentials'

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

/**
 * 对账 #517 的前置事实：短令牌（含 `*` 这类特殊字符）**在凭据层是完好存下来的**。
 *
 * 用户报「填写令牌就填写不进去」，要先排除"加密吃掉了字符"这个可能 ——
 * 排除了才能把病根定位到界面那一侧（拿尾号反推「存过没有」）。
 */
describe('webCryptoCredentials · 短令牌与特殊字符', () => {
  it('★★ 9 位含 * 的令牌：存进去再读回来一字不差', async () => {
    const creds = createWebCryptoCredentials(memoryStorage())
    /* ref 由调用方（仓库层）生成，凭据端口只认这个字符串 —— 与真实链路一致 */
    const ref = 'qinghua.cred.test'
    await creds.save(ref, '431959*Sh')
    expect(await creds.load(ref)).toBe('431959*Sh')
  })

  it('★ 前端判断用的尾号在这个令牌上是 null（所以界面不能靠它反推"存过没有"）', () => {
    const token = '431959*Sh'
    const tail = token.length >= 12 ? token.slice(-4) : null
    expect(tail).toBeNull()
  })
})
