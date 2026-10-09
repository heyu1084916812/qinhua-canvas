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
 * 本脚本把「完整性」从人工承诺变成机械校验，四条判据：
 * ① 每份「已被取代」的文档，都必须在《文档总索引.md》§3.1 的迁移对照表里出现；
 * ② 对照表里引用的每个 `#编号`，都必须在《轻画-功能对账清单.md》里真有条目；
 * ③ 被取代文档里带 P0 的小节，必须在对照表里被引用；
 * ④ 被取代文档的**每个小节都有交代**：二级（章）与三级（节）要么在 §3.1 有落点，
 *    要么在 §3.2「有意不迁移」里写明理由 —— 两处都没提 = 报错，不存在「悄悄少一节」。
 *    章的判据松一档：章本身被引用，或它的**全部**小节都被引用，都算交代过。
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
const EXEMPT_ANCHOR = '### 3.2'

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

/** 取出某个 `### x.y` 起、到下一个二/三级标题为止的块 */
function blockOf(anchor) {
  const start = allLines.findIndex((l) => l.startsWith(anchor))
  if (start < 0) return null
  let end = allLines.length
  for (let i = start + 1; i < allLines.length; i++) {
    if (/^#{2,3} /.test(allLines[i])) {
      end = i
      break
    }
  }
  return allLines.slice(start + 1, end)
}

/**
 * 表格行 → { doc, section, target }；只认第一格是「被取代文档」的行。
 * 「有意不迁移」表同形（第三格是理由）。
 */
function rowsOf(anchor) {
  const lines = blockOf(anchor)
  if (!lines) return null
  const rows = []
  for (const line of lines) {
    if (!line.startsWith('|')) continue
    if (/^\|\s*-{2,}/.test(line)) continue
    const doc = line.match(/`([^`/\\]+\.md)`/)?.[1]
    if (!doc || !superseded.has(doc)) continue
    const cells = line.split('|').map((s) => s.trim())
    rows.push({ doc, section: cells[2] ?? '', target: cells[3] ?? '' })
  }
  return rows
}

const mapping = rowsOf(ANCHOR)
if (!mapping) {
  console.error(`✘ 找不到《${INDEX}》里的「${ANCHOR} 结论迁移对照」小节`)
  console.error('  新增对照表后重跑：它保证"哪条历史结论落到哪个编号"可机械核对。')
  process.exit(1)
}
const exemptions = rowsOf(EXEMPT_ANCHOR)
if (!exemptions) {
  console.error(`✘ 找不到《${INDEX}》里的「${EXEMPT_ANCHOR} 有意不迁移」小节`)
  console.error('  判据 ④ 要求每个小节都有交代：不迁移的也要在这一节写明理由。')
  process.exit(1)
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

const CN_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

/**
 * 被取代文档的小节台账：二级标题 = 章，三级标题 = 节。
 * 节的键取标题开头的 `2.1` / `A.1`；章取中文数字（「附录 A」取字母）。
 */
function sectionsOf(docText) {
  const chapters = []
  const sections = []
  for (const line of docText.split(/\r?\n/)) {
    let m
    if ((m = line.match(/^##\s+(.+)$/))) {
      const index = chapters.length + 1
      const cn = m[1].match(/^([一二三四五六七八九十]+)、/)
      const apx = m[1].match(/^附录\s*([A-Z])/)
      const key = apx ? apx[1] : cn ? String(CN_NUM[cn[1]] ?? index) : String(index)
      chapters.push({ key, index, title: m[1] })
    } else if ((m = line.match(/^###\s+([0-9A-Z]+\.[0-9]+)/))) {
      sections.push({ key: m[1], chapter: chapters.length, title: line.replace(/^#+\s*/, '') })
    }
  }
  return { chapters, sections }
}

const RANGE_RE = /§\s*([0-9A-Z]+(?:\.[0-9]+)?)\s*[–—~-]\s*§?\s*([0-9A-Z]+(?:\.[0-9]+)?)/g
const REF_RE = /§\s*([0-9A-Z]+(?:\.[0-9]+)?)/g
const APPENDIX_RE = /附录\s*([A-Z])(?![\w])/g

/** 从「§3.1–§3.3 数据安全」「§6 + 附录 B」这类写法里取出小节键 */
function refsOf(text) {
  const keys = new Set()
  const ranges = []
  for (const m of text.matchAll(RANGE_RE)) {
    ranges.push(m[0])
    const [, a, b] = m
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
      for (let i = Number(a); i <= Number(b); i++) keys.add(String(i))
      continue
    }
    const [majorA, minorA] = a.split('.')
    const [majorB, minorB] = b.split('.')
    if (minorA !== undefined && majorA === majorB && minorB !== undefined) {
      for (let i = Number(minorA); i <= Number(minorB); i++) keys.add(`${majorA}.${i}`)
      continue
    }
    keys.add(a)
    keys.add(b)
  }
  let rest = text
  for (const r of ranges) rest = rest.split(r).join(' ')
  for (const m of rest.matchAll(REF_RE)) keys.add(m[1])
  for (const m of rest.matchAll(APPENDIX_RE)) keys.add(m[1])
  return keys
}

const problems = []

/** ① */
const uncoveredDocs = [...superseded].filter((d) => !mapping.some((r) => r.doc === d))
if (uncoveredDocs.length) {
  problems.push(
    ...uncoveredDocs.map(
      (d) => `被取代文档没有迁移对照：${d}（在《${INDEX}》${ANCHOR} 里补一行）`,
    ),
  )
}

/** ② */
const dangling = [...referenced.keys()].filter((id) => !ledgerIds.has(id))
if (dangling.length) {
  problems.push(
    ...dangling.map(
      (id) => `对照表引用了不存在的编号：#${id}（《${LEDGER}》里没有这一条，先登记再引用）`,
    ),
  )
}

