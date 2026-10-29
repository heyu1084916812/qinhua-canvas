/** 模型发起的一次工具调用；画布循环与共享控制器共用。 */
export interface AgentToolRequest {
  callId: string
  name: string
  args: unknown
}
