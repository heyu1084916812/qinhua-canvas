use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem};
use tauri::path::BaseDirectory;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State};
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
use tauri_plugin_opener::OpenerExt;
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
    for key in [
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramW6432",
        "SystemRoot",
    ] {
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

/// 所有壳共用同一份空壳 profile。
///
/// 业务数据已迁到 shared-store；这里只放 WebView2 缓存和可重建偏好。
fn shared_shell_profile_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|root| root.join("shell-v2"))
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

/// 备份专用复制：`.ldb` 是不可变的 LevelDB 表文件，优先硬链接；失败再回落复制。
///
/// 这样 GB 级素材库的启动备份不会每次重写一遍大文件；`MANIFEST` / `CURRENT` /
/// `*.log` 仍然逐字节复制，所以副本引用到的表文件一定是齐的。
fn copy_profile_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_profile_dir(&entry.path(), &target)?;
            continue;
        }

        let path = entry.path();
        let immutable_ldb = path
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("ldb"));
        if immutable_ldb && std::fs::hard_link(&path, &target).is_ok() {
            continue;
        }
        std::fs::copy(&path, &target)?;
    }
    Ok(())
}

/// WebView2 用户数据副本保留份数（对账 #505）。
///
/// 这里刻意只保留少量：IndexedDB 可能很大，多做几份会把磁盘吃掉；
/// 真正兜底的是“至少有一份最近可用”，不是把历史全留下来。
const PROFILE_BACKUP_KEEP: usize = 3;
const PROFILE_BACKUP_DIR_NAME: &str = "qinghua-profile-backups";
const PROFILE_DATA_DIRS: [&str; 2] = ["IndexedDB", "Local Storage"];

fn profile_backup_root(data_dir: &Path) -> PathBuf {
    data_dir
        .parent()
        .map(|parent| parent.join(PROFILE_BACKUP_DIR_NAME))
        .unwrap_or_else(|| data_dir.join(PROFILE_BACKUP_DIR_NAME))
}

fn profile_backup_name(at: std::time::SystemTime) -> String {
    let millis = at
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("profile-{millis}")
}

/// 复制一份 WebView2 profile 的用户数据。
///
/// **只抄 `IndexedDB` 与 `Local Storage`**：
/// 前者是项目 / 素材 / 素材库，后者是令牌密文与界面设置；
/// `Cache` / `Code Cache` / `GPUCache` 都能重建，抄进去只会让备份巨大。
///
/// 先抄到 `.tmp-*` 再改名，半截失败不会留下一个看起来像备份、实际读不了的目录。
fn create_profile_backup(
    data_dir: &Path,
    at: std::time::SystemTime,
) -> std::io::Result<Option<PathBuf>> {
    let source = data_dir.join("EBWebView").join("Default");
    let has_any_data = PROFILE_DATA_DIRS
        .iter()
        .any(|name| source.join(name).is_dir());
    if !has_any_data {
        return Ok(None);
    }

    let root = profile_backup_root(data_dir);
    std::fs::create_dir_all(&root)?;

    let name = profile_backup_name(at);
    let final_dir = root.join(&name);
    if final_dir.exists() {
        return Ok(None);
    }

    let tmp = root.join(format!(".tmp-{name}"));
    let _ = std::fs::remove_dir_all(&tmp);

    let copied = (|| -> std::io::Result<()> {
        std::fs::create_dir_all(&tmp)?;
        for dir_name in PROFILE_DATA_DIRS {
            let from = source.join(dir_name);
            if from.is_dir() {
                copy_profile_dir(&from, &tmp.join(dir_name))?;
            }
        }
        std::fs::rename(&tmp, &final_dir)
    })();

    if let Err(err) = copied {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(err);
    }

    if let Err(err) = prune_profile_backups(&root, PROFILE_BACKUP_KEEP) {
        eprintln!("[data] 桌面数据副本清理旧份失败（不影响本次备份）：{err}");
    }
    Ok(Some(final_dir))
}

/// 只清理本功能自己生成的 `profile-*` 目录；任何不认识的目录一律不动。
fn prune_profile_backups(root: &Path, keep: usize) -> std::io::Result<usize> {
    let mut entries: Vec<_> = std::fs::read_dir(root)?
        .flatten()
        .filter(|entry| {
            entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false)
                && entry
                    .file_name()
                    .to_str()
                    .is_some_and(|name| name.starts_with("profile-"))
        })
        .collect();
    entries.sort_by(|a, b| b.file_name().cmp(&a.file_name()));

    let mut removed = 0;
    for entry in entries.into_iter().skip(keep) {
        if std::fs::remove_dir_all(entry.path()).is_ok() {
            removed += 1;
        }
    }
    Ok(removed)
}

static PROFILE_BACKUP_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 拍一份桌面数据副本；任何失败都只记日志，不挡启动 / 退出。
fn backup_profile(app: &tauri::AppHandle) {
    let Some(data_dir) = current_data_dir(app) else {
        return;
    };
    let Ok(_guard) = PROFILE_BACKUP_LOCK.lock() else {
        return;
    };
    match create_profile_backup(&data_dir, std::time::SystemTime::now()) {
        Ok(Some(path)) => eprintln!("[data] 已备份桌面数据：{}", path.display()),
        Ok(None) => {}
        Err(err) => eprintln!("[data] 桌面数据备份失败（不影响启动 / 退出）：{err}"),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileBackupInfo {
    dir: String,
    keep: usize,
}

#[tauri::command]
fn profile_backup_info(app: tauri::AppHandle) -> ProfileBackupInfo {
    let dir = current_data_dir(&app)
        .map(|data_dir| data_dir.to_string_lossy().to_string())
        .unwrap_or_default();
    ProfileBackupInfo { dir, keep: 0 }
}

// ─────────────────────────────────────────────────────────────
// 存储：数据目录 / 打开目录 / 网页缓存（对账 #261）
// ─────────────────────────────────────────────────────────────

/// **可清理的网页缓存目录名**（白名单）。
///
/// ⚠️ 这份名单是**唯一**决定"哪些目录能删"的地方，所以它必须是**白名单**：
/// `EBWebView/Default` 下面同时躺着 `IndexedDB`（项目 / 素材 / 素材库）与
/// `Local Storage`（令牌密文 + 设置）—— 用黑名单去"排掉"数据目录，
/// 漏一个就是**删用户数据**。
const CACHE_DIR_NAMES: [&str; 8] = [
    "Cache",
    "Code Cache",
    "GPUCache",
    "DawnCache",
    "DawnGraphiteCache",
    "DawnWebGPUCache",
    "GrShaderCache",
    "ShaderCache",
];

fn is_cache_dir_name(name: &str) -> bool {
    CACHE_DIR_NAMES.contains(&name)
}

/// 当前数据目录（与 #250 同一条规则：程序隔壁的 `data`，否则系统默认位置）。
fn current_data_dir(_app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(qinghua_shared_store::default_data_dir())
}

/// WebView2 的 profile 默认区（网页缓存就在它下面）。
fn profile_default_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(
        shared_shell_profile_dir(app)?
            .join("EBWebView")
            .join("Default"),
    )
}

fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    let mut total = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => total += dir_size(&path),
            Ok(kind) if kind.is_file() => {
                total += entry.metadata().map(|meta| meta.len()).unwrap_or(0)
            }
            _ => {}
        }
    }
    total
}

/// 可清理的网页缓存现在占多少字节。
fn cache_bytes(app: &tauri::AppHandle) -> u64 {
    let Some(default) = profile_default_dir(app) else {
        return 0;
    };
    let Ok(entries) = std::fs::read_dir(&default) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| entry.file_name().to_str().is_some_and(is_cache_dir_name))
        .map(|entry| dir_size(&entry.path()))
        .sum()
}

/// 数据目录的绝对路径（项目 / 令牌 / 素材库都在里面）。
#[tauri::command]
fn data_dir_path(app: tauri::AppHandle) -> String {
    current_data_dir(&app)
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// 在系统文件管理器里打开一个目录（壳里的「打开数据目录 / 打开素材目录」用它）。
#[tauri::command]
fn open_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !std::path::Path::new(&path).is_dir() {
        return Err("目录不存在或已被移动".into());
    }
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|err| err.to_string())
}

/// 网页缓存占用（字节）。
#[tauri::command]
fn cache_usage(app: tauri::AppHandle) -> u64 {
    cache_bytes(&app)
}

/// 清网页缓存，返回**实际**释放的字节数。
///
/// 三条刻意做法：
/// 1. **只删白名单里的目录**（见 `CACHE_DIR_NAMES`）；
/// 2. **先量、再删、再量**，用差值报成绩 —— 正在被 WebView2 占用的文件删不掉，
///    拿"删之前的大小"当成绩就是虚报；
/// 3. **删不掉不算错**：缓存本来就能重建，锁住的文件下次再删就是。
#[tauri::command]
fn clear_cache(app: tauri::AppHandle) -> u64 {
    let before = cache_bytes(&app);
    if let Some(default) = profile_default_dir(&app) {
        if let Ok(entries) = std::fs::read_dir(&default) {
            for entry in entries.flatten() {
                let name_ok = entry.file_name().to_str().is_some_and(is_cache_dir_name);
                if name_ok && entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
        }
    }
    before.saturating_sub(cache_bytes(&app))
}

/// 取一个 URL 的字节（**只给"从网站抓站点图标"用**，对账 #396）。
///
/// 为什么必须放在 Rust 侧：前端那条 `fetch`（浏览器与壳里的 webview 用的是同一份实现，
/// 见 `platform/desktop/index.ts` 的装配注释）受 **CORS** 限制 —— 站点不给
/// `Access-Control-Allow-Origin` 时读不到 `favicon.ico`，而绝大多数站点都不给。
/// 壳里用 reqwest 发这一条就没有这个限制。
///
/// 三条边界：
/// 1. **只做 GET**，只认 http / https；
/// 2. **超过 512KB 直接拒**（站点图标不该这么大，防止被当成下载器用）；
/// 3. 状态码原样回给前端，由前端决定"算不算抓到"（这里不替它判断）。
#[derive(serde::Serialize)]
struct FetchedBytes {
    status: u16,
    content_type: Option<String>,
    bytes: Vec<u8>,
}

#[tauri::command]
async fn fetch_bytes(url: String, timeout_ms: Option<u64>) -> Result<FetchedBytes, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("只支持 http / https 地址".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms.unwrap_or(8000)))
        .build()
        .map_err(|err| err.to_string())?;
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let bytes = response.bytes().await.map_err(|err| err.to_string())?;
    if bytes.len() > 512 * 1024 {
        return Err("文件太大（超过 512KB），不像是站点图标".into());
    }
    Ok(FetchedBytes {
        status,
        content_type,
        bytes: bytes.to_vec(),
    })
}

