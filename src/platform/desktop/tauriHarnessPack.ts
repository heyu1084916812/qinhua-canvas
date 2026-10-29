export interface HarnessPackInfo {
  packId: string
  harnessVersion: string
  harnessCommit: string
  nodeVersion: string
  root: string
  entry: string
  sha256: string
}

export interface TauriHarnessPackBridge {
  install(packPath: string, signaturePath: string): Promise<HarnessPackInfo>
  current(): Promise<HarnessPackInfo | null>
}

export const defaultTauriHarnessPackBridge: TauriHarnessPackBridge = {
  async install(packPath, signaturePath) {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<HarnessPackInfo>('harness_pack_install', {
      packPath,
      signaturePath,
    })
  },
  async current() {
    const { invoke } = await import('@tauri-apps/api/core')
    return invoke<HarnessPackInfo | null>('harness_pack_current')
  },
}

export function createTauriHarnessPackPort(
  bridge: TauriHarnessPackBridge = defaultTauriHarnessPackBridge,
) {
  return {
    install(packPath: string, signaturePath: string) {
      return bridge.install(packPath, signaturePath)
    },
    current() {
      return bridge.current()
    },
  }
}
