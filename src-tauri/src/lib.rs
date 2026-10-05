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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
