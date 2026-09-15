import { useEffect, useRef, useState } from 'react'

/**
 * 前缘 + 后缘节流：值连续快速变化时，最多每 `ms` 毫秒放出一个新值。
 *
 * 与「防抖」的区别很关键：防抖只在**变化停下**后才给值，快速连续变化时
 * （拖动节点就是每帧一变）永远拿不到中间值，视图会僵住不动、松手才跳一下。
 * 这里要的是「拖动中小地图也在动，只是不必每帧都动」，故必须前后缘都给。
 *
 * 用途：小地图的节点点阵（详见 Minimap.tsx 的注释）——它是导航控件，
 * 8Hz 的刷新率肉眼无感，却是 60Hz 重算重渲成本的约七分之一。
 */
export function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value)
  const lastAt = useRef(0)
  const latest = useRef(value)
  latest.current = value

  useEffect(() => {
    const now = Date.now()
    const wait = ms - (now - lastAt.current)
    if (wait <= 0) {
      lastAt.current = now
      setShown(value)
      return
    }
    const timer = setTimeout(() => {
      lastAt.current = Date.now()
      setShown(latest.current)
    }, wait)
    return () => clearTimeout(timer)
  }, [value, ms])

  return shown
}
