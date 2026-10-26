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
} from '../../domain/storyboard/storyboard'
import { digitalHumanPlanOf } from '../../domain/storyboard/digitalHuman'
import { fingerprintBytesSync } from '../../domain/shared/hash'
import { mixAudioSequentially } from '../../platform/web/audioMix'
import { asAppError, describeError } from '../../shared/result'
import { withStoryboardRunScope } from '../../features/storyboard/runScope'

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
    scopeId?: string
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
        const data = withStoryboardRunScope(
          await canvas.resolveGenerationData({
            mode: 'image',
            prompt: shotPromptWithAssets(doc, shot),
          }),
          {
            subjectKind: 'shot-image',
            subjectId: `shot:${shot.id}`,
            scopeId: `episode:${shot.episodeId}`,
          },
        )
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
          scopeId: `episode:${shot.episodeId}`,
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
      const data = withStoryboardRunScope(
        await canvas.resolveGenerationData({
          mode: 'video',
          channelId: digitalHumanTarget.channelId,
          model: digitalHumanTarget.model,
          prompt: '数字人口播',
          durationSec: shot.durationSec,
          assetHash: output.hash,
          assetMime: output.mime || 'video/mp4',
        }),
        {
          subjectKind: 'digital-human',
          subjectId: `shot:${shot.id}`,
          scopeId: `episode:${shot.episodeId}`,
        },
      )
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

  return {
    layOut,
    makeDigitalHuman,
    syncPrompts,
  }
}