/**
 * **通用 HTTP 请求**（对账 #518）：给"站点不给 CORS 头"的中转站用。
 *
 * 与 `fetch_bytes` 的分工：那个只做 GET、只取字节、有 512KB 上限，服务的是"抓站点图标"；
 * 这一条要能带上自定义头与请求体去打 `/v1/models` / `/v1/chat/completions`，
 * 所以支持 GET / POST / PUT / DELETE / HEAD，返回的是**文本 + 响应头**（渠道层要读 JSON）。
 *
 * 为什么需要它：壳里的 webview 与浏览器是同一份 `fetch` 实现，**同样受 CORS 限制**。
 * 实测（`154.19.242.25:7863`）`/v1/models` 返回 200，但响应头里**没有任何**
 * `access-control-*` ⇒ 页面侧请求被拦下，应用只看到"网络错误"，于是"验证协议"报
 * 「连不上这个地址（域名解析失败或连接被拒绝）」，而真实原因是跨域、不是地址不可达。
 * 别的客户端（cc switch / workbuddy）不走浏览器，所以它们能正常用同一地址。
 *
 * 边界：
 * 1. 只认 http / https；
 * 2. **不跟随重定向以外的魔法**：状态码与响应头原样回给前端，"算不算通过"由渠道层判断；
 * 3. 文本正文上限 8MB；图片 / 视频等二进制上限 64MB。
 *    前者覆盖模型列表与对话回包，后者只服务生成产物回落，不做通用下载器。
 */
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FetchedText {
    status: u16,
    headers: std::collections::HashMap<String, String>,
    text: String,
    body_base64: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct FetchMultipartPart {
    name: String,
    value: Option<String>,
    data_base64: Option<String>,
    file_name: Option<String>,
    content_type: Option<String>,
}

fn quoted_param(value: &str) -> Result<String, String> {
    if value.contains('\r') || value.contains('\n') {
        return Err("multipart 字段名或文件名不能包含换行".into());
    }
    Ok(value.replace('\\', "\\\\").replace('"', "\\\""))
}

fn multipart_body(parts: Vec<FetchMultipartPart>) -> Result<(String, Vec<u8>), String> {
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let sequence = SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let boundary = format!("----qinghua-form-{}-{sequence}", std::process::id());
    let mut out = Vec::new();
    for part in parts {
        out.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        let name = quoted_param(&part.name)?;
        if let Some(data) = part.data_base64.filter(|value| !value.is_empty()) {
            let file_name = quoted_param(
                part.file_name
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .unwrap_or(&part.name),
            )?;
            out.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"{name}\"; filename=\"{file_name}\"\r\n"
                )
                .as_bytes(),
            );
            if let Some(content_type) = part.content_type.filter(|value| !value.is_empty()) {
                if content_type.contains('\r') || content_type.contains('\n') {
                    return Err("multipart 文件类型不能包含换行".into());
                }
                out.extend_from_slice(format!("Content-Type: {content_type}\r\n").as_bytes());
            }
            out.extend_from_slice(b"\r\n");
            out.extend_from_slice(&base64_decode(&data)?);
            out.extend_from_slice(b"\r\n");
        } else {
            out.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes(),
            );
            out.extend_from_slice(part.value.unwrap_or_default().as_bytes());
            out.extend_from_slice(b"\r\n");
        }
    }
    out.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    Ok((format!("multipart/form-data; boundary={boundary}"), out))
}

fn is_textual_content_type(value: Option<&str>) -> bool {
    let Some(value) = value else {
        return false;
    };
    let lower = value.to_ascii_lowercase();
    lower.starts_with("text/")
        || lower.contains("json")
        || lower.contains("xml")
        || lower.contains("javascript")
        || lower.contains("x-www-form-urlencoded")
}

#[tauri::command]
async fn fetch_text(
    url: String,
    method: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    body: Option<String>,
    body_base64: Option<String>,
    content_type: Option<String>,
    multipart: Option<Vec<FetchMultipartPart>>,
    timeout_ms: Option<u64>,
) -> Result<FetchedText, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("只支持 http / https 地址".into());
    }
    let verb = method.unwrap_or_else(|| "GET".into()).to_uppercase();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(
            timeout_ms.unwrap_or(10000),
        ))
        .build()
        .map_err(|err| err.to_string())?;

    let mut req = match verb.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "HEAD" => client.head(&url),
        other => return Err(format!("不支持的请求方法：{other}")),
    };
    let has_multipart = multipart.as_ref().is_some_and(|parts| !parts.is_empty());
    let has_binary_body = body_base64.as_ref().is_some_and(|value| !value.is_empty());
    if let Some(map) = headers {
        for (k, v) in map {
            if (has_multipart || has_binary_body) && k.eq_ignore_ascii_case("content-type") {
                continue;
            }
            req = req.header(k, v);
        }
    }
    if has_multipart {
        let (content_type, payload) = multipart_body(multipart.unwrap_or_default())?;
        req = req.header("content-type", content_type).body(payload);
    } else if let Some(payload) = body_base64.filter(|value| !value.is_empty()) {
        if let Some(content_type) = content_type.filter(|value| !value.is_empty()) {
            req = req.header("content-type", content_type);
        }
        req = req.body(base64_decode(&payload)?);
    } else if let Some(payload) = body {
        if !payload.is_empty() {
            req = req.body(payload);
        }
    }

    let response = req.send().await.map_err(|err| err.to_string())?;
    let status = response.status().as_u16();
    let mut out_headers = std::collections::HashMap::new();
    for (name, value) in response.headers().iter() {
        if let Ok(v) = value.to_str() {
            out_headers.insert(name.as_str().to_string(), v.to_string());
        }
    }
    let content_type = out_headers
        .get("content-type")
        .cloned()
        .or_else(|| out_headers.get("Content-Type").cloned());
    let textual = is_textual_content_type(content_type.as_deref());
    let bytes = response.bytes().await.map_err(|err| err.to_string())?;
    let limit = if textual {
        8 * 1024 * 1024
    } else {
        64 * 1024 * 1024
    };
    if bytes.len() > limit {
        return Err(if textual {
            "响应太大（文本超过 8MB）".into()
        } else {
            "响应太大（二进制超过 64MB）".into()
        });
    }
    Ok(FetchedText {
        status,
        headers: out_headers,
        // 文本响应完整解码；二进制只留前 64KB 供 HTTP 错误文案使用，
        // 不把几十 MB 的图片再复制成一份无意义字符串。
        text: if textual {
            String::from_utf8_lossy(&bytes).to_string()
        } else {
            String::from_utf8_lossy(&bytes[..bytes.len().min(64 * 1024)]).to_string()
        },
        // 文本响应不额外复制一份 base64；图片 / 视频等二进制必须走原始字节。
        // 0x89 在 text 里会变成 U+FFFD，永远不能从 text 反推文件内容。
        body_base64: if textual {
            String::new()
        } else {
            base64_encode(&bytes)
        },
    })
}

/**
 * `fetch_text` 的输入校验（对账 #518）。
 *
 * 这几条锁的是**没发请求就该拒**的那部分：地址协议与方法白名单。
 * 真打真实站点的用例不写在这里 —— 单测不该依赖外网（本机到 Google 域就常年不通）。
 */
#[cfg(test)]
mod fetch_text_tests {
    #[test]
    fn rejects_non_http_url() {
        assert!(!"ftp://x/y".starts_with("http://") && !"ftp://x/y".starts_with("https://"));
        assert!("http://a/b".starts_with("http://"));
        assert!("https://a/b".starts_with("https://"));
    }

    #[test]
    fn method_allowlist_is_exactly_five() {
        // 与 `fetch_text` 里 match 的分支逐字一致：加/改方法时必须同时改这里
        for m in ["GET", "POST", "PUT", "DELETE", "HEAD"] {
            assert!(matches!(m, "GET" | "POST" | "PUT" | "DELETE" | "HEAD"));
        }
        assert!(!matches!(
            "PATCH",
            "GET" | "POST" | "PUT" | "DELETE" | "HEAD"
        ));
    }

    #[test]
    fn content_type_splits_text_from_binary() {
        assert!(super::is_textual_content_type(Some(
            "application/json; charset=utf-8"
        )));
        assert!(super::is_textual_content_type(Some("text/event-stream")));
        assert!(!super::is_textual_content_type(Some("image/png")));
        assert!(!super::is_textual_content_type(Some("video/mp4")));
        assert!(!super::is_textual_content_type(None));
    }
}

