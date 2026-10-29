import type { ContextBundle, ContextMemory } from '../../../domain/shared/context'
import {
  memoryCandidateProblems,
  type MemoryCandidate,
} from '../../../domain/shared/memoryOrganizer'
import type { ContextRepository } from '../../../state/shared/contextRepository'

export interface AgentMemoryPort {
  /** 读取已按作用域、冲突和字符预算裁剪的上下文。 */
  read(input: Parameters<ContextRepository['bundleForProject']>[0]): Promise<ContextBundle>
  /** 只接受用户确认后的候选；Harness 不能直接持有记忆仓储。 */
  remember(candidate: MemoryCandidate): Promise<ContextMemory>
}

export function createAgentMemoryPort(
  repository: Pick<ContextRepository, 'bundleForProject' | 'createMemory'>,
): AgentMemoryPort {
  return {
    read(input) {
      return repository.bundleForProject(input)
    },
    async remember(candidate) {
      const problems = memoryCandidateProblems(candidate)
      if (problems.length > 0) {
        throw new Error(problems.join('；'))
      }
      return repository.createMemory({
        kind: candidate.kind,
        text: candidate.text,
        scope: candidate.scope,
        ...(candidate.workbench ? { workbench: candidate.workbench } : {}),
        ...(candidate.projectId ? { projectId: candidate.projectId } : {}),
        ...(candidate.sessionId ? { sessionId: candidate.sessionId } : {}),
        ...(candidate.key ? { key: candidate.key } : {}),
        ...(candidate.expiresAt ? { expiresAt: candidate.expiresAt } : {}),
        ...(candidate.replaceMemoryId
          ? { replaceMemoryId: candidate.replaceMemoryId }
          : {}),
        source: 'agent',
        confidence: candidate.confidence,
      })
    },
  }
}
