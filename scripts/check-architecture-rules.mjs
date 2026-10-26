import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const baseConfig = require(path.join(root, '.dependency-cruiser.cjs'))
const temp = mkdtempSync(path.join(os.tmpdir(), 'qinghua-architecture-'))

function write(relative, source) {
  const target = path.join(temp, relative)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, source, 'utf8')
}

try {
  write(
    'src/features/storyboard/probe.ts',
    "import '../../domain/canvas/probe'\n",
  )
  write(
    'src/pages/StoryboardPage/probe.ts',
    "import '../../app/workbenchHosts/StoryboardCanvasHost'\n",
  )
  write(
    'src/pages/EcommercePage/probe.ts',
    "import '../../domain/canvas/probe'\n",
  )
  write(
    'src/features/shared/probe.ts',
    "import '../../workbenches/canvas/probe'\n",
  )
  write('src/domain/canvas/probe.ts', 'export const canvasProbe = true\n')
  write('src/workbenches/canvas/probe.ts', 'export const canvasProbe = true\n')
  write(
    'src/app/workbenchHosts/StoryboardCanvasHost.ts',
    'export const storyboardCanvasHostProbe = true\n',
  )

  const config = {
    forbidden: baseConfig.forbidden,
    options: {
      doNotFollow: { path: 'node_modules' },
      tsPreCompilationDeps: true,
    },
  }
  const configPath = path.join(temp, 'dependency-cruiser.cjs')
  writeFileSync(
    configPath,
    `module.exports = ${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  )

  const depcruise = path.join(
    root,
    'node_modules',
    'dependency-cruiser',
    'bin',
    'dependency-cruise.mjs',
  )
  const run = spawnSync(
    process.execPath,
    [depcruise, 'src', '--config', configPath],
    {
      cwd: temp,
      encoding: 'utf8',
    },
  )
  const output = `${run.stdout}\n${run.stderr}`
  const expectedRules = [
    'storyboard-no-canvas-runtime',
    'storyboard-no-app-host',
    'ecommerce-no-canvas-runtime',
    'no-shared-to-workbench',
  ]
  const missing = expectedRules.filter((name) => !output.includes(name))
  if (run.status === 0) {
    throw new Error('architecture fixtures unexpectedly passed')
  }
  if (missing.length > 0) {
    throw new Error(
      `architecture fixtures did not trigger: ${missing.join(', ')}\n${output}`,
    )
  }
  console.log(
    `architecture rule reverse-check passed: ${expectedRules.join(', ')}`,
  )
} finally {
  rmSync(temp, { recursive: true, force: true })
}
