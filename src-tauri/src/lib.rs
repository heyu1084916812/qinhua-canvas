/**
 * 轻画桌面壳（Tauri 2）的入口。
 *
 * **P0**：把窗口开出来、加载同一套前端（`tauri.conf.json` 里配 devUrl / frontendDist）。
 * 前端一行不改 —— 壳里跑的还是那套 React 应用（画布、素材、执行引擎全在 Web 侧）。
 *
 * **P1**（方案 §4.3）：`AssetFolderPort` / `FilePort` 的原生实现。这里只做三件**必须**在 Rust 侧做的事
 * —— 弹系统对话框、并且**把用户选中的路径加进 fs 插件的作用域**（选过才算授权，与浏览器侧"刷新后要重选"
 * 同一口径）；真正的读写交给 `tauri-plugin-fs`，前端只调 JS 的那几个函数。
 *
 * 后续：P3 接 `tauri-plugin-updater`（自动更新）。
 */
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;
use tauri_plugin_updater::UpdaterExt;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// 「选一个目录当素材文件夹」：弹系统目录选择框 → 把该目录**递归**加进 fs 作用域 → 返回绝对路径。
///
/// 为什么授权要在 Rust 侧做：前端没有扩展 fs 作用域的接口，而"用户选过的目录"正是授权的唯一依据。
/// 取消（关掉对话框）返回 `null` —— 取消不是错误。
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    app.dialog()
        .file()
        .set_title("选择素材文件夹")
        .pick_folder(move |picked| {
            let _ = tx.blocking_send(picked.map(|p| p.to_string()));
        });
    let dir = rx.recv().await.flatten()?;
    if let Err(err) = app.fs_scope().allow_directory(&dir, true) {
        eprintln!("[assetFolder] 授权素材目录失败：{err}");
    }
    Some(dir)
}

/// **重新**授权一个"记住的"素材目录（应用重启后作用域是空的）。
///
/// 与浏览器侧**刻意不同**的一处：浏览器不允许静默恢复目录权限，所以那边每次刷新都要用户重选；
/// 而桌面壳里目录是应用自己的数据，用户选过一次就该记住 —— 否则每次启动素材全变「缺失」，
/// 「把素材放在文件夹里」这件事在壳里就没意义了。路径由前端记（`localStorage`），
/// 这里只负责"照它把作用域重新打开"。
///
/// 返回 `false` = 这个目录**已经不在了**（被移动 / 删除 / 拔盘）⇒ 前端当作"没选目录"，如实回落内置库。
#[tauri::command]
async fn grant_folder(app: tauri::AppHandle, path: String) -> Result<bool, String> {
    if !std::path::Path::new(&path).is_dir() {
        return Ok(false);
    }
    app.fs_scope()
        .allow_directory(&path, true)
        .map_err(|err| err.to_string())?;
    Ok(true)
}

/// 「选一个文件打开」（导入素材 / 导入项目 JSON）：弹选择框 → 授权该文件 → 返回路径。
#[tauri::command]
async fn pick_file(
    app: tauri::AppHandle,
    title: Option<String>,
    extensions: Option<Vec<String>>,
) -> Option<String> {
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    let mut builder = app.dialog().file();
    if let Some(title) = title {
        builder = builder.set_title(title);
    }
    if let Some(exts) = extensions.filter(|e| !e.is_empty()) {
        let refs: Vec<&str> = exts.iter().map(String::as_str).collect();
        builder = builder.add_filter("文件", &refs);
    }
    builder.pick_file(move |picked| {
        let _ = tx.blocking_send(picked.map(|p| p.to_string()));
    });
    let file = rx.recv().await.flatten()?;
    if let Err(err) = app.fs_scope().allow_file(&file) {
        eprintln!("[files] 授权文件失败：{err}");
    }
    Some(file)
}

/// 「另存为」（导出项目 / 下载素材）：弹保存框 → 授权目标文件 → 返回路径。
#[tauri::command]
async fn save_file_dialog(
    app: tauri::AppHandle,
    name: String,
    extensions: Option<Vec<String>>,
) -> Option<String> {
    let (tx, mut rx) = tauri::async_runtime::channel(1);
    let mut builder = app.dialog().file().set_file_name(&name);
    if let Some(exts) = extensions.filter(|e| !e.is_empty()) {
        let refs: Vec<&str> = exts.iter().map(String::as_str).collect();
        builder = builder.add_filter("文件", &refs);
    }
    builder.save_file(move |picked| {
        let _ = tx.blocking_send(picked.map(|p| p.to_string()));
    });
    let file = rx.recv().await.flatten()?;
    if let Err(err) = app.fs_scope().allow_file(&file) {
        eprintln!("[files] 授权目标文件失败：{err}");
    }
    Some(file)
}

