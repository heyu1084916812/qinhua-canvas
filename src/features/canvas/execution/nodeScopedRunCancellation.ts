export interface NodeScopedRunCancellation {
  trackPlan(planId: string, nodeIds: Iterable<string>): void
  addTarget(planId: string, nodeId: string): void
  cancelForNode(nodeId: string, cancelPlan: (planId: string) => void): string[]
  release(planId: string): void
}

/**
 * Keeps cancellation scoped to the node that owns a running plan.
 *
 * A node can be associated with multiple concurrent plans, and a plan can gain
 * extra carrier nodes after placement. Both directions therefore use sets.
 */
export function createNodeScopedRunCancellation(): NodeScopedRunCancellation {
  const nodesByPlan = new Map<string, Set<string>>()
  const plansByNode = new Map<string, Set<string>>()

  const addLink = (planId: string, nodeId: string) => {
    const nodes = nodesByPlan.get(planId) ?? new Set<string>()
    nodes.add(nodeId)
    nodesByPlan.set(planId, nodes)

    const plans = plansByNode.get(nodeId) ?? new Set<string>()
    plans.add(planId)
    plansByNode.set(nodeId, plans)
  }

  const release = (planId: string) => {
    const nodes = nodesByPlan.get(planId)
    if (!nodes) return
    for (const nodeId of nodes) {
      const plans = plansByNode.get(nodeId)
      if (!plans) continue
      plans.delete(planId)
      if (plans.size === 0) plansByNode.delete(nodeId)
    }
    nodesByPlan.delete(planId)
  }

  return {
    trackPlan(planId, nodeIds) {
      release(planId)
      for (const nodeId of nodeIds) {
        if (nodeId) addLink(planId, nodeId)
      }
    },
    addTarget(planId, nodeId) {
      if (nodeId) addLink(planId, nodeId)
    },
    cancelForNode(nodeId, cancelPlan) {
      const planIds = [...(plansByNode.get(nodeId) ?? [])]
      for (const planId of planIds) cancelPlan(planId)
      return planIds
    },
    release,
  }
}
