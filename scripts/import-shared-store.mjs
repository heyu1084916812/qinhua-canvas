import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'

const root = path.resolve(import.meta.dirname, '..')
const sourceDir = path.resolve(process.argv[2] ?? path.join(root, 'target/recovery-export'))
const baseUrl = String(process.env.QH_SHARED_STORE_URL ?? 'http://127.0.0.1:18765').replace(/\/$/, '')

async function post(route, body, timeout = 30_000) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
  if (!response.ok) {
    throw new Error(`${route}: HTTP ${response.status} ${await response.text()}`)
  }
  return response.json()
}

async function importTable(file) {
  const table = path.basename(file, '.ndjson')
  const batchSize = table === 'assets' || table === 'fonts' ? 1 : 100
  let imported = 0
  let batch = []
  let total = 0
  const flush = async () => {
    if (batch.length === 0) return
    const rows = batch.map((line) => JSON.parse(line).value)
    await post('/bulkPut', { table, rows }, 20 * 60_000)
    imported += rows.length
    batch = []
    process.stdout.write(`\r${table}: ${imported}/${total || '?'}`)
  }
  const input = readline.createInterface({
    input: fs.createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  for await (const line of input) {
    if (!line.trim()) continue
    total += 1
    batch.push(line)
    if (batch.length >= batchSize) await flush()
  }
  await flush()
  if (imported > 0) process.stdout.write('\n')
  return { table, rows: imported }
}

const health = await fetch(`${baseUrl}/health`).then((response) => response.json())
console.log(`shared store: ${baseUrl} (${health.dataDir})`)

const results = []
for (const name of fs.readdirSync(sourceDir)) {
  if (!name.endsWith('.ndjson')) continue
  results.push(await importTable(path.join(sourceDir, name)))
}

const localStoragePath = path.join(sourceDir, 'local-storage.json')
let kvCount = 0
if (fs.existsSync(localStoragePath)) {
  const all = JSON.parse(fs.readFileSync(localStoragePath, 'utf8'))
  const source = all['http://127.0.0.1:1420'] ?? {}
  for (const [key, entry] of Object.entries(source)) {
    if (!entry?.live || !key.startsWith('qinghua.cred.')) continue
    const value = key === 'qinghua.cred.salt' ? JSON.parse(entry.value) : JSON.parse(entry.value)
    await post('/kv/put', { key, value })
    kvCount += 1
  }
}

console.log(JSON.stringify({ results, kvCount }, null, 2))
