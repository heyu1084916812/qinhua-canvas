import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}))

import { createTauriCli } from './tauriCli'

describe('桌面 CLI · 字幕写入', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
  })

  it('把 SRT 字节以数字数组传给壳，文件名与命令参数名保持一致', async () => {
    mocks.invoke.mockResolvedValue('C:\\data\\cli-out\\第1集.srt')
    const cli = createTauriCli()

    const path = await cli.writeOut?.(
      '第1集.srt',
      new Uint8Array([0xe5, 0xad, 0x97]),
    )

    expect(path).toBe('C:\\data\\cli-out\\第1集.srt')
    expect(mocks.invoke).toHaveBeenCalledWith('cli_write_out', {
      name: '第1集.srt',
      bytes: [229, 173, 151],
    })
  })
})
