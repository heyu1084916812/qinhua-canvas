import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const catalogPath = path.join(root, 'public', 'libtv-skills', 'catalog.json')
const bodyDir = path.join(root, 'public', 'libtv-skills', 'bodies')
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const items = Array.isArray(catalog.items) ? catalog.items : []
const withBody = items.filter((item) => typeof item.bodyFile === 'string' && item.bodyFile)

if (items.length !== 1472) throw new Error(`LibTV 目录应为 1472 条，实际 ${items.length}`)
if (catalog.bodyCount !== 704) throw new Error(`LibTV 正文计数应为 704，实际 ${catalog.bodyCount}`)
if (withBody.length !== 704) throw new Error(`带正文的目录应为 704 条，实际 ${withBody.length}`)

if (!existsSync(bodyDir)) throw new Error('缺少 LibTV 正文分片目录')
const bodyKeys = new Set()
const duplicateKeys = []
const emptyKeys = []
for (const file of readdirSync(bodyDir).filter((name) => name.endsWith('.json'))) {
  const payload = JSON.parse(readFileSync(path.join(bodyDir, file), 'utf8'))
  for (const [key, value] of Object.entries(payload)) {
    if (bodyKeys.has(key)) duplicateKeys.push(key)
    bodyKeys.add(key)
    if (typeof value !== 'string' || !value.trim()) emptyKeys.push(key)
  }
}
const missing = withBody.map((item) => item.bodyFile).filter((key) => !bodyKeys.has(key))
if (missing.length) throw new Error(`缺失 LibTV 正文 ${missing.length} 份：${missing.slice(0, 5)}`)
if (duplicateKeys.length) {
  throw new Error(`LibTV 正文重复 ${duplicateKeys.length} 份：${duplicateKeys.slice(0, 5)}`)
}
if (emptyKeys.length) throw new Error(`空 LibTV 正文 ${emptyKeys.length} 份：${emptyKeys.slice(0, 5)}`)

const canvasCases = items.filter((item) =>
  (item.cases ?? []).some((entry) => typeof entry.canvasCaseUrl === 'string' && entry.canvasCaseUrl),
).length
console.log(
  `✔ LibTV 技能目录：${items.length} 条 / ${withBody.length} 份正文 / ${canvasCases} 条画布案例 / 正文 ${readdirSync(bodyDir).filter((name) => name.endsWith('.json')).length} 个分片`,
)
