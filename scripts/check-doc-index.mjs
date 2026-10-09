/**
 * 文档索引覆盖检查（防"文档越写越多、没人知道哪份算数"）。
 *
 * 背景：仓库根目录已有 17 份 markdown。曾出现两处真实冲突：
 * ① 两份"计划"对同一件事说法不同；② 漫剧口径与既有调研不一致。
 * 处理原则是**不删不合并**，靠 `文档总索引.md` 登记"谁管什么"。
 * 但索引本身也会过期 —— 新增了文档却忘了登记，索引就变成假真相。
 *
 * 本脚本只做一件事：把根目录**所有** `.md` 与索引里登记的清单逐一对账，
 * 列出「没登记的」和「登记了但文件不在的」。任何一处不一致即退出码 1。
 *
 * 用法：node scripts/check-doc-index.mjs
 * 已接入 `npm run check`（与主题守卫、壳几何同层）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const INDEX = '文档总索引.md'

/** 根目录下所有 markdown（不含子目录；索引自身也要求登记，避免自指混乱） */
const actual = readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
  .map((e) => e.name)
  .sort()

const indexText = readFileSync(join(ROOT, INDEX), 'utf8')

/**
 * 登记解析：索引里每份文档都写在**行内代码**里（`` `文件名.md` ``）。
 * 只认"根目录第一层"的名字（不含 `/`），这样引用别的文档时不会误判。
 */
const registered = new Set()
for (const m of indexText.matchAll(/`([^`/\\]+\.md)`/gi)) {
  registered.add(m[1])
}

const missing = actual.filter((name) => !registered.has(name))
const stale = [...registered].filter((name) => !actual.includes(name)).sort()

if (missing.length === 0 && stale.length === 0) {
  console.log(`✔ 文档索引覆盖通过：根目录 ${actual.length} 份 .md 全部已登记`)
  process.exit(0)
}

console.error(`✘ 文档索引不一致（根目录 ${actual.length} 份）`)
if (missing.length) {
  console.error('  未登记的文档（新增后忘了写进《文档总索引.md》）：')
  for (const name of missing) console.error(`    - ${name}`)
}
if (stale.length) {
  console.error('  索引里登记了、但文件不在（可能被改名或删除）：')
  for (const name of stale) console.error(`    - ${name}`)
}
console.error('\n处理：在《文档总索引.md》第二节的表格里补一行 / 改一行，再重跑。')
process.exit(1)
