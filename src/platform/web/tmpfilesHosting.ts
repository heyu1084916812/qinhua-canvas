import type { HostingPort, StoragePort } from '../ports'
import { HOSTING_ROW_ID, hostingConfigOf, tmpfilesDirectUrl } from '../../domain/shared/hosting'

const UPLOAD_URL = 'https://tmpfiles.org/api/v1/upload'

/**
 * **素材传输（web）**：按设置页选的服务把素材传上图床，换回公网直链。
 *
 * 为什么是这个站：2026-10-03 在本机把候选图床逐个真传了一遍（对账清单 #115）——
 * freeimage.host / catbox / uguu / qu.ax / envs.sh / file.io / 0x0.st 在浏览器里
 * 一律 `Failed to fetch`（要么没 CORS，要么本网络到不了）；**只有 tmpfiles.org
 * 能从页面里上传成功并读回 JSON**。
 *
 * 两条必须记住的细节：
 * ① 它返回的是**页面地址**，直链要把 `tmpfiles.org/` 换成 `tmpfiles.org/dl/`
 *    （见 `tmpfilesDirectUrl`）；
 * ② 默认 60 分钟就删，上传时可以带 `expire`（3600 / 21600 / 86400 / 172800 秒）。
 */
export function createWebHosting(storage: StoragePort): HostingPort {
  return {
    async upload({ blob, name }) {
      const rows = await storage.query('presets', { id: HOSTING_ROW_ID })
      const config = hostingConfigOf(rows[0])
      /** 没配图床：如实返回 null（调用方回落内联 Base64），不当作失败 */
      if (config.provider === 'off') return null

      const form = new FormData()
      form.append('file', blob, name)
      form.append('expire', String(config.expireSeconds))
      const res = await fetch(UPLOAD_URL, { method: 'POST', body: form })
      if (!res.ok) throw new Error(`图床上传失败：HTTP ${res.status}`)
      const url = tmpfilesDirectUrl(await res.json().catch(() => null))
      if (!url) throw new Error('图床没有返回可用直链')
      return { url }
    },
  }
}
