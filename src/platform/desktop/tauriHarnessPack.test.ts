import { describe, expect, it, vi } from 'vitest'
import { createTauriHarnessPackPort } from './tauriHarnessPack'

const info = {
  packId: 'dsh-0.2.2-alpha.2-abc',
  harnessVersion: '0.2.2-alpha.2',
  harnessCommit: 'f3803c96974ad4a94195fb97e5c637e9c2a3afe3',
  nodeVersion: 'v24.14.1',
  root: 'C:/Users/u/AppData/Local/com.qinghua.canvas/harness/packs/dsh',
  entry: 'C:/Users/u/AppData/Local/com.qinghua.canvas/harness/packs/dsh/bin/dsh.cmd',
  sha256: 'ABC',
}

describe('Tauri Harness pack port', () => {
  it('passes the pack and detached signature to Rust without merging them', async () => {
    const install = vi.fn(async () => info)
    const current = vi.fn(async () => info)
    const port = createTauriHarnessPackPort({ install, current })

    await expect(port.install('pack.zip', 'pack.zip.sig')).resolves.toEqual(info)
    expect(install).toHaveBeenCalledWith('pack.zip', 'pack.zip.sig')
    await expect(port.current()).resolves.toEqual(info)
  })
})
