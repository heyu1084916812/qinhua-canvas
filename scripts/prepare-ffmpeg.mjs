/**
 * Prepare the Windows FFmpeg resource used by the desktop renderer.
 *
 * The executable is intentionally not committed: the pinned essentials build
 * is about 100 MB. A cached download is verified against a fixed SHA-256,
 * then only ffmpeg.exe and its license are extracted into Tauri resources.
 */
import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'

const VERSION = '9.0.2'
const ARCHIVE = `ffmpeg-${VERSION}-essentials_build.zip`
const URL = `https://www.gyan.dev/ffmpeg/builds/packages/${ARCHIVE}`
const SHA256 = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'
const ROOT = process.cwd()
const CACHE_DIR = path.join(ROOT, '.cache', 'ffmpeg')
const ARCHIVE_PATH = path.join(CACHE_DIR, ARCHIVE)
const RESOURCE_DIR = path.join(ROOT, 'src-tauri', 'resources')
const TARGET = path.join(RESOURCE_DIR, 'ffmpeg.exe')
const TARGET_TMP = `${TARGET}.tmp`
const LICENSE = path.join(RESOURCE_DIR, 'FFMPEG-LICENSE.txt')
const BUILD_INFO = path.join(RESOURCE_DIR, 'ffmpeg-build.json')
const ENTRY = `ffmpeg-${VERSION}-essentials_build/bin/ffmpeg.exe`
const LICENSE_ENTRY = `ffmpeg-${VERSION}-essentials_build/LICENSE`
const force = process.argv.includes('--force')

function fail(message) {
  console.error(`[ffmpeg] ${message}`)
  process.exit(1)
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

async function ensureArchive() {
  if (existsSync(ARCHIVE_PATH) && (await sha256(ARCHIVE_PATH)) === SHA256) return
  rmSync(ARCHIVE_PATH, { force: true })
  mkdirSync(CACHE_DIR, { recursive: true })
  console.log(`[ffmpeg] downloading ${URL}`)
  const response = await fetch(URL, { redirect: 'follow' })
  if (!response.ok || !response.body) fail(`download failed: HTTP ${response.status}`)
  const tmp = `${ARCHIVE_PATH}.download`
  rmSync(tmp, { force: true })
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tmp))
  const got = await sha256(tmp)
  if (got !== SHA256) {
    rmSync(tmp, { force: true })
    fail(`SHA-256 mismatch: expected ${SHA256}, got ${got}`)
  }
  renameSync(tmp, ARCHIVE_PATH)
}

function extractEntries() {
  mkdirSync(RESOURCE_DIR, { recursive: true })
  rmSync(TARGET_TMP, { force: true })
  const command = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
    '$zip=[System.IO.Compression.ZipFile]::OpenRead($env:QH_FFMPEG_ZIP);',
    'try {',
    '  $exe=$zip.GetEntry($env:QH_FFMPEG_ENTRY);',
    '  if(-not $exe){ throw "ffmpeg entry missing from archive" };',
    '  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($exe,$env:QH_FFMPEG_TARGET,$true);',
    '  $license=$zip.GetEntry($env:QH_FFMPEG_LICENSE_ENTRY);',
    '  if(-not $license){ throw "license entry missing from archive" };',
    '  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($license,$env:QH_FFMPEG_LICENSE,$true);',
    '} finally { $zip.Dispose() }',
  ].join(' ')
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        QH_FFMPEG_ZIP: ARCHIVE_PATH,
        QH_FFMPEG_ENTRY: ENTRY,
        QH_FFMPEG_TARGET: TARGET_TMP,
        QH_FFMPEG_LICENSE_ENTRY: LICENSE_ENTRY,
        QH_FFMPEG_LICENSE: LICENSE,
      },
    },
  )
  if (result.status !== 0 || !existsSync(TARGET_TMP)) fail('resource extraction failed')
}

function verifyExecutable() {
  const version = spawnSync(TARGET, ['-version'], { encoding: 'utf8', windowsHide: true })
  if (version.status !== 0) {
    rmSync(TARGET, { force: true })
    fail(`ffmpeg -version failed: ${(version.stderr || version.stdout || '').trim()}`)
  }
  const firstLine = String(version.stdout || '').split(/\r?\n/, 1)[0]
  writeFileSync(
    BUILD_INFO,
    `${JSON.stringify(
      {
        version: VERSION,
        source: URL,
        sha256: SHA256,
        executable: 'ffmpeg.exe',
        license: 'FFMPEG-LICENSE.txt',
        verifiedVersion: firstLine,
      },
      null,
      2,
    )}\n`,
  )
  return firstLine
}

if (process.platform !== 'win32') {
  console.log('[ffmpeg] desktop bundle currently targets Windows; resource prep skipped')
  process.exit(0)
}

if (!force && existsSync(TARGET) && statSync(TARGET).size > 0) {
  console.log(`[ffmpeg] using existing ${TARGET} (${verifyExecutable()})`)
  process.exit(0)
}

await ensureArchive()
extractEntries()
rmSync(TARGET, { force: true })
renameSync(TARGET_TMP, TARGET)
console.log(`[ffmpeg] ready: ${TARGET} (${verifyExecutable()})`)
