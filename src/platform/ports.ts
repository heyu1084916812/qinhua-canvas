import type { AppError } from '../shared/result'
import type { DetectorFaceRect } from '../shared/faceDetect'
import type { ModelCapability } from '../domain/shared/capability'
import type { ProtocolDefinition } from '../domain/project/protocol'

/** 表名与产品文档 §8 数据模型一致 */
export type TableName =
  | 'projects'
  | 'nodes'
  | 'edges'
  | 'channels'
  | 'tasks'
  | 'runRecords'
  | 'assets'
  | 'credentials'
  /**
   * UI 偏好（生成预设等）：一行一个偏好，键固定（见 domain/project/generationPreset）。
   * 与业务数据分开，业务表保持「只有业务」这一条界限。
   */
  | 'presets'
  /** 用户自建协议（「一站一协议」的声明式定义，见 domain/project/protocol） */
  | 'customProtocols'
  /**
   * 素材库收藏关系。**只记录「用户手动保存过哪张素材」与保存当时的元数据**，
   * 素材字节仍在 `assets` 表；一张素材未被收藏时不会进入 `/assets`。
   */
  | 'assetLibrary'
  /** 随应用内置、只读的技能默认正文。 */
  | 'builtinSkills'
  /** 用户技能：新建、导入、从内置复制而来。 */
  | 'skills'
  /**
   * Agent 会话（设计文档 §12）。**单独一张表**，不塞进 `presets`：
   * 那是 UI 偏好表，而会话历史会一直增长，混进去会把偏好表撑大。
   */
  | 'agentSessions'
  /**
   * 用户自定义界面字体（用户 2026-10-09）。
   *
   * 与 `assets` 刻意分开：那一张是**生成素材**（参与导出 / 备份 / 内容寻址），
   * 字体是**本机界面偏好**的附属字节，不该混进素材库、也不该被"导出项目"带走。
   * 一行 = 一个字体：元数据 + `bytes`（ArrayBuffer）。
   */
  | 'fonts'
  /**
   * 项目快照（用户 2026-10-09，对账 #378 A4）。
   *
   * 与 `fonts` / `assets` 分开：一行 = 一个项目的**图与记录**的副本
   * （nodes / edges / runRecords），**不含素材字节** —— 素材走内容寻址的 `assets`，
   * 那张表只增不改，本身就是历史。这样快照可以又多又小。
   */
  | 'snapshots'
  /** 漫剧工作台第一阶段的整份文档（一行 = 一个项目，对账 #382） */
  | 'storyboards'
  /**
   * 电商工作台的任务 / 结果（对账 #399 第二期）。
   *
   * 结果字节仍走内容寻址的 `assets`；这两张表只存"这一批做了什么、
   * 每一格对应哪个内部节点与素材 hash"。画布节点是执行载体，不再当结果真源。
   */
  | 'ecommerceTasks'
  | 'ecommerceResults'
  /**
   * 灵感库的**索引缓存**（用户 2026-10-14）。
   *
   * 一行 = 一个来源：存解析后的案例数组 + 拉取时间。**只存索引、不存媒体** ——
   * 预览图与视频始终走原始外链（用户明确说过「同步本地太大了，因为里面还有视频」）。
   */
  | 'inspirationCache'

export interface Row {
  id: string
  [key: string]: unknown
}

export type RowOf<K extends TableName> = Row & { __table?: K }

export interface StoragePort {
  open(): Promise<void>
  transaction<T>(tables: TableName[], fn: () => Promise<T>): Promise<T>
  put<K extends TableName>(table: K, row: RowOf<K>): Promise<void>
  bulkPut<K extends TableName>(table: K, rows: RowOf<K>[]): Promise<void>
  delete<K extends TableName>(table: K, id: string): Promise<void>
  query<K extends TableName>(table: K, filter: Partial<RowOf<K>>): Promise<RowOf<K>[]>
  /**
   * **整表流式扫描**（可选）：一次只把 `batchSize` 行交给 `onBatch`，**不把整表拿在手里**；
   * 第二参数带着**总数**（进度要分母）。返回一共扫过多少行。
   *
   * 为什么需要它：`assets` 表**每行都带全分辨率字节**，而"导出素材到文件夹"正是迁移主路径。
   * 若先 `query('assets', {})` 再逐行写盘，库涨到几个 GB 时那一下就是**内存峰值 = 整个库**（浏览器直接崩）。
   * 分批之后峰值只跟 `batchSize` 有关，与库多大无关。
   *
   * 只做**整表**：要过滤就走 `query`（结果集小，内存不痛）。
   * **可选**：没实现的后端（如有）由调用方退回 `query` —— 小库两条路等价。
   */
  scan?<K extends TableName>(
    table: K,
    batchSize: number,
    onBatch: (rows: RowOf<K>[], meta: { total: number }) => Promise<void>,
  ): Promise<number>
  estimateUsage(): Promise<{ used: number; quota: number }>
}

