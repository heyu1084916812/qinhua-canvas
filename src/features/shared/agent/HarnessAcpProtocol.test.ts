import { describe, expect, it } from 'vitest'
import {
  decodeAcpMessage,
  encodeAcpMessage,
} from './HarnessAcpProtocol'

describe('Harness ACP protocol', () => {
  it('encodes one newline-delimited JSON-RPC request', () => {
    expect(
      encodeAcpMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/new',
        params: { cwd: 'E:/project' },
      }),
    ).toBe(
      '{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"E:/project"}}\n',
    )
  })

  it('distinguishes requests, notifications and responses', () => {
    expect(
      decodeAcpMessage('{"jsonrpc":"2.0","id":"1","method":"initialize"}'),
    ).toMatchObject({ id: '1', method: 'initialize' })
    expect(
      decodeAcpMessage('{"jsonrpc":"2.0","method":"session/update"}'),
    ).toMatchObject({ method: 'session/update' })
    expect(
      decodeAcpMessage('{"jsonrpc":"2.0","id":2,"result":{"ok":true}}'),
    ).toMatchObject({ id: 2, result: { ok: true } })
    expect(
      decodeAcpMessage(
        '{"jsonrpc":"2.0","id":3,"error":{"code":-32601,"message":"not found"}}',
      ),
    ).toMatchObject({ id: 3, error: { code: -32601 } })
  })

  it('rejects malformed protocol messages instead of guessing', () => {
    expect(() => decodeAcpMessage('{"method":"x"}')).toThrow('JSON-RPC 2.0')
    expect(() => decodeAcpMessage('{"jsonrpc":"2.0"}')).toThrow('id')
  })
})
