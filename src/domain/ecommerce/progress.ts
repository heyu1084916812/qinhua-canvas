/** 电商出图的可观测阶段。UI 只读这一份词表，不在页面里另拼状态。 */
export type EcommerceGenerationPhase =
  | 'validate'
  | 'analyze'
  | 'prompts'
  | 'workflow'
  | 'generate'
  | 'done'
  | 'failed'

export interface EcommerceGenerationStage {
  phase: EcommerceGenerationPhase
  label: string
  detail?: string
  current?: number
  total?: number
}
