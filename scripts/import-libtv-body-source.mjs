import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const sourceDir = path.resolve(
  process.argv[2] ?? path.join(root, '.probe-tmp', 'libtv-source-full', 'skill'),
)
const catalogPath = path.join(root, 'public', 'libtv-skills', 'catalog.json')
const bodyDir = path.join(root, 'public', 'libtv-skills', 'bodies')
const manifestPath = path.join(sourceDir, '_manifest.json')

if (!existsSync(sourceDir)) throw new Error(`LibTV 正文源目录不存在：${sourceDir}`)
if (!existsSync(manifestPath)) throw new Error(`LibTV 导入清单不存在：${manifestPath}`)

const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const items = Array.isArray(catalog.items) ? catalog.items : []
const results = Array.isArray(manifest.results) ? manifest.results : []

function readCurrentBodies() {
  const bodies = new Map()
  if (!existsSync(bodyDir)) return bodies
  for (const file of readdirSync(bodyDir).filter((name) => name.endsWith('.json'))) {
    const payload = JSON.parse(readFileSync(path.join(bodyDir, file), 'utf8'))
    for (const [key, value] of Object.entries(payload)) bodies.set(key, value)
  }
  return bodies
}

const currentBodies = readCurrentBodies()
const savedById = new Map(
  results
    .filter((result) => result.status === 'saved')
    .map((result) => [result.templateUuid, result]),
)

function normalizeMarkdown(value) {
  return value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim()
}

function sourceFile(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) {
    throw new Error('LibTV 清单包含空文件路径')
  }
  const full = path.resolve(sourceDir, relativePath)
  const relative = path.relative(sourceDir, full)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`LibTV 文件越出源目录：${relativePath}`)
  }
  if (!existsSync(full)) throw new Error(`LibTV 源文件不存在：${relativePath}`)
  return full
}

function attachmentKey(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/')
  const marker = '_附件/'
  const markerAt = normalized.indexOf(marker)
  if (markerAt < 0) throw new Error(`无法识别 LibTV 附件路径：${relativePath}`)
  const key = normalized.slice(markerAt + marker.length)
  if (!key || key.startsWith('/') || key.split('/').includes('..')) {
    throw new Error(`LibTV 附件路径非法：${relativePath}`)
  }
  return key
}

function filesFor(result) {
  const files = {}
  files['SKILL.md'] = normalizeMarkdown(readFileSync(sourceFile(result.file), 'utf8'))
  if (!files['SKILL.md']) throw new Error(`LibTV 主正文为空：${result.name}`)
  for (const extra of result.extraFiles ?? []) {
    const key = attachmentKey(extra)
    if (files[key]) throw new Error(`LibTV 附件重复：${result.name} / ${key}`)
    const content = normalizeMarkdown(readFileSync(sourceFile(extra), 'utf8'))
    if (!content) throw new Error(`LibTV 附件为空：${result.name} / ${key}`)
    files[key] = content
  }
  return files
}

const shards = new Map()
let importedFromManifest = 0
let preservedCurrent = 0

for (const item of items) {
  const saved = savedById.get(item.sourceId)
  if (saved) {
    const bodyFile = `bodies/${item.sourceId}.md`
    const files = filesFor(saved)
    const shard = item.sourceId.toLowerCase()[0] ?? '_'
    if (!shards.has(shard)) shards.set(shard, {})
    shards.get(shard)[bodyFile] = files
    item.bodyFile = bodyFile
    importedFromManifest += 1
    continue
  }

  const existing = item.bodyFile ? currentBodies.get(item.bodyFile) : null
  if (!existing) {
    item.bodyFile = null
    continue
  }
  const shard = path.basename(item.bodyFile).toLowerCase()[0] ?? '_'
  if (!shards.has(shard)) shards.set(shard, {})
  shards.get(shard)[item.bodyFile] = existing
  preservedCurrent += 1
}

catalog.bodyCount = importedFromManifest + preservedCurrent
catalog.importedAt = '2026-10-27'

mkdirSync(bodyDir, { recursive: true })
for (const [shard, payload] of shards) {
  writeFileSync(
    path.join(bodyDir, `${shard}.json`),
    JSON.stringify(payload),
    'utf8',
  )
}
writeFileSync(catalogPath, JSON.stringify(catalog), 'utf8')

const fileCount = [...shards.values()].reduce(
  (total, payload) =>
    total +
    Object.values(payload).reduce(
      (skillTotal, value) =>
        skillTotal +
        (typeof value === 'string' ? 1 : Object.keys(value ?? {}).length),
      0,
    ),
  0,
)

console.log(
  `LibTV 正文导入完成：清单恢复 ${importedFromManifest} 条，保留现有 ${preservedCurrent} 条，合计 ${catalog.bodyCount} 条 / ${fileCount} 个 Markdown 文件。`,
)
