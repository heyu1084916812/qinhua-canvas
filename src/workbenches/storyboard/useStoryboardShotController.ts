import type { Dispatch, SetStateAction } from 'react'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { StoryboardCanvasPort } from '../../features/storyboard/canvasPort'
import type { PlatformKit } from '../../platform/ports'
import type { DirectRunTraceInput } from '../../state/shared/directRun'
import type { Edge } from '../../domain/canvas/model/edge'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import type {
  StoryboardDoc,
  StoryboardEpisode,
  StoryboardShot,
} from '../../domain/storyboard/storyboard'
import {
  attachShotNodes,
  attachShotVideos,
  planShotRefEdges,
  setShotVideoNode,
  shotPromptWithAssets,
  shotRefNodeIds,
  shotVideoPrompt,
  shotsOf,
} from '../../domain/storyboard/storyboard'
import { videoParamsFor } from '../../domain/canvas/layout/videoParams'
import { digitalHumanPlanOf } from '../../domain/storyboard/digitalHuman'
import { fingerprintBytesSync } from '../../domain/shared/hash'
import { mixAudioSequentially } from '../../platform/web/audioMix'
import { asAppError, describeError } from '../../shared/result'

export interface StoryboardShotControllerArgs {
  doc: StoryboardDoc
  currentDoc: () => StoryboardDoc | null
  selected: StoryboardEpisode | null
  shots: readonly StoryboardShot[]
  needNodes: readonly StoryboardShot[]
  graphNodes: readonly NodeSnapshot[]
  graphEdges: readonly Edge[]
  liveNodeIds: ReadonlySet<string>
  channels: ChannelStore
  canvas: StoryboardCanvasPort
  platform: PlatformKit
  directTrace: (args: {
    subjectId: string
    kind: 'text' | 'video' | 'speech'
    channelId: string
    model: string
    payload: unknown
    inputs?: DirectRunTraceInput['inputs']
    params?: Record<string, unknown>
  }) => DirectRunTraceInput
  digitalHumanTarget: {
    channelId: string
    model: string
  } | null
  apply: (doc: StoryboardDoc) => void
  setLay: Dispatch<
    SetStateAction<{
      kind: 'idle' | 'running' | 'done' | 'error'
      text: string
    }>
  >
  setDigitalHumanBusy: Dispatch<SetStateAction<string | null>>
}

