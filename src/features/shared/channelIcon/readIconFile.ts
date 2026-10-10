/**
 * 把用户选的图片读成渠道图标（`data:` URL）。
 *
 * 先**等比缩到 ≤128px** 再编码成 PNG：渠道行会跟着图存进 IndexedDB（见
 * `domain/project/channel.ts` 的 `icon`），原图几 MB 直接塞进去会拖慢整表读写。
 * 128px 足够列表（22px 底）与详情（28px）两处用。
 *
 * 单独成文件是为了"这块以后可以换"（用户第 19 批：「这个上传图标的功能可以改，
 * 后续可能会改其他的图标」）—— 换实现时只动这一个函数，界面不用跟着改。
 */
export async function readChannelIconFile(file: File, max = 128): Promise<string> {
  return readChannelIconBlob(file, max)
}

/**
 * 同上，但收的是**任意 Blob**（对账 #396：「从网站抓站点图标」那条路把字节装进 Blob 再进来）。
 *
 * 拆成两份而不是让调用方自己包个 `File`：`File` 需要 name/lastModified，
 * 抓来的字节并没有这些，硬编只会造出一个假文件名。
 */
export async function readChannelIconBlob(blob: Blob, max = 128): Promise<string> {
  const bitmap = await createImageBitmap(blob)
  try {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('画布不可用')
    ctx.drawImage(bitmap, 0, 0, w, h)
    return canvas.toDataURL('image/png')
  } finally {
    bitmap.close()
  }
}
