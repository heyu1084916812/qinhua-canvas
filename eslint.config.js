import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'
import globals from 'globals'

export default tseslint.config(
  {
    /**
     * `scripts/probe-*.mjs` 是**临时验证脚本**（与 .gitignore 同口径，不入库）：
     * 用完即删，里面的变量常常只为调试而留。让 lint 扫它们只会反复报
     * 「assigned but never used」——那是脚本的常态，不是缺陷。
     * 正式脚本（scripts/smoke.mjs 等）仍照常检查。
     */
    ignores: ['dist', 'node_modules', '.workbuddy', 'scripts/probe-*.mjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 配置文件是 CommonJS（dependency-cruiser 用 .cjs）
    files: ['*.cjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // scripts/ 下的验证脚本跑在 node 里（Playwright 驱动），但脚本内部会 evaluate 浏览器代码
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { import: importPlugin },
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true },
      },
    },
    rules: {
      // 跨层依赖方向由 .dependency-cruiser.js 强制；这里只约束层内可读性
      'no-restricted-imports': 'off',
      // 与 tsconfig 的 noUnusedParameters 口径一致：下划线前缀表示「刻意不用的占位参数」
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'domain 层禁止 import React' },
            { name: 'react-dom', message: 'domain 层禁止 import react-dom' },
          ],
          patterns: [
            { group: ['**/platform/**'], message: 'domain 层禁止 import platform' },
            { group: ['**/state/**'], message: 'domain 层禁止读写全局状态' },
            { group: ['**/features/**'], message: 'domain 层禁止 import features' },
            { group: ['**/workbenches/**'], message: 'domain 层禁止 import workbenches' },
            { group: ['**/ui/**'], message: 'domain 层禁止 import ui' },
            { group: ['**/pages/**', '**/app/**'], message: 'domain 层禁止 import 上层' },
          ],
        },
      ],
    },
  },
)
