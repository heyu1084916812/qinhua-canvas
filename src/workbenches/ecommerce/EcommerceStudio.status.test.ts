import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ResultStatusOverlay } from './EcommerceStudio'

describe('ecommerce result status overlay', () => {
  it('renders a readable failure message in the card center', () => {
    const html = renderToStaticMarkup(
      createElement(ResultStatusOverlay, {
        item: {
          nodeId: 'gen_failed',
          status: 'failed',
          error: '渠道请求失败：令牌无效，请到渠道配置更新令牌',
        },
      }),
    )
    expect(html).toContain('data-ecommerce-result-overlay="failed"')
    expect(html).toContain('role="alert"')
    expect(html).toContain('生成失败')
    expect(html).toContain('令牌无效')
  })

  it('renders the shared orbit indicator and running timer', () => {
    const html = renderToStaticMarkup(
      createElement(ResultStatusOverlay, {
        item: { nodeId: 'gen_running', status: 'running' },
      }),
    )
    expect(html).toContain('data-ecommerce-result-overlay="running"')
    expect(html).toContain('data-ecommerce-result-orbit')
    expect(html).toContain('生成中 0s')
  })

  it('never renders a waiting state', () => {
    const html = renderToStaticMarkup(
      createElement(ResultStatusOverlay, {
        item: { nodeId: 'gen_running', status: 'running' },
      }),
    )
    expect(html).not.toContain('排队中')
    expect(html).not.toContain('data-ecommerce-result-overlay="pending"')
  })
})
