import type { GenerationData } from '../model/node'

/**
 * 生成请求的参数集（产品文档 §6.8 第三部分）。
 *
 * 抽出来的直接原因：`generation` / `group` / `batch` 三个规格各抄了一份一模一样的
 * `params` 字面量——三处同步修改的代价，在**视频参数**上立刻兑现了：`GenerationData`
 * 里的 `size` / `durationSec` / `refMode` 声明了很久，但三处 params 都只发图片那四项，
 * 于是这三个字段**没有任何消费者**：面板上摆着的视频参数是纯装饰。这正是本项目
 * 反复踩的那类「假成功」——数据结构接好了，链路却从未真正读过它（同 M6-12 的
 * `inputs` 从未被渠道消费）。
 *
 * 语义：图片与视频是**同一个生成节点的功能类别**（`data.mode`），参数集互不相同，
 * 因此这里按 mode 分支，而不是把两套字段揉在一起发出去（渠道收到 `resolution`
 * 却收到的是视频请求，只会让人猜哪几个字段有效）。
 */
export function generationParams(data: GenerationData): Record<string, unknown> {
  if (data.mode === 'video') {
    return {
      ratio: data.ratio ?? null,
      size: data.size ?? null,
      durationSec: data.durationSec ?? null,
      refMode: data.refMode ?? null,
      /** 「生成数量」（图三/图六/图八/图十那排 1/2/4）：适配器据此发 `n` */
      count: data.count ?? null,
      /** 图四/图五那种「视频生成模式」；没设过就不发（渠道自己推断） */
      videoMode: data.videoMode ?? null,
      /** 「生成音频 开启/关闭」：未设置 = 不下发（交给模型默认） */
      generateAudio: data.generateAudio ?? null,
    }
  }
  return {
    count: data.count ?? 1,
    ratio: data.ratio ?? null,
    // `'auto'` 是「不指定」，不是「1K」——原样下发会让渠道收到一个它不认的档位值。
    resolution: data.resolution && data.resolution !== 'auto' ? data.resolution : null,
    quality: data.quality ?? null,
    /** 「背景」：同样地，`auto` = 不指定，不下发 */
    background: data.background && data.background !== 'auto' ? data.background : null,
  }
}
