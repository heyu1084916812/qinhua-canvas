import { describe, expect, it } from 'vitest'
import { classifyError, statusToFailure } from './openaiCommon'

describe('statusToFailure · 429', () => {
  it('names free-tier throttling without claiming the model is unavailable', () => {
    const out = statusToFailure(
      429,
      JSON.stringify({
        error: {
          message: 'You have reached the free user API rate limit. Upgrade Token Plan for higher limits.',
        },
      }),
    )

    expect(out.message).toContain('模型本身免费，但不等于不限速')
    expect(out.message).toContain('free user API rate limit')
    expect(out.error).toMatchObject({ kind: 'http', status: 429 })
  })

  it('keeps the generic 429 wording for ordinary transient throttling', () => {
    const out = statusToFailure(429, 'query too frequent')
    expect(out.message).toContain('请求过于频繁（429）')
  })

  it('desktop invoke transport strings are network errors, not parse errors', () => {
    const out = classifyError(
      'error sending request for url (https://soonstudio.ai/v1/images/generations)',
    )
    expect(out.error).toMatchObject({ kind: 'network', detail: 'dns' })
    expect(out.message).toContain('error sending request')
  })
})
