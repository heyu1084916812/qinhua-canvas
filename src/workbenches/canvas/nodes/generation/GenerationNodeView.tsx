import { useState } from 'react'
import type { GenerationData } from '../../../../domain/canvas/model/node'
import type { NodeViewProps } from '../registry'
import { useAsset } from '../../hooks/useAsset'
import styles from './GenerationNodeView.module.css'

/** 生成数量：固定四项（产品文档 §6.8「1张 / 2张 / 4张 / 9张，固定四项」） */
export const COUNT_OPTIONS = [1, 2, 4, 9] as const

/**
 * 图片 / 视频生成节点 —— **节点本体**（产品文档 §6.8「状态 A / 状态 B」）。
 *
 * 本体只是一个**媒体框**：
 * - 状态 A（空）：占位框 + 中间一个 `+`，点击或拖入文件可上传（§6.8）
 * - 状态 B（有内容）：按原始比例渲染缩略图 / 视频首帧；单击选中、双击灯箱（§6.8）
 * - 排队 / 生成中 / 失败：居中显示（§6.8「在节点中心显示报错原因」）
 *
 * **参数、提示词、生成按钮都不在本体里**——它们属于节点下方的「创作参数面板」
 * （§6.8「创作参数面板」，宽度约 840px、挂在节点下方）。此前本体里又画了一套
 * 平台 / 模型下拉 + 提示词框 + 生成按钮，与面板完全重复；本组按文档把本体减重为媒体框。
 *
 * 视图只 emit 语义事件（requestUpload / openLightbox），落盘与哈希由宿主完成（架构 §4.7）。
 */
export function GenerationNodeView(props: NodeViewProps) {
  const data = props.node.data as GenerationData
  const url = useAsset(data.assetHash)
  const [dropping, setDropping] = useState(false)

  const isVideo = data.mode === 'video'
  /**
   * 居中覆盖层只表达**本节点自己**的状态：运行中 / 失败（§6.19.5）。
   *
   * 刻意**不**渲染「全局运行中」：那是**生成按钮**的状态（§6.8 按钮在全局运行时变
   * `LoaderCircle` 并禁用），不属于节点本体。此前把 `globalRunning` 也画成本体覆盖层，
   * 于是跑任意一个节点时，画布上**所有**未参与的生成节点都跟着转圈——
   * 用户看到的是「我没让它生成，它却在生成」。
   * 节点是否在跑，只认 `props.running`（由执行宿主按 nodeId 反查，见 NodeLayer）。
   */
  const overlay = props.error ? 'error' : props.running ? 'running' : null

  return (
    <div
      className={`${styles.media} ${dropping ? styles.dropping : ''}`}
      data-generation-media
      onDragOver={(e) => {
        // 只在文件拖拽时亮起落点提示，避免节点拖动误触
        if (!Array.from(e.dataTransfer.types).includes('Files')) return
        e.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        const file = e.dataTransfer.files?.[0]
        if (!file) return
        e.preventDefault()
        e.stopPropagation()
        setDropping(false)
        props.emit({ type: 'requestUpload', file })
      }}
    >
      {data.assetHash ? (
        url ? (
          isVideo ? (
            <VideoBody url={url} onOpen={() => props.emit({ type: 'openLightbox', assetHash: data.assetHash! })} />
          ) : (
            <img
              className={styles.asset}
              src={url}
              alt=""
              draggable={false}
              data-node-asset
              onDoubleClick={() => props.emit({ type: 'openLightbox', assetHash: data.assetHash! })}
            />
          )
        ) : (
          /* 已有内容、但素材本体还在从 assets 表读回（读取带退避重试）：
             此时**不能**退回「`+` 上传」——那会让用户以为内容丢了并再传一次。
             用一块中立骨架占位即可。 */
          <div className={styles.assetLoading} data-node-asset-loading />
        )
      ) : (
        /* 状态 A：占位框 + 中间一个 `+`。
           框本身**不是按钮**（否则点击节点任意处都会弹上传、且无法拖动节点）；
           只有中间的 `+` 是上传入口，其余区域照常选中 / 拖动（§6.8） */
        <div className={styles.placeholder} data-node-placeholder>
          <button
            type="button"
            className={styles.plus}
            data-node-upload
            title="点击上传，或把图片 / 视频拖进来"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              props.emit({ type: 'requestUpload' })
            }}
          >
            <span aria-hidden>＋</span>
          </button>
        </div>
      )}

      {overlay && (
        <div className={styles.overlay} data-node-status={overlay}>
          {overlay === 'error' ? (
            <span className={styles.errorText} data-node-error>
              {props.error}
            </span>
          ) : (
            <span className={styles.spinner} aria-label="生成中" />
          )}
        </div>
      )}
    </div>
  )
}

/** 视频本体：hover 显示播放 / 暂停（§6.8「视频 hover 显示播放 / 暂停控件」） */
function VideoBody({ url, onOpen }: { url: string; onOpen: () => void }) {
  const [playing, setPlaying] = useState(false)
  return (
    <div className={styles.videoWrap}>
      <video
        className={styles.asset}
        src={url}
        muted
        loop
        playsInline
        autoPlay={playing}
        data-node-asset
        onDoubleClick={onOpen}
      />
      <button
        type="button"
        className={styles.playBtn}
        data-video-toggle
        title={playing ? '暂停' : '播放'}
        aria-label={playing ? '暂停' : '播放'}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          setPlaying((p) => !p)
        }}
      >
        {playing ? '❙❙' : '▶'}
      </button>
    </div>
  )
}