export interface NetworkRequest {
  url: string
  /** `HEAD` 是给「测连通性」用的（对账 #260）：只要响应头，不取正文 */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD'
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
}

export interface NetworkResponse {
  status: number
  headers: Record<string, string>
  text(): Promise<string>
  json<T = unknown>(): Promise<T>
  arrayBuffer(): Promise<ArrayBuffer>
}

export interface StreamChunk {
  type: 'delta' | 'tool_call' | 'done' | 'error'
  text?: string
  toolCall?: { name: string; args: unknown }
  error?: AppError
}

export interface NetworkPort {
  request(req: NetworkRequest, signal: AbortSignal): Promise<NetworkResponse>
  /** 流式响应（SSE）：Agent 与长文本输出使用，取消时迭代终止 */
  stream(req: NetworkRequest, signal: AbortSignal): AsyncIterable<StreamChunk>
}

export interface CredentialPort {
  save(ref: string, secret: string): Promise<void>
  load(ref: string): Promise<string | null>
  remove(ref: string): Promise<void>
  mask(secret: string): string
}

/** 素材本体（字节 + 类型） */
export interface AssetPayload {
  bytes: Uint8Array
  mime: string
}

/**
 * 素材读回端口（M6-12）。
 *
 * 单独成口而非让渠道直接查 storage：渠道只需要「hash → 字节」这一件事，
 * 不需要知道 `assets` 表的形状（id 即 hash、bytes 可能是 Uint8Array / ArrayBuffer）。
 * 表结构的变化因此被挡在 platform 内部，渠道层不受影响。
 */
export interface AssetPort {
  /** 素材不存在（尚未落库 / 已被清理）时返回 null */
  read(hash: string): Promise<AssetPayload | null>
  /**
   * **远端素材**（视频成片）的地址：Agnes 的产物托管域不带 CORS 头，
   * 字节根本取不回来（实测 `net::ERR_FAILED`），`assets` 行里只有一条 `url`。
   *
   * 这类素材的**播放**靠 `<video src>`、**下载**靠把地址交回浏览器自己取
   * —— 两条路都要先拿到这个地址，故单开一口；本地素材返回 null。
   */
  readUrl(hash: string): Promise<AssetUrlSource | null>
}

/** 远端素材：可播放/可交给浏览器下载的地址 + 它的类型 */
export interface AssetUrlSource {
  url: string
  mime: string
}

export interface PickedFile {
  name: string
  size: number
  mime: string
  blob: Blob
}

