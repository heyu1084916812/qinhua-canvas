import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
/*
 * 直接 import package.json 而不是 `readFileSync`：项目的 tsconfig **刻意不装 @types/node**
 * （`types: ["vite/client"]`），而 `resolveJsonModule` 是开着的 —— JSON 导入既能拿到版本，
 * 又不用把 node 类型引进构建配置。
 */
import pkg from './package.json'

/**
 * 应用版本（构建时注入 `__APP_VERSION__`）。
 *
 * 为什么现在才要它：扩展包（#386）带 `minAppVersion` —— 包说"需要 0.2.0 以上"时，
 * 界面必须能如实回答"当前是多少"。写死一份常量迟早与 package.json 漂移，
 * 所以从唯一来源读。
 */
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 1420,
  },
  build: {
    // 生产构建剔除 dev/ 陈列室：入口不引用即被 tree-shake，这里再显式排除源码
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
