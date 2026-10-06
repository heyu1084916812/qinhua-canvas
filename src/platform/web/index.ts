import type {
  AssetFolderPort,
  FilePort,
  PlatformKit,
  StorageAdminPort,
  UpdatePort,
} from '../ports'
import { createIndexedDbStorage } from './indexedDbStorage'
import { createFetchNetwork } from './fetchNetwork'
import { createWebCryptoCredentials } from './webCryptoCredentials'
import { createFileAccessFiles } from './fileSystemAccessFiles'
import { createConsoleLogger } from './consoleLogger'
import { createStorageAssetPort } from '../assets'
import { createWebHosting } from './hosting'
import { createLocalFaceDetector } from './localFaceDetector'
import { createWebAssetFolder } from './assetFolder'

export function createWebPlatform(
  /**
   * 只给**桌面壳**用（方案 §4.3）：它复用这份装配，把"操作系统那一层"的两个端口换成原生实现。
   * 之所以在这里开这个口子，而不是在 desktop 里再写一遍整份装配：其余端口（存储 / 网络 / 凭据 /
   * 日志 / 视觉）在壳里与浏览器里**是同一份实现**，抄一遍只会多出两个会漂移的地方。
   */
  overrides: {
    assetFolder?: AssetFolderPort
    files?: FilePort
    updater?: UpdatePort
    storageAdmin?: StorageAdminPort
  } = {},
): PlatformKit {
  const storage = createIndexedDbStorage()
  const network = createFetchNetwork()
  const credentials = createWebCryptoCredentials()
  return {
    storage,
    network,
    assets: createStorageAssetPort(storage),
    assetFolder: overrides.assetFolder ?? createWebAssetFolder(),
    // 自动更新只有壳里有：浏览器侧传空即"没有这一项"（端口是可选字段）
    updater: overrides.updater,
    /**
     * 素材传输要三样：配置行（storage）、密钥（credentials）、发请求（network）。
     * 三者都由这里装配 —— **不在端口实现里各自 new 一份**（凭据层换实现时，
     * 渠道与图床必须拿到同一份，否则"加密存的密钥"和"明文读的密钥"会分叉）。
     */
    hosting: createWebHosting({ storage, credentials, network }),
    credentials,
    files: overrides.files ?? createFileAccessFiles(),
    logger: createConsoleLogger(),
    vision: createLocalFaceDetector(),
  }
}