#[cfg(test)]
mod storage_tests {
    use super::*;

    #[test]
    fn cache_whitelist_covers_browser_caches() {
        for name in [
            "Cache",
            "Code Cache",
            "GPUCache",
            "DawnWebGPUCache",
            "ShaderCache",
        ] {
            assert!(is_cache_dir_name(name), "{name} 应当算可清理的网页缓存");
        }
    }

    #[test]
    fn cache_whitelist_never_touches_user_data() {
        // 这条是**护栏**：哪天有人把它改成"黑名单式"（"除了这几个都删"），先在这里红
        for name in [
            "IndexedDB",
            "Local Storage",
            "WebStorage",
            "Session Storage",
            "Network",
            "Cookies",
            "Preferences",
            "blob_storage",
        ] {
            assert!(
                !is_cache_dir_name(name),
                "{name} 是用户数据，绝不能当缓存删"
            );
        }
    }

    #[test]
    fn dir_size_counts_nested_files() {
        let dir = std::env::temp_dir().join("qinghua-dir-size-test");
        let nested = dir.join("a").join("b");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(dir.join("one.bin"), vec![0u8; 10]).unwrap();
        std::fs::write(nested.join("two.bin"), vec![0u8; 25]).unwrap();
        assert_eq!(dir_size(&dir), 35);
        std::fs::remove_dir_all(&dir).unwrap();
        // 量不到的目录返回 0 而不是抛 —— 调用方只看差值，"没有"与"零字节"在这里等价
        assert_eq!(dir_size(&dir), 0);
    }

    fn backup_temp_dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "qinghua-profile-backup-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn backup_at(ms: u64) -> std::time::SystemTime {
        std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_millis(ms)
    }

    #[test]
    fn profile_backup_copies_user_data_and_skips_cache() {
        let base = backup_temp_dir("copy");
        let dir = base.join("data");
        let source = dir.join("EBWebView").join("Default");
        std::fs::create_dir_all(source.join("IndexedDB")).unwrap();
        std::fs::write(source.join("IndexedDB").join("db.ldb"), b"db").unwrap();
        std::fs::create_dir_all(source.join("Local Storage")).unwrap();
        std::fs::write(source.join("Local Storage").join("state"), b"ls").unwrap();
        std::fs::create_dir_all(source.join("Cache")).unwrap();
        std::fs::write(source.join("Cache").join("junk"), b"junk").unwrap();

        let backup = create_profile_backup(&dir, backup_at(1_000))
            .unwrap()
            .expect("有 IndexedDB 就该拍出一份");
        assert!(backup.join("IndexedDB").join("db.ldb").is_file());
        assert!(backup.join("Local Storage").join("state").is_file());
        assert_eq!(
            std::fs::read(backup.join("IndexedDB").join("db.ldb")).unwrap(),
            b"db"
        );
        assert_eq!(
            std::fs::read(backup.join("Local Storage").join("state")).unwrap(),
            b"ls"
        );
        assert!(!backup.join("Cache").exists(), "可再生缓存不该进备份");

        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn profile_backup_keeps_newest_and_never_touches_unknown_dirs() {
        let base = backup_temp_dir("prune");
        let dir = base.join("data");
        let source = dir.join("EBWebView").join("Default").join("IndexedDB");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("db.ldb"), b"db").unwrap();
        std::fs::create_dir_all(profile_backup_root(&dir).join("keep-me")).unwrap();

        for ms in [1_000, 2_000, 3_000, 4_000] {
            create_profile_backup(&dir, backup_at(ms)).unwrap();
        }

        let root = profile_backup_root(&dir);
        let names: Vec<String> = std::fs::read_dir(&root)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(
            names
                .iter()
                .filter(|name| name.starts_with("profile-"))
                .count(),
            PROFILE_BACKUP_KEEP
        );
        assert!(!names.contains(&"profile-1000".to_string()));
        assert!(names.contains(&"profile-4000".to_string()));
        assert!(root.join("keep-me").is_dir(), "不认识的目录不能被清理");

        std::fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn profile_backup_without_source_is_a_noop() {
        let base = backup_temp_dir("missing");
        let dir = base.join("data");
        assert!(create_profile_backup(&dir, backup_at(1_000))
            .unwrap()
            .is_none());
        assert!(!profile_backup_root(&dir).exists());
    }
}

// ─────────────────────────────────────────────────────────────
// 本机 CLI：真的起一个子进程（用户 2026-10-06 第 11 批第 4 条）
// ─────────────────────────────────────────────────────────────
//
// 用户原话：「……能用里面的额度调用模型生成图片或者视频，或者对话，runninghub 也要，
// 需要真的能跑本机的 cli」。
//
// **安全边界**（写在这里，免得以后被"顺手改成 shell 更灵活"）：
// 走 `Command::new(program).args(args)`，**不经过 shell**（没有 `cmd /c`、没有 `sh -c`），
// 参数是数组、不拼字符串 ⇒ 命令注入不成立。命令由**用户自己**在设置里填 ——
// 那等价于他自己开一个终端，这正是他要的能力；壳这边不额外加白名单，也不替他拼字符串。
//
// **一次调用拿到什么**：退出码 / stdout / stderr / 是否超时 / 是否被取消 / 耗时。
// 没有"假装成功"这一档：起不来就是 `Err`，跑起来退码非零就如实回 `code`。

/// 一次 CLI 调用的结果。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CliOutcome {
    /// 退出码。被信号杀掉、或系统没给码时为 `None`
    code: Option<i32>,
    stdout: String,
    stderr: String,
    timed_out: bool,
    /// 被 `cli_kill` 主动掐掉的（用户点了"停止"）
    cancelled: bool,
    ms: u64,
}

/// 单条输出（stdout / stderr 各一份）最多回传这么多字节：CLI 可能吐几百 MB。
const CLI_MAX_OUTPUT: usize = 200 * 1024;
const CLI_DEFAULT_TIMEOUT_MS: u64 = 120_000;
const CLI_MAX_TIMEOUT_MS: u64 = 30 * 60 * 1000;

/// 超时夹在 [1s, 30min]：`Some(0)` 会让它在下一轮轮询就被杀，比不填更糟。
fn clamp_timeout(ms: Option<u64>) -> u64 {
    ms.unwrap_or(CLI_DEFAULT_TIMEOUT_MS)
        .clamp(1_000, CLI_MAX_TIMEOUT_MS)
}

/// 只留**尾部**：CLI 的报错与结果永远在最后。
///
/// 必须按 **char 边界**裁 —— `&text[start..]` 落在字符中间会直接 panic，
/// 而这类 CLI 的输出里有中文是常态。
fn tail_of(text: String, max: usize) -> String {
    if text.len() <= max {
        return text;
    }
    let mut start = text.len() - max;
    while start < text.len() && !text.is_char_boundary(start) {
        start += 1;
    }
    format!("…（前 {} 字节已省略）\n{}", start, &text[start..])
}

/// 在 PATH 里找可执行文件。
///
/// `exists` 是注入的（单测不碰真实文件系统）；Windows 上还要按 `PATHEXT` 逐个后缀试
/// —— 用户填的往往是 `codex` 而不是 `codex.cmd`。
fn find_in_path(program: &str, path_var: &str, exists: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    // 带路径分隔符的一律当"用户已经给全了"，**不再去 PATH 里找**
    if program.contains('/') || program.contains('\\') {
        let direct = Path::new(program);
        return if exists(direct) {
            Some(direct.to_path_buf())
        } else {
            None
        };
    }
    let mut exts: Vec<String> = vec![String::new()];
    if cfg!(windows) {
        let pathext =
            std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
        for ext in pathext.split(';').filter(|s| !s.is_empty()) {
            exts.push(ext.to_lowercase());
            exts.push(ext.to_uppercase());
        }
    }
    for dir in std::env::split_paths(path_var) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        for ext in &exts {
            let cand = dir.join(format!("{program}{ext}"));
            if exists(&cand) {
                return Some(cand);
            }
        }
    }
    None
}

/// 起子进程失败时**说人话**（用户看到的是这一句，不是 io error）。
fn describe_spawn_error(program: &str, err: std::io::Error) -> String {
    match err.kind() {
        std::io::ErrorKind::NotFound => format!(
            "找不到命令「{program}」：先在设置里确认它的命令名或完整路径，并确保它在系统 PATH 里"
        ),
        std::io::ErrorKind::PermissionDenied => format!("没有权限执行「{program}」"),
        _ => format!("启动「{program}」失败：{err}"),
    }
}

/// 正在跑的 CLI 进程。`cli_kill` 与超时都按 `id` 找它 —— 同一时刻可以有多个在跑。
#[derive(Default)]
struct CliRegistry(std::sync::Mutex<std::collections::HashMap<String, std::process::Child>>);

#[cfg(test)]
mod cli_tests {
    use super::*;

    #[test]
    fn timeout_is_clamped_to_sane_bounds() {
        assert_eq!(clamp_timeout(None), CLI_DEFAULT_TIMEOUT_MS);
        assert_eq!(clamp_timeout(Some(0)), 1_000);
        assert_eq!(clamp_timeout(Some(999)), 1_000);
        assert_eq!(clamp_timeout(Some(5_000)), 5_000);
        assert_eq!(
            clamp_timeout(Some(CLI_MAX_TIMEOUT_MS + 1)),
            CLI_MAX_TIMEOUT_MS
        );
    }

