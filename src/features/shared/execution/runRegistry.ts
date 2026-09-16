/**
 * 并发运行的**登记表**（纯数据，供 `useExecution` 使用）。
 *
 * 为什么单独抽出来：并发缺陷（「一个节点生成时另一个节点生成不了」）来自
 * 「只记一个 runningPlanId / 一个 controller」这套单槽位记账。把表本身做成
 * 纯结构后，可以脱离 React 直接断言「两条链路互不覆盖」，而不用为一个 hook
 * 搭 DOM 测试环境。
 */
export interface RunRegistry<T> {
  add(id: string, value: T): void
  remove(id: string): void
  get(id: string): T | undefined
  ids(): string[]
  has(id: string): boolean
}

export function createRunRegistry<T>(): RunRegistry<T> {
  const map = new Map<string, T>()
  return {
    add(id, value) {
      map.set(id, value)
    },
    remove(id) {
      map.delete(id)
    },
    get(id) {
      return map.get(id)
    },
    ids() {
      return [...map.keys()]
    },
    has(id) {
      return map.has(id)
    },
  }
}
