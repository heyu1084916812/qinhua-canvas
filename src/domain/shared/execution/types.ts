/**
 * 执行领域的中性词表（M6-5 路径 B，背景见 `轻画-comic形态调研.md` §5.3–§5.5）。
 *
 * 这些类型原先住在 `domain/canvas/model/runRecord.ts` 与
 * `domain/canvas/nodeSpecs/types.ts`。核对后确认它们**不含任何画布专有结构**：
 * - `RunRequest` 只认 (渠道 / 模型 / 提示词 / 输入 / 参数)，与图结构无关；
 * - `NodeInput` 只认文本 / 素材 / 集合三种输入源，也不含画布类型。
 *
 * 第二个消费者（comic 工作台）出现后，它们上移共享 domain，好让
 * `features/shared/execution` 的执行引擎能同时服务两个工作台——
 * 这正是调研稿 §5.5「等到有第二个真实实现再定接口」所等待的时机。
 *
 * 命名说明：`NodeInput.nodeId` 里的 "node" 是**执行主体**的中性称呼
 * （canvas = 画布节点、comic = 分镜格），不是画布专有名词。为把改动面收敛在
 * "类型上移"本身，M6-5 不改字段名（等真有第三处消费再统一改名）。
 *
 * 纯度：只依赖 `domain/shared` 与 `shared`，不含 React / platform / state（架构 §2.2）。
 */

/** 执行作用域（架构 §4.3）：node = 单主体、global = 全量 */
export type RunScope = 'node' | 'global'

/** 执行模式（架构 §4.3 / §4.5 修订）：single-alt 是入口修饰符，不进命令联合 */
/**
 * 执行模式。
 *
 * `refreshStale` 已随陈旧标记一并下线（用户 2026-09-17）：它筛出「指纹变了」的
 * 节点重跑，而落位改成「每次生成新建右侧节点」后，新节点本就没有基线、旧节点
 * 指纹也不变——这个集合恒为空，模式失去意义。
 */
export type RunMode = 'idle' | 'single' | 'single-alt' | 'rerun' | 'rerunAll'

/** 真正进入 plan / 命令层的模式：idle 与 single-alt 在计划构建时被解析掉 */
export type ExecutionMode = Exclude<RunMode, 'idle' | 'single-alt'>

/** 一次生成记录的状态（产品文档 §6.21） */
export type RunStatus = 'succeeded' | 'failed' | 'canceled' | 'interrupted'

/**
 * 状态词表（M6-15）。
 *
 * 与 `RunStatus` 是同一份封闭枚举的两面：类型给代码收窄，这个数组给**遍历**用——
 * 读回归一化（`pickFrom` 校验磁盘上的值）与「标签完备性」断言（每个状态都有中文标签、
 * 且不多不少）都需要它。放在这里而不是某个工作台的模型里：状态是**共享执行词**，
 * comic 的留痕只是它的第二个消费者。
 */
export const RUN_STATUSES: readonly RunStatus[] = [
  'succeeded',
  'failed',
  'canceled',
  'interrupted',
]

/**
 * 一次调用的输入项（架构 §4.1）。
 *
 * `collectionItemId` 只在**执行期**由 domain/execution/collectionExpand 打上：
 * 集合卡展开后，元素标记它来自集合里哪一个子节点。
 * 语义：同一次生成若把同一张素材放进集合 2 次，nodeId + assetHash 相同，
 * 必须靠这个字段区分「第 1 次 / 第 2 次调用」，否则结果会互相覆盖（hash 相同）。
 * 收集阶段（collectInputs）不带该字段，因此它不参与指纹计算（见 fingerprint.inputKey）。
 */
export type NodeInput =
  | { kind: 'text'; nodeId: string; text: string; collectionItemId?: string }
  | {
      kind: 'asset'
      nodeId: string
      assetHash: string
      mime: string
      collectionItemId?: string
      /**
       * 素材**自带**的提示词（素材节点自己的 `data.prompt`）。
       *
       * 为什么需要它：批量套图时，每张素材常常有自己的描述（「男人站着」/「女人坐着」）。
       * 收集阶段只带 assetHash 的话，拼提示词时这一段就丢了——于是「外部素材下方写了
       * 提示词、批量节点下方也写了」时，请求里只剩后写的那一份，前一份从未生效。
       *
       * 只在**素材本身是生成节点**时才有值；提示词节点走 `kind:'text'`。
       */
      prompt?: string
      /** 素材的原始像素（供「跟随素材比例」取比例用） */
      naturalSize?: { width: number; height: number }
    }
  /** 批量节点作为上游时的集合卡：下游遍历集合内每一项各生成一次 */
  | { kind: 'collection'; nodeId: string; items: NodeInput[] }

/**
 * 一次可调用的工具声明（Agent 用，架构 §5.9 ④）。
 *
 * 刻意只保留「名字 / 说明 / 参数 schema」三件：这是 OpenAI 兼容族的公共子集，
 * 各家私有字段（缓存、严格模式等）由适配器按需补，**共享层不解释它**。
 * 放在这里而不是渠道层：主体（agent）要产出它，渠道要消费它，两边共用一份形状。
 */
export interface ToolDeclaration {
  name: string
  description?: string
  /** JSON Schema 形式的参数描述 */
  parameters: Record<string, unknown>
}

/**
 * 一次对话里的一条消息（Agent 多轮用，架构 §5.9 ④）。
 *
 * 为什么需要它：`completeText` 原先只接受**一条 prompt 字符串**，
 * 而带工具的多轮对话必然要回传「assistant 要求调工具」「tool 的执行结果」
 * 这两种历史消息 —— 只发单条 user 消息的话，模型看不到自己上一步做过什么，
 * 会反复调同一个工具（正是设计文档 §4「循环的刹车」要治的那个病）。
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** `role:'assistant'` 时：它请求调用的工具 */
  toolCalls?: { id: string; name: string; args: string }[]
  /** `role:'tool'` 时：这条结果对应哪一次调用 */
  toolCallId?: string
}

interface RunRequestBase {
  channelId: string
  model: string
  prompt: string
  inputs: NodeInput[]
  params: Record<string, unknown>
  /**
   * 本次调用可用的工具。不传 = 普通文本调用（与加这个字段之前完全一致）。
   *
   * 为什么挂在请求上而不是 `params` 里：`params` 是**厂商参数**（比例、张数、
   * 时长……），各渠道含义不同；而「能调哪些工具」是**执行语义**，与厂商无关，
   * 混进 params 会让适配器既要知道它是谁、又要从一堆厂商字段里挑出来。
   */
  tools?: readonly ToolDeclaration[]
  /**
   * 完整消息历史（Agent 用）。给了它就以它为准，`prompt` 只作为「没有 messages 时」
   * 的老路径 —— 这样既有调用点（优化 / 翻译 / 反推）一个字都不用改。
   */
  messages?: readonly ChatMessage[]
}

/**
 * 判别联合而非「kind 是联合的接口」——后者在 switch(kind) 里无法收窄类型，
 * 渠道适配层会因此到处写 as。
 *
 * 位置迁移说明：定义在本文件（共享 domain），渠道适配层与两个工作台共用同一份，
 * 保证「主体产出的请求」与「渠道接收的请求」不会各自漂移。
 */
export type RunRequest =
  | (RunRequestBase & { kind: 'image' })
  | (RunRequestBase & { kind: 'video' })
  | (RunRequestBase & { kind: 'text' })
