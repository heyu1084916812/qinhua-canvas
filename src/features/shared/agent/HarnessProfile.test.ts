import { describe, expect, it } from 'vitest'
import {
  HARNESS_AGENT_MODEL,
  HARNESS_PROVIDER_TOKEN_ENV,
  HARNESS_PROVIDER_URL_ENV,
  buildHarnessAcpProfilePatch,
  harnessHttpMcpServer,
} from './HarnessProfile'

describe('Harness profile contract', () => {
  it('builds the standard Streamable HTTP MCP declaration', () => {
    expect(
      harnessHttpMcpServer({
        url: 'http://127.0.0.1:3210/mcp',
        token: 'secret',
      }),
    ).toEqual({
      name: 'qinghua-canvas',
      type: 'http',
      url: 'http://127.0.0.1:3210/mcp',
      headers: [{ name: 'Authorization', value: 'Bearer secret' }],
    })
  })

  it('rejects unsafe MCP names and non-http URLs', () => {
    expect(() =>
      harnessHttpMcpServer({
        name: '../escape',
        url: 'http://127.0.0.1/mcp',
        token: 'secret',
      }),
    ).toThrow('服务名')
    expect(() =>
      harnessHttpMcpServer({
        url: 'file:///tmp/socket',
        token: 'secret',
      }),
    ).toThrow('HTTP')
  })

  it('routes ACP through one fixed local provider and disables DSH retry', () => {
    const patch = buildHarnessAcpProfilePatch()

    expect(patch).toContain('- id: llm-retry\n  disabled: true')
    expect(patch).toContain('provider: qinghua-local')
    expect(patch).toContain(`model: ${HARNESS_AGENT_MODEL}`)
    expect(patch).toContain(`apiKeyEnv: ${HARNESS_PROVIDER_TOKEN_ENV}`)
    expect(patch).toContain(
      `baseURL: !!js process.env.${HARNESS_PROVIDER_URL_ENV}`,
    )
    expect(patch).toContain('supportsDeveloperRole: false')
    expect(patch).toContain('maxTokensField: max_tokens')
    expect(patch).not.toContain('deepseek-v4')
  })
})
