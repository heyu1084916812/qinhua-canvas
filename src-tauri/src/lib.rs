/**
 * 轻画桌面壳（Tauri 2）的入口。
 *
 * P0 阶段：**只负责把窗口开出来、加载同一套前端**（`tauri.conf.json` 里配 devUrl / frontendDist）。
 * 前端一行不改 —— 壳里跑的还是那套 React 应用（画布、素材、执行引擎全在 Web 侧）。
 *
 * 后续（方案 §4 / §6）：
 * - P1 在这里注册 `AssetFolderPort` / `FilePort` 的 Rust 命令（目录选择与读写、保存位置），
 *   前端换一个 `PlatformKit` 实现即可，端口契约不动；
 * - P3 接 `tauri-plugin-updater`（自动更新）。
 */
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
