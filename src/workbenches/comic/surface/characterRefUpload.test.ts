import { describe, it, expect } from 'vitest'
import { fingerprintBytes } from '../../../domain/shared/hash'
import type { PickedFile } from '../../../platform/ports'
import {
  createCharacterRefUploader,
  type CharacterRefAssetRow,
} from './characterRefUpload'

/** 造一个 PickedFile（bytes → Blob；node 环境下 Blob 为全局） */
function picked(name: string, mime: string, bytes: Uint8Array): PickedFile {
  return { name, size: bytes.length, mime, blob: new Blob([bytes as BlobPart], { type: mime }) }
}

/** 记录落库行的假 store + 可选返回值的假选图 */
function harness(pick: () => Promise<PickedFile | null>) {
  const rows: CharacterRefAssetRow[] = []
  const accepted: (string | undefined)[] = []
  const uploader = createCharacterRefUploader({
    pickFile: async (accept) => {
      accepted.push(accept)
      return pick()
    },
    putAsset: async (row) => {
      rows.push(row)
    },
  })
  return { uploader, rows, accepted }
}

const REF_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])

describe('characterRefUpload / 一张图 → 素材库一行', () => {
  it('按**内容**取哈希，行 id 与 hash 同值（id 即内容哈希）', async () => {
    const { uploader, rows } = harness(async () => picked('a.png', 'image/png', REF_BYTES))
    const out = await uploader.pickAndStore()
    expect(out).toEqual({ hash: await fingerprintBytes(REF_BYTES), mime: 'image/png' })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(rows[0]!.hash)
    expect(rows[0]!.bytes).toEqual(REF_BYTES)
    expect(rows[0]!.mime).toBe('image/png')
  })

  it('哈希口径 = sha1 截 16 hex（固定向量：sha1("abc") 前 16 位）', async () => {
    expect(await fingerprintBytes(new TextEncoder().encode('abc'))).toBe('a9993e364706816a')
  })

  it('同一张图传两次 → 两行**同一个 id**（幂等：覆盖写，不产生第二份）', async () => {
    const { uploader, rows } = harness(async () => picked('a.png', 'image/png', REF_BYTES))
    await uploader.pickAndStore()
    await uploader.pickAndStore()
    expect(rows).toHaveLength(2)
    expect(rows[0]!.id).toBe(rows[1]!.id)
  })

  it('换文件名不改 hash（「同一张图」由字节决定，不由文件名决定）', async () => {
    const a = harness(async () => picked('猫.png', 'image/png', REF_BYTES))
    const b = harness(async () => picked('copy-of-猫.jpeg', 'image/jpeg', REF_BYTES))
    const ra = await a.uploader.pickAndStore()
    const rb = await b.uploader.pickAndStore()
    expect(ra!.hash).toBe(rb!.hash)
    // 但 mime 如实透传（字节相同不代表类型相同——由选图方声明）
    expect(ra!.mime).toBe('image/png')
    expect(rb!.mime).toBe('image/jpeg')
  })

  it('用户取消（选图返回 null）→ null，且**不写库**', async () => {
    const { uploader, rows } = harness(async () => null)
    expect(await uploader.pickAndStore()).toBeNull()
    expect(rows).toHaveLength(0)
  })

  it('0 字节文件 → 当作没选到（不往库里塞空行）', async () => {
    const { uploader, rows } = harness(async () => picked('empty.png', 'image/png', new Uint8Array()))
    expect(await uploader.pickAndStore()).toBeNull()
    expect(rows).toHaveLength(0)
  })

  it('mime 缺失时回退 image/png（仍可用，不因缺 mime 丢图）', async () => {
    const { uploader, rows } = harness(async () => picked('x', '', REF_BYTES))
    const out = await uploader.pickAndStore()
    expect(out!.mime).toBe('image/png')
    expect(rows[0]!.mime).toBe('image/png')
  })

  it('只收图像：accept 固定传 image/*', async () => {
    const { uploader, accepted } = harness(async () => null)
    await uploader.pickAndStore()
    expect(accepted).toEqual(['image/*'])
  })
})
