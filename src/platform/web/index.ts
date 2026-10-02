import type { PlatformKit } from '../ports'
import { createIndexedDbStorage } from './indexedDbStorage'
import { createFetchNetwork } from './fetchNetwork'
import { createWebCryptoCredentials } from './webCryptoCredentials'
import { createFileAccessFiles } from './fileSystemAccessFiles'
import { createConsoleLogger } from './consoleLogger'
import { createStorageAssetPort } from '../assets'
import { createWebHosting } from './tmpfilesHosting'

export function createWebPlatform(): PlatformKit {
  const storage = createIndexedDbStorage()
  return {
    storage,
    network: createFetchNetwork(),
    assets: createStorageAssetPort(storage),
    hosting: createWebHosting(storage),
    credentials: createWebCryptoCredentials(),
    files: createFileAccessFiles(),
    logger: createConsoleLogger(),
  }
}
