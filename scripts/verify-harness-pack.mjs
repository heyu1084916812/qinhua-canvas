#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, '.harness-pack', '0.2.2-alpha.2', 'staging')
const home = path.join(ROOT, '.playwright-verify', 'harness-pack-runtime', 'home')
const dsh = path.join(packRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
const node = path.join(packRoot, 'node', 'node.exe')

if (!existsSync(node) || !existsSync(dsh)) {
  throw new Error(`Harness pack incomplete: ${packRoot}`)
}

mkdirSync(path.join(home, 'profiles'), { recursive: true })
const sourceProfile = path.join(packRoot, 'profile', 'acp')
const targetProfile = path.join(home, 'profiles', 'acp')
mkdirSync(targetProfile, { recursive: true })
for (const name of [
  'package.json',
  'cordis.yml',
  'cordis.patch.yml',
  'pnpm-workspace.yaml',
]) {
  writeFileSync(
    path.join(targetProfile, name),
    readFileSync(path.join(sourceProfile, name)),
  )
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

const provider = createServer(async (request, response) => {
  if (request.url === '/v1/models') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(
      JSON.stringify({
        object: 'list',
        data: [{ id: 'qinghua-agent', object: 'model' }],
      }),
    )
    return
  }
  if (request.url === '/v1/chat/completions' && request.method === 'POST') {
    const body = JSON.parse(await readBody(request))
    if (body.model !== 'qinghua-agent') {
      response.writeHead(400, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'unexpected model' } }))
      return
    }
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    })
    const base = {
      id: 'mock-completion',
      object: 'chat.completion.chunk',
      model: 'qinghua-agent',
    }
    response.write(
      `data: ${JSON.stringify({
        ...base,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: '收到' },
            finish_reason: null,
          },
        ],
      })}\n\n`,
    )
    response.write(
      `data: ${JSON.stringify({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      })}\n\n`,
    )
    response.end('data: [DONE]\n\n')
    return
  }
  response.writeHead(404)
  response.end()
})

await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve))
const address = provider.address()
if (!address || typeof address === 'string') throw new Error('mock provider address missing')

const agent = spawn(node, [dsh, '--profile', 'acp'], {
  cwd: ROOT,
  env: {
    ...process.env,
    DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: '1',
    QINGHUA_PROVIDER_URL: `http://127.0.0.1:${address.port}/v1`,
    QINGHUA_PROVIDER_TOKEN: 'harness-verification-token',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
})

let stderr = ''
agent.stderr.setEncoding('utf8')
agent.stderr.on('data', (chunk) => {
  stderr += chunk
})

const pending = new Map()
const notifications = []
let inputBuffer = ''
let nextId = 1
agent.stdout.setEncoding('utf8')
agent.stdout.on('data', (chunk) => {
  inputBuffer += chunk
  while (true) {
    const lineEnd = inputBuffer.indexOf('\n')
    if (lineEnd < 0) break
    const line = inputBuffer.slice(0, lineEnd).trim()
    inputBuffer = inputBuffer.slice(lineEnd + 1)
    if (!line) continue
    const message = JSON.parse(line)
    if ('id' in message && pending.has(message.id)) {
      const request = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message))
      else request.resolve(message.result)
    } else {
      notifications.push(message)
    }
  }
})

function request(method, params) {
  const id = nextId++
  agent.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`ACP ${method} timed out`))
    }, 60_000)
    pending.set(id, {
      resolve(value) {
        clearTimeout(timer)
        resolve(value)
      },
      reject(error) {
        clearTimeout(timer)
        reject(error)
      },
    })
  })
}

try {
  const initialized = await request('initialize', {
    protocolVersion: 1,
    clientCapabilities: {},
  })
  if (initialized.protocolVersion !== 1) {
    throw new Error(`Unexpected ACP protocol: ${JSON.stringify(initialized)}`)
  }
  const session = await request('session/new', {
    cwd: ROOT,
    mcpServers: [],
  })
  if (!session.sessionId) throw new Error('ACP session id missing')
  const modelOption = session.configOptions?.find((item) => item.id === 'model')
  if (!modelOption || !String(modelOption.currentValue).includes('qinghua-agent')) {
    throw new Error(`qinghua-local model not selected: ${JSON.stringify(modelOption)}`)
  }
  const answer = await request('session/prompt', {
    sessionId: session.sessionId,
    prompt: [
      {
        type: 'text',
        text: '只回复“收到”，不要调用任何工具。',
      },
    ],
  })
  if (answer.stopReason !== 'end_turn') {
    throw new Error(`Unexpected prompt stop reason: ${JSON.stringify(answer)}`)
  }
  const text = notifications
    .filter(
      (item) =>
        item.method === 'session/update' &&
        item.params?.update?.sessionUpdate === 'agent_message_chunk',
    )
    .flatMap((item) => {
      const content = item.params.update.content
      return content?.type === 'text' ? [content.text] : []
    })
    .join('')
  if (!text.includes('收到')) {
    throw new Error(`Expected assistant message missing: ${JSON.stringify(notifications)}`)
  }
  await request('session/close', { sessionId: session.sessionId })
  console.log('Harness pack runtime passed: initialize -> session/new -> prompt -> close')
  console.log(`provider model: ${modelOption.currentValue}`)
  console.log(`assistant text: ${text}`)
} catch (error) {
  if (stderr.trim()) console.error(stderr.trim())
  throw error
} finally {
  agent.kill()
  provider.close()
}