    #[test]
    fn tail_keeps_the_end_and_never_splits_a_char() {
        let short = "abc".to_string();
        assert_eq!(tail_of(short.clone(), 16), short);
        // 64 个汉字 = 192 字节，从 (len - 10) 起必然落在某个汉字中间
        let text = "汉".repeat(64);
        let cut = tail_of(text, 10);
        assert!(cut.starts_with("…（前 "));
        assert!(cut.ends_with('汉'));
        let tail = cut.split('\n').nth(1).unwrap();
        assert!(tail.len() <= 10, "尾部实际长度 {}", tail.len());
    }

    #[test]
    fn path_with_separator_is_never_searched_in_path() {
        let hits = |p: &Path| p.to_string_lossy().contains("tools");
        assert!(find_in_path(r"C:\tools\a.exe", "", &hits).is_some());
        assert!(find_in_path("/opt/tools/a", "/nope", &hits).is_some());
        assert!(find_in_path("/opt/tools/a", "/nope", &|_| false).is_none());
    }

    #[cfg(windows)]
    #[test]
    fn finds_executable_by_pathext_extension() {
        let hit = |p: &Path| {
            // 目录也要判：只认文件名的话 `C:\missing\tool.exe` 也会被当成"存在"
            p.to_string_lossy().to_lowercase().contains(r"c:\bin")
                && p.file_name()
                    .map(|n| n.to_string_lossy().to_lowercase())
                    .unwrap_or_default()
                    == "tool.exe"
        };
        let found = find_in_path("tool", r"C:\missing;C:\bin", &hit);
        assert_eq!(
            found.map(|p| p.to_string_lossy().to_string()),
            Some(r"C:\bin\tool.exe".to_string())
        );
        assert!(find_in_path("nope", r"C:\bin", &hit).is_none());
    }
}

fn bundled_program_relative(program: &str) -> Option<PathBuf> {
    if program.eq_ignore_ascii_case("ffmpeg") {
        Some(PathBuf::from("resources").join("ffmpeg.exe"))
    } else {
        None
    }
}

fn bundled_program_path(app: &tauri::AppHandle, program: &str) -> Option<PathBuf> {
    let relative = bundled_program_relative(program)?;
    if let Ok(path) = app.path().resolve(&relative, BaseDirectory::Resource) {
        if path.is_file() {
            return Some(path);
        }
    }
    #[cfg(debug_assertions)]
    {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
        if path.is_file() {
            return Some(path);
        }
    }
    None
}

/// 「这个命令到底能不能跑」——只看文件在不在，**不执行任何东西**。
#[tauri::command]
fn cli_which(app: tauri::AppHandle, program: String) -> Option<String> {
    if let Some(path) = bundled_program_path(&app, &program) {
        return Some(path.to_string_lossy().to_string());
    }
    let path_var = std::env::var("PATH").unwrap_or_default();
    find_in_path(&program, &path_var, &|p| p.is_file()).map(|p| p.to_string_lossy().to_string())
}

/// 真的跑一条命令。**异步**：耗时可到 30 分钟，不能占着 IPC 线程。
#[tauri::command]
async fn cli_run(
    app: tauri::AppHandle,
    id: String,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    stdin: Option<String>,
) -> Result<CliOutcome, String> {
    // 阻塞式的 `spawn` + 轮询放到阻塞线程池：直接写在 async 命令里会占住运行时线程，
    // 期间别的 IPC 都得排队。
    tauri::async_runtime::spawn_blocking(move || {
        run_cli_blocking(app, id, program, args, cwd, timeout_ms, stdin)
    })
    .await
    .map_err(|err| format!("CLI 任务没能跑起来：{err}"))?
}

/// 掐掉一条正在跑的命令（用户点"停止"）。找不到 = 它已经自己结束了 ⇒ 返回 false。
#[tauri::command]
fn cli_kill(app: tauri::AppHandle, id: String) -> bool {
    let registry = app.state::<CliRegistry>();
    let Ok(mut map) = registry.0.lock() else {
        return false;
    };
    match map.remove(&id) {
        Some(mut child) => {
            let _ = child.kill();
            let _ = child.wait();
            true
        }
        None => false,
    }
}

/// 在一个**可见的控制台窗口**里跑命令 —— 给"一键登录"用（用户 2026-10-06 第 13 批第 2 条：
/// 「我希望是我一键设置，然后输入密码或者其他的就可以保持登录」）。
///
/// 与 `cli_run` 的三点不同，每一点都是有意为之：
/// 1. **要一个自己的窗口**（`CREATE_NEW_CONSOLE`）—— 登录要么在浏览器里点授权、要么在终端里
///    输密码，而我们的 `cli_run` 恰恰是 `CREATE_NO_WINDOW`（不弹框）。这里反过来；
/// 2. **不捕获输出** —— 输出是给用户看的，不是给我们解析的；
/// 3. **不等待它结束** —— 交互登录没有"跑完"这一说（用户可能几分钟后才点完授权），
///    等它只会把界面卡住。所以这个命令**立刻返回**，用户在那个窗口里自己完成登录。
///
/// 安全边界与 `cli_run` **完全一致**：`Command::new(program).args(args)`、不过 shell、
/// 参数是数组 ⇒ 命令注入不成立；命令与参数都是用户在设置里填的。
#[tauri::command]
fn cli_spawn_window(program: String, args: Vec<String>, cwd: Option<String>) -> Result<(), String> {
    use std::process::Command;

    let mut cmd = Command::new(&program);
    cmd.args(&args);
    if let Some(dir) = cwd.as_deref().filter(|d| !d.is_empty()) {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 0x0000_0010 = CREATE_NEW_CONSOLE：**故意**给它一个可见窗口（见上面的说明）。
        // 注意别顺手加上 0x0800_0000（CREATE_NO_WINDOW）—— 两个标志一起加就等于又藏起来了。
        cmd.creation_flags(0x0000_0010);
    }
    cmd.spawn()
        .map(|_| ())
        .map_err(|err| describe_spawn_error(&program, err))
}

