import type { PickedFile } from '../../../platform/ports'
import { fingerprintBytes } from '../../../domain/shared/hash'

/**
 * 角色卡参考图上传（M6-13）。
 *
 * 职责边界：**只管「一张图 → 素材库里的一行」**，到此为止。
 * 把 hash 追加进角色的 `referenceHashes` 是调用方（surface）经
 * `character.update` 派发的事——命令层不认识 `Blob`，素材层也不认识角色卡，
 * 两者在 surface 这一层接线。这样切分的好处是本文件可以在 node 下单测
 * （注入假的选图 / 落库），不需要浏览器与 IndexedDB。
 *
 * 与生成产物共用同一张 `assets` 表、同一约定：**id 即内容哈希**（产品文档 §8）。
 * 于是「同一张图重复上传」天然幂等——覆盖写同一行，不会多出第二份字节。
 */

/** 落到 `assets` 表的一行（形状与 `ComicExecutionProvider` 的产物写入一致） */
export interface CharacterRefAssetRow {
  /** Dexie 主键，等于内容哈希 */
  id: string
  /** 业务侧引用的哈希（与 id 同值；保留字段是与生成产物保持同一形状） */
  hash: string
  mime: string
  bytes: Uint8Array
}

export interface CharacterRefUploaderDeps {
  /** 一次选图；`accept` 由本模块给（只收图像） */
  pickFile: (accept?: string) => Promise<PickedFile | null>
  /** 写 `assets` 表（与生成产物同表同约定） */
  putAsset: (row: CharacterRefAssetRow) => Promise<void>
}

export interface UploadedReference {
  hash: string
  mime: string
}

export interface CharacterRefUploader {
  /**
   * 选图 → 按内容取哈希 → 写入素材库 → 返回 hash。
   * 用户取消、或选到 0 字节文件时返回 `null`（静默，不是错误）。
   */
  pickAndStore(): Promise<UploadedReference | null>
}

/** 造一个绑定好依赖的上传器（surface 只调用一次 `pickAndStore`） */
export function createCharacterRefUploader(deps: CharacterRefUploaderDeps): CharacterRefUploader {
  return {
    async pickAndStore(): Promise<UploadedReference | null> {
      const picked = await deps.pickFile('image/*')
      if (!picked) return null
      const bytes = new Uint8Array(await picked.blob.arrayBuffer())
      // 0 字节不可能是可用图像；当作「没选到」处理，避免往库里塞空行
      if (bytes.length === 0) return null
      // 哈希走 crypto.subtle（异步），避免大图在上传瞬间卡住主线程
      const hash = await fingerprintBytes(bytes)
      const mime = picked.mime || 'image/png'
      await deps.putAsset({ id: hash, hash, mime, bytes })
      return { hash, mime }
    },
  }
}
