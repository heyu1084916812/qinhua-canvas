import type { PlatformKit } from '../ports'
import { createIndexedDbStorage } from './indexedDbStorage'
import { createFetchNetwork } from './fetchNetwork'
import { createWebCryptoCredentials } from './webCryptoCredentials'
import { createFileAccessFiles } from './fileSystemAccessFiles'
import { createConsoleLogger } from './consoleLogger'
import { createStorageAssetPort } from '../assets'

export function createWebPlatform(): PlatformKit {
  const storage = createIndexedDbStorage()
  return {
    storage,
    network: createFetchNetwork(),
    assets: createStorageAssetPort(storage),
    credentials: createWebCryptoCredentials(),
    files: createFileAccessFiles(),
    logger: createConsoleLogger(),
  }
}
