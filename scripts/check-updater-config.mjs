import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const conf = JSON.parse(
  readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'),
)
const mode = conf?.plugins?.updater?.windows?.installMode

if (mode !== 'quiet') {
  console.error(
    `更新安装模式必须是 quiet（当前 ${mode ?? '未设置'}）。\n` +
      'passive / basicUi 会显示系统安装面板，与应用的静默更新交互不一致。',
  )
  process.exit(1)
}

console.log('✔ 更新安装模式：quiet（应用短暂退出后自动重开，不显示 NSIS 面板）')
