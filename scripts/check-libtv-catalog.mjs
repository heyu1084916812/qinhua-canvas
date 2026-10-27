import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const catalogPath = path.join(root, 'public', 'libtv-skills', 'catalog.json')
const bodyDir = path.join(root, 'public', 'libtv-skills', 'bodies')
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'))
const items = Array.isArray(catalog.items) ? catalog.items : []
const withBody = items.filter((item) => typeof item.bodyFile === 'string' && item.bodyFile)
const categories = [
  '图像创作',
  '视频创作',
  '人物角色',
  '电商品牌',
  '影视剧情',
  '动漫游戏',
  '音频音乐',
  '文案策划',
  '后期工具',
  '其他',
]

if (items.length !== 1472) throw new Error(`LibTV 目录应为 1472 条，实际 ${items.length}`)
if (catalog.bodyCount !== 764) throw new Error(`LibTV 正文计数应为 764，实际 ${catalog.bodyCount}`)
if (withBody.length !== 764) throw new Error(`带正文的目录应为 764 条，实际 ${withBody.length}`)
if (catalog.categoryVersion !== 2) {
  throw new Error(`LibTV 分类版本应为 2，实际 ${catalog.categoryVersion}`)
}
const allowedCategories = new Set(categories)
const invalidCategory = items.filter((item) => !allowedCategories.has(item.category))
if (invalidCategory.length) {
  throw new Error(
    `LibTV v2 分类缺失或非法 ${invalidCategory.length} 条：${invalidCategory
      .slice(0, 5)
      .map((item) => item.name)
      .join('、')}`,
  )
}

if (!existsSync(bodyDir)) throw new Error('缺少 LibTV 正文分片目录')
const bodyKeys = new Set()
const duplicateKeys = []
const emptyKeys = []
let fileTotal = 0
let multiFileSkills = 0
for (const file of readdirSync(bodyDir).filter((name) => name.endsWith('.json'))) {
  const payload = JSON.parse(readFileSync(path.join(bodyDir, file), 'utf8'))
  for (const [key, value] of Object.entries(payload)) {
    if (bodyKeys.has(key)) duplicateKeys.push(key)
    bodyKeys.add(key)
    if (typeof value === 'string') {
      if (!value.trim()) emptyKeys.push(key)
      fileTotal += 1
      continue
    }
    if (!value || typeof value !== 'object') {
      emptyKeys.push(key)
      continue
    }
    const files = Object.entries(value)
    fileTotal += files.length
    if (files.length > 1) multiFileSkills += 1
    if (!files.some(([path]) => path === 'SKILL.md')) emptyKeys.push(`${key}:SKILL.md`)
    for (const [filePath, content] of files) {
      if (typeof content !== 'string' || !content.trim()) emptyKeys.push(`${key}:${filePath}`)
    }
  }
}
const missing = withBody.map((item) => item.bodyFile).filter((key) => !bodyKeys.has(key))
if (missing.length) throw new Error(`缺失 LibTV 正文 ${missing.length} 份：${missing.slice(0, 5)}`)
if (duplicateKeys.length) {
  throw new Error(`LibTV 正文重复 ${duplicateKeys.length} 份：${duplicateKeys.slice(0, 5)}`)
}
if (emptyKeys.length) throw new Error(`空 LibTV 正文 ${emptyKeys.length} 份：${emptyKeys.slice(0, 5)}`)
if (fileTotal <= withBody.length) throw new Error('LibTV 正文没有识别到任何附件文件')

const canvasCases = items.filter((item) =>
  (item.cases ?? []).some((entry) => typeof entry.canvasCaseUrl === 'string' && entry.canvasCaseUrl),
).length
console.log(
  `✔ LibTV 技能目录：${items.length} 条 / ${withBody.length} 个技能正文 / ${fileTotal} 个 MD 文件（${multiFileSkills} 个多文件技能）/ ${canvasCases} 条画布案例 / 正文 ${readdirSync(bodyDir).filter((name) => name.endsWith('.json')).length} 个分片`,
)
