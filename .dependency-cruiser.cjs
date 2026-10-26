/**
 * 依赖治理规则（架构 §7.2）
 * 运行：npx depcruise src --config .dependency-cruiser.js
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-pure',
      comment: 'domain 只依赖 domain 与 shared，不碰 React / platform / state',
      from: { path: '^src/domain' },
      to: { pathNot: '^src/(domain|shared)' },
    },
    {
      name: 'ui-stateless',
      comment: 'ui 层无业务状态，只依赖 ui 与 shared',
      from: { path: '^src/ui' },
      to: { pathNot: '^src/(ui|shared)' },
    },
    {
      name: 'no-upward',
      comment: 'state 不得反向依赖上层',
      from: { path: '^src/state' },
      to: { path: '^src/(workbenches|pages|features)' },
    },
    {
      // 口径：只约束「节点实现目录 → 另一个节点实现目录的模块代码」。
      // 排除：① nodes/index.ts（唯一聚合入口）② nodes/registry.ts ③ 同目录内的 css / 资源。
      // 已知限制：同目录内拆多个 .ts 文件仍会告警，届时应把共享部分上浮到 registry 或 ui。
      name: 'no-node-cross-talk',
      comment: '节点类型实现之间互不引用，共享部分上浮到 registry 或 ui',
      from: { path: '^src/workbenches/[^/]+/nodes/[^/]+/.+\\.tsx?$' },
      to: {
        path: '^src/workbenches/[^/]+/nodes/[^/]+/.+\\.tsx?$',
        pathNot: '^src/workbenches/[^/]+/nodes/registry\\.tsx?$',
      },
    },
    {
      name: 'agent-only-through-commands',
      comment: 'Agent 只能通过命令层改图数据（features/shared/agent 与 features/canvas/agent）',
      from: { path: '^src/features/(shared|canvas)/agent' },
      to: {
        path: '^src/state/workbenches/[^/]+/slices',
        pathNot: '^src/state/workbenches/[^/]+/commands',
      },
    },
    {
      name: 'storyboard-no-canvas-runtime',
      severity: 'error',
      comment:
        '漫剧页面、工作台和业务能力不得直接依赖画布 Store / 执行器 / Provider / 节点创建入口；只能使用 features/storyboard/canvasPort',
      from: {
        path: '^src/(pages/StoryboardPage|workbenches/storyboard|features/storyboard)',
      },
      to: {
        path: '^src/(workbenches/canvas|state/workbenches/canvas|features/canvas|domain/canvas)',
      },
    },
    {
      name: 'storyboard-no-app-host',
      severity: 'error',
      comment:
        '漫剧页面业务组件、工作台和业务能力不得直接依赖 app 层画布宿主；只有 StoryboardProject 组合根可装配 Host',
      from: {
        path: '^(src/workbenches/storyboard|src/features/storyboard|src/pages/StoryboardPage/(?!StoryboardProject\\.tsx$|StoryboardPage\\.tsx$).*)',
      },
      to: {
        path: '^src/app/workbenchHosts/Storyboard',
      },
    },
    {
      // M6-1 收口：架构 §5.10 承诺过「共享层不得依赖工作台私有层」，但此前**无工具强制**，
      // 导致 features/shared/execution、useViewport、state/shared/persist 等悄悄反向依赖画布
      // （tsPreCompilationDeps 打开时，纯 type import 也计入）。本规则把该不变量变为可强制。
      // 口径：共享层的定义 = src/shared + src/{domain,state,features}/shared；不允许 import
      // 任何 workbenches|features|state/workbenches|domain 下的 canvas|comic 私有代码。
      name: 'no-shared-to-workbench',
      severity: 'error',
      comment: '共享层不得依赖任何工作台私有层（架构 §5.10）',
      from: { path: '^src/(shared|domain/shared|state/shared|features/shared)' },
      to: { path: '^src/(workbenches|features|state/workbenches|domain)/(canvas|comic)' },
    },
    {
      name: 'dev-preview-isolated',
      comment: '陈列室是单向依赖，业务代码不引用它',
      from: { path: '^src/(workbenches|features|state|domain)' },
      to: { path: '^src/dev' },
    },
    {
      name: 'ecommerce-no-canvas-runtime',
      severity: 'error',
      comment:
        '电商页面和工作台不得依赖画布 Store / 执行器 / 节点创建入口（对账 #766 阶段 3）',
      from: { path: '^src/(pages/EcommercePage|workbenches/ecommerce)' },
      to: {
        path: '^src/(workbenches/canvas|state/workbenches/canvas|features/canvas|domain/canvas)',
      },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.tsx?$' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
}
