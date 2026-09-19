/**
 * 端点的「磁吸」判定（§6.14，用户 2026-09-19）。
 *
 * 语义：指针进入端点附近的**感应圈**时，端点浮现并朝指针方向吸过去；
 * 离开则弹回原位。这里是纯几何——不碰 DOM、不碰 React，故可直接单测。
 *
 * 为什么值得单独成模块：这段判定有两个**容易写错又不报错**的性质——
 *   1. 吸附量必须随距离**衰减**（贴圆心吸满、近圈边几乎不吸），否则端点会「啪」地跳出去；
 *   2. 位移方向必须是「从圆心指向指针」，取反会变成「躲开指针」，看起来像端点坏了。
 * 两者在 UI 上都只是「怪怪的」，不会抛错，所以必须用测试钉住。
 */

/** 吸附结果：是否感应到了，以及端点该偏移多少 */
export interface PortMagnet {
  /** 指针是否落在感应圈内 */
  hot: boolean
  /** 端点相对原位的位移（视觉像素） */
  dx: number
  dy: number
}

export interface PortMagnetOptions {
  /** 感应圈半径（视觉像素，从圆心算） */
  radius: number
  /** 最大吸附位移（视觉像素） */
  maxPull: number
}

/** 没感应到的零位移结果——复用同一对象，便于调用方比较引用省重渲染 */
export const NO_MAGNET: PortMagnet = { hot: false, dx: 0, dy: 0 }

/**
 * 算端点对指针的吸附。
 *
 * @param center 端点圆心（视觉坐标，与 pointer 同一坐标系）
 * @param pointer 指针位置（同上）
 */
export function portMagnet(
  center: { x: number; y: number },
  pointer: { x: number; y: number },
  opts: PortMagnetOptions,
): PortMagnet {
  const dx = pointer.x - center.x
  const dy = pointer.y - center.y
  const dist = Math.hypot(dx, dy)
  /**
   * 边界取**闭区间**：正好落在感应圈上算感应到。
   * 取开区间会让「半径 34、距离恰好 34」这种整数坐标在测试与真机上表现不一致。
   */
  if (dist > opts.radius) return NO_MAGNET
  /** 圆心重合时无方向可言，退化为不位移（仍算感应到，端点会浮现） */
  if (dist === 0) return { hot: true, dx: 0, dy: 0 }
  const pull = Math.max(0, 1 - dist / opts.radius)
  const amount = opts.maxPull * pull
  const norm = amount / dist
  return { hot: true, dx: dx * norm, dy: dy * norm }
}