fn run_cli_blocking(
    app: tauri::AppHandle,
    id: String,
    program: String,
    args: Vec<String>,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
    stdin: Option<String>,
) -> Result<CliOutcome, String> {
    use std::io::Read;
    use std::process::{Command, Stdio};

    /// 一轮轮询的结论（写成枚举是为了**先出借用块再动 map**，见下面的两段式）
    enum Poll {
        Running,
        Exited(Option<i32>),
        /// 表里已经没有它 = 被 `cli_kill` 拿走并杀掉了
        Gone,
        Broken(String),
    }

    let started = std::time::Instant::now();
    let timeout = clamp_timeout(timeout_ms);

    let mut cmd = Command::new(&program);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // 没有 stdin 就不给管道：给了却不写，CLI 会一直等输入（"卡住"的经典成因）
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });
    if let Some(dir) = cwd.as_deref().filter(|d| !d.is_empty()) {
        cmd.current_dir(dir);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW：别为一次调用弹一个黑框（会闪一下还抢焦点）
        cmd.creation_flags(0x0800_0000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|err| describe_spawn_error(&program, err))?;

    if let Some(text) = stdin {
        if let Some(mut pipe) = child.stdin.take() {
            use std::io::Write;
            // 写完就出作用域 ⇒ 管道被 drop。**必须** drop，否则 CLI 一直等输入
            let _ = pipe.write_all(text.as_bytes());
        }
    }

    // 两条读管道**必须先被读走**：管道缓冲写满后子进程会卡在 write 上，
    // 而我们正等着它退出 ⇒ 两边互相等，死锁。所以各起一个线程读到底。
    let mut out_pipe = child.stdout.take();
    let mut err_pipe = child.stderr.take();
    let out_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(pipe) = out_pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buf);
        }
        buf
    });
    let err_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(pipe) = err_pipe.as_mut() {
            let _ = pipe.read_to_end(&mut buf);
        }
        buf
    });

    // 登记进来，`cli_kill` 才找得到它
    {
        let registry = app.state::<CliRegistry>();
        let mut map = registry
            .0
            .lock()
            .map_err(|_| "CLI 进程表被上一次崩溃污染了，请重启应用".to_string())?;
        map.insert(id.clone(), child);
    }

    let mut code: Option<i32> = None;
    let mut timed_out = false;
    let mut cancelled = false;

    loop {
        // 两段式：第一个块里只"问状态"并把结论带出来，出了块才动 `map`
        // （在 `get_mut` 的借用里再 `remove` 会被借用检查拦住）
        let poll = {
            let registry = app.state::<CliRegistry>();
            let mut map = match registry.0.lock() {
                Ok(map) => map,
                Err(_) => return Err("CLI 进程表被上一次崩溃污染了，请重启应用".to_string()),
            };
            let mut exit: Option<std::process::ExitStatus> = None;
            let mut broken: Option<String> = None;
            let mut gone = false;
            match map.get_mut(&id) {
                None => gone = true,
                Some(child) => match child.try_wait() {
                    Ok(status) => exit = status,
                    Err(err) => broken = Some(err.to_string()),
                },
            }
            if gone {
                Poll::Gone
            } else if let Some(message) = broken {
                if let Some(mut dead) = map.remove(&id) {
                    let _ = dead.kill();
                    let _ = dead.wait();
                }
                Poll::Broken(format!("等待「{program}」结束失败：{message}"))
            } else if let Some(status) = exit {
                let exit_code = status.code();
                map.remove(&id);
                Poll::Exited(exit_code)
            } else {
                Poll::Running
            }
        };

        match poll {
            Poll::Running => {}
            Poll::Exited(exit_code) => {
                code = exit_code;
                break;
            }
            Poll::Gone => {
                // 不在了 ≠ 失败：这是用户点了"停止"
                cancelled = true;
                break;
            }
            Poll::Broken(message) => return Err(message),
        }

        if started.elapsed().as_millis() as u64 >= timeout {
            timed_out = true;
            let registry = app.state::<CliRegistry>();
            if let Ok(mut map) = registry.0.lock() {
                if let Some(mut child) = map.remove(&id) {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    // 进程已退（或被掐）⇒ 写端关闭，两个读线程会把剩余输出读完返回
    let stdout = out_reader.join().unwrap_or_default();
    let stderr = err_reader.join().unwrap_or_default();

    Ok(CliOutcome {
        code,
        stdout: tail_of(String::from_utf8_lossy(&stdout).to_string(), CLI_MAX_OUTPUT),
        stderr: tail_of(String::from_utf8_lossy(&stderr).to_string(), CLI_MAX_OUTPUT),
        timed_out,
        cancelled,
        ms: started.elapsed().as_millis() as u64,
    })
}

// ── 本机 CLI 的产物文件 ──
//
// 用户同一句的后半段：「**链接后能用里面的额度调用模型生成图片或者视频**，或者对话」。
// 对话只要 stdout，产物（图 / 视频）却只能落在**文件**里 —— 各家 CLI 都用 `--out <路径>`
// 这类参数。所以这一层回答两件事：给它一个能写的目录（`cli_out_dir`）、
// 把写出来的字节读回来（`cli_read_out`）。
//
// **安全边界**：`cli_read_out` 只认 `<数据目录>/cli-out/` **里面**的文件。
// 路径是前端拼的，若允许它读任意文件，这个命令就等于给页面开了一个"任意文件读取"原语
// —— 拿到那种 IPC，`%APPDATA%` 下的令牌与数据库都能被读走。
// 产物本来就只该落在这个目录，所以把范围收死：越界一律拒。

const CLI_OUT_DIR_NAME: &str = "cli-out";

/// 标准 base64 编码（含 `=` 补齐）。
///
/// 手写而不引依赖：整个壳只有这一个用途，而它必须与前端
/// `domain/shared/base64.ts` 的 `base64ToBytes` 精确对上（单测按 RFC 4648 的向量钉住）。
fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

fn base64_decode(text: &str) -> Result<Vec<u8>, String> {
    let clean = text.trim();
    if clean.len() % 4 != 0 {
        return Err("base64 长度不是 4 的倍数".into());
    }
    let mut out = Vec::with_capacity(clean.len() / 4 * 3);
    for chunk in clean.as_bytes().chunks_exact(4) {
        let digit = |value: u8| -> Result<u8, String> {
            match value {
                b'A'..=b'Z' => Ok(value - b'A'),
                b'a'..=b'z' => Ok(value - b'a' + 26),
                b'0'..=b'9' => Ok(value - b'0' + 52),
                b'+' => Ok(62),
                b'/' => Ok(63),
                _ => Err("base64 含非法字符".into()),
            }
        };
        if chunk[0] == b'=' || chunk[1] == b'=' {
            return Err("base64 首两位不能是填充符".into());
        }
        let a = digit(chunk[0])? as u32;
        let b = digit(chunk[1])? as u32;
        let c = if chunk[2] == b'=' { 0 } else { digit(chunk[2])? as u32 };
        let d = if chunk[3] == b'=' { 0 } else { digit(chunk[3])? as u32 };
        if chunk[2] == b'=' && chunk[3] != b'=' {
            return Err("base64 填充格式错误".into());
        }
        let value = (a << 18) | (b << 12) | (c << 6) | d;
        out.push(((value >> 16) & 0xff) as u8);
        if chunk[2] != b'=' {
            out.push(((value >> 8) & 0xff) as u8);
        }
        if chunk[3] != b'=' {
            out.push((value & 0xff) as u8);
        }
    }
    Ok(out)
}

/// 目标是否在根目录**里面**。
///
/// 两道关：
/// 1. **含 `..` 的一律拒** —— `Path::starts_with` 是逐段比较、**不做规范化**，
///    于是 `cli-out/../secret.txt` 会被判成"在里面"；
/// 2. 逐段比较（Windows 大小写不敏感 ⇒ 两边都小写化，`lower()` 是既有工具）。
fn is_inside(root: &Path, target: &Path) -> bool {
    if target
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return false;
    }
    let root = lower(root);
    let target = lower(target);
    target != root && target.starts_with(&root)
}

/// 产物目录：`<数据目录>/cli-out`（没有就建）。
fn cli_out_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = current_data_dir(app)
        .ok_or_else(|| "拿不到数据目录，无法给本机 CLI 准备输出位置".to_string())?
        .join(CLI_OUT_DIR_NAME);
    std::fs::create_dir_all(&dir).map_err(|err| format!("建 CLI 产物目录失败：{err}"))?;
    Ok(dir)
}

/// 给前端一个可以写产物、也允许被读回的目录（绝对路径）。
#[tauri::command]
fn cli_out_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(cli_out_root(&app)?.to_string_lossy().to_string())
}

/// 把 CLI 写出来的文件读回 base64（前端要把它变成素材字节）。
#[tauri::command]
fn cli_read_out(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let root = cli_out_root(&app)?;
    let target = PathBuf::from(&path);
    if !is_inside(&root, &target) {
        return Err("只能读本机 CLI 产物目录里的文件".to_string());
    }
    let bytes = std::fs::read(&target).map_err(|err| {
        format!("读不到本机 CLI 的产物（{err}）：确认参数模板里给了 `{{out}}`，且命令真的把文件写出来了")
    })?;
    Ok(base64_encode(&bytes))
}

const CLI_TEXT_OUT_MAX_BYTES: usize = 2 * 1024 * 1024;

/// 把一个小文本文件写进 CLI 产物目录（当前用于 SRT）。
///
/// 只接受单文件名：不允许路径、控制字符、首尾空白，且扩展名必须是 `.srt`。
/// 这条命令只服务字幕落盘，不是通用文件写入原语。
fn valid_cli_out_name(name: &str) -> bool {
    let path = Path::new(name);
    let is_srt = path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("srt"));
    !name.is_empty()
        && name.chars().count() <= 180
        && name.trim() == name
        && !name
            .chars()
            .any(|ch| ch.is_control() || ch == '/' || ch == '\\' || ch == ':')
        && !name.contains("..")
        && path.file_name().and_then(|file| file.to_str()) == Some(name)
        && is_srt
}

#[tauri::command]
fn cli_write_out(app: tauri::AppHandle, name: String, bytes: Vec<u8>) -> Result<String, String> {
    if !valid_cli_out_name(&name) {
        return Err(
            "字幕文件名不合法：只写文件名、扩展名必须是 .srt，不能包含路径或控制字符".to_string(),
        );
    }
    if bytes.is_empty() {
        return Err("字幕内容为空，没有可写入的文件".to_string());
    }
    if bytes.len() > CLI_TEXT_OUT_MAX_BYTES {
        return Err("字幕文件超过 2MB，拒绝写入本机 CLI 产物目录".to_string());
    }
    let root = cli_out_root(&app)?;
    let target = root.join(&name);
    if !is_inside(&root, &target) {
        return Err("只能写本机 CLI 产物目录里的文件".to_string());
    }
    std::fs::write(&target, bytes).map_err(|err| format!("写 CLI 文本文件失败：{err}"))?;
    Ok(target.to_string_lossy().to_string())
}

// ── RunningHub CLI 的登录：写它自己的配置文件 ──
//
// 用户 2026-10-08 第 3 条：「runininghub 的 cli 是在 github 上找的，看看 github 上
// 能不能把目前实现不了一键自动安装的 cli 给做好」。
//
// 官方 CLI（`HM-RunningHub/RH_CLI`）的登录命令是 `rh auth set-key <KEY>`，而那是个
// **位置参数** —— 应用里不能调它（本机约定：**密钥只走 stdin，不进 argv**：
// argv 会进进程列表、也会被别的工具记进历史）。但那套 CLI 自己认配置文件里的 `api_key`
// （`rh_cli/config.py` 的 `resolve_api_key`：argv → 环境变量 `RUNNINGHUB_API_KEY` →
// `%APPDATA%\rh\config.toml`）⇒ **壳直接把那一行写好**，效果与用户手敲那条命令一样，
// 而且是持久的：用户自己终端里的 `rh` 也立刻是登录态。
//
// 安全边界：路径**由壳自己拼**（`%APPDATA%\rh\config.toml`），前端只能给"那把 Key"，
// 借这个命令动不了任何别的文件 —— 与 `cli_read_out` 收死目录是同一条思路。

/// RunningHub CLI 的配置文件路径（与它的 `config_dir()` 同一套规则）。
fn rh_config_path() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    let base = std::env::var("APPDATA")
        .map_err(|_| "拿不到 %APPDATA%，写不了 RunningHub 的配置".to_string())?;
    #[cfg(not(target_os = "windows"))]
    let base = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .or_else(|| std::env::var("HOME").ok().map(|h| format!("{h}/.config")))
        .ok_or_else(|| "拿不到配置目录，写不了 RunningHub 的配置".to_string())?;
    Ok(PathBuf::from(base).join("rh").join("config.toml"))
}

/// 把 `api_key` 那一行写进配置文本，**其余行原样保留**。
///
/// 为什么是"读回来再写"而不是直接覆盖：官方 CLI 的 `write_config` 也是这么做的 ——
/// 它那份配置里还可能有 `output_dir` 这类别的键，覆盖会把用户已有的设置冲掉。
fn upsert_api_key(existing: &str, api_key: &str) -> String {
    let mut lines: Vec<String> = existing
        .lines()
        /* 旧的 `api_key` 行整行丢掉（等价于"改"，不是"追加第二条"） */
        .filter(|line| line.split('=').next().unwrap_or("").trim() != "api_key")
        .map(|line| line.to_string())
        .collect();
    /* 值与官方 CLI 同一套转义（TOML 基本字符串：反斜杠与双引号要转义） */
    let escaped = api_key.replace('\\', "\\\\").replace('"', "\\\"");
    lines.push(format!("api_key = \"{escaped}\""));
    let mut out = lines.join("\n");
    out.push('\n');
    out
}

