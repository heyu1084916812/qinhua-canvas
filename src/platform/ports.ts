import type { AppError } from '../shared/result'
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
  estimateUsage(): Promise<{ used: number; quota: number }>
}

export interface NetworkRequest {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
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
}

export interface LoggerPort {
  log(level: LogLevel, message: string, meta?: Record<string, unknown>): void
}

export interface PlatformKit {
  storage: StoragePort
  network: NetworkPort
  assets: AssetPort
  /** 素材传输（图床）：把本地字节换成公网直链；没配图床时 `upload` 返回 null */
  hosting: HostingPort
  credentials: CredentialPort
  files: FilePort
  logger: LoggerPort
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
