/**
 * 文档迁移对照检查（防「宣布已并入、实际漏掉一整条」）。
 *
 * 背景：仓库里有 5 份被标为「已被取代」的历史文档（计划 / 调研 / 设计）。
 * 2026-10-09 的整理宣布「结论已并入《轻画-开发计划.md》」，
 * 但同一天的审计实测抓到真实漏网：
 * 《轻画-交付功能与设置梳理.md》§3.5「使用引导与帮助（P0）」
 * 在《轻画-开发计划.md》与《轻画-功能对账清单.md》里关键词命中数**全部为 0**
 * —— 整条 P0 结论在合并时丢了，而当时的门禁没有任何一条会报错（对账 #388）。
 *
 * 本脚本把「完整性」从人工承诺变成机械校验，三条判据：
 * ① 每份「已被取代」的文档，都必须在《文档总索引.md》§3.1 的迁移对照表里出现；
 * ② 对照表里引用的每个 `#编号`，都必须在《轻画-功能对账清单.md》里真有条目；
 * ③ 被取代文档里带 P0 的小节，必须在对照表里被引用。
 *
 * 它防不住「抄了一半 / 语义走样」——那类只能靠《轻画-开发计划.md》
 * 各步的验收判据，别把这条脚本当全能保证。
 *
 * 用法：node scripts/check-doc-migration.mjs
 * 已接入 `npm run check`（与 check-doc-index.mjs 同层）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const INDEX = '文档总索引.md'
const LEDGER = '轻画-功能对账清单.md'
const ANCHOR = '### 3.1'

const indexText = readFileSync(join(ROOT, INDEX), 'utf8')
const ledgerText = readFileSync(join(ROOT, LEDGER), 'utf8')

/** ① 索引第二节「当前文档清单」里，状态列写着「已被取代」的文档 */
const allLines = indexText.split(/\r?\n/)
const inventoryStart = allLines.findIndex((l) => /^##\s*二、/.test(l))
const inventoryEnd = allLines.findIndex((l, i) => i > inventoryStart && /^##\s*三、/.test(l))
const superseded = new Set()
for (const line of allLines.slice(inventoryStart, inventoryEnd < 0 ? undefined : inventoryEnd)) {
  if (!line.startsWith('|')) continue
  const cells = line.split('|').map((s) => s.trim())
  if (cells.length < 5 || !cells[3].includes('已被取代')) continue
  const m = cells[1].match(/`([^`/\\]+\.md)`/)
  if (m) superseded.add(m[1])
}

/** ② §3.1 迁移对照表：只认第一格是「被取代文档」的行 */
const start = allLines.findIndex((l) => l.startsWith(ANCHOR))
if (start < 0) {
  console.error(`✘ 找不到《${INDEX}》里的「${ANCHOR} 结论迁移对照」小节`)
  console.error('  新增对照表后重跑：它保证"哪条历史结论落到哪个编号"可机械核对。')
  process.exit(1)
}
let end = allLines.length
for (let i = start + 1; i < allLines.length; i++) {
  if (/^#{2,3} /.test(allLines[i])) {
    end = i
    break
  }
}

const mapping = []
for (let i = start + 1; i < end; i++) {
  const line = allLines[i]
  if (!line.startsWith('|')) continue
  if (/^\|\s*-{2,}/.test(line)) continue
  const doc = line.match(/`([^`/\\]+\.md)`/)?.[1]
  if (!doc || !superseded.has(doc)) continue
  const cells = line.split('|').map((s) => s.trim())
  mapping.push({ doc, section: cells[2] ?? '', target: cells[3] ?? '' })
}

/** ③ 对账清单里的编号条目（`| **378a** |` 与 `| 10 |` 两种写法都认） */
const ledgerIds = new Set()
for (const line of ledgerText.split(/\r?\n/)) {
  const m = line.match(/^\|\s*\*{0,2}(\d{1,4}[a-z]?)\*{0,2}\s*\|/i)
  if (m) ledgerIds.add(m[1])
}

const referenced = new Map()
for (const row of mapping) {
  for (const m of row.target.matchAll(/#(\d{1,4}[a-z]?)/gi)) {
    const id = m[1]
    if (!referenced.has(id)) referenced.set(id, row)
  }
}

const problems = []

const uncoveredDocs = [...superseded].filter((d) => !mapping.some((r) => r.doc === d))
if (uncoveredDocs.length) {
  problems.push(
    ...uncoveredDocs.map(
      (d) => `被取代文档没有迁移对照：${d}（在《${INDEX}》${ANCHOR} 里补一行）`,
    ),
  )
}

const dangling = [...referenced.keys()].filter((id) => !ledgerIds.has(id))
if (dangling.length) {
  problems.push(
    ...dangling.map(
      (id) =>
        `对照表引用了不存在的编号：#${id}（《${LEDGER}》里没有这一条，先登记再引用）`,
    ),
  )
}

let p0Count = 0
for (const doc of superseded) {
  let docText
  try {
    docText = readFileSync(join(ROOT, doc), 'utf8')
  } catch {
    problems.push(`文档不在仓库里：${doc}（被取代的是结论，不是文件——原文必须保留）`)
    continue
  }
  for (const line of docText.split(/\r?\n/)) {
    if (!/^#{2,4} /.test(line) || !line.includes('P0')) continue
    const num = line.match(/(\d+\.\d+)/)?.[1]
    if (!num) continue
    p0Count += 1
    const covered = mapping.some((r) => r.doc === doc && r.section.includes(num))
    if (!covered) {
      const heading = line.replace(/^#+\s*/, '')
      problems.push(`P0 小节漏迁移：${doc} §${num}（${heading}，在 ${ANCHOR} 对照表里补一行）`)
    }
  }
}

if (problems.length) {
  console.error(`✘ 文档迁移对照不一致（被取代文档 ${superseded.size} 份 / 对照行 ${mapping.length} 条）`)
  for (const p of problems) console.error(`    - ${p}`)
  console.error(`\n处理：在《${INDEX}》${ANCHOR} 的对照表里补/改一行，再重跑。`)
  process.exit(1)
}

console.log(
  `✔ 文档迁移对照通过：被取代文档 ${superseded.size} 份 / 对照行 ${mapping.length} 条 / ` +
    `引用编号 ${referenced.size} 个全部有据 / P0 小节 ${p0Count} 个无漏引`,
)