/// 「检查更新」后交给前端的**一份状态**（方案 §5 / 对账 #223）。
///
/// 为什么不让前端直接调 updater 的 JS API：那样"没配地址"和"网络不通"会糊成同一个异常串，
/// 界面就只能说一句含糊的"检查失败"。这里把四档说清楚，前端照着显示，不解析错误文本。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus {
    /// `not-configured` / `up-to-date` / `available` / `failed`
    state: String,
    /// 装在用户机器上的版本（不是清单上的）
    current: String,
    version: Option<String>,
    notes: Option<String>,
    /// 失败时的原话：**如实回**，不吞
    error: Option<String>,
}

fn update_status(state: &str, current: String) -> UpdateStatus {
    UpdateStatus {
        state: state.into(),
        current,
        version: None,
        notes: None,
        error: None,
    }
}

fn update_failed(current: String, error: String) -> UpdateStatus {
    UpdateStatus {
        state: "failed".into(),
        current,
        version: None,
        notes: None,
        error: Some(error),
    }
}

/// 「没有配更新地址」要单独认出来（见 `check_update` 里的说明）
fn is_not_configured(err: &tauri_plugin_updater::Error) -> bool {
    matches!(err, tauri_plugin_updater::Error::EmptyEndpoints)
}

/// 检查有没有新版。
///
/// **没配更新地址时回 `not-configured`**：目标地址还没定（GitHub Releases 还是自有地址），
/// 这时不能假装"已是最新"——用户会以为自动更新在守着，其实什么都没查。
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> UpdateStatus {
    let current = app.package_info().version.to_string();
    // ⚠️ 更新地址为空时，**`app.updater()` 这一步就报错**（`Error::EmptyEndpoints`），
    // 根本走不到 `check()` —— 所以前后两处都要认这一档。少认一处，界面就会把
    // 「还没接完」说成「检查失败」（真机上就是这么显示的，已修）。
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(err) if is_not_configured(&err) => return update_status("not-configured", current),
        Err(err) => return update_failed(current, err.to_string()),
    };
    match updater.check().await {
        Ok(Some(update)) => UpdateStatus {
            state: "available".into(),
            current,
            version: Some(update.version.clone()),
            notes: update.body.clone(),
            error: None,
        },
        Ok(None) => update_status("up-to-date", current),
        Err(err) if is_not_configured(&err) => update_status("not-configured", current),
        Err(err) => update_failed(current, err.to_string()),
    }
}

/// 下载 → **验签**（公钥在 `tauri.conf.json`）→ 交给安装器。
///
/// Windows 上安装器一起来应用就会自己退出（NSIS 默认带 `/R` 重启），
/// 所以这里**不**再调 `app.restart()` —— 那等于把应用启动两次。
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|err| err.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|err| err.to_string())?
        .ok_or_else(|| "没有可用的更新".to_string())?;
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|err| err.to_string())?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────
// 数据目录：程序目录隔壁的 `data\`（方案 §5.11 / 对账 #248）
// ─────────────────────────────────────────────────────────────

/// 「数据该放哪」的**纯决策**：程序目录的上一级 `\data`；四道闸门任一不过就返回 `None`
/// （`None` = 用系统默认位置 `%LOCALAPPDATA%\<identifier>`）。
///
/// 为什么要闸门：这条规则只对"用户自己挑的位置"成立。默认安装位置是 `%LOCALAPPDATA%\轻画`，
/// 若不管它，数据就会跑到 `%LOCALAPPDATA%\data` —— 既污染上一层，也丢了"每个账户各自一份"。
fn decide_data_dir(
    exe_dir: &Path,
    system_roots: &[PathBuf],
    writable: &dyn Fn(&Path) -> bool,
) -> Option<PathBuf> {
    // 闸门 0：开发 / 测试构建不走这条规则（工程里它们都在 `src-tauri\target\{debug,release}`）。
    // 否则开发数据会落进构建缓存 —— 一次 `cargo clean` 就顺手把它删了。
    let is_build_output = exe_dir
        .file_name()
        .is_some_and(|name| name == "debug" || name == "release")
        && exe_dir
            .parent()
            .and_then(|parent| parent.file_name())
            .is_some_and(|name| name == "target");
    if is_build_output {
        return None;
    }
    // 闸门 1：程序目录得有上一级（程序就躺在盘根时为假）
    let parent = exe_dir.parent()?;
    // 闸门 2：上一级不能是盘根 —— `D:\data` 不算"外面一个文件夹"
    parent.parent()?;
    // 闸门 3：上一级不能落在系统目录里（默认安装位置 / Program Files / Windows）
    let parent_lower = lower(parent);
    if system_roots
        .iter()
        .any(|root| parent_lower.starts_with(lower(root)))
    {
        return None;
    }
    // 闸门 4：`<上一级>\data` 必须真的写得进去（只读盘、权限不足 ⇒ 回落系统位置）
    let data = parent.join("data");
    if !writable(&data) {
        return None;
    }
    Some(data)
}

