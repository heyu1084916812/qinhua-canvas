import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ffmpegArgs } from '../src/domain/storyboard/ffmpegPack.ts'

const ffmpeg = process.env.QH_FFMPEG_BIN

/**
 * This test is opt-in because the binary is a desktop build resource, not a
 * JavaScript dependency. It executes the exact argument list used by the app,
 * including the image loop, BGM, timed voice, SRT track and H.264 encode.
 */
describe('ffmpegPack real encode', () => {
  it.skipIf(!ffmpeg)('encodes the complete storyboard filter graph', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'qinghua-ffmpeg-pack-'))
    try {
      const still = spawnSync(
        ffmpeg,
        ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=108x192', '-frames:v', '1', 'still.png'],
        { cwd: dir, encoding: 'utf8', windowsHide: true, timeout: 30_000 },
      )
      expect(still.status, still.stderr).toBe(0)
      writeFileSync(path.join(dir, 'sub.srt'), '1\n00:00:00,100 --> 00:00:00,900\n测试字幕\n')

      for (const [name, frequency] of [
        ['bgm.wav', 220],
        ['voice.wav', 440],
      ]) {
        const made = spawnSync(
          ffmpeg,
          ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000`, '-t', '1', name],
          { cwd: dir, encoding: 'utf8', windowsHide: true, timeout: 30_000 },
        )
        expect(made.status, made.stderr).toBe(0)
      }

      const clips = [
        {
          index: 1,
          shotId: 'shot-1',
          kind: 'image',
          hash: 'image-hash',
          seconds: 1,
          lines: [],
          scene: '场景',
          cast: [],
          file: 'still.png',
          local: true,
        },
      ]
      const args = ffmpegArgs(clips, {
        output: 'pack.mp4',
        bgm: { file: 'bgm.wav', volume: 0.2 },
        voices: [{ file: 'voice.wav', start: 0.1 }],
        subtitles: { file: 'sub.srt' },
      })
      const run = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], {
        cwd: dir,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 8 * 1024 * 1024,
      })
      expect(run.error, run.stderr).toBeUndefined()
      expect(run.status, run.stderr).toBe(0)

      const output = path.join(dir, 'pack.mp4')
      expect(existsSync(output)).toBe(true)
      const bytes = readFileSync(output)
      expect(bytes.length).toBeGreaterThan(1000)
      expect(bytes.subarray(4, 8).toString('latin1')).toBe('ftyp')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
