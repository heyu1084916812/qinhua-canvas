import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GenerationStageView, ResultStatusOverlay } from './EcommerceStudio'

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

describe('ecommerce generation stage', () => {
  it('shows the active pipeline step and numeric progress', () => {
    const html = renderToStaticMarkup(
      createElement(GenerationStageView, {
        stage: {
          phase: 'generate',
          label: '正在生成 2/4',
          detail: '商品分析与逐张提示词已完成',
          current: 2,
          total: 4,
        },
      }),
    )
    expect(html).toContain('data-ecommerce-generation-stage="generate"')
    expect(html).toContain('正在生成 2/4')
    expect(html).toContain('2/4')
    expect(html).toContain('aria-live="polite"')
  })

  it('announces a real failure instead of leaving a running indicator', () => {
    const html = renderToStaticMarkup(
      createElement(GenerationStageView, {
        stage: {
          phase: 'failed',
          label: '生成失败',
          detail: '渠道没有返回最终提示词',
        },
      }),
    )
    expect(html).toContain('data-ecommerce-generation-stage="failed"')
    expect(html).toContain('role="alert"')
    expect(html).toContain('渠道没有返回最终提示词')
  })
})