export interface FilePort {
  pickFile(accept?: string): Promise<PickedFile | null>
  saveFile(name: string, blob: Blob): Promise<void>
  /**
   * 把**远端地址**存成本地文件（用户 2026-10-03：节点下载按钮对视频成片无效）。
   *
   * 返回走了哪条路，调用方据此给用户一句话：
   * - `saved`：取到了字节，已按 `saveFile` 落盘；
   * - `opened`：托管域不给 CORS 头，字节进不了页面，只能把地址交给浏览器
   *   （新标签页里用播放器自带的下载）—— 如实上报，别假装存好了。
   */
  saveFromUrl(url: string, name: string): Promise<'saved' | 'opened'>
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * **素材传输端口**（用户 2026-10-03：单独一个「素材传输」设置页）。
 *
 * 把本地素材字节传到用户配置的图床，换回一条**能被上游抓到**的公网直链。
 * 约定：没配图床（`provider: 'off'`）时返回 `null` —— 这不是失败，
 * 调用方据此回落「内联 Base64」那条路（实测 Agnes 两边都认）。
 */
export interface HostingPort {
  upload(input: { blob: Blob; name: string }): Promise<{ url: string } | null>
  /**
   * **测连通性**（对账 #260，用户点名要的按钮）。
   *
   * 只发**只读**请求（`domain/shared/hosting.ts` 的 `hostingProbe` 决定打哪儿），
   * 绝不为了测一下就在用户桶里留垃圾对象。`message` 是给用户看的中文话术
   * （含 HTTP 状态码与"这一发到底验了什么/没验什么"）。
   */
  test(): Promise<{ ok: boolean; message: string }>
}

export interface LoggerPort {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void
}

/**
 * **本机人脸检测端口**。
 *
 * 与 `network` 那条路刻意分开：这件事**不出网**。它是 Web Worker 里的
 * MediaPipe BlazeFace（wasm + tflite，随包走），不花渠道、不依赖模型能力。
 *
 * 契约里最要紧的一条是**「认不出来不算失败」**：没有脸、浏览器跑不了 wasm、
 * 模型文件缺失，一律返回 `null`，由调用方走回退路径（问模型 / 手动框选）。
 * 只有「用户主动取消」才抛 `AbortError`。
 */
export interface FaceDetectionPort {
  /**
   * @param bytes 图片字节（调用方从素材库读出来，见 `AssetPort.read`）
   * @param mime  图片类型（解码时用得到）
   * @returns 本机检测结果；跑不起来 / 认不出来都是 `null`（这不是失败，是「没有」）
   */
  detectFaces(
    bytes: Uint8Array,
    mime: string,
    signal?: AbortSignal,
  ): Promise<FaceDetectionResult | null>
}

/**
 * 本机检测的**原始**结果：像素框 + 检测器实际解码出来的图片尺寸。
 *
 * 为什么把尺寸一起带回来：归一化（像素框 → 0–1）是**领域层**的事
 * （`normalizeDetectorBox`，有单测），而只有这里知道解码后到底多大 ——
 * 文件头读出来的尺寸与真正解码出来的可能差一点，用错那个会让框整体偏。
 * 平台层因此只负责「如实取回」，不做业务判断。
 */
export interface FaceDetectionResult {
  imageWidth: number
  imageHeight: number
  /** 像素框，相对图片左上角，可能多张 */
  faces: DetectorFaceRect[]
}

/**
 * 素材文件夹（对账 #196 / 方案 §7）。约定：
 *
 * - 文件名统一按 `assetFileName(hash, mime)` = `<hash>.<ext>`（`domain/shared/assetLocation`），
 *   **重传同一张图天然幂等**；
 * - `read` 返回 `null` 表示「这个文件不在文件夹里」——**必须与"读取失败"区分开**，
 *   因为这决定了界面该说「素材缺失」还是「读取出错」（不假装有图）；
 * - 目录句柄**只在内存里**：刷新 / 重启后要用户重新授权（浏览器安全模型如此），
 *   所以 `current()` 只回名字，`pick()` 是唯一的授权入口。
 */
export interface AssetFolderPort {
  /** 当前环境能不能选目录（没有 FSA 时为 false，调用方据此禁用入口） */
  supported(): boolean
  /** 本次会话已授权的目录（只有名字）；没授权过 = null */
  current(): { name: string } | null
  /**
   * 目录的**绝对路径**。**可选**：只有桌面壳有 —— 浏览器拿到的 FSA 句柄不给路径
   * （那是有意的隐私设计），所以也只有桌面壳能"在资源管理器里打开它"。
   */
  path?(): string | null
  /** 打开目录选择器；用户取消返回 null（取消不是错误） */
  pick(): Promise<{ name: string } | null>
  has(name: string): Promise<boolean>
  /** 文件不存在返回 null（＝素材缺失，而不是读取失败） */
  read(name: string): Promise<Blob | null>
  /** 写入（已存在则覆盖）；同名即同 hash ⇒ 覆盖是幂等的 */
  write(name: string, blob: Blob): Promise<void>
  /** 目录里的文件名清单（不含子目录）——「加载某个文件夹的内容」用 */
  list(): Promise<string[]>
}

/** 自动更新的四档状态（《轻画-桌面封装方案.md》§5 / 对账 #223） */
export type UpdateState = 'not-configured' | 'up-to-date' | 'available' | 'failed'

export interface UpdateStatus {
  state: UpdateState
  /** 装在用户机器上的版本（**不是**清单上的） */
  current: string
  /** 有新版时：清单上写的版本号 */
  version: string | null
  /** 有新版时：更新说明（可以没有） */
  notes: string | null
  /** `failed` 时的原话，如实显示、不吞 */
  error: string | null
}

/**
 * **自动更新端口**（方案 §5）。
 *
 * ⚠️ **可选**：只有桌面壳有 —— 浏览器里没有"安装新版本"这回事，
 * 调用方必须容忍它缺席（入口藏起来即可，别当错误）。
 *
 * 为什么"没配更新地址"要单独占一档：更新包放哪（GitHub Releases / 自有地址）还没定，
 * 这时候若回"已是最新"，用户会以为自动更新在守着 —— 其实一次都没查过。
 */
export interface UpdatePort {
  /** 查有没有新版（只查，不下载） */
  check(): Promise<UpdateStatus>
  /**
   * 下载 → 验签 → 安装。
   *
   * Windows 上安装器一起来**应用就会自己退出**（NSIS 会带 `/R` 重启），
   * 所以这个 Promise 通常**不会**正常返回 —— 调用方别把"没等到返回"当失败。
   */
  install(): Promise<void>
}

/**
 * **存储管理端口**（对账 #261）：只有桌面壳有。
 *
 * 四件事都是"只有壳能做"的：知道**数据目录的真实路径**、**在文件管理器里打开它**、
 * 量**网页缓存占用**、清掉它。浏览器里这些要么没有、要么不该做
 * （网页版的数据就活在浏览器里，没有"目录"这回事）⇒ 与 `updater` 一样是**可选端口**，
 * 调用方必须容错（界面上如实说"仅在桌面应用可用"，别当错误）。
 */
export interface StorageAdminPort {
  /** 数据目录绝对路径（项目 / 令牌 / 素材库都在里面） */
  dataDir(): Promise<string>
  /** 在系统文件管理器里打开一个目录（目录没了就抛错，由调用方如实展示） */
  openDir(path: string): Promise<void>
  /** 网页缓存占用（字节） */
  cacheUsage(): Promise<number>
  /** 清网页缓存，返回**实际**释放的字节数（删不掉的占用不算成绩） */
  clearCache(): Promise<number>
}

/** 一次本机 CLI 调用的请求（对账 #308） */
export interface CliRunRequest {
  /** 调用方给的编号：`kill` 按它找人；同一时刻可以并存多条 */
  id: string
  /** 命令名或完整路径。**不经过 shell**，所以带空格的路径要原样给、不要加引号 */
  program: string
  args: string[]
  /** 在哪个目录里跑；不填 = 应用当前目录 */
  cwd?: string
  /** 最长等多久；缺省 2 分钟，壳里再夹一次 [1s, 30min] */
  timeoutMs?: number
  /** 要喂给 stdin 的内容；不填就不给 stdin 管道（免得 CLI 一直等输入） */
  stdin?: string
}

/**
 * 一次调用的**如实**结果。
 *
 * 没有"假装成功"这一档：起不来就是 Promise reject（带一句人话），
 * 跑起来退码非零就如实回 `code` —— 调用方据此决定怎么说给用户听。
 */
export interface CliOutcome {
  /** 退出码；被信号杀掉、或系统没给码时为 null */
  code: number | null
  stdout: string
  stderr: string
  /** 到点被杀（不是失败，是"太久了"） */
  timedOut: boolean
  /** 被 `kill` 主动掐掉 */
  cancelled: boolean
  /** 实际耗时（毫秒） */
  ms: number
}

/**
 * **本机 CLI 端口**（对账 #308）。
 *
 * 三条约定：
 * 1. `which` **只看文件在不在，不执行任何东西** —— 它是"我填的命令对不对"的即时回答；
 * 2. `run` 的参数是一个数组、由壳直接交给 `Command::new(program).args(args)`，
 *    **不拼字符串、不过 shell** ⇒ 提示词里带引号 / 分号 / `$` 都不会变成命令注入；
 * 3. `kill` 找不到那条 = 它已经自己结束了 ⇒ 返回 `false`，**不算错误**。
 */
export interface CliPort {
  /** 找到就返回绝对路径，找不到返回 null（"没装"不是异常） */
  which(program: string): Promise<string | null>
  run(req: CliRunRequest): Promise<CliOutcome>
  kill(id: string): Promise<boolean>
  /**
   * 在一个**可见的控制台窗口**里跑命令（一键登录用）。
   *
   * 与 `run` 的区别是刻意的：不捕获输出、**不等它结束** —— 登录要么在浏览器里点授权、
   * 要么在终端里输密码，我们只需要把它"递到用户面前"，剩下的他自己在那个窗口里完成。
   * 立刻 resolve；起不来时抛一句人话（与 `run` 的 NotFound 文案同一套）。
   */
  spawnWindow(req: CliWindowRequest): Promise<void>
  /**
   * 给产物准备一个**可写**的目录（绝对路径）。
   *
   * 图 / 视频没法从 stdout 拿（各家 CLI 都写文件），所以参数模板里的 `{out}`
   * 要指向一个真实路径。壳里给的是 `<数据目录>/cli-out`，并且**只允许读回这个目录**
   * —— 前端拼的路径不能变成"任意文件读取"（见 Rust 侧 `cli_read_out` 的边界说明）。
   */
  outDir(): Promise<string>
  /** 把 CLI 写出来的产物读回来（base64 在壳内部解决，这里直接给字节） */
  readOut(path: string): Promise<Uint8Array>
  /**
   * 把 RunningHub CLI 的 API Key 写进**它自己的配置文件**（用户 2026-10-08 第 3 条：
   * 「runininghub 的 cli 是在 github 上找的，看看 github 上能不能把目前实现不了一键
   * 自动安装的 cli 给做好」）。
   *
   * 为什么需要它：官方 CLI 的登录是 `rh auth set-key <KEY>`，而 Key 是**位置参数**
   * —— 应用里不能这么调（本机约定：**密钥只走 stdin、不进 argv**：argv 会进进程列表、
   * 也会被别的工具记进历史）。于是壳改写**它自己认的那份配置**
   * （`%APPDATA%\rh\config.toml` 里的 `api_key` 行，见 `rh_cli/config.py` 的 `resolve_api_key`）。
   * 效果与用户手敲那条命令一致，而且是**持久的** —— 他自己的终端里 `rh` 也立刻是登录态。
   *
   * 路径由壳自己拼（前端给不了路径），所以这个能力动不了别的文件。
   * 返回写入的文件路径，供界面如实告知"写去哪儿了"。
   */
  rhSetApiKey(key: string): Promise<string>
}

/** 可见窗口里那条命令（一键登录 / 打开工具的交互界面） */
export interface CliWindowRequest {
  program: string
  args: string[]
  cwd?: string
}

/** 取远端字节的请求（只管一条 GET，不做缓存、不跟随业务） */
export interface RemoteBytesRequest {
  /** 完整地址（必须 http / https，端口实现侧会再挡一道） */
  url: string
  timeoutMs?: number
}

export interface RemoteBytesResponse {
  /** HTTP 状态码（原样回来，"算不算抓到"由调用方判断） */
  status: number
  /** 响应头里的 `Content-Type`；站点没给就是空串 */
  contentType: string
  bytes: Uint8Array
}

/**
 * **取远端字节端口**（对账 #396：用户问「上传图标能否给网站，然后自己去拉取抓图标下来？」）。
 *
 * 为什么不能直接用页面里的 `fetch`：跨域站点不给 `Access-Control-Allow-Origin` 时，
 * 浏览器（壳里的 WebView2 也算浏览器）**读不到字节** —— 实测见
 * `AssetPort.readUrl` 那条注释里记的 `net::ERR_FAILED`。桌面壳里有原生 HTTP 客户端，
 * 所以这一项**只有壳给得出**，与 `cli` / `storageAdmin` 一样是可选端口：
 * 浏览器里缺席时，界面照旧显示按钮位置，但如实写明"仅在桌面应用可用"并禁用。
 *
 * 边界（Rust 侧 `fetch_bytes` 是唯一实现）：只认 http / https、超时默认 8s、
 * 超过 512KB 直接拒 —— 它不是下载器，只服务"抓一张站点图标"这一件事。
 */
export interface RemoteBytesPort {
  get(req: RemoteBytesRequest): Promise<RemoteBytesResponse>
}

/**
 * **系统通知端口**（对账 #392：给桌面壳接真的通知插件）。
 *
 * 为什么需要它：壳里跑的是 WebView2，页面侧那个 `Notification` 的权限处理不可靠
 * （实测拿不到稳定状态）—— 想让"生成完成"真弹一条，得走**壳自己的通知能力**。
 * 浏览器里没有这一项（那就退回页面自带的 `Notification`，见
 * `features/shared/notify/desktopNotify.ts`）。
 *
 * 三条口径：
 * 1. **不自动申请权限** —— 申请会弹系统对话框，必须由用户在设置页按按钮触发；
 * 2. `state()` 只回答"现在能不能弹"：壳里读不到"被拒绝过"这个中间态时如实返回 `default`；
 * 3. `send()` 返回 false 只代表"这次没弹成"，**不改变页内提示** —— 那两件事互不依赖。
 */
export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported'

export interface NotifyPort {
  state(): Promise<NotifyPermission>
  /** 申请权限（**只能由用户手势触发**）；返回申请后的真实状态 */
  request(): Promise<NotifyPermission>
  /** 真的发一条；没权限 / 失败返回 false */
  send(title: string, body: string): Promise<boolean>
}

export interface PlatformKit {
  storage: StoragePort
  network: NetworkPort
  assets: AssetPort
  /**
   * **本机 CLI**（用户 2026-10-06 第 11 批第 4 条，对账 #308）：
   * 「我的要求和目的就是链接后能用里面的额度调用模型生成图片或者视频，或者对话，
   * runninghub 也要，**需要真的能跑本机的 cli**」。
   *
   * **可选**：只有桌面壳能起子进程 —— 浏览器里没有"子进程"这回事。
   * 缺席时界面**照旧显示**（用户要的"桌面专属能力也要看得见"），
   * 但如实写明"仅在桌面应用可用"，并且不去假装能跑。
   */
  cli?: CliPort
  /**
   * **素材文件夹端口**（对账 #196）：把「素材放在哪个位置 / 从哪个文件夹加载」抽出来。
   *
   * 与 `AssetPort` 的分工：`AssetPort` 是「hash → 字节」（内置库那条路，一直在），
   * 这里管的是「字节存在**磁盘上的哪个文件夹**」。浏览器实现走 File System Access
   * （选目录需要用户手势）；封装成桌面壳后换成原生目录读写 —— **同一端口两个实现**，
   * 与「只换平台层」那条架构约定一致。
   *
   * **可选**：受限环境（无 FSA / 无权限）没有这一项，调用方必须容错并禁用入口。
   */
  assetFolder?: AssetFolderPort
  /** 自动更新。**可选**：只有桌面壳有（浏览器里没有"安装新版本"这回事） */
  updater?: UpdatePort
  /** 存储管理（数据目录路径 / 打开目录 / 网页缓存）。**可选**：只有桌面壳有 */
  storageAdmin?: StorageAdminPort
  /**
   * 取远端字节（对账 #396：从网站抓站点图标）。**可选**：只有桌面壳有，
   * 理由见 `RemoteBytesPort` 那段 —— 浏览器里跨域读不到，调用方必须容错并禁用入口。
   */
  remoteBytes?: RemoteBytesPort
  /**
   * 系统通知（对账 #392）。**可选**：只有桌面壳接了这个插件；浏览器里缺席，
   * 调用方按"没有端口"退回页面自带的 `Notification`。
   */
  notify?: NotifyPort
  /** 素材传输（图床）：把本地字节换成公网直链；没配图床时 `upload` 返回 null */
  hosting: HostingPort
  credentials: CredentialPort
  files: FilePort
  logger: LoggerPort
  /**
   * 本机人脸检测。**可选**：只有真浏览器跑得起来（要 Worker + wasm + ImageBitmap），
   * 测试用的内存平台没有这一项 —— 调用方必须容忍它缺席。
   */
  vision?: FaceDetectionPort
}

/** 渠道配置的「安全形态」：明文令牌由凭据层在调用前注入，业务代码与 UI 全程不接触 */
export interface SafeChannelConfig {
  id: string
  protocol: string
  /**
   * 该渠道协议的定义（内置或自建）。渠道一建好就带上它，适配器因此不必再查全局表，
   * 也就不会出现「界面认识这条自建协议、适配器不认识」的半认识状态。
   */
  protocolDefinition?: ProtocolDefinition
  baseUrl: string
  credentialRef: string | null
  modelCache?: ModelCapability[]
}
