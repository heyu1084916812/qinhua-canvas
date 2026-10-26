import { useEffect, useState } from 'react'
import { expectedAssetPath } from '../../../domain/shared/assetLocation'
import { useAssetPlatform } from './AssetPlatformContext'
import { loadAssetUrl, type AssetMeta } from './assetReader'

export { loadAssetUrl, type AssetMeta } from './assetReader'

/**
 * 同 `useAsset`，但把 mime 一并返回。
 *
 * mime 只存在于 assets 行里，**猜不出来**：objectURL 是 `blob:`，扩展名没有，
 * 而「该用 `<img>` 还是 `<video>`」完全由它决定（猜错就是黑屏）。
 */
export function useAssetMeta(
  hash: string | undefined,
  opts: { preferThumb?: boolean; preferPreview?: boolean } = {},
): AssetMeta {
  const platform = useAssetPlatform()
  const preferThumb = opts.preferThumb === true
  const preferPreview = opts.preferPreview === true
  const [meta, setMeta] = useState<AssetMeta>({ url: null, mime: null })

  useEffect(() => {
    if (!hash) {
      setMeta({ url: null, mime: null })
      return
    }
    let alive = true
    let created: string | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    /**
     * 退避窗口：前 3s 每 250ms 一次，其后每 500ms，总计约 20s。
     *
     * 素材在 store 里已**插队立即落库**（不等 800ms 防抖），正常几十毫秒内就命中；
     * 这里只是兜住「首屏装载 / 超大图 / 慢设备」这类长尾。更关键的是：
     * 图一变（tick）effect 会整个重跑、计数归零，所以不存在
     * 「重试次数用完 → 这张图从此永久空白」——那才是真正的断连。
     */
    const MAX_ATTEMPTS = 48
    const backoffOf = (attempt: number) => (attempt < 12 ? 250 : 500)

    const load = async (attempt: number) => {
      let meta: AssetMeta
      try {
        meta = await loadAssetUrl(platform, hash, { preferThumb, preferPreview })
      } catch {
        /*
         * 共享存储写新素材时会极短地出现“行还没落盘”。`loadAssetUrl` 的查询
         * 可能因此抛错；这和“查到了行但字节为空”一样属于可重试状态。
         * 不能让它冒成未捕获异常，否则一次正常生成会在页面上留下红错，
         * 同时这张图也不会继续等待落库。
         */
        if (!alive) return
        if (attempt < MAX_ATTEMPTS) {
          timer = setTimeout(() => void load(attempt + 1), backoffOf(attempt))
        } else {
          setMeta({
            url: null,
            mime: null,
            missing: true,
            expectedPath: expectedAssetPath(
              platform.assetFolder?.current()?.name,
              hash,
              null,
            ),
          })
        }
        return
      }
      if (!alive) return
      if (!meta.url) {
        if (attempt < MAX_ATTEMPTS) {
          // 素材尚未落库：退避重试，最多约 20s
          timer = setTimeout(() => void load(attempt + 1), backoffOf(attempt))
        } else {
          /**
           * 重试用尽还读不到 ⇒ **如实标记缺失**（对账 #196 · 增量 4）。
           * 这条**不能省**：界面拿不到这个标记就只能一直显示骨架屏，
           * 而真相是"文件没了"——用户会一直等一张永远不会出现的图。
           */
          setMeta({ url: null, mime: meta.mime, missing: true, expectedPath: meta.expectedPath })
        }
        return
      }
      created = meta.url
      setMeta(meta)
    }
    void load(0)

    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      if (created) URL.revokeObjectURL(created)
    }
    // 只依赖 hash：拖动 / 缩放每帧都会换图快照引用，把 graph 放进依赖会让
    // effect 每帧重跑 —— 旧 URL 被 revoke、重查库建新 URL，<img> 每帧换 src
    // 触发重新解码，用户看到的就是「拖动时图片一闪一闪」。
    // 素材落库的时差由上面的退避重试兜住，不需要借 graph 变更来触发。
  }, [hash, platform, preferThumb, preferPreview])

  return meta
}

/**
 * **小尺寸显示**那条路（对账 #231）：优先给缩略图；还没有就先给原图，并**后台补一张落库**。
 * 要原图的地方（灯箱、旋转、标注）用 `useAssetMeta` —— 那些地方要的是像素。
 *
 * **凡是"显示尺寸远小于原图"的地方都该走它**：画布节点本体（一屏几十张）、面板缩略图、
 * 日志面板里一排排历史产物、@ 提及的小图 —— 每张按原图解码，4K 就是 33MB，几十张就是 GB 级。
 *
 * ⚠️ 面板那条**曾经被一条断言挡过**：日志面板的「实际像素与产物真实像素一致」原来拿
 * `img.naturalWidth` 当证据，而缩略图会让它变成 640。**改的是断言的口径**（改成从库里的字节读
 * 文件头 —— 与界面上那行文字是两个来源，交叉验证反而更硬），不是把这条能力砍掉。见对账 #235。
 */
export function useAssetThumb(hash: string | undefined): AssetMeta {
  return useAssetMeta(hash, { preferThumb: true })
}

/** 工作台高清显示：1600px 预览，明显比节点缩略图清楚，但不等同于原图。 */
export function useAssetPreview(hash: string | undefined): AssetMeta {
  return useAssetMeta(hash, { preferPreview: true })
}

/** 只要 URL 的那条（走**缩略图**）—— 画布节点媒体框与各类小图都用它 */
export function useAssetThumbUrl(hash: string | undefined): string | null {
  return useAssetThumb(hash).url
}

/** 小图那条路（等价于 `useAssetThumbUrl`，保留旧名给"面板里的小图"读） */
export function useAsset(hash: string | undefined): string | null {
  return useAssetThumbUrl(hash)
}
