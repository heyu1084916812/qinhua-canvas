import type { AssetFolderPort, FilePort, PlatformKit } from '../ports'
import { createIndexedDbStorage } from './indexedDbStorage'
import { createFetchNetwork } from './fetchNetwork'
import { createWebCryptoCredentials } from './webCryptoCredentials'
import { createFileAccessFiles } from './fileSystemAccessFiles'
import { createConsoleLogger } from './consoleLogger'
import { createStorageAssetPort } from '../assets'
import { createWebHosting } from './tmpfilesHosting'
import { createLocalFaceDetector } from './localFaceDetector'
import { createWebAssetFolder } from './assetFolder'

export function createWebPlatform(
  /**
   * 只给**桌面壳**用（方案 §4.3）：它复用这份装配，把"操作系统那一层"的两个端口换成原生实现。
   * 之所以在这里开这个口子，而不是在 desktop 里再写一遍整份装配：其余端口（存储 / 网络 / 凭据 /
   * 日志 / 视觉）在壳里与浏览器里**是同一份实现**，抄一遍只会多出两个会漂移的地方。
   */
  overrides: { assetFolder?: AssetFolderPort; files?: FilePort } = {},
): PlatformKit {
  const storage = createIndexedDbStorage()
  return {
    storage,
    network: createFetchNetwork(),
    assets: createStorageAssetPort(storage),
    assetFolder: overrides.assetFolder ?? createWebAssetFolder(),
    hosting: createWebHosting(storage),
    credentials: createWebCryptoCredentials(),
    files: overrides.files ?? createFileAccessFiles(),
    logger: createConsoleLogger(),
    vision: createLocalFaceDetector(),
  }
}