let p0Count = 0
let sectionTotal = 0
let chapterTotal = 0

for (const doc of superseded) {
  let docText
  try {
    docText = readFileSync(join(ROOT, doc), 'utf8')
  } catch {
    problems.push(`文档不在仓库里：${doc}（被取代的是结论，不是文件——原文必须保留）`)
    continue
  }

  /** ③ P0 小节必须有落点 */
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

  /** ④ 每个章 / 节都要有交代（落点或理由） */
  const { chapters, sections } = sectionsOf(docText)
  const accounted = new Set()
  for (const row of [...mapping, ...exemptions]) {
    if (row.doc !== doc) continue
    for (const key of refsOf(row.section)) accounted.add(key)
  }
  sectionTotal += sections.length
  chapterTotal += chapters.length
  for (const s of sections) {
    if (accounted.has(s.key)) continue
    problems.push(
      `小节没有交代：${doc} §${s.key}（${s.title}）` +
        ` —— 在 ${ANCHOR} 补落点，或在 ${EXEMPT_ANCHOR} 写明「有意不迁移」的理由`,
    )
  }
  for (const c of chapters) {
    if (accounted.has(c.key)) continue
    const own = sections.filter((s) => s.chapter === c.index)
    if (own.length > 0 && own.every((s) => accounted.has(s.key))) continue
    problems.push(
      `章没有交代：${doc} §${c.key}（${c.title}）` +
        ` —— 在 ${ANCHOR} 补落点，或在 ${EXEMPT_ANCHOR} 写明理由`,
    )
  }
}

if (problems.length) {
  console.error(
    `✘ 文档迁移对照不一致（被取代文档 ${superseded.size} 份 / 对照行 ${mapping.length} 条 / ` +
      `不迁移行 ${exemptions.length} 条）`,
  )
  for (const p of problems) console.error(`    - ${p}`)
  console.error(`\n处理：在《${INDEX}》${ANCHOR} 补落点、或在 ${EXEMPT_ANCHOR} 写明理由，再重跑。`)
  process.exit(1)
}

console.log(
  `✔ 文档迁移对照通过：被取代文档 ${superseded.size} 份 / 对照行 ${mapping.length} 条 / ` +
    `不迁移行 ${exemptions.length} 条 / 引用编号 ${referenced.size} 个全部有据 / ` +
    `章 ${chapterTotal} 节 ${sectionTotal} 全部有交代 / P0 小节 ${p0Count} 个无漏引`,
)