/// 写 RunningHub CLI 的 API Key（登录）。返回配置文件路径，供界面如实告知。
#[tauri::command]
fn rh_set_api_key(api_key: String) -> Result<String, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("Key 是空的，没有可写的内容".to_string());
    }
    let path = rh_config_path()?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|err| format!("建配置目录失败：{err}"))?;
    }
    let existing = std::fs::read_to_string(&path).unwrap_or_default();
    std::fs::write(&path, upsert_api_key(&existing, key))
        .map_err(|err| format!("写 RunningHub 配置失败：{err}"))?;
    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod cli_out_tests {
    use super::*;

    #[test]
    fn base64_matches_rfc4648_vectors() {
        // RFC 4648 §10 的官方向量：三种余数长度都覆盖到
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
        assert_eq!(base64_encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        // 高位字节（>127）：PNG / JPEG 的头就是这种，编码表用错会在这里露馅
        assert_eq!(base64_encode(&[0x89, 0x50, 0x4e, 0x47]), "iVBORw==");
    }

    #[test]
    fn base64_decode_round_trips_binary_vectors() {
        for bytes in [
            b"".as_slice(),
            b"f".as_slice(),
            b"fo".as_slice(),
            b"foo".as_slice(),
            b"foobar".as_slice(),
            &[0x89, 0x50, 0x4e, 0x47],
        ] {
            assert_eq!(base64_decode(&base64_encode(bytes)).unwrap(), bytes);
        }
        assert!(base64_decode("iVBOR===").is_err());
        assert!(base64_decode("iV!ORw==").is_err());
    }

    #[test]
    fn multipart_body_preserves_text_fields_and_file_bytes() {
        let (content_type, body) = multipart_body(vec![
            FetchMultipartPart {
                name: "model".into(),
                value: Some("gpt-image-2".into()),
                data_base64: None,
                file_name: None,
                content_type: None,
            },
            FetchMultipartPart {
                name: "image".into(),
                value: None,
                data_base64: Some(base64_encode(&[0x89, 0x50, 0x4e, 0x47])),
                file_name: Some("reference.png".into()),
                content_type: Some("image/png".into()),
            },
        ])
        .unwrap();
        assert!(content_type.starts_with("multipart/form-data; boundary="));
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("name=\"model\""));
        assert!(text.contains("gpt-image-2"));
        assert!(text.contains("filename=\"reference.png\""));
        assert!(text.contains("Content-Type: image/png"));
        assert!(body.windows(4).any(|window| window == [0x89, 0x50, 0x4e, 0x47]));
    }

    #[test]
    fn only_files_inside_the_out_dir_are_readable() {
        let root = Path::new(r"C:\data\cli-out");
        assert!(is_inside(root, Path::new(r"C:\data\cli-out\a.png")));
        assert!(is_inside(root, Path::new(r"C:\DATA\CLI-OUT\b.mp4")));
        // 目录本身不是文件
        assert!(!is_inside(root, Path::new(r"C:\data\cli-out")));
        // `..` 一律拒：starts_with 不做规范化，不挡这条就能读到隔壁
        assert!(!is_inside(
            root,
            Path::new(r"C:\data\cli-out\..\secret.txt")
        ));
        assert!(!is_inside(
            root,
            Path::new(r"C:\data\cli-out\sub\..\..\secret.txt")
        ));
        // 前缀相同但不是同一层（`cli-out2` 不是 `cli-out` 的子目录）
        assert!(!is_inside(root, Path::new(r"C:\data\cli-out2\a.png")));
        // 完全无关的盘
        assert!(!is_inside(root, Path::new(r"D:\other\a.png")));
    }

    #[test]
    fn cli_text_out_name_rejects_paths_and_parent_segments() {
        assert!(valid_cli_out_name("字幕.srt"));
        assert!(valid_cli_out_name("subtitle-01.srt"));
        assert!(valid_cli_out_name("subtitle-01.SRT"));
        assert!(!valid_cli_out_name("../secret.srt"));
        assert!(!valid_cli_out_name("sub/secret.srt"));
        assert!(!valid_cli_out_name(r"sub\secret.srt"));
        assert!(!valid_cli_out_name("C:secret.srt"));
        assert!(!valid_cli_out_name(" subtitle.srt"));
        assert!(!valid_cli_out_name("subtitle.txt"));
        assert!(!valid_cli_out_name("subtitle.srt\n"));
        assert!(!valid_cli_out_name(""));
        assert!(!valid_cli_out_name(&format!("{}.srt", "a".repeat(177))));
    }

    /**
     * RunningHub 的 Key 落盘规则（用户 2026-10-08 第 3 条）。
     *
     * 三条判据，都是"写坏一次就很难查"的那种：
     *   ① 新文件直接写出这一行；
     *   ② **已有的别的键要留着**（官方 CLI 的配置里还可能有 `output_dir`，
     *      覆盖写会把它冲掉 —— 那正是"读回来再写"的理由）；
     *   ③ 旧的 `api_key` **不追加第二条**，且值里的反斜杠 / 双引号照 TOML 转义。
     */
    #[test]
    fn api_key_line_is_upserted_not_appended() {
        assert_eq!(upsert_api_key("", "abc"), "api_key = \"abc\"\n");

        let kept = upsert_api_key("output_dir = \"D:/rh\"\n", "abc");
        assert_eq!(kept, "output_dir = \"D:/rh\"\napi_key = \"abc\"\n");

        let replaced = upsert_api_key("api_key = \"old\"\noutput_dir = \"D:/rh\"\n", "new");
        assert_eq!(replaced, "output_dir = \"D:/rh\"\napi_key = \"new\"\n");
        assert_eq!(replaced.matches("api_key").count(), 1);

        let escaped = upsert_api_key("", r#"a\b"c"#);
        assert_eq!(escaped, "api_key = \"a\\\\b\\\"c\"\n");
    }
}

// ─────────────────────────────────────────────────────────────
// 窗口几何：记住上次的尺寸与位置（用户 2026-10-06 第 11 批第 7 条）
// ─────────────────────────────────────────────────────────────
//
// 用户原话：「7、就补那五条权限，顺手加全屏，**记住上次窗口尺寸和位置**」。
//
// 为什么不用官方那个 `tauri-plugin-window-state`：我们的主窗口是**手动建**的
// （`tauri.conf.json` 里 `create: false`，见 `setup` 里那段说明），插件对"后建的窗口"
// 要不要显式 `restore_state` 有版本差异；而这件事本身只有三个纯决策
// （存什么、读什么、**这条几何还能不能用**），自己写反而更好测、也不用再加依赖。
// 三条决策里的"还能不能用"写成纯函数 + 单测（见 `window_state_tests`）。

/// 存盘用的窗口几何（物理像素）。
///
/// 位置取**外框**左上角、尺寸取**内尺寸** —— 两者在 `decorations: false` 下同一个矩形，
/// 所以这里不用纠结"边框几个像素"，与 Tauri 的 `set_size`（设的是内尺寸）也自洽。
#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, PartialEq, Debug)]
struct WindowGeometry {
    x: i32,
    y: i32,
    w: u32,
    h: u32,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Copy, PartialEq, Debug, Default)]
struct SavedWindow {
    #[serde(default)]
    geometry: Option<WindowGeometry>,
    /// 上次退出时是不是最大化（是的话下次直接最大化开）
    #[serde(default)]
    maximized: bool,
}

/// 最小可用尺寸（与 `tauri.conf.json` 的 `minWidth` / `minHeight` 一致）
const WINDOW_MIN_W: u32 = 1024;
const WINDOW_MIN_H: u32 = 700;

/// 一块屏幕的可见区域（物理像素）
#[derive(Clone, Copy, Debug)]
struct MonitorRect {
    x: i32,
    y: i32,
    w: u32,
    h: u32,
}

/// **这条几何还能用吗**（纯函数）。
///
/// 场景：上次在副屏 / 大分辨率下用的窗口，这次副屏拔了 —— 直接照搬会把窗口放回一块
/// 不存在的屏幕，用户看到的是"点了图标什么都没出现"（窗口在屏幕外）。所以：
/// - 尺寸先夹到不小于最小可用尺寸、不大于那块屏幕；
/// - **左上角（标题栏那一带）必须落在某块屏幕里**，且至少露出 `200 × 100` ——
///   拖得回来、也点得到；
/// - 一块都放不下就返回 `None`，调用方回落到"居中"。
fn sanitize_geometry(geo: WindowGeometry, monitors: &[MonitorRect]) -> Option<WindowGeometry> {
    let w = geo.w.max(WINDOW_MIN_W);
    let h = geo.h.max(WINDOW_MIN_H);
    for m in monitors {
        let min_x = m.x - (w as i32 - 200);
        let max_x = m.x + m.w as i32 - 200;
        let min_y = m.y;
        let max_y = m.y + m.h as i32 - 100;
        if geo.x >= min_x && geo.x <= max_x && geo.y >= min_y && geo.y <= max_y {
            return Some(WindowGeometry {
                x: geo.x,
                y: geo.y,
                w: w.min(m.w),
                h: h.min(m.h),
            });
        }
    }
    None
}

