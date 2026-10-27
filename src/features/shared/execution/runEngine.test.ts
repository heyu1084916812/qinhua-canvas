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
import { describe, it, expect, vi } from 'vitest'
import { runEngine, type RunTaskState } from './runEngine'
import type { RunTask, RunPlan } from '../../../domain/shared/execution/plan'
import type {
  NodeInput,
  RunRequest,
} from '../../../domain/shared/execution/types'
import type {
  RunRecord,
  RunRecordScope,
} from '../../../domain/shared/execution/runRecord'

/** 最小可用的落位适配器：把 task 的落点改到 targetId（模拟「另建承载节点」） */
const CARRIER = 'carrier-node'

function scopeOf(
  plan: RunPlan<RunTask>,
  _task: RunTask,
  targetId: string,
): RunRecordScope {
  return {
    scopeVersion: 1,
    workbench: 'canvas',
    subjectId: targetId,
    scopeId: `plan:${plan.id}`,
    operationId: plan.id,
  }
}

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
  it('★★ 生图网络超时只调用一次，不自动重复提交付费请求', async () => {
    const plan = makePlan()
    let calls = 0
    const summary = await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
      channelResolver: () =>
        ({
          protocol: 'mock',
          async generateImage() {
            calls += 1
            throw { kind: 'network', detail: 'timeout' }
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
      policy: { maxRetries: 2, backoffBase: 1 },
      now: () => 0,
      wait: () => Promise.resolve(),
    })
    expect(calls).toBe(1)
    expect(summary.failed).toBe(1)
    expect(summary.records[0]?.errorText).toContain('超时')
    expect(summary.records[0]).toMatchObject({
      nodeId: CARRIER,
      workbench: 'canvas',
      subjectId: CARRIER,
      scopeId: 'plan:plan_1',
      operationId: 'plan_1',
      routePlanId: 'plan_1',
      routeAttempts: [
        {
          attempt: 1,
          status: 'failed',
          errorKind: 'network',
          sendPhase: 'unknown',
        },
      ],
    })
  })

  it('★★ 作用域在任何落位副作用与渠道请求前解析，并使用真实落点作为主体', async () => {
    const plan = makePlan()
    const order: string[] = []
    const summary = await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: (currentPlan, task, targetId) => {
        order.push('scope')
        return scopeOf(currentPlan, task, targetId)
      },
      channelResolver: () => {
        order.push('channel')
        return {
          protocol: 'mock',
          async generateImage() {
            return [{ hash: 'h1', mime: 'image/png', bytes: new Uint8Array([1]) }]
          },
        } as never
      },
      writeBack: () => {
        order.push('write')
      },
      placement: {
        begin: () => ({ targetId: CARRIER, commands: ['landing'] }),
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

    expect(order.indexOf('scope')).toBeLessThan(order.indexOf('write'))
    expect(order.indexOf('scope')).toBeLessThan(order.indexOf('target'))
    expect(order.indexOf('scope')).toBeLessThan(order.indexOf('queued'))
    expect(order.indexOf('scope')).toBeLessThan(order.indexOf('channel'))
    expect(summary.records[0]).toMatchObject({
      nodeId: CARRIER,
      subjectId: CARRIER,
    })
  })

  it('★★ HTTP 408 不自动重发付费请求', async () => {
    const plan = makePlan()
    let calls = 0
    const summary = await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
      channelResolver: () => ({
        protocol: 'mock',
        async generateImage() {
          calls += 1
          throw { kind: 'http', status: 408 }
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
      policy: { maxRetries: 2, backoffBase: 1 },
      now: () => 0,
      wait: () => Promise.resolve(),
    })

    expect(calls).toBe(1)
    expect(summary.failed).toBe(1)
    expect(summary.records[0]?.routeAttempts).toMatchObject([
      {
        attempt: 1,
        status: 'failed',
      },
    ])
  })

  it('★ 同渠道多 Key 分组遇到 403 按优先级换组；只换到下一组一次', async () => {
    const plan = makePlan()
    plan.tasks[0]!.params = { model: 'GPT Logical' }
    plan.tasks[0]!.request.credentialGroupIds = ['chat-primary', 'chat-backup']
    const attempts: number[] = []
    let calls = 0
    const summary = await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
      channelResolver: (request) => {
        attempts.push(request.routingAttempt ?? -1)
        return {
          protocol: 'mock',
          async generateImage() {
            calls += 1
            if (calls === 1) throw { kind: 'http', status: 403 }
            return [{ hash: 'h1', mime: 'image/png', bytes: new Uint8Array([1]) }]
          },
        } as never
      },
      writeBack: () => {},
      placement: {
        begin: () => ({ targetId: CARRIER, commands: [] }),
        commit: () => [],
        shouldCollect: () => false,
        record: () => null,
        finalize: () => [],
      },
      policy: { maxRetries: 0, backoffBase: 1 },
      now: () => 0,
      wait: () => Promise.resolve(),
    })
    expect(attempts).toEqual([0, 1])
    expect(calls).toBe(2)
    expect(summary.succeeded).toBe(1)
    expect(summary.records[0]).toMatchObject({
      nodeId: CARRIER,
      workbench: 'canvas',
      subjectId: CARRIER,
      scopeId: 'plan:plan_1',
      operationId: 'plan_1',
      routePlanId: 'plan_1',
      credentialGroupId: 'chat-backup',
      routeAttempts: [
        {
          attempt: 1,
          credentialGroupId: 'chat-primary',
          requestedModel: 'GPT Logical',
          sentModel: 'm',
          status: 'failed',
          errorKind: 'http',
          httpStatus: 403,
          sendPhase: 'rejected',
        },
        {
          attempt: 2,
          credentialGroupId: 'chat-backup',
          requestedModel: 'GPT Logical',
          sentModel: 'm',
          status: 'succeeded',
          sendPhase: 'accepted',
        },
      ],
    })
  })

  it('★ RoutePlan 跨渠道遇到 403 后按候选顺序切到下一渠道，并使用该渠道自己的上游模型', async () => {
    const plan = makePlan()
    const task = plan.tasks[0]!
    task.request = {
      ...task.request,
      routePlanId: 'route_plan_1',
      logicalModel: 'GPT Image 2',
      routeCandidates: [
        { channelId: 'relay-a', credentialGroupId: 'a1', model: 'upstream-a' },
        { channelId: 'relay-b', credentialGroupId: 'b1', model: 'upstream-b' },
      ],
    }
    const seen: { channelId: string; model: string; group?: string }[] = []
    const summary = await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
      channelResolver: (request) => {
        seen.push({
          channelId: request.channelId,
          model: request.model,
          ...(request.credentialGroupId
            ? { group: request.credentialGroupId }
            : {}),
        })
        return {
          protocol: 'mock',
          async generateImage() {
            if (request.channelId === 'relay-a') {
              throw { kind: 'http', status: 403 }
            }
            return [{ hash: 'h1', mime: 'image/png', bytes: new Uint8Array([1]) }]
          },
        } as never
      },
      writeBack: () => {},
      placement: {
        begin: () => ({ targetId: CARRIER, commands: [] }),
        commit: () => [],
        shouldCollect: () => false,
        record: () => null,
        finalize: () => [],
      },
      policy: { maxRetries: 2, backoffBase: 1 },
      now: () => 0,
      wait: () => Promise.resolve(),
    })

    expect(seen).toEqual([
      { channelId: 'relay-a', model: 'upstream-a', group: 'a1' },
      { channelId: 'relay-b', model: 'upstream-b', group: 'b1' },
    ])
    expect(summary.succeeded).toBe(1)
    expect(summary.records[0]).toMatchObject({
      routePlanId: 'route_plan_1',
      sentChannelId: 'relay-b',
      sentModel: 'upstream-b',
      credentialGroupId: 'b1',
      routeAttempts: [
        {
          attempt: 1,
          channelId: 'relay-a',
          requestedModel: 'GPT Image 2',
          sentModel: 'upstream-a',
          status: 'failed',
          httpStatus: 403,
        },
        {
          attempt: 2,
          channelId: 'relay-b',
          requestedModel: 'GPT Image 2',
          sentModel: 'upstream-b',
          status: 'succeeded',
        },
      ],
    })
  })

  it('★★ RoutePlan 有后续候选时，网络超时仍只提交一次', async () => {
    const plan = makePlan()
    plan.tasks[0]!.request = {
      ...plan.tasks[0]!.request,
      routeCandidates: [
        { channelId: 'relay-a', model: 'upstream-a' },
        { channelId: 'relay-b', model: 'upstream-b' },
      ],
    }
    let calls = 0
    const summary = await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
      channelResolver: () =>
        ({
          protocol: 'mock',
          async generateImage() {
            calls += 1
            throw { kind: 'network', detail: 'timeout' }
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
      policy: { maxRetries: 2, backoffBase: 1 },
      now: () => 0,
      wait: () => Promise.resolve(),
    })

    expect(calls).toBe(1)
    expect(summary.failed).toBe(1)
  })

  it('★★ 多分组时网络超时仍不换组，避免付费请求重复提交', async () => {
    const plan = makePlan()
    plan.tasks[0]!.request.credentialGroupIds = ['chat-primary', 'chat-backup']
    let calls = 0
    const summary = await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
      channelResolver: () =>
        ({
          protocol: 'mock',
          async generateImage() {
            calls += 1
            throw { kind: 'network', detail: 'timeout' }
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
      policy: { maxRetries: 2, backoffBase: 1 },
      now: () => 0,
      wait: () => Promise.resolve(),
    })
    expect(calls).toBe(1)
    expect(summary.failed).toBe(1)
  })

  it('★ onTaskTarget 三参到位：(planId, taskId, targetId)', async () => {
    const plan = makePlan()
    const seen: { planId: string; taskId: string; targetId: string }[] = []
    await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
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
      recordScope: scopeOf,
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

  /**
   * 「N张」应当**同时开工**（用户 2026-09-17）：N 个承载节点同时出现、同时转圈，
   * 而不是「出完一张才冒出下一个」。
   *
   * 判据：所有 task 的 queued/running 必须在**任何一次 succeeded 之前**全部到位。
   * 串行实现下，第 2 个 task 的 queued 会晚于第 1 个 task 的 succeeded，
   * 这条断言立刻变红。
   */
  it('★ 多任务同时开工：全部 running 先落地，才有 succeeded', async () => {
    const tasks: RunTask[] = [0, 1, 2].map((i) => ({
      ...makePlan().tasks[0]!,
      id: `task_${i}`,
      seq: i,
    }))
    const plan: RunPlan<RunTask> = { id: 'plan_1', tasks, scope: 'node', mode: 'single', newDownstream: false }

    const events: string[] = []
    await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
      channelResolver: () =>
        ({
          protocol: 'mock',
          // 每张延迟一点点，串行实现下会明显错开
          async generateImage() {
            await new Promise((r) => setTimeout(r, 10))
            return [{ hash: 'h', mime: 'image/png', bytes: new Uint8Array([1]) }]
          },
        }) as never,
      writeBack: () => {},
      placement: {
        begin: (task: RunTask) => ({ targetId: `carrier-${task.id}`, commands: [] }),
        commit: () => [],
        shouldCollect: () => false,
        record: () => null,
        finalize: () => [],
      },
      onTaskUpdate: (_planId, _taskId, state) => {
        events.push(state.kind)
      },
      now: () => 0,
      wait: () => Promise.resolve(),
    })

    const firstSucceeded = events.indexOf('succeeded')
    const runningCount = events.slice(0, firstSucceeded).filter((e) => e === 'running').length
    expect(runningCount).toBe(3)
    expect(firstSucceeded).toBeGreaterThanOrEqual(3)
  })

  it('★ queued 不在落点确定前广播（源节点不会平白转圈）', async () => {
    const plan = makePlan()
    const order: string[] = []
    await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
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
      recordScope: scopeOf,
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

  it.each(['cors', 'dns', 'tls'] as const)(
    'network %s after POST is unknown and is not resubmitted',
    async (detail) => {
      const plan = makePlan()
      let calls = 0
      const summary = await runEngine(plan, {
        signal: new AbortController().signal,
        projectId: 'p1',
        recordScope: scopeOf,
        channelResolver: () =>
          ({
            protocol: 'mock',
            async generateImage() {
              calls += 1
              throw { kind: 'network', detail, sendPhase: 'unknown' }
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
        policy: { maxRetries: 2, backoffBase: 1 },
        now: () => 0,
        wait: () => Promise.resolve(),
      })

      expect(calls).toBe(1)
      expect(summary.failed).toBe(1)
    },
  )

  it('only a proven not-sent network error is retried', async () => {
    const plan = makePlan()
    let calls = 0
    const summary = await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
      channelResolver: () =>
        ({
          protocol: 'mock',
          async generateImage() {
            calls += 1
            if (calls === 1) {
              throw { kind: 'network', detail: 'aborted', sendPhase: 'not-sent' }
            }
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
      policy: { maxRetries: 1, backoffBase: 1 },
      now: () => 0,
      wait: () => Promise.resolve(),
    })

    expect(calls).toBe(2)
    expect(summary.succeeded).toBe(1)
  })

  it('execution accepted is terminal and never resubmits the paid request', async () => {
    const plan = makePlan()
    let calls = 0
    const summary = await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
      channelResolver: () =>
        ({
          protocol: 'mock',
          async generateImage() {
            calls += 1
            throw { kind: 'execution', detail: 'accepted', message: 'task may exist upstream' }
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
      policy: { maxRetries: 2, backoffBase: 1 },
      now: () => 0,
      wait: () => Promise.resolve(),
    })

    expect(calls).toBe(1)
    expect(summary.failed).toBe(1)
  })
})

describe('runEngine / 拓扑依赖', () => {
  function deferredSignal(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    return { promise, resolve }
  }

  async function within(promise: Promise<void>, label: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`等待超时：${label}`)),
        500,
      )
      promise.then(
        () => {
          clearTimeout(timer)
          resolve()
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  }

  function dependencyTask(id: string, dependsOn: string[] = []): RunTask {
    return {
      id,
      nodeId: `subject-${id}`,
      request: {
        kind: 'image',
        channelId: 'c',
        model: 'm',
        prompt: id,
        inputs: [],
        params: {},
      },
      dependsOn,
      fingerprint: `fp-${id}`,
      params: {},
    }
  }

  const placement = {
    begin: (task: RunTask) => ({ targetId: task.nodeId, commands: [] }),
    commit: () => [],
    shouldCollect: () => false,
    record: (_task: RunTask, _targetId: string, record: RunRecord) =>
      record as never,
    finalize: () => [],
  }

  it('依赖任务必须在前置任务成功后启动，即使数组顺序相反', async () => {
    const calls: string[] = []
    const plan: RunPlan<RunTask> = {
      id: 'plan-deps',
      scope: 'node',
      mode: 'single',
      tasks: [
        dependencyTask('child', ['parent']),
        dependencyTask('parent'),
      ],
    }
    const summary = await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
      channelResolver: () =>
        ({
          protocol: 'mock',
          async generateImage(request: RunRequest) {
            calls.push(request.prompt)
            return [
              {
                hash: request.prompt,
                mime: 'image/png',
                bytes: new Uint8Array([1]),
              },
            ]
          },
        }) as never,
      writeBack: () => {},
      placement,
      now: () => 0,
    })

    expect(calls).toEqual(['parent', 'child'])
    expect(summary.succeeded).toBe(2)
    expect(summary.taskResults.map((item) => item.taskId)).toEqual([
      'parent',
      'child',
    ])
  })

  it('零依赖任务在同一波次并发启动，数组顺序不隐式串行', async () => {
    let active = 0
    let maxActive = 0
    const plan: RunPlan<RunTask> = {
      id: 'plan-independent',
      scope: 'node',
      mode: 'single',
      tasks: [dependencyTask('a'), dependencyTask('b')],
    }
    const summary = await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
      channelResolver: () =>
        ({
          protocol: 'mock',
          async generateImage(request: RunRequest) {
            active += 1
            maxActive = Math.max(maxActive, active)
            await new Promise((resolve) => setTimeout(resolve, 0))
            active -= 1
            return [
              {
                hash: request.prompt,
                mime: 'image/png',
                bytes: new Uint8Array([1]),
              },
            ]
          },
        }) as never,
      writeBack: () => {},
      placement,
      now: () => 0,
    })

    expect(maxActive).toBe(2)
    expect(summary.succeeded).toBe(2)
  })

  it('同一波次先完成的任务立即写回留痕，不等待慢任务', async () => {
    let releaseSlow!: () => void
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })
    let slowFinished = false
    let markFastRecorded!: () => void
    const fastRecorded = new Promise<void>((resolve) => {
      markFastRecorded = resolve
    })
    const plan: RunPlan<RunTask> = {
      id: 'plan-early-settle',
      scope: 'node',
      mode: 'single',
      tasks: [dependencyTask('fast'), dependencyTask('slow')],
    }
    const running = runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
      channelResolver: () =>
        ({
          protocol: 'mock',
          async generateImage(request: RunRequest) {
            if (request.prompt === 'slow') {
              await slowGate
              slowFinished = true
            }
            return [
              {
                hash: request.prompt,
                mime: 'image/png',
                bytes: new Uint8Array([1]),
              },
            ]
          },
        }) as never,
      writeBack: (commands) => {
        if (
          commands.some(
            (command) =>
              (command as unknown as RunRecord).taskId === 'fast',
          )
        ) {
          markFastRecorded()
        }
      },
      placement,
      now: () => 0,
    })

    await fastRecorded
    expect(slowFinished).toBe(false)
    releaseSlow()
    await running
  })

  it('前置失败时后续任务不触网，并以依赖失败收口', async () => {
    const calls: string[] = []
    const plan: RunPlan<RunTask> = {
      id: 'plan-deps-fail',
      scope: 'node',
      mode: 'single',
      tasks: [
        dependencyTask('parent'),
        dependencyTask('child', ['parent']),
      ],
    }
    const summary = await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
      channelResolver: () =>
        ({
          protocol: 'mock',
          async generateImage(request: RunRequest) {
            calls.push(request.prompt)
            throw { kind: 'http', status: 500, body: '上游失败' }
          },
        }) as never,
      writeBack: () => {},
      placement,
      policy: { maxRetries: 0 },
      now: () => 0,
    })

    expect(calls).toEqual(['parent'])
    expect(summary.failed).toBe(2)
    expect(summary.taskResults[1]?.state).toMatchObject({
      kind: 'failed',
      error: {
        kind: 'validation',
        field: 'dependsOn',
      },
    })
    expect(summary.records).toHaveLength(1)
  })

  it('前置成功后立即启动后继，不被同层无关慢任务阻塞', async () => {
    const slowGate = deferredSignal()
    const childStarted = deferredSignal()
    let slowFinished = false
    const plan: RunPlan<RunTask> = {
      id: 'plan-ready-after-parent',
      scope: 'node',
      mode: 'single',
      tasks: [
        dependencyTask('parent'),
        dependencyTask('slow'),
        dependencyTask('child', ['parent']),
      ],
    }
    const running = runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
      channelResolver: () =>
        ({
          protocol: 'mock',
          async generateImage(request: RunRequest) {
            if (request.prompt === 'slow') {
              await slowGate.promise
              slowFinished = true
            }
            if (request.prompt === 'child') childStarted.resolve()
            return [
              {
                hash: request.prompt,
                mime: 'image/png',
                bytes: new Uint8Array([1]),
              },
            ]
          },
        }) as never,
      writeBack: () => {},
      placement,
      now: () => 0,
    })

    try {
      await within(childStarted.promise, 'child start')
      expect(slowFinished).toBe(false)
    } finally {
      slowGate.resolve()
    }
    const summary = await running

    expect(summary.succeeded).toBe(3)
    expect(summary.taskResults.map((item) => item.taskId)).toEqual([
      'parent',
      'slow',
      'child',
    ])
  })

  it('独立慢任务不拖住快任务落库，最终结算仍按稳定顺序', async () => {
    const slowGate = deferredSignal()
    const fastRecorded = deferredSignal()
    let slowFinished = false
    let active = 0
    let maxActive = 0
    const plan: RunPlan<RunTask> = {
      id: 'plan-stable-settlement',
      scope: 'node',
      mode: 'single',
      tasks: [dependencyTask('slow'), dependencyTask('fast')],
    }
    const running = runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
      channelResolver: () =>
        ({
          protocol: 'mock',
          async generateImage(request: RunRequest) {
            active += 1
            maxActive = Math.max(maxActive, active)
            if (request.prompt === 'slow') {
              await slowGate.promise
              slowFinished = true
            }
            active -= 1
            return [
              {
                hash: request.prompt,
                mime: 'image/png',
                bytes: new Uint8Array([1]),
              },
            ]
          },
        }) as never,
      writeBack: (commands) => {
        if (
          commands.some(
            (command) =>
              (command as unknown as RunRecord).taskId === 'fast',
          )
        ) {
          fastRecorded.resolve()
        }
      },
      placement,
      now: () => 0,
    })

    try {
      await within(fastRecorded.promise, 'fast record')
      expect(maxActive).toBe(2)
      expect(slowFinished).toBe(false)
    } finally {
      slowGate.resolve()
    }
    const summary = await running

    expect(summary.taskResults.map((item) => item.taskId)).toEqual([
      'slow',
      'fast',
    ])
    expect(summary.records.map((record) => record.taskId)).toEqual([
      'slow',
      'fast',
    ])
  })

  it('一个分支失败只阻断其下游，无关慢任务和成功结果继续结算', async () => {
    const slowGate = deferredSignal()
    const downstreamFailed = deferredSignal()
    let slowFinished = false
    const plan: RunPlan<RunTask> = {
      id: 'plan-partial-success',
      scope: 'node',
      mode: 'single',
      tasks: [
        dependencyTask('slow-success'),
        dependencyTask('failed-parent'),
        dependencyTask('blocked-child', ['failed-parent']),
      ],
    }
    const running = runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
      channelResolver: () =>
        ({
          protocol: 'mock',
          async generateImage(request: RunRequest) {
            if (request.prompt === 'slow-success') {
              await slowGate.promise
              slowFinished = true
              return [
                {
                  hash: 'slow',
                  mime: 'image/png',
                  bytes: new Uint8Array([1]),
                },
              ]
            }
            throw { kind: 'http', status: 500, body: '失败分支' }
          },
        }) as never,
      writeBack: () => {},
      placement,
      policy: { maxRetries: 0 },
      onTaskUpdate: (_planId, taskId, state) => {
        if (taskId === 'blocked-child' && state.kind === 'failed') {
          downstreamFailed.resolve()
        }
      },
      now: () => 0,
    })

    try {
      await within(downstreamFailed.promise, 'downstream failure')
      expect(slowFinished).toBe(false)
    } finally {
      slowGate.resolve()
    }
    const summary = await running

    expect(summary.succeeded).toBe(1)
    expect(summary.failed).toBe(2)
    expect(summary.taskResults.map((item) => item.state.kind)).toEqual([
      'succeeded',
      'failed',
      'failed',
    ])
    expect(summary.records.map((record) => record.taskId)).toEqual([
      'slow-success',
      'failed-parent',
    ])
  })

  it('取消立即收口未启动后代，已启动任务保留取消留痕', async () => {
    const controller = new AbortController()
    const parentStarted = deferredSignal()
    const plan: RunPlan<RunTask> = {
      id: 'plan-cancel-ready-queue',
      scope: 'node',
      mode: 'single',
      tasks: [
        dependencyTask('parent'),
        dependencyTask('child', ['parent']),
      ],
    }
    const running = runEngine(plan, {
      signal: controller.signal,
      projectId: 'p1',
      recordScope: scopeOf,
      channelResolver: () =>
        ({
          protocol: 'mock',
          generateImage(
            _request: RunRequest,
            signal: AbortSignal,
          ): Promise<never> {
            parentStarted.resolve()
            return new Promise((_, reject) => {
              const abort = () => {
                const error = new Error('aborted')
                error.name = 'AbortError'
                reject(error)
              }
              if (signal.aborted) abort()
              else signal.addEventListener('abort', abort, { once: true })
            })
          },
        }) as never,
      writeBack: () => {},
      placement,
      now: () => 0,
    })

    await parentStarted.promise
    controller.abort()
    const summary = await running

    expect(summary.succeeded).toBe(0)
    expect(summary.failed).toBe(0)
    expect(summary.canceled).toBe(2)
    expect(summary.taskResults.map((item) => item.state.kind)).toEqual([
      'canceled',
      'canceled',
    ])
    expect(summary.records).toHaveLength(1)
    expect(summary.records[0]).toMatchObject({
      taskId: 'parent',
      status: 'canceled',
    })
  })
})

