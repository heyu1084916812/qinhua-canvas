import { useEffect, useState } from 'react'
import type { GenerationData } from '../../../../domain/canvas/model/node'
import { assetBoxCorrection } from '../../../../domain/canvas/layout/assetBoxCorrection'
import type { NodeViewProps } from '../registry'
import { useAssetThumb } from '../../../../features/shared/assets/index'
import { AssetMenu } from '../../panels/AssetMenu'
import { IconPause, IconPlay } from '../../toolbar/icons'
import styles from './GenerationNodeView.module.css'

/** 生成数量：固定四项（产品文档 §6.8「1张 / 2张 / 4张 / 9张，固定四项」） */
export const COUNT_OPTIONS = [1, 2, 4, 9] as const

/**
 * 这张素材到底是图还是视频：**以 assets 行的 mime 为准**，拿不到 mime 才退回节点
 * 自己的 `mode`。
 *
 * 用户 2026-10-03：「刚刚生成的视频只有双击进灯箱才能看」——灯箱按 mime 渲染，
 * 所以对；节点按 `data.mode` 渲染，只要 mode 与素材对不上（换过模型、Agent 落地、
 * 老节点），就会拿 `<img>` 去显示 mp4 —— 页面上就是一块空白，双击反而正常。
 */
export function assetIsVideo(mime: string | null, mode: GenerationData['mode']): boolean {
  if (mime) return mime.startsWith('video/')
  return mode === 'video'
}

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
  /**
   * 节点本体是**小尺寸显示**（约 240×192）⇒ 走缩略图那条路（对账 #231）：
   * 拿 4K 原图解码给一个 240px 的框看，一张就是 33MB —— 可见几十张就是 GB 级。
   * 灯箱要原图，它自己用 `useAssetMeta`，与此无关。
   */
  const { url, mime, missing, expectedPath } = useAssetThumb(data.assetHash)
  const [dropping, setDropping] = useState(false)
  /**
   * 素材操作菜单（清除 / 替换）挂在**本体那张图的右上角**（用户 2026-09-18 明确位置）。
   *
   * 此前误加在创作面板的缩略图上——那是另一个地方，用户要的是节点本身。
   * 本体才是「这张图属于谁」的直观对象，换图 / 清图在这里做最顺手。
   */
  const [menuOpen, setMenuOpen] = useState(false)

  /**
   * 媒体**真实像素到手之后**纠正节点框（对账 #266）。
   *
   * 用户报的两条症状其实是同一件事：导入的图"上下有空隙"、视频"不按原视频比例"——
   * 都是**尺寸未知时退化成 240×192 方框**（`NODE_MINIMUMS.generation`），
   * 宽图落在方框里就上下各留一条白边。
   *
   * 为什么在**显示这一层**补而不是在每条导入路径上各修一遍：路径有四条
   *（拖入画布 / 节点上的上传 / 素材库拖入 / 从生成产物落位），旧实现里视频那条
   * 就是漏掉的那个 —— 尺寸读不到的那些素材，无论从哪进来，**一张图都逃不过这里**。
   * 决策本身是纯函数（`assetBoxCorrection`，带单测），这里只负责把元数据喂给它。
   */
  const reportNatural = (width: number, height: number) => {
    /**
     * 新导入 / 新生成的素材在节点数据里已经有真实 naturalSize。
     * 此时画面上的 `<img>` 可能只是 320px 缩略图，不能拿它的
     * naturalWidth 反过来覆盖真实像素；但框错了仍要用真实尺寸纠正。
     */
    const natural = data.naturalSize ?? { width, height }
    const fix = assetBoxCorrection({ w: props.node.w, h: props.node.h }, natural)
    if (!fix) return
    props.emit({
      type: 'updateData',
      patch: { naturalSize: fix.naturalSize },
      ...(fix.size ? { size: fix.size } : {}),
      // 这是**后台纠错**，不是用户的一次操作：不进撤销栈（否则 Ctrl+Z 会先"撤销尺寸"），
      // 但仍照常落库（store 对 transient 的语义就是"不建撤销点、照样写"）
      transient: true,
    })
  }

  const isVideo = assetIsVideo(mime, data.mode)
  /**
   * 居中覆盖层只表达**本节点自己**的状态：运行中 / 失败（§6.19.5）。
   *
   * 刻意**不**渲染「全局运行中」：那是**生成按钮**的状态（§6.8 按钮在全局运行时变
   * `LoaderCircle` 并禁用），不属于节点本体。此前把 `globalRunning` 也画成本体覆盖层，
   * 于是跑任意一个节点时，画布上**所有**未参与的生成节点都跟着转圈——
   * 用户看到的是「我没让它生成，它却在生成」。
   * 节点是否在跑，只认 `props.running`（由执行宿主按 nodeId 反查，见 画布表面）。
   */
  const overlay = props.error ? 'error' : props.running ? 'running' : null

  /**
   * 这次生成**已经跑了多少秒**（用户 2026-10-06 第 13 批第 9 条：
   * 「改成生成中的动画，同时显示时长」）。
   *
   * 只认 `props.running` 的**边沿**：从"没跑"到"在跑"的那一刻起算，跑完/失败立刻归零 ——
   * 这样它显示的是**这一次**的耗时，而不是"这个节点被打开多久了"。
   * 500ms 一跳（而不是 1000ms）：整秒切换时不会因为取整时刻漂移而"跳两格"。
   */
  const [elapsed, setElapsed] = useState(0)
  const running = props.running === true
  useEffect(() => {
    if (!running) {
      setElapsed(0)
      return
    }
    const startedAt = Date.now()
    setElapsed(0)
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 500)
    return () => window.clearInterval(timer)
  }, [running])

  return (
    <div
      className={`${styles.media} ${dropping ? styles.dropping : ''}`}
      data-generation-media
      data-natural-width={data.naturalSize?.width}
      data-natural-height={data.naturalSize?.height}
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
            <VideoBody
              url={url}
              onOpen={() => props.emit({ type: 'openLightbox', assetHash: data.assetHash! })}
              onNatural={reportNatural}
            />
          ) : (
            <img
              className={styles.asset}
              src={url}
              alt=""
              draggable={false}
              data-node-asset
              onLoad={(e) => reportNatural(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
              onDoubleClick={() => props.emit({ type: 'openLightbox', assetHash: data.assetHash! })}
            />
          )
        ) : (
          <>
            {/*
              已有内容、但字节读不到。两种情形要分清楚（对账 #196 · 增量 4）：
              - **还在读**（刚生成、字节尚未落库）：中立骨架占位。此时**不能**退回
                「`+` 上传」——那会让用户以为内容丢了并再传一次。
              - **确实缺失**（库 + 文件夹都没有，且退避重试已用尽）：如实说「素材缺失」，
                并给出"它本该在哪"。留骨架屏等于让用户一直等一张永远不会出现的图。
            */}
            {missing ? (
              <div className={styles.assetMissing} data-node-asset-missing>
                <span className={styles.missingTitle}>素材缺失</span>
                {expectedPath ? (
                  <span className={styles.missingPath} data-node-asset-missing-path title={expectedPath}>
                    {expectedPath}
                  </span>
                ) : null}
                <span className={styles.missingHint}>把文件放回这个位置，或重新拖入素材</span>
              </div>
            ) : (
              <div className={styles.assetLoading} data-node-asset-loading />
            )}
          </>
        )
      ) : overlay ? null : (
        /* 状态 A：占位框 + 中间一个 `+`。
           框本身**不是按钮**（否则点击节点任意处都会弹上传、且无法拖动节点）；
           只有中间的 `+` 是上传入口，其余区域照常选中 / 拖动（§6.8）。
           ⚠️ **生成中 / 失败时不渲染它**（用户 2026-10-06 第 13 批第 9 条：
           「盖住的时候他还是会显示出来，我不想要他显示出来」）——
           覆盖层是半透明的（要能看见上一次的图），只盖不改结构的话，
           「上传素材 / 支持音频、视频、图片素材」会从底下透出来。 */
        <div className={styles.placeholder} data-node-placeholder>
          <button
            type="button"
            className={styles.uploadBtn}
            data-node-upload
            title="点击上传素材，或把图片 / 视频拖进来"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              props.emit({ type: 'requestUpload' })
            }}
          >
            上传素材
          </button>
          {/*
            按钮下方的小字：说明「能传什么」（用户 2026-09-19）。
            按钮只说动作、不说范围——用户手里可能是音频或 mp4，猜错就得点一次才发现不收。
            文案里「音频」放最前：它最容易被误以为不支持。
          */}
          <span className={styles.uploadHint} data-node-upload-hint>
            支持音频、视频、图片素材
          </span>
        </div>
      )}

      {overlay && (
        <div className={styles.overlay} data-node-status={overlay}>
          {overlay === 'error' ? (
            <span className={styles.errorText} data-node-error>
              {props.error}
            </span>
          ) : (
            /*
             * 生成中（用户 2026-10-06 第 13 批第 9 条：「改成生成中的动画，同时显示时长」
             * +「动画用一些动效吧，好看一点的，你设计一个出来」）。
             *
             * 形态：一圈**呼吸的光环** + 一段**在转的双色弧线** + 下面「生成中 12s」。
             * 三条设计口径：
             * ① 自转 1.1s、呼吸 2.4s —— 两个节拍错开，读起来是"在做事"而不是"卡住了"，
             *    也比系统默认的 0.9s 匀速圈多一点呼吸感；
             * ② 秒数用**等宽数字**（`tabular-nums`）：不然每跳一秒，后面的 `s` 都会跟着挪一下；
             * ③ 系统开了"减少动态效果"就停转、只留光环与秒数 —— 信息不丢，动效听系统的。
             */
            <div className={styles.running} data-node-running>
              <span className={styles.orbit} aria-hidden="true" />
              <span className={styles.runningText} data-node-elapsed={elapsed}>
                生成中 {elapsed}s
              </span>
            </div>
          )}
        </div>
      )}

      {/*
        素材操作（清除 / 替换）：**本体那张图的右上角**（用户 2026-09-18 指定位置）。

        只在**有素材**时出现——空态本来就有中间的 `+` 作为上传入口，再摆一个
        「替换」是重复的。常显而不做 hover 才浮现：这是换图 / 清图的唯一入口，
        藏起来等于没有（上一版在创作面板缩略图上就是这么消失的）。
      */}
      {data.assetHash && url && (
        <div className={styles.assetActions} data-node-asset-actions>
          <button
            type="button"
            className={styles.assetMenuTrigger}
            data-node-asset-menu
            title="素材操作"
            aria-label="素材操作"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((v) => !v)
            }}
          >
            <AssetSwapIcon />
            <span className={styles.tooltip} role="tooltip">
              素材操作
            </span>
          </button>
          {menuOpen && (
            <AssetMenu
              onClose={() => setMenuOpen(false)}
              items={[
                {
                  id: 'clear',
                  label: '清除',
                  hint: '清掉这张素材，节点回到空态',
                  icon: 'clear',
                  onSelect: () => props.emit({ type: 'removeOwnAsset' }),
                },
                {
                  id: 'replace',
                  label: '替换',
                  hint: '换一张素材',
                  icon: 'upload',
                  onSelect: () => props.emit({ type: 'requestUpload' }),
                },
              ]}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** 视频本体：hover 显示播放 / 暂停（§6.8「视频 hover 显示播放 / 暂停控件」） */
function VideoBody({
  url,
  onOpen,
  onNatural,
}: {
  url: string
  onOpen: () => void
  onNatural: (width: number, height: number) => void
}) {
  const [playing, setPlaying] = useState(false)
  return (
    <div className={styles.videoWrap}>
      {/*
        先把元数据（含首帧）取回来：不写 `preload` 时，节点上可能只有一块黑 ——
        用户看到的现象就是「只有双击进灯箱才能看」。
      */}
      <video
        className={styles.asset}
        src={url}
        muted
        loop
        playsInline
        preload="metadata"
        autoPlay={playing}
        data-node-asset
        /*
         * 视频的尺寸**只能在解码到元数据之后才知道**（导入那一刻读不出来），
         * 所以节点框的纠正必须由这里喂 —— 这就是"视频不按原视频比例"那条的落点。
         */
        onLoadedMetadata={(e) => onNatural(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
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
        {playing ? <IconPause size={14} /> : <IconPlay size={14} />}
      </button>
    </div>
  )
}


/**
 * 素材操作（清除 / 替换）那颗按钮的图标 —— **实心圆底 + 两条粗白箭头**，
 * 按用户 2026-10-06 给的参考图矢量复刻（上一版是两条细描边箭头，用户说"不像换"）。
 *
 * 为什么单独导出一个组件而不是内联在 JSX 里：内联的 SVG 只在大组件渲染时才存在，
 * 而"素材操作"这一段要等 `useAssetThumb` 在 effect 里把 URL 解析出来才挂载 ——
 * 单测跑的是 SSR（`renderToString`，effect 不执行），内联写法**根本断言不到**
 * （第一版就这么写过，得到一条永远拿不到目标的红）。抽出来之后形状契约可以单独钉。
 *
 * 三个刻意的决定：
 * 1. **圆底不画在这里** —— 它就是按钮自己的 `--accent` 实底 + `--radius-pill`
 *    （`.assetMenuTrigger`，26px）。图标再画一遍等于叠第二层，深色主题下会多出
 *    一圈同色描边，按钮自己的 hover 反馈也会被盖住；
 * 2. **尺寸取 26 = 按钮直径、viewBox 16**：箭头组横跨 2.9→13.1（= 64% 直径），
 *    与参考图里"箭头占圆的六成出头"一致；按原来的 14px 画会缩成一小撮；
 * 3. 颜色**只用 `currentColor`**（= `--accent-text`）⇒ 两套主题自动反转，
 *    不必为深色主题另画一版（与仓库既有图标同一口径）。
 *
 * 形状：轴是带圆角的粗矩形（rx = 半个厚度），头是实心三角 + 同色 `stroke-linejoin: round`
 * （用描边给填充多边形倒圆角 —— SVG 里最省事的一条路）。头的半高 1.7 ＞ 轴厚 0.9，
 * 才有"箭头"的形；两条轴心相距 4.8、圆角各吃掉 0.3，**净空隙 0.8** ——
 * 第一版轴心只相距 4.2，圆角一磨两条就粘在一起（放大对照图里看得出来）。
 */
export function AssetSwapIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 16 16" aria-hidden data-asset-swap-icon>
      {/* 上：向左（轴的外端圆角 + 实心头） */}
      <rect x="6.6" y="4.7" width="5.8" height="1.8" rx="0.9" fill="currentColor" />
      <path
        d="M2.8 5.6 7.4 3.9v3.4z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
      {/* 下：向右（与上一条上下镜像，两条轴心相距 4.8） */}
      <rect x="3.6" y="9.5" width="5.8" height="1.8" rx="0.9" fill="currentColor" />
      <path
        d="M13.2 10.4 8.6 8.7v3.4z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}
