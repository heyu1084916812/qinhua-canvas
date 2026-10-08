import type {
  AssetFolderPort,
  CliPort,
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
    /**
     * 本机 CLI（对账 #308）：浏览器侧**没有**这一项（端口可选、字段就是 undefined），
     * 只有壳把它换成 `tauriCli`。界面按"端口在不在"决定显示"仅在桌面应用可用"。
     */
    cli?: CliPort
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
    // 浏览器里没有"起子进程"这回事：不传就是"没有这一项"
    cli: overrides.cli,
    // 自动更新只有壳里有：浏览器侧传空即"没有这一项"（端口是可选字段）
    updater: overrides.updater,
    /**
     * 数据目录 / 打开目录 / 网页缓存（对账 #261）。
     *
     * ⚠️ 2026-10-08 修：这一行**以前漏了** —— 函数签名收下了 `storageAdmin`，
     * 但返回的对象里没有它。后果是**桌面壳里 `platform.storageAdmin` 一直是 undefined**：
     * 「存储 → 数据目录 / 网页缓存」两块在任何环境都显示"仅在桌面应用可用"，
     * 用户永远看不到「打开数据目录」与「清理网页缓存」两个按钮（真机探针实测到的）。
     * 浏览器冒烟测不出它 —— 浏览器里"没有这一项"本来就是对的。
     */
    storageAdmin: overrides.storageAdmin,
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
