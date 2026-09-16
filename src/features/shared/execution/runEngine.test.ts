/**
 * runEngine 的**回调参数契约**（2026-09-17 修的真 bug）。
 *
 * 起因：`onTaskTarget` 的引擎侧签名是三参 `(planId, taskId, targetId)`，
 * 而 useExecution 侧按两参 `(taskId, targetId)` 接——于是 taskId 位收到的是 planId。
 * 宿主拿 planId 去本计划的 taskId→nodeId 表查，永远 `undefined`，
 * 「状态改绑到真正收产物的节点」整条逻辑**从未生效**。
 *
 * 这类签名错配不会报错、单看任一侧都对，只有两侧对上才暴露。
 * 故这里用「宿主按真实签名查表」的方式把契约钉死：
 * 表里有这个 taskId 才算通过，而它只有参数没错位时才查得到。
 */
import { describe, it, expect } from 'vitest'
import { runEngine, type RunTaskState } from './runEngine'
import type { RunTask, RunPlan } from '../../../domain/shared/execution/plan'
import type { NodeInput } from '../../../domain/shared/execution/types'

/** 最小可用的落位适配器：把 task 的落点改到 targetId（模拟「另建承载节点」） */
const CARRIER = 'carrier-node'

function makePlan(): RunPlan<RunTask> {
  const task: RunTask = {
    id: 'task_1',
    nodeId: 'source-node',
    request: { kind: 'image', channelId: 'c', model: 'm', prompt: 'p', inputs: [] as NodeInput[], params: {} },
    dependsOn: [],
    fingerprint: 'fp',
    params: {},
  }
  return { id: 'plan_1', tasks: [task], scope: 'node', mode: 'single', newDownstream: false }
}

describe('runEngine / 回调参数契约', () => {
  it('★ onTaskTarget 三参到位：(planId, taskId, targetId)', async () => {
    const plan = makePlan()
    const seen: { planId: string; taskId: string; targetId: string }[] = []
    await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      channelResolver: () =>
        ({
          protocol: 'mock',
          async generateImage() {
            return [
              {
                hash: 'h1',
                mime: 'image/png',
                bytes: new Uint8Array([1, 2, 3]),
                width: 4,
                height: 4,
              },
            ]
          },
        }) as never,
      writeBack: () => {},
      placement: {
        begin: () => ({ targetId: CARRIER, commands: [] }),
        commit: () => [],
        shouldCollect: () => false,
        record: () => null,
        finalize: () => [],
      },
      onTaskTarget: (planId, taskId, targetId) => {
        seen.push({ planId, taskId, targetId })
      },
      now: () => 0,
      wait: () => Promise.resolve(),
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.planId).toBe('plan_1')
    // 关键：taskId 必须是 **task 的 id**，不能是 planId（错位时这里会等于 'plan_1'）
    expect(seen[0]!.taskId).toBe('task_1')
    expect(seen[0]!.targetId).toBe(CARRIER)
  })

  it('★ onTaskUpdate 的 taskId 同样不是 planId', async () => {
    const plan = makePlan()
    const taskIds = new Set<string>()
    const planIds = new Set<string>()
    await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      channelResolver: () =>
        ({
          protocol: 'mock',
          async generateImage() {
            return [{ hash: 'h1', mime: 'image/png', bytes: new Uint8Array([1]) }]
          },
        }) as never,
      writeBack: () => {},
      placement: {
        begin: () => ({ targetId: CARRIER, commands: [] }),
        commit: () => [],
        shouldCollect: () => false,
        record: () => null,
        finalize: () => [],
      },
      onTaskUpdate: (planId, taskId, _state: RunTaskState) => {
        planIds.add(planId)
        taskIds.add(taskId)
      },
      now: () => 0,
      wait: () => Promise.resolve(),
    })
    expect([...planIds]).toEqual(['plan_1'])
    expect([...taskIds]).toEqual(['task_1'])
  })

  it('★ queued 不在落点确定前广播（源节点不会平白转圈）', async () => {
    const plan = makePlan()
    const order: string[] = []
    await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      channelResolver: () =>
        ({
          protocol: 'mock',
          async generateImage() {
            return [{ hash: 'h1', mime: 'image/png', bytes: new Uint8Array([1]) }]
          },
        }) as never,
      writeBack: () => {},
      placement: {
        begin: () => {
          order.push('begin')
          return { targetId: CARRIER, commands: [] }
        },
        commit: () => [],
        shouldCollect: () => false,
        record: () => null,
        finalize: () => [],
      },
      onTaskTarget: () => {
        order.push('target')
      },
      onTaskUpdate: (_planId, _taskId, state) => {
        order.push(state.kind)
      },
      now: () => 0,
      wait: () => Promise.resolve(),
    })
    // begin（决定落点）→ target（改绑）→ 之后才有 queued/running/succeeded
    expect(order.indexOf('begin')).toBeLessThan(order.indexOf('target'))
    expect(order.indexOf('target')).toBeLessThan(order.indexOf('queued'))
    expect(order.filter((x) => x === 'queued')).toHaveLength(1)
  })

  /**
   * 复刻宿主 CanvasExecutionProvider 的**真实用法**：拿 planId 取表、拿 taskId 查行。
   *
   * 这一条才是「签名错配」真正会崩的那一环——单看 taskId 的值对不对还不够，
   * 必须证明「宿主按这个参数组合能查到东西」。错位时 `m.get(taskId)` 为 undefined，
   * 改绑被整个跳过（状态留在源节点），而两个值各自看起来都「像 id」。
   */
  it('★ 宿主按 (planId 取表, taskId 查行) 能查到，且改绑后状态落在承载节点', async () => {
    const plan = makePlan()
    // 宿主侧的映射表，与 CanvasExecutionProvider 同款：planId → (taskId → nodeId)
    const table = new Map<string, Map<string, string>>([
      [plan.id, new Map(plan.tasks.map((t) => [t.id, t.nodeId]))],
    ])
    const stateOwner: { nodeId: string | null } = { nodeId: null }

    await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      channelResolver: () =>
        ({
          protocol: 'mock',
          async generateImage() {
            return [{ hash: 'h1', mime: 'image/png', bytes: new Uint8Array([1]) }]
          },
        }) as never,
      writeBack: () => {},
      placement: {
        begin: () => ({ targetId: CARRIER, commands: [] }),
        commit: () => [],
        shouldCollect: () => false,
        record: () => null,
        finalize: () => [],
      },
      onTaskTarget: (planId, taskId, targetId) => {
        const m = table.get(planId)
        // 参数错位时这里是 undefined —— 改绑被跳过，状态留在源节点
        if (m && m.has(taskId)) m.set(taskId, targetId)
      },
      onTaskUpdate: (planId, taskId) => {
        const m = table.get(planId)
        const nodeId = m?.get(taskId)
        if (nodeId) stateOwner.nodeId = nodeId
      },
      now: () => 0,
      wait: () => Promise.resolve(),
    })

    // 改绑生效 ⇒ 最终状态挂在承载节点上，而不是源节点
    expect(stateOwner.nodeId).toBe(CARRIER)
    expect(stateOwner.nodeId).not.toBe('source-node')
  })
})
