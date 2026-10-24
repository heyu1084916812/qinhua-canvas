import { invoke } from '@tauri-apps/api/core'
import type {
  StorageAdminPort,
  StorageMigrationReport,
  StorageReplaceResult,
  StorageStartupState,
  StorageUpgradeResult,
  StorageV2Verification,
  StorageRootInfo,
} from '../ports'

/**
 * 「存储管理」的**壳实现**（对账 #261）：四个动作各自对应一条 Rust 命令。
 *
 * 这里刻意只做**转发**，不在这里做任何判断（例如"这个目录能不能打开"）——
 * 判断都在 Rust 侧：那儿才知道真实路径、也才能真的删文件。
 * 前端多写一层判断只会出现"两边结论不一致"。
 */
export function createTauriStorageAdmin(): StorageAdminPort {
  return {
    dataDir: () => invoke<string>('data_dir_path'),
    pickDataDir: () => invoke<string | null>('pick_data_dir'),
    setDataDir: (path) => invoke<string>('set_data_dir', { path }),
    inspectRoot: (path) => invoke<StorageRootInfo>('inspect_data_dir', { path }),
    migrateDataDir: (source, target, dryRun) =>
      invoke<StorageMigrationReport>('migrate_data_dir', {
        source,
        target,
        dryRun,
      }),
    startupStorageState: () =>
      invoke<StorageStartupState>('storage_startup_state'),
    autoUpgradeStorage: () =>
      invoke<StorageUpgradeResult>('auto_upgrade_storage'),
    finalizeStorageUpgrade: () =>
      invoke<StorageV2Verification>('finalize_storage_upgrade'),
    replaceDataDir: (target) =>
      invoke<StorageReplaceResult>('replace_storage_root', { target }),
    openDir: async (path) => {
      await invoke('open_dir', { path })
    },
    cacheUsage: () => invoke<number>('cache_usage'),
    clearCache: () => invoke<number>('clear_cache'),
    profileBackupInfo: () =>
      invoke<{ dir: string; keep: number }>('profile_backup_info'),
  }
}
