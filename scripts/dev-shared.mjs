import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const cargo = process.platform === 'win32' ? 'cargo.exe' : 'cargo'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

async function healthy() {
  try {
    const response = await fetch('http://127.0.0.1:18765/health')
    return response.ok
  } catch {
    return false
  }
}

let storage = null
if (!(await healthy())) {
  const built = spawnSync(cargo, ['build', '--manifest-path', 'shared-store/Cargo.toml'], {
    cwd: root,
    stdio: 'inherit',
  })
  if (built.status !== 0) process.exit(built.status || 1)
  const binary = path.join(
    root,
    'shared-store',
    'target',
    'debug',
    process.platform === 'win32' ? 'qinghua-store.exe' : 'qinghua-store',
  )
  storage = spawn(binary, [], { cwd: root, stdio: 'inherit' })
  const started = Date.now()
  while (!(await healthy())) {
    if (storage.exitCode !== null) {
      console.error('共享存储服务启动失败；Vite 不会启动，避免退回另一份 IndexedDB。')
      process.exit(storage.exitCode || 1)
    }
    if (Date.now() - started > 120_000) {
      console.error('共享存储服务启动超时。')
      storage.kill()
      process.exit(1)
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

const vite = spawn(npm, ['run', 'dev:vite'], { cwd: root, stdio: 'inherit' })

const stop = () => {
  vite.kill()
  storage?.kill()
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
vite.on('exit', (code) => {
  storage?.kill()
  process.exit(code ?? 0)
})