/// 大小写归一：Windows 路径大小写不敏感，而 `Path::starts_with` 是敏感的
fn lower(path: &Path) -> PathBuf {
    PathBuf::from(path.to_string_lossy().to_lowercase())
}

/// 真建目录 + 落一个探针文件再删掉 —— "能不能写"只能试出来
fn dir_is_writable(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".write-probe");
    match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// 系统目录清单：命中任何一条就说明程序装在"我们默认 / 系统给的位置"，数据不该跟过去
fn system_roots(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(p) = app.path().local_data_dir() {
        roots.push(p);
    }
    if let Ok(p) = app.path().data_dir() {
        roots.push(p);
    }
    for key in ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "SystemRoot"] {
        if let Ok(value) = std::env::var(key) {
            if !value.is_empty() {
                roots.push(PathBuf::from(value));
            }
        }
    }
    roots
}

/// 本次运行该用的数据目录（`None` = 交给 Tauri 的默认值）
fn resolve_data_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;
    decide_data_dir(exe_dir, &system_roots(app), &dir_is_writable)
}

/// 第一次在新位置启动时，把**数据**从默认 profile 搬过去（不是每次启动都搬）。
///
/// 只搬三样：`IndexedDB`（项目 / 素材 / 素材库）、`Local Storage`（令牌密文 + 设置）、`WebStorage`。
/// 其余（`Cache` / `Code Cache` / `GPUCache` …）是网页缓存，几十 MB 且能重建，**不搬**。
/// 目标已经有 `IndexedDB` 就整个跳过 —— 否则每次启动都会拿旧数据盖掉新数据。
fn migrate_profile(default_root: &Path, data_dir: &Path) {
    let src = default_root.join("EBWebView").join("Default");
    if !src.is_dir() {
        return;
    }
    let dst = data_dir.join("EBWebView").join("Default");
    if dst.join("IndexedDB").exists() {
        return;
    }
    for name in ["IndexedDB", "Local Storage", "WebStorage"] {
        let from = src.join(name);
        if !from.exists() {
            continue;
        }
        let to = dst.join(name);
        match copy_dir(&from, &to) {
            Ok(()) => eprintln!("[data] 已迁移 {name} ⇒ {}", to.display()),
            Err(err) => {
                /*
                 * 拷到一半失败会留下**残缺副本**，而上面那句"目标已有 IndexedDB 就跳过"
                 * 会让下次启动不再重试 ⇒ 用户看到半个库。故失败即清掉残骸，留给下次重试。
                 * （清理也失败就只能这样了：日志里说清"旧数据仍在原地"。）
                 */
                let _ = std::fs::remove_dir_all(&to);
                eprintln!(
                    "[data] 迁移 {name} 失败：{err}（已清掉残骸，下次启动会重试；旧数据仍在原地）"
                );
            }
        }
    }
}