export function createStoryboardShotController(
  args: StoryboardShotControllerArgs,
) {
  const {
    doc,
    currentDoc,
    selected,
    shots,
    needNodes,
    graphNodes,
    graphEdges,
    liveNodeIds,
    channels,
    canvas,
    platform,
    directTrace,
    digitalHumanTarget,
    apply,
    setLay,
    setDigitalHumanBusy,
  } = args
  const graph = { nodes: graphNodes, edges: graphEdges }
  const humanError = (error: unknown) => {
    const appError = asAppError(error)
    return appError
      ? describeError(appError)
      : error instanceof Error
        ? error.message
        : String(error)
  }

  /**
   * **把"这一镜该接的参考图"同步到连线上**（对账 #430）。
   *
   * #419 做出来的定妆图 / 基准图此前**一个字节都没喂进生成**：它只被显示、被镜像，
   * 请求里从来没有它（这就是"假功能"长什么样）。这一步把它接上 —— 而且**不加任何新机制**：
   * 上游图正是靠连线进 `inputs` 的（G141 在视频那条链上验过同一条路）。
   *
   * 三条纪律：
   * ① **按快照算**：`getSnapshot()` 是同步真相，同一轮里已经接上的线不会再接一遍
   *    （`canConnect` 也会挡重复边）；
   * ② **没有增减就一条命令都不发**：免得每次出图都往撤销栈里塞一步空事务；
   * ③ **只断我们自己接的那些** —— 用户手工连进来的参考图一律不动（见 `planShotRefEdges`）。
   */
  const syncShotRefs = (shot: StoryboardShot, targetNodeId: string) => {
    const snapshot = canvas.getSnapshot()
    const live = new Set(snapshot.nodes.map((n) => n.id))
    if (!live.has(targetNodeId)) return
    const incoming = snapshot.edges
      .filter((e) => e.target === targetNodeId)
      .map((e) => e.source)
    const plan = planShotRefEdges(doc, shot, incoming, live)
    if (plan.disconnect.length === 0 && plan.connect.length === 0) return
    for (const source of plan.disconnect) {
      for (const edge of snapshot.edges) {
        if (edge.source === source && edge.target === targetNodeId) {
          canvas.removeEdge(edge.id)
        }
      }
    }
    for (const source of plan.connect) {
      canvas.connectEdge(source, targetNodeId)
    }
  }

  /**
   * 「铺到画布」：给这一集**还没铺**（或铺过的节点已被删）的镜头各建一个生成节点。
   *
   * 两条纪律：
   * ① **整批一个事务**（`beginPlan` / `endPlan`）：用户按一次撤销，这一批节点一起退回去；
   * ② 先把异步的默认配方**全部解析完**再进事务 —— 事务里夹 `await` 会把撤销断成好几步
   *    （`createNodeWithDefaults` 的文件注释记着当年怎么栽的，电商页也是这么写的）。
   *
   * 提示词就用这一镜的 `shotPrompt`（留空回落画面描述）—— 分镜里写的那句话，
   * 到此为止一直是纯文本，这一步才第一次变成"真能跑的节点"。
   */
  const layOut = async () => {
    if (!selected) return
    const targets = needNodes
    if (targets.length === 0) {
      setLay({ kind: 'done', text: '这一集的镜头都已经在画布上了' })
      return
    }
    try {
      const base = graph.nodes.length
      const prescribed: { shotId: string; data: Record<string, unknown> }[] = []
      for (const shot of targets) {
        const data = await canvas.resolveGenerationData({
          mode: 'image',
          prompt: shotPromptWithAssets(doc, shot),
        })
        prescribed.push({ shotId: shot.id, data })
      }
      const pairs: { shotId: string; nodeId: string }[] = []
      canvas.beginPlan('storyboard:lay-out', `漫剧铺到画布 ×${prescribed.length}`)
      try {
        prescribed.forEach((item, i) => {
          const nodeId = canvas.createGenerationNode({
            at: { x: 40, y: 40 + (base + i) * 200 },
            data: item.data,
          })
          if (nodeId) pairs.push({ shotId: item.shotId, nodeId })
        })
        /**
         * 铺完立刻把参考图接上（对账 #430）：**已经出过定妆图 / 基准图**的角色与场景，
         * 它们的图就是这一镜的输入。放在同一个事务里 —— 用户按一次撤销，
         * 节点与这几条线一起退回去（线单独成事务就会散成好几步）。
         */
        for (const pair of pairs) {
          const shot = doc.shots.find((s) => s.id === pair.shotId)
          if (shot) syncShotRefs(shot, pair.nodeId)
        }
      } finally {
        canvas.endPlan()
      }
      const current = currentDoc()
      if (current && pairs.length > 0) apply(attachShotNodes(current, pairs, 0))
      setLay({ kind: 'done', text: `已把 ${pairs.length} 镜铺到画布` })
    } catch (e) {
      setLay({ kind: 'error', text: humanError(e) })
    }
  }

  /**
   * 出图：产物**写回这一镜自己的节点**（`inPlace`，对账 #413 那条能力在这里第二次被用上）。
   *
   * 为什么不铺新节点：分镜要的是"这一镜的图"，不是"这一镜的十张候选"。
   * 想留旧图比稿的用户可以先用单镜重出（每次覆盖），或到画布上用 Alt+R —— 两条路都在。
   *
   * 出图前先 `syncShotRefs`：**定妆图是后补的**（先铺了分镜、之后才给角色出定妆图）
   * 也得吃进这一趟请求 —— 只在铺的时候接一次，后补的那张就永远喂不进去。
   */
  const runShot = (shot: StoryboardShot) => {
    if (!shot.nodeId) return
    syncShotRefs(shot, shot.nodeId)
    const refs = shotRefNodeIds(doc, shot, new Set(graph.nodes.map((n) => n.id))).length
    if (refs > 0) setLay({ kind: 'running', text: `这一镜在跑（带 ${refs} 张参考图）…` })
    void canvas.runNode(shot.nodeId, { inPlace: true }).then(
      () => {
        /**
         * 「跑完」不等于「出成」：失败是**记在状态里**的（`nodeStates`），不抛异常。
         * 只看 then 就把失败报成"已出"，正是 #188 那个坑。
         */
        if (refs === 0) return
        const state = canvas.nodeStateOf(shot.nodeId!)
        if (state?.kind === 'failed') {
          setLay({ kind: 'error', text: `这一镜出图失败：${describeError(state.error)}` })
          return
        }
        setLay({ kind: 'done', text: `这一镜的图已出（带了 ${refs} 张参考图）` })
      },
      (e: unknown) => setLay({ kind: 'error', text: humanError(e) }),
    )
  }

  /**
   * **「这一镜出视频」**（对账 #429）—— #428 查实"引擎那条路是通的，差的只是接线"。
   *
   * 四件事，一件都不能省：
   * ① 这一镜得先有图（图生视频是拿图去动的，没图就没得动）；
   * ② 第一次建一个 `mode:'video'` 的**新节点**；重出时**复用**它。把这一镜的图节点
   *    连上去，下一镜已出图且模型支持时再接一条尾帧 —— 上游图正是靠这两条连线进
   *    `inputs` 的（G141 验过：`[{kind:'asset',…}]`）；
   * ③ **建完节点立刻写进文档**（`setShotVideoNode`）—— 跑视频是长任务、中途失败很常见，
   *    那时节点已经躺在画布上了；不写，用户再点一次会又建一个，画布上慢慢堆起没人认领的空节点；
   * ④ 产物 hash 由上面那条镜像 effect 收回文档，列表才知道这一镜有视频了。
   *
   * **为什么另铺节点、而不像出图那样 `inPlace`**：写回会把这一镜的**图**顶掉，
   * 而图还得留着 —— 它既是视频的输入，也是分镜表里的画面。图与视频各占一个节点，两条都在。
   */
  const makeShotVideo = async (
    shot: StoryboardShot,
    options: { quiet?: boolean } = {},
  ): Promise<boolean> => {
    const report = (kind: 'running' | 'done' | 'error', text: string) => {
      if (!options.quiet) setLay({ kind, text })
    }
    if (!shot.nodeId || !liveNodeIds.has(shot.nodeId)) {
      report('error', '这一镜还没铺到画布 —— 先铺一次，出了图再出视频')
      return false
    }
    if (!shot.imageHash) {
      report('error', '这一镜还没有图 —— 图生视频要先有画面，先点「出图」')
      return false
    }
    try {
      /**
       * 视频模型由**渠道解析**决定（与画布同一条口径：模型定下来，谁提供它由选路决定）。
       * 解析不到就如实说 —— 不硬编一个预设名去请求（#414 那条教训）。
       */
      const recipe = await channels.defaultForNewNode({}, 'video')
      if (!recipe?.channelId || !recipe?.model) {
        report('error', '还没有可用的视频模型服务 —— 先去「全局设置 → 模型服务」添加一条并勾上视频模型')
        return false
      }
      const latestDoc = currentDoc()
      const episodeShots = latestDoc ? shotsOf(latestDoc, shot.episodeId) : []
      const shotIndex = episodeShots.findIndex((item) => item.id === shot.id)
      const nextShot = shotIndex >= 0 ? episodeShots[shotIndex + 1] : undefined
      const nextFrameNodeId =
        nextShot?.nodeId && nextShot.imageHash && liveNodeIds.has(nextShot.nodeId)
          ? nextShot.nodeId
          : ''
      const liveChannel = channels
        .getState()
        .channels.find((channel) => channel.id === recipe.channelId)
      const logicalModel =
        Object.entries(liveChannel?.modelMap ?? {}).find(
          ([, upstream]) => upstream === recipe.model,
        )?.[0] ?? recipe.model
      const videoSpec = videoParamsFor(logicalModel)
      /**
       * 未声明能力时不设限（项目既有口径）：认不出的渠道模型仍可按首尾帧发，
       * 由适配器 / 上游如实报错；只有**明确声明了不支持**时才回落单张首帧。
       */
      const supportsFirstLastFrame =
        !!nextFrameNodeId &&
        (videoSpec ? videoSpec.modes.includes('first-last-frame') : true)
      const endFrameNodeId = supportsFirstLastFrame ? nextFrameNodeId : ''
      const singleImageMode = videoSpec?.modes.includes('image-to-video')
        ? 'image-to-video'
        : videoSpec?.modes.includes('all-purpose')
          ? 'all-purpose'
          : undefined
      const videoMode = endFrameNodeId
        ? 'first-last-frame'
        : singleImageMode
      const videoPrompt = shotVideoPrompt(doc, shot, endFrameNodeId ? nextShot : undefined)
      const imageNode = graph.nodes.find((n) => n.id === shot.nodeId)
      const data = await canvas.resolveGenerationData({
        mode: 'video',
        model: recipe.model,
        prompt: videoPrompt,
        durationSec: shot.durationSec,
        ...(videoMode ? { videoMode } : {}),
      })
      let nodeId =
        shot.videoNodeId && liveNodeIds.has(shot.videoNodeId) ? shot.videoNodeId : ''
      canvas.beginPlan('storyboard:shot-video', '这一镜出视频')
      try {
        if (nodeId) {
          /**
           * 重出必须**复用原视频节点**：每次都新建会让画布堆出一排空视频节点，
           * 而分镜文档只认最后一个，前几个就永远没人认领。
           */
          canvas.updateNodeData(nodeId, {
            ...data,
            mode: 'video',
            model: recipe.model,
            prompt: videoPrompt,
            count: 1,
            durationSec: shot.durationSec,
            ...(videoMode ? { videoMode } : {}),
          })
        } else {
          nodeId =
            canvas.createGenerationNode({
              /* 贴着这一镜的图节点往右放（与模板「图生视频」的摆法一致，一眼看得出谁喂谁） */
              at: { x: (imageNode?.x ?? 40) + 280, y: (imageNode?.y ?? 40) },
              data,
            }) ?? ''
        }
        if (nodeId) {
          const connected = new Set(
            graph.edges.filter((edge) => edge.target === nodeId).map((edge) => edge.source),
          )
          /* 下一镜换了 / 被删了：只断我们自己记录的旧尾帧，用户手工参考图不动。 */
          if (
            shot.videoEndNodeId &&
            shot.videoEndNodeId !== endFrameNodeId &&
            connected.has(shot.videoEndNodeId)
          ) {
            const old = graph.edges.find(
              (edge) => edge.source === shot.videoEndNodeId && edge.target === nodeId,
            )
            if (old) {
              canvas.removeEdge(old.id)
              connected.delete(shot.videoEndNodeId)
            }
          }
          /* 这一步是"图进请求"的全部机制：连线就是 inputs（G141 验过） */
          if (!connected.has(shot.nodeId)) {
            canvas.connectEdge(shot.nodeId, nodeId)
            connected.add(shot.nodeId)
          }
          if (endFrameNodeId && !connected.has(endFrameNodeId)) {
            canvas.connectEdge(endFrameNodeId, nodeId)
          }
        }
      } finally {
        canvas.endPlan()
      }
      if (!nodeId) {
        report('error', '视频节点没能建出来（模型服务或模型没配全）')
        return false
      }
      const current = currentDoc()
      if (current) apply(setShotVideoNode(current, shot.id, nodeId, 0, endFrameNodeId))
      report(
        'running',
        endFrameNodeId
          ? '这一镜的视频在跑（首尾帧：接到下一镜的画面）…'
          : nextFrameNodeId
            ? '这一镜的视频在跑（当前视频模型不支持首尾帧，按单张首帧生成）…'
            : '这一镜的视频在跑…',
      )
      await canvas.runNode(nodeId, { inPlace: true })
      const state = canvas.nodeStateOf(nodeId)
      if (state?.kind === 'failed') {
        report('error', `这一镜的视频生成失败：${describeError(state.error)}`)
        return false
      }
      report(
        'done',
        endFrameNodeId
          ? '这一镜的视频已出（用了这一镜与下一镜的首尾帧）'
          : '这一镜的视频已出（画布里就挂在这一镜的图右边）',
      )
      return true
    } catch (e) {
      report('error', humanError(e))
      return false
    }
  }

  /**
   * 整镜数字人口播：RunningHub 官方数字人端点只接收一条音轨。
   * 同一角色的多句台词先按顺序合成一条 WAV；多角色镜头仍拒绝，避免把多人
   * 对白错误地映射到同一个人的口型上。
   */
  const makeDigitalHuman = async (shot: StoryboardShot) => {
    const plan = digitalHumanPlanOf(shot)
    if (!digitalHumanTarget) {
      setLay({
        kind: 'error',
        text: '当前没有可用的数字人口播模型：在 RunningHub 渠道勾选 Kling V2 数字人口播',
      })
      return
    }
    if (!shot.nodeId || !liveNodeIds.has(shot.nodeId) || !shot.imageHash) {
      setLay({ kind: 'error', text: '这一镜还没有可用的图片节点' })
      return
    }
    if (!plan.ok) {
      setLay({ kind: 'error', text: plan.reason })
      return
    }
    setDigitalHumanBusy(shot.id)
    setLay({
      kind: 'running',
      text: plan.lines.length > 1 ? '正在合并整镜配音并生成数字人视频…' : '正在调用数字人口播模型…',
    })
    const ac = new AbortController()
    const timer = window.setTimeout(() => ac.abort(), 20 * 60 * 1000)
    try {
      const image = await platform.assets.read(shot.imageHash)
      const audioClips = await Promise.all(
        plan.lines.map(async (line) => {
          const audio = await platform.assets.read(line.audioHash!)
          if (!audio) throw new Error('有台词配音的素材字节已经不在库里')
          return audio
        }),
      )
      if (!image) {
        throw new Error('人像图或配音音频的素材字节已经不在库里')
      }
      const mixed = plan.lines.length > 1 ? await mixAudioSequentially(audioClips) : audioClips[0]!
      const audioHash =
        plan.lines.length > 1 ? fingerprintBytesSync(mixed.bytes) : plan.lines[0]!.audioHash!
      if (plan.lines.length > 1) {
        canvas.putAsset({
          hash: audioHash,
          mime: mixed.mime,
          bytes: mixed.bytes,
        })
      }
      const outputs = await channels.generateVideo({
        kind: 'video',
        channelId: digitalHumanTarget.channelId,
        model: digitalHumanTarget.model,
        prompt:
          '生成单人数字人口播视频，保持人物身份、服装、构图与画面风格一致，口型自然贴合配音，避免夸张动作和镜头跳变。',
        inputs: [
          {
            kind: 'asset',
            nodeId: shot.nodeId,
            assetHash: shot.imageHash,
            mime: image.mime || 'image/png',
          },
          {
            kind: 'asset',
            nodeId: shot.nodeId,
            assetHash: audioHash,
            mime: mixed.mime || 'audio/mpeg',
          },
        ],
        params: {},
        signal: ac.signal,
        trace: directTrace({
          subjectId: `shot:${shot.id}:digital-human`,
          kind: 'video',
          channelId: digitalHumanTarget.channelId,
          model: digitalHumanTarget.model,
          payload: {
            prompt:
              '生成单人数字人口播视频，保持人物身份、服装、构图与画面风格一致，口型自然贴合配音，避免夸张动作和镜头跳变。',
            imageHash: shot.imageHash,
            audioHash,
          },
        }),
      })
      const output = outputs[0]
      if (!output) throw new Error('数字人口播模型没有返回视频')
      canvas.putAsset({
        ...output,
        mime: output.mime || 'video/mp4',
      })
      const data = await canvas.resolveGenerationData({
        mode: 'video',
        channelId: digitalHumanTarget.channelId,
        model: digitalHumanTarget.model,
        prompt: '数字人口播',
        durationSec: shot.durationSec,
        assetHash: output.hash,
        assetMime: output.mime || 'video/mp4',
      })
      const imageNode = graph.nodes.find((node) => node.id === shot.nodeId)
      let videoNodeId =
        shot.videoNodeId && liveNodeIds.has(shot.videoNodeId) ? shot.videoNodeId : ''
      canvas.beginPlan('storyboard:digital-human', '单句数字人口播')
      try {
        if (videoNodeId) {
          canvas.updateNodeData(videoNodeId, {
            ...data,
            mode: 'video',
            channelId: digitalHumanTarget.channelId,
            model: digitalHumanTarget.model,
            prompt: '数字人口播',
            durationSec: shot.durationSec,
            assetHash: output.hash,
            assetMime: output.mime || 'video/mp4',
          })
        } else {
          videoNodeId =
            canvas.createGenerationNode({
              at: { x: (imageNode?.x ?? 40) + 280, y: (imageNode?.y ?? 40) },
              data,
            }) ?? ''
        }
        if (videoNodeId) {
          const connected = graph.edges.some(
            (edge) => edge.source === shot.nodeId && edge.target === videoNodeId,
          )
          if (!connected) {
            canvas.connectEdge(shot.nodeId, videoNodeId)
          }
        }
      } finally {
        canvas.endPlan()
      }
      if (!videoNodeId) throw new Error('口播视频节点没能建出来')
      const current = currentDoc()
      if (current) {
        const withNode = setShotVideoNode(current, shot.id, videoNodeId, 0)
        apply(attachShotVideos(withNode, [{ shotId: shot.id, hash: output.hash }], 0))
      }
      setLay({
        kind: 'done',
        text:
          plan.lines.length > 1
            ? `整镜 ${plan.lines.length} 句配音已合并，数字人口播视频已生成`
            : '这一句的数字人口播视频已生成',
      })
    } catch (error) {
      setLay({ kind: 'error', text: humanError(error) })
    } finally {
      setDigitalHumanBusy(null)
      window.clearTimeout(timer)
    }
  }

  /**
   * 已有镜头视频 → 真实视频超清。
   *
   * 旧视频节点与素材一个都不动：超清结果落成新的视频节点，并把它作为旧节点的下游。
   * 镜头的 `videoNodeId / videoHash` 指向新结果；旧节点仍留在画布上可供对比 / 回退。
   */

  /** 这一集出视频：只跑“有图但还没有视频”的镜头，逐镜串行，避免免费额度被并发打满。 */
  const runEpisodeVideos = async () => {
    const targets = shots.filter(
      (shot) =>
        shot.nodeId &&
        liveNodeIds.has(shot.nodeId) &&
        shot.imageHash &&
        (!shot.videoHash ||
          !shot.videoNodeId ||
          !liveNodeIds.has(shot.videoNodeId)),
    )
    if (targets.length === 0) {
      setLay({ kind: 'done', text: '这一集没有待出视频的镜头（要重出请用单镜那把）' })
      return
    }
    let ok = 0
    let failed = 0
    for (let i = 0; i < targets.length; i += 1) {
      setLay({
        kind: 'running',
        text: `这一集出视频 ${i + 1}/${targets.length}：第 ${shots.indexOf(targets[i]!) + 1} 镜…`,
      })
      const success = await makeShotVideo(targets[i]!, { quiet: true })
      if (success) ok += 1
      else failed += 1
    }
    setLay({
      kind: failed > 0 ? 'error' : 'done',
      text:
        failed > 0
          ? `这一集视频跑完：成功 ${ok} 镜，失败 ${failed} 镜（失败原因见各自状态）`
          : `这一集 ${ok} 镜视频已出`,
    })
  }

  /**
   * 「刷新提示词」：把**当前**资产设定重新拼进已经铺到画布的节点（对账 #418）。
   *
   * 为什么需要它：提示词是在**铺的那一刻**按当时的资产拼好的（快照）。改完角色描述，
   * 画布上的节点还是旧描述 —— 两条路：重新铺（会多铺节点，不行）或原地刷提示词（这条）。
   * 整批一个事务：按一次撤销，这一批提示词一起回到上一版。
   */
  const syncPrompts = () => {
    const targets = shots.filter((s) => s.nodeId && liveNodeIds.has(s.nodeId))
    if (targets.length === 0) {
      setLay({ kind: 'done', text: '还没有铺到画布的镜头' })
      return
    }
    canvas.beginPlan('storyboard:sync-prompt', `按资产刷新提示词 ×${targets.length}`)
    try {
      for (const shot of targets) {
        canvas.updateNodeData(
          shot.nodeId!,
          { prompt: shotPromptWithAssets(doc, shot) },
          false,
        )
      }
    } finally {
      canvas.endPlan()
    }
    setLay({ kind: 'done', text: `已按当前资产刷新 ${targets.length} 个节点的提示词` })
  }

  /** 这一集出图：逐镜串行（顺着分镜顺序），**已出过的跳过**；重出用单镜那把 */
  const runEpisode = async () => {
    const targets = shots.filter((s) => s.nodeId && liveNodeIds.has(s.nodeId) && !s.imageHash)
    if (targets.length === 0) {
      setLay({ kind: 'done', text: '这一集没有待出图的镜头（要重出请用单镜那把）' })
      return
    }
    setLay({ kind: 'idle', text: '' })
    for (const shot of targets) {
      /* 整集出图与单镜出图同一条纪律：跑之前先把参考图接上（对账 #430） */
      syncShotRefs(shot, shot.nodeId!)
      await canvas.runNode(shot.nodeId!, { inPlace: true })
    }
    setLay({ kind: 'done', text: `已跑完这一集 ${targets.length} 镜（失败的镜头各自标了原因）` })
  }


  return {
    layOut,
    runShot,
    makeShotVideo,
    makeDigitalHuman,
    runEpisodeVideos,
    syncPrompts,
    runEpisode,
  }
}