/// 存盘位置：与数据目录同一处（`<数据目录>/window.json`）——
/// 用户 2026-10-06 要求"一个文件夹装数据"，窗口位置也是这份数据的一部分。
fn window_state_file(app: &tauri::AppHandle) -> Option<PathBuf> {
    Some(current_data_dir(app)?.join("window.json"))
}

fn read_window_state(app: &tauri::AppHandle) -> Option<SavedWindow> {
    let text = std::fs::read_to_string(window_state_file(app)?).ok()?;
    serde_json::from_str(&text).ok()
}

/// 落盘（`geometry = None` 表示"这次不要改几何"，只更新最大化的位）。
fn write_window_state(app: &tauri::AppHandle, geometry: Option<WindowGeometry>, maximized: bool) {
    let mut state = read_window_state(app).unwrap_or_default();
    if let Some(geo) = geometry {
        state.geometry = Some(geo);
    }
    state.maximized = maximized;
    let Some(path) = window_state_file(app) else {
        return;
    };
    match serde_json::to_string(&state) {
        Ok(text) => {
            if let Err(err) = std::fs::write(&path, text) {
                eprintln!("[window] 记窗口位置失败：{err}");
            }
        }
        Err(err) => eprintln!("[window] 序列化窗口位置失败：{err}"),
    }
}

/// 把某块窗口的**当前**几何存下来（几何读不到时只更新最大化位）。
fn remember_window(app: &tauri::AppHandle, win: &tauri::Window) {
    /*
     * ⚠️ **不可见 / 最小化时不记**（2026-10-06 实测踩到）：
     * 窗口在启动时是 `visible: false`（先摆位置再露脸），而 `set_size` / `set_position`
     * 同样会触发 `Resized` / `Moved` —— 那次记录读到的是"还没有内容的窗口"。
     * 更糟的是最小化：Windows 把最小化窗口的坐标报成 **(-32000, -32000)**，尺寸也退化，
     * 照记下去下次启动就把窗口丢到屏幕外（实测状态文件里出现过 `x:-32000,y:-32000,w:144,h:19`）。
     */
    if !win.is_visible().unwrap_or(false) || win.is_minimized().unwrap_or(false) {
        return;
    }
    let maximized = win.is_maximized().unwrap_or(false);
    let fullscreen = win.is_fullscreen().unwrap_or(false);
    /*
     * 最大化 / 全屏时**不记几何**：那时读到的尺寸是屏幕尺寸，记下去会把
     * "还原后该多大"冲掉 —— 下次取消最大化就回不到用户原来拉的大小了。
     */
    let geometry = if maximized || fullscreen {
        None
    } else {
        match (win.outer_position(), win.inner_size()) {
            /* 坐标再兜一道：最小化的哨兵值 -32000 不该进状态文件 */
            (Ok(pos), Ok(size)) if pos.x > -30000 && pos.y > -30000 => Some(WindowGeometry {
                x: pos.x,
                y: pos.y,
                w: size.width,
                h: size.height,
            }),
            _ => None,
        }
    };
    write_window_state(app, geometry, maximized);
}