/// 递归拷贝（只服务上面那条一次性迁移）
fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod data_dir_tests {
    use super::*;

    fn none_roots() -> Vec<PathBuf> {
        Vec::new()
    }
    fn always(_: &Path) -> bool {
        true
    }
    fn never(_: &Path) -> bool {
        false
    }

    #[test]
    fn chosen_install_dir_gets_sibling_data_dir() {
        let got = decide_data_dir(
            Path::new("D:\\轻画\\app"),
            &none_roots(),
            &always,
        );
        assert_eq!(got, Some(PathBuf::from("D:\\轻画\\data")));
    }

    #[test]
    fn default_install_dir_under_local_app_data_falls_back() {
        // 默认安装位置：%LOCALAPPDATA%\轻画 ⇒ 上一级是 %LOCALAPPDATA%，命中系统目录
        let roots = vec![PathBuf::from("C:\\Users\\u\\AppData\\Local")];
        let got = decide_data_dir(
            Path::new("C:\\Users\\u\\AppData\\Local\\轻画"),
            &roots,
            &always,
        );
        assert_eq!(got, None);
    }

    #[test]
    fn program_files_falls_back() {
        let roots = vec![PathBuf::from("C:\\Program Files")];
        let got = decide_data_dir(Path::new("C:\\Program Files\\轻画"), &roots, &always);
        assert_eq!(got, None);
    }

    #[test]
    fn drive_root_is_not_a_usable_parent() {
        // 装在 D:\app ⇒ 上一级是盘根 D:\ ⇒ 不做"隔壁 data"
        assert_eq!(decide_data_dir(Path::new("D:\\app"), &none_roots(), &always), None);
        // 程序直接躺在盘根 ⇒ 连上一级都没有
        assert_eq!(decide_data_dir(Path::new("D:\\qinghua.exe"), &none_roots(), &always), None);
    }

    #[test]
    fn unwritable_parent_falls_back() {
        let got = decide_data_dir(Path::new("D:\\轻画\\app"), &none_roots(), &never);
        assert_eq!(got, None);
    }

    #[test]
    fn dev_build_output_falls_back() {
        // `npm run tauri dev` / `cargo test` 的 exe 在 target\{debug,release} 下：
        // 数据不能跟着进构建缓存（`cargo clean` 会连它一起删）
        let roots = none_roots();
        assert_eq!(
            decide_data_dir(Path::new("E:\\proj\\src-tauri\\target\\debug"), &roots, &always),
            None
        );
        assert_eq!(
            decide_data_dir(Path::new("E:\\proj\\src-tauri\\target\\release"), &roots, &always),
            None
        );
        // 但真的装在 `...\轻画\app` 时要生效（"target" 只在 dev 那一层出现）
        assert_eq!(
            decide_data_dir(Path::new("D:\\轻画\\app"), &roots, &always),
            Some(PathBuf::from("D:\\轻画\\data"))
        );
    }

    #[test]
    fn system_root_match_is_case_insensitive() {
        let roots = vec![PathBuf::from("c:\\program files")];
        let got = decide_data_dir(Path::new("C:\\Program Files\\轻画"), &roots, &always);
        assert_eq!(got, None);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            grant_folder,
            pick_file,
            save_file_dialog,
            check_update,
            install_update
        ])
        .setup(|app| {
            /*
             * 窗口在这里**手动建**（`tauri.conf.json` 那条窗口配了 `"create": false`），
             * 唯一原因就是要赶在 webview 创建**之前**把它的数据目录指过去 ——
             * `data_directory` 只能在建窗口时给，建完就改不了了。
             */
            let data_dir = resolve_data_dir(app.handle());
            match &data_dir {
                Some(dir) => {
                    if let Ok(default_root) = app.path().app_local_data_dir() {
                        migrate_profile(&default_root, dir);
                    }
                    eprintln!("[data] 数据目录：{}", dir.display());
                }
                None => eprintln!("[data] 数据目录：系统默认位置（%LOCALAPPDATA%\\com.qinghua.canvas）"),
            }
            /*
             * 建窗口要能建**两次**（自定义数据目录那次失败还能回落），故包成一个闭包。
             * 会失败的情形：数据目录在两次检查之间被删 / 网络盘掉线 / WebView2 起不来 ——
             * 那些都不该让用户"双击了却没窗口"，所以失败就退回系统默认位置再建一次。
             */
            let build_window = |dir: Option<PathBuf>| -> tauri::Result<tauri::WebviewWindow> {
                let config = app.config().app.windows.first().cloned();
                let mut builder = match config {
                    Some(cfg) => tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?,
                    None => tauri::WebviewWindowBuilder::new(
                        app.handle(),
                        "main",
                        tauri::WebviewUrl::default(),
                    ),
                };
                if let Some(dir) = dir {
                    builder = builder.data_directory(dir);
                }
                builder.build()
            };
            if let Err(err) = build_window(data_dir.clone()) {
                eprintln!("[data] 用自定义数据目录建窗口失败：{err} ⇒ 回落到系统默认位置");
                if let Some(dir) = &data_dir {
                    // 探针建出来的空目录顺手收掉（只有真的是空的才会成功，不会误删数据）
                    let _ = std::fs::remove_dir(dir);
                }
                build_window(None)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
