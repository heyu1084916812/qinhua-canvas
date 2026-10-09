/**
 * 应用版本（构建时由 vite 的 `define` 注入）。
 *
 * 非构建环境（例如有人直接跑 tsc 产物）拿不到注入值 —— 那时回落 `0.0.0`，
 * 于是"需要更高版本"的扩展包会被如实拒收，而不是假装能装。
 */
declare const __APP_VERSION__: string

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
