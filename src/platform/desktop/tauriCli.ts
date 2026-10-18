import { invoke } from '@tauri-apps/api/core'
import { base64ToBytes } from '../../domain/shared/base64'
import type { CliOutcome, CliPort, CliRunRequest, CliWindowRequest } from '../ports'

/**
 * 「本机 CLI」的**壳实现**（对账 #308）：三个动作各自对应一条 Rust 命令
 * （`src-tauri/src/lib.rs` 的「本机 CLI」那一段）。
 *
 * 这里刻意只做**转发**，不做任何判断：
 * - "这个命令在不在" 由 Rust 按真实文件系统 + `PATHEXT` 回答；
 * - "跑没跑起来 / 退码几 / 超没超时" 也只有真正起进程的那一侧知道。
 * 前端多写一层"我觉得应该能找到"只会造出"界面说能找到、实际起不来"的分叉。
 *
 * 参数名按 Tauri 的约定用 camelCase（`timeoutMs` → Rust 的 `timeout_ms`）。
 */
export function createTauriCli(): CliPort {
  return {
    which: async (program) => {
      const found = await invoke<string | null>('cli_which', { program })
      return found ?? null
    },
    run: (req: CliRunRequest) =>
      invoke<CliOutcome>('cli_run', {
        id: req.id,
        program: req.program,
        args: req.args,
        cwd: req.cwd,
        timeoutMs: req.timeoutMs,
        stdin: req.stdin,
      }),
    kill: (id) => invoke<boolean>('cli_kill', { id }),
    spawnWindow: async (req: CliWindowRequest) => {
      await invoke('cli_spawn_window', { program: req.program, args: req.args, cwd: req.cwd })
    },
    outDir: () => invoke<string>('cli_out_dir'),
    readOut: async (path) => base64ToBytes(await invoke<string>('cli_read_out', { path })),
    writeOut: (name, bytes) =>
      invoke<string>('cli_write_out', { name, bytes: Array.from(bytes) }),
    /**
     * RunningHub 的登录（用户 2026-10-08 第 3 条）：壳把 Key 写进 CLI 自己的配置，
     * 与用户手敲 `rh auth set-key` 等效，但**密钥不进 argv**。见 `ports.ts` 那条的说明。
     */
    rhSetApiKey: (key) => invoke<string>('rh_set_api_key', { apiKey: key }),
  }
}
