import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const sourceDir = path.resolve(process.argv[2] ?? path.join(root, '.probe-tmp', 'libtv-bodies'))
const outputDir = path.join(root, 'public', 'libtv-skills', 'bodies')
const catalog = JSON.parse(
  readFileSync(path.join(root, 'public', 'libtv-skills', 'catalog.json'), 'utf8'),
)

if (!existsSync(sourceDir)) {
  throw new Error(`正文源目录不存在：${sourceDir}`)
}

const shards = new Map()
for (const item of catalog.items ?? []) {
  if (typeof item.bodyFile !== 'string' || !item.bodyFile) continue
  const source = path.join(sourceDir, path.basename(item.bodyFile))
  if (!existsSync(source)) throw new Error(`缺少正文源文件：${item.bodyFile}`)
  const body = readFileSync(source, 'utf8').trim()
  if (!body) throw new Error(`正文为空：${item.bodyFile}`)
  const shard = path.basename(item.bodyFile).toLowerCase()[0] ?? '_'
  if (!shards.has(shard)) shards.set(shard, {})
  shards.get(shard)[item.bodyFile] = body
}

mkdirSync(outputDir, { recursive: true })
for (const [shard, payload] of shards) {
  writeFileSync(path.join(outputDir, `${shard}.json`), JSON.stringify(payload), 'utf8')
}

console.log(`已生成 ${shards.size} 个 LibTV 正文分片：${outputDir}`)
