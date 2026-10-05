import type { PlatformKit } from '../ports'
import { createWebPlatform } from '../web/index'
import { createTauriAssetFolder } from './tauriAssetFolder'
import { createTauriFiles } from './tauriFiles'

/**
 * **桌面壳（Tauri 2）的平台装配**（《轻画-桌面封装方案.md》§4.3）。
 *
 * 只换**操作系统那一层**，其余全部复用 Web 那一份 —— 因为壳里跑的本来就是一个浏览器：
 * IndexedDB 存储、`fetch` 网络、WebCrypto 凭据、`<video>`/WebGL、mediapipe 全都照旧。
 * 真正"只有壳能做"的只有两件事，也正是这里被替换的两个端口：
 * - `assetFolder`：目录不再是 FSA 句柄，而是原生目录（Rust 侧弹框 + 授权）；
 * - `files`：打开 / 另存为对话框（WebView2 的行为与 Chrome 不完全一致，走原生更确定）。
 *
 * ⇒ 上层（画布、素材、导入导出）**一行都不用改**：它们只认端口。
 */
export function createDesktopPlatform(): PlatformKit {
  return createWebPlatform({ assetFolder: createTauriAssetFolder(), files: createTauriFiles() })
}
