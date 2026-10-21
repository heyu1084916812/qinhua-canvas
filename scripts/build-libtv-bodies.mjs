import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const sourceDir = path.resolve(
  process.argv[2] ?? path.join(root, '.probe-tmp', 'libtv-source-full', 'skill'),
)
const outputDir = path.join(root, 'public', 'libtv-skills', 'bodies')
const catalog = JSON.parse(
  readFileSync(path.join(root, 'public', 'libtv-skills', 'catalog.json'), 'utf8'),
)

if (!existsSync(sourceDir)) {
  throw new Error(`正文源目录不存在：${sourceDir}`)
}

function normalizeMarkdown(value) {
  return value.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim()
}

function markdownFilesBelow(dir) {
  if (!existsSync(dir)) return []
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...markdownFilesBelow(full))
    else if (entry.isFile() && /\.md$/i.test(entry.name)) files.push(full)
  }
  return files
}

function bodyFromShardValue(value) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return ''
  return typeof value['SKILL.md'] === 'string' ? value['SKILL.md'] : ''
}

const currentBodies = new Map()
for (const file of existsSync(outputDir)
  ? readdirSync(outputDir).filter((name) => name.endsWith('.json'))
  : []) {
  const payload = JSON.parse(readFileSync(path.join(outputDir, file), 'utf8'))
  for (const [key, value] of Object.entries(payload)) {
    const body = bodyFromShardValue(value)
    if (body) currentBodies.set(key, body)
  }
}

const mainFiles = readdirSync(sourceDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.md$/i.test(entry.name))
  .map((entry) => path.join(sourceDir, entry.name))
const compactName = (value) => value.replace(/\s+/g, '').toLowerCase()
const mainByStem = new Map(mainFiles.map((file) => [compactName(path.basename(file, '.md')), file]))
const mainByContent = new Map()
for (const file of mainFiles) {
  const content = normalizeMarkdown(readFileSync(file, 'utf8'))
  if (!mainByContent.has(content)) mainByContent.set(content, [])
  mainByContent.get(content).push(file)
}

function matchMainFile(item, body) {
  const byName = mainByStem.get(compactName(item.name))
  if (byName) return byName
  const candidates = mainByContent.get(normalizeMarkdown(body)) ?? []
  if (candidates.length <= 1) return candidates[0] ?? null
  return (
    candidates.find(
      (file) => compactName(path.basename(file, '.md')) === compactName(item.name),
    ) ?? candidates[0]
  )
}

const shards = new Map()
const diagnostics = { unmatched: [], withoutAttachments: 0, attachmentFiles: 0, fileCount: 0 }
for (const item of catalog.items ?? []) {
  if (typeof item.bodyFile !== 'string' || !item.bodyFile) continue
  const body = currentBodies.get(item.bodyFile)
  if (!body) throw new Error(`缺少当前主正文：${item.bodyFile}`)
  const mainFile = matchMainFile(item, body)
  if (!mainFile) {
    diagnostics.unmatched.push({ name: item.name, bodyFile: item.bodyFile })
  }
  const attachmentDir = mainFile
    ? path.join(path.dirname(mainFile), `${path.basename(mainFile, '.md')}_附件`)
    : ''
  const attachments = markdownFilesBelow(attachmentDir)
  const mainContent = mainFile ? normalizeMarkdown(readFileSync(mainFile, 'utf8')) : body
  if (!mainContent) throw new Error(`正文为空：${item.bodyFile}`)
  const files = { 'SKILL.md': mainContent }
  for (const attachment of attachments) {
    let relative = path.relative(attachmentDir, attachment).split(path.sep).join('/')
    if (relative === 'SKILL.md') relative = `附件/${relative}`
    files[relative] = normalizeMarkdown(readFileSync(attachment, 'utf8'))
  }
  if (attachments.length === 0) diagnostics.withoutAttachments += 1
  diagnostics.attachmentFiles += attachments.length
  diagnostics.fileCount += Object.keys(files).length
  const shard = path.basename(item.bodyFile).toLowerCase()[0] ?? '_'
  if (!shards.has(shard)) shards.set(shard, {})
  shards.get(shard)[item.bodyFile] = files
}

mkdirSync(outputDir, { recursive: true })
for (const [shard, payload] of shards) {
  writeFileSync(path.join(outputDir, `${shard}.json`), JSON.stringify(payload), 'utf8')
}

if (diagnostics.unmatched.length) {
  throw new Error(
    `有 ${diagnostics.unmatched.length} 个主正文无法映射到源文件：${JSON.stringify(
      diagnostics.unmatched.slice(0, 5),
    )}`,
  )
}

console.log(
  `已生成 ${shards.size} 个 LibTV 正文分片：${diagnostics.fileCount} 个文件（${diagnostics.attachmentFiles} 个附件）`,
)
console.log(`无附件主文件 ${diagnostics.withoutAttachments} 个。`)