describe('runEngine / 语音任务', () => {
  it('speech task 调用适配器 TTS，并将单个音频作为任务产物结算', async () => {
    const generateSpeech = vi.fn(async () => ({
      hash: 'speech-hash',
      mime: 'audio/mpeg',
      bytes: new Uint8Array([1]),
    }))
    const task: RunTask = {
      id: 'speech-task',
      nodeId: 'line:line-1',
      request: {
        kind: 'speech',
        channelId: 'channel-1',
        model: 'speech-model',
        prompt: '你好',
        inputs: [],
        params: {
          voice: 'alloy',
          speed: 1.2,
          responseFormat: 'wav',
        },
        timeoutMs: 120_000,
      },
      dependsOn: [],
      fingerprint: 'speech-fp',
      params: {},
    }
    const plan: RunPlan<RunTask> = {
      id: 'plan-speech',
      scope: 'node',
      mode: 'single',
      tasks: [task],
    }

    const summary = await runEngine(plan, {
      signal: new AbortController().signal,
      projectId: 'p1',
      recordScope: scopeOf,
      channelResolver: () =>
        ({
          protocol: 'mock',
          generateSpeech,
        }) as never,
      writeBack: () => {},
      placement: {
        begin: (item: RunTask) => ({ targetId: item.nodeId, commands: [] }),
        commit: () => [],
        shouldCollect: () => false,
        record: () => null,
        finalize: () => [],
      },
      now: () => 0,
    })

    expect(generateSpeech).toHaveBeenCalledWith(
      {
        channelId: 'channel-1',
        model: 'speech-model',
        text: '你好',
        voice: 'alloy',
        speed: 1.2,
        responseFormat: 'wav',
        timeoutMs: 120_000,
      },
      expect.any(AbortSignal),
    )
    expect(summary.succeeded).toBe(1)
    expect(summary.taskResults[0]?.state).toMatchObject({
      kind: 'succeeded',
      result: [{ hash: 'speech-hash', mime: 'audio/mpeg' }],
    })
  })
})