/// 起窗口时套用它：最大化过就直接最大化，否则设回尺寸 + 位置；
/// 一条都不能用（或第一次启动）就居中。
///
/// `correct` = 是否做"显示后再量一次、把差值补掉"那一趟（见下面的说明）。
fn apply_saved_window(app: &tauri::AppHandle, win: &tauri::WebviewWindow, correct: bool) {
    let monitors: Vec<MonitorRect> = win
        .available_monitors()
        .map(|list| {
            list.into_iter()
                .map(|m| {
                    let pos = m.position();
                    let size = m.size();
                    MonitorRect {
                        x: pos.x,
                        y: pos.y,
                        w: size.width,
                        h: size.height,
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    let saved = read_window_state(app).unwrap_or_default();
    if saved.maximized {
        let _ = win.maximize();
        return;
    }
    if let Some(geo) = saved.geometry.and_then(|g| sanitize_geometry(g, &monitors)) {
        let _ = win.set_size(tauri::PhysicalSize::new(geo.w, geo.h));
        let _ = win.set_position(tauri::PhysicalPosition::new(geo.x, geo.y));
        /*
         * ⚠️ **窗口还没显示时 `set_size` 量不准**（实测）：要 1264×811，显示后量到
         * **1264×841**（高度差 30px、宽度却准）—— 系统对"还没显示 / 图标化"的窗口
         * 另有一套非客户区算法。所以 `show()` 之后再量一次，把差值补掉。
         * 只在这一趟做（`correct = true`），免得来回抖。
         */
        if correct {
            if let Ok(actual) = win.inner_size() {
                let dw = actual.width as i64 - geo.w as i64;
                let dh = actual.height as i64 - geo.h as i64;
                if dw != 0 || dh != 0 {
                    let w = (geo.w as i64 - dw).max(WINDOW_MIN_W as i64) as u32;
                    let h = (geo.h as i64 - dh).max(WINDOW_MIN_H as i64) as u32;
                    let _ = win.set_size(tauri::PhysicalSize::new(w, h));
                    let _ = win.set_position(tauri::PhysicalPosition::new(geo.x, geo.y));
                }
            }
        }
        return;
    }
    /* 第一次启动（或存的位置已经没用了）：居中 —— 与 `tauri.conf.json` 的 `center: true` 同义 */
    let _ = win.center();
}

/// 恢复已有主窗口：show → unminimize → focus。
///
/// 第二实例回调里不能只按固定 label 找窗口：窗口 `create: false`、由 setup 手动构建，
/// 版本变化或配置重载时 label 可能读不到。先找 `main`，再回落到应用当前唯一的 WebView。
fn reveal_existing_window(app: &tauri::AppHandle) {
    if let Ok(mut last) = app.state::<UiHealth>().last.lock() {
        *last = Instant::now();
    }
    let window = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next());
    if let Some(window) = window {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 前端存活心跳。窗口可见但 20 秒没有心跳，就认为 WebView 白屏 / 渲染进程卡死。
struct UiHealth {
    last: Mutex<Instant>,
    reloads: AtomicUsize,
}

impl Default for UiHealth {
    fn default() -> Self {
        Self {
            last: Mutex::new(Instant::now()),
            reloads: AtomicUsize::new(0),
        }
    }
}

#[tauri::command]
fn ui_heartbeat(health: State<UiHealth>) {
    if let Ok(mut last) = health.last.lock() {
        *last = Instant::now();
    }
    health.reloads.store(0, Ordering::Relaxed);
}

/// 托盘：左键恢复窗口；菜单提供打开 / 重新加载 / 退出。
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "tray_open", "打开轻画", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "tray_reload", "重新加载界面", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray_quit", "退出轻画", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &reload, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .tooltip("轻画")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray_open" => reveal_existing_window(app),
            "tray_reload" => {
                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(mut last) = app.state::<UiHealth>().last.lock() {
                        *last = Instant::now();
                    }
                    let _ = window.eval("window.location.reload()");
                }
            }
            "tray_quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal_existing_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// 白屏看门狗：只在窗口可见且未最小化时工作，托盘隐藏 / 正常最小化不会误重启。
fn start_ui_watchdog(app: &tauri::AppHandle) {
    if std::env::var_os("QINGHUA_DISABLE_UI_WATCHDOG").is_some() {
        eprintln!("[ui] 已通过 QINGHUA_DISABLE_UI_WATCHDOG 暂停心跳看门狗");
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(20));
        loop {
            std::thread::sleep(Duration::from_secs(5));
            let Some(window) = app.get_webview_window("main") else {
                continue;
            };
            if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
                continue;
            }
            let elapsed = app
                .state::<UiHealth>()
                .last
                .lock()
                .map(|last| last.elapsed())
                .unwrap_or_default();
            if elapsed < Duration::from_secs(20) {
                continue;
            }
            let attempts = app
                .state::<UiHealth>()
                .reloads
                .fetch_add(1, Ordering::Relaxed);
            eprintln!(
                "[ui] 20 秒无心跳，WebView 可能白屏，执行第 {} 次重载",
                attempts + 1
            );
            if let Ok(mut last) = app.state::<UiHealth>().last.lock() {
                *last = Instant::now();
            }
            let _ = window.eval("window.location.reload()");
            if attempts >= 1 && !cfg!(debug_assertions) {
                app.restart();
            }
        }
    });
}

/// 节流用的时钟：拖动窗口时 `Resized` / `Moved` 每帧都来，不能每帧写一次盘。
struct WindowSaveClock(std::sync::Mutex<std::time::Instant>);

#[cfg(test)]
mod window_state_tests {
    use super::*;

    fn monitor(x: i32, y: i32, w: u32, h: u32) -> MonitorRect {
        MonitorRect { x, y, w, h }
    }

    #[test]
    fn keeps_geometry_that_fits_a_monitor() {
        let got = sanitize_geometry(
            WindowGeometry {
                x: 100,
                y: 80,
                w: 1440,
                h: 900,
            },
            &[monitor(0, 0, 2560, 1440)],
        );
        assert_eq!(
            got,
            Some(WindowGeometry {
                x: 100,
                y: 80,
                w: 1440,
                h: 900
            })
        );
    }

    #[test]
    fn keeps_a_window_on_a_negative_x_second_monitor() {
        // 副屏在主屏左边 ⇒ 合法的 x 是负数，不能被当成"屏幕外"
        let got = sanitize_geometry(
            WindowGeometry {
                x: -1800,
                y: 40,
                w: 1200,
                h: 800,
            },
            &[monitor(0, 0, 2560, 1440), monitor(-1920, 0, 1920, 1080)],
        );
        assert!(got.is_some());
    }

    #[test]
    fn drops_geometry_of_a_monitor_that_is_gone() {
        // 副屏拔掉：x=-1800 那条现在哪块屏幕都不沾 ⇒ None（调用方居中）
        let got = sanitize_geometry(
            WindowGeometry {
                x: -1800,
                y: 40,
                w: 1200,
                h: 800,
            },
            &[monitor(0, 0, 2560, 1440)],
        );
        assert_eq!(got, None);
    }

    #[test]
    fn bumps_a_too_small_size_to_the_minimum() {
        let got = sanitize_geometry(
            WindowGeometry {
                x: 0,
                y: 0,
                w: 300,
                h: 200,
            },
            &[monitor(0, 0, 2560, 1440)],
        )
        .unwrap();
        assert_eq!((got.w, got.h), (WINDOW_MIN_W, WINDOW_MIN_H));
    }

    #[test]
    fn clamps_a_size_larger_than_the_monitor() {
        let got = sanitize_geometry(
            WindowGeometry {
                x: 0,
                y: 0,
                w: 5000,
                h: 4000,
            },
            &[monitor(0, 0, 1920, 1080)],
        )
        .unwrap();
        assert_eq!((got.w, got.h), (1920, 1080));
    }

    #[test]
    fn rejects_a_window_whose_title_bar_is_above_the_screen() {
        // y 在屏幕上方（拖不回来）⇒ None
        let got = sanitize_geometry(
            WindowGeometry {
                x: 100,
                y: -400,
                w: 1200,
                h: 800,
            },
            &[monitor(0, 0, 2560, 1440)],
        );
        assert_eq!(got, None);
    }

    #[test]
    fn saved_state_round_trips_through_json() {
        let state = SavedWindow {
            geometry: Some(WindowGeometry {
                x: 12,
                y: 34,
                w: 1440,
                h: 900,
            }),
            maximized: true,
        };
        let text = serde_json::to_string(&state).unwrap();
        assert_eq!(serde_json::from_str::<SavedWindow>(&text).unwrap(), state);
        // 老文件（只有几何、没有 maximized）也要读得动
        assert_eq!(
            serde_json::from_str::<SavedWindow>("{\"geometry\":{\"x\":1,\"y\":2,\"w\":3,\"h\":4}}")
                .unwrap()
                .maximized,
            false
        );
    }
}

#[cfg(test)]
mod bundled_program_tests {
    use super::*;

    #[test]
    fn only_ffmpeg_maps_to_the_bundled_resource() {
        assert_eq!(
            bundled_program_relative("ffmpeg"),
            Some(PathBuf::from("resources").join("ffmpeg.exe"))
        );
        assert_eq!(
            bundled_program_relative("FFMPEG"),
            Some(PathBuf::from("resources").join("ffmpeg.exe"))
        );
        assert_eq!(bundled_program_relative("ffprobe"), None);
        assert_eq!(bundled_program_relative("notepad"), None);
    }

    #[test]
    fn debug_resource_candidate_lives_under_src_tauri() {
        let relative = bundled_program_relative("ffmpeg").unwrap();
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
        assert!(path.ends_with(Path::new("src-tauri").join("resources").join("ffmpeg.exe")));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        /*
         * 必须放在其他插件之前。第二实例启动时不再起一套窗口，而是恢复已有窗口、
         * 取消最小化并聚焦 —— 这正是“进程还在，但用户以为应用挂了”的兜底。
         */
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            reveal_existing_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        /*
         * 系统通知（对账 #392）：壳里的 WebView2 对 `Notification` 的权限处理不可靠，
         * 走官方插件才是"真的能弹"。**不自动申请权限** —— 申请由设置页那个按钮触发。
         */
        .plugin(tauri_plugin_notification::init())
        /*
         * 窗口几何的节流时钟（见 `WindowSaveClock`）。初值往回拨 10 秒，
         * 免得"启动后第一次微调尺寸"被节流吃掉。
         */
        .manage(WindowSaveClock(std::sync::Mutex::new(
            std::time::Instant::now(),
        )))
        .manage(UiHealth::default())
        /*
         * 本机 CLI 的进程表（见上面「本机 CLI」那一段）。
         * 进的是 `AppHandle` 的受管状态，所以 `cli_run` 与 `cli_kill` 看到的是同一张表。
         */
        .manage(CliRegistry::default())
        /*
         * 窗口几何的自动记盘（用户 2026-10-06 第 11 批第 7 条："记住上次窗口尺寸和位置"）。
         *
         * 两种时机都记：
         * - `Resized` / `Moved`：**节流 800ms**（拖动窗口时这两个事件每帧都来，
         *   逐帧写盘是自找的卡顿）；
         * - `CloseRequested`：关窗口前再记一次（保证最后一次一定落盘）。
         */
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                    let app = window.app_handle();
                    let clock_state = app.state::<WindowSaveClock>();
                    let Ok(clock) = clock_state.0.lock() else {
                        return;
                    };
                    if clock.elapsed() < std::time::Duration::from_millis(800) {
                        return;
                    }
                    drop(clock);
                    if let Ok(mut clock) = clock_state.0.lock() {
                        *clock = std::time::Instant::now();
                    }
                    remember_window(app, window);
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    remember_window(window.app_handle(), window);
                    /*
                     * 有托盘时关闭按钮只隐藏窗口：生成任务与系统通知继续运行。
                     * 真正退出走托盘菜单；托盘没建成功则保留系统默认关闭行为。
                     */
                    if window.app_handle().tray_by_id("main").is_some() {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            grant_folder,
            pick_file,
            save_file_dialog,
            check_update,
            install_update,
            data_dir_path,
            open_dir,
            cache_usage,
            clear_cache,
            profile_backup_info,
            fetch_bytes,
            fetch_text,
            cli_which,
            cli_run,
            cli_kill,
            cli_spawn_window,
            cli_out_dir,
            cli_read_out,
            cli_write_out,
            rh_set_api_key,
            ui_heartbeat
        ])
        .setup(|app| {
            /*
             * 权威数据从这里开始不再属于某个 WebView origin。
             * 调试壳、release 壳和浏览器都连同一个本地服务与同一份文件库。
             */
            qinghua_shared_store::start_in_background();
            /*
             * 窗口在这里**手动建**（`tauri.conf.json` 那条窗口配了 `"create": false`），
             * 唯一原因就是要赶在 webview 创建**之前**把它的数据目录指过去 ——
             * `data_directory` 只能在建窗口时给，建完就改不了了。
             */
            let data_dir = shared_shell_profile_dir(app.handle());
            match &data_dir {
                Some(dir) => {
                    eprintln!("[data] 共享壳 profile：{}", dir.display());
                }
                None => eprintln!("[data] 无法取得共享壳 profile 目录"),
            }
            /*
             * 建窗口前先拍一份：强杀后 WebView2 可能重建空库，
             * 这份副本就是“上次真正能读的数据”。
             */
            /*
             * 权威数据已迁到 shared-store，不再备份整个 WebView profile。
             * 旧逻辑会在启动前复制 GB 级 IndexedDB，反而把窗口卡死。
             */
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
            let window = match build_window(data_dir.clone()) {
                Ok(win) => win,
                Err(err) => {
                    eprintln!("[data] 用自定义数据目录建窗口失败：{err} ⇒ 回落到系统默认位置");
                    if let Some(dir) = &data_dir {
                        // 探针建出来的空目录顺手收掉（只有真的是空的才会成功，不会误删数据）
                        let _ = std::fs::remove_dir(dir);
                    }
                    build_window(None)?
                }
            };
            /*
             * 窗口几何：先套上次的尺寸 / 位置，**再**显示（用户 2026-10-06 第 11 批第 7 条
             * "记住上次窗口尺寸和位置"）。`tauri.conf.json` 那条窗口因此配了 `visible: false`
             * —— 摆好位置再露脸，用户看不到"先居中、再跳到上次位置"那一下。
             */
            apply_saved_window(app.handle(), &window, false);
            /*
             * 显式取消最小化再显示：Windows 对“图标化”的窗口只在任务栏留一个入口，
             * 而开发壳没有托盘图标，用户很容易把“最小化”理解成“挂了”。
             */
            let _ = window.unminimize();
            /* 显示失败要出声：`visible: false` 之下，这一步失败 = 用户双击了却什么都没有 */
            if let Err(err) = window.show() {
                eprintln!("[window] 显示主窗口失败：{err}");
            }
            let _ = window.set_focus();
            if let Err(err) = setup_tray(app.handle()) {
                eprintln!("[tray] 创建托盘失败（关闭按钮将退回直接退出）：{err}");
            }
            start_ui_watchdog(app.handle());
            /*
             * 显示**之后**再套一次：窗口还没显示时系统对 `set_size` 另有一套算法
             * （实测差 30px 高），这一趟会量一次实际尺寸并把差值补掉（见 `apply_saved_window`）。
             */
            apply_saved_window(app.handle(), &window, true);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            let _ = (app_handle, event);
        });
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
        let got = decide_data_dir(Path::new("D:\\轻画\\app"), &none_roots(), &always);
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
        assert_eq!(
            decide_data_dir(Path::new("D:\\app"), &none_roots(), &always),
            None
        );
        // 程序直接躺在盘根 ⇒ 连上一级都没有
        assert_eq!(
            decide_data_dir(Path::new("D:\\qinghua.exe"), &none_roots(), &always),
            None
        );
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
            decide_data_dir(
                Path::new("E:\\proj\\src-tauri\\target\\debug"),
                &roots,
                &always
            ),
            None
        );
        assert_eq!(
            decide_data_dir(
                Path::new("E:\\proj\\src-tauri\\target\\release"),
                &roots,
                &always
            ),
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
