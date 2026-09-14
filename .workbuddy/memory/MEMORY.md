# CanvasFlow（轻画）项目记忆

> 🔴 **改动 canvas / comic 内部前，先读同目录 `INVARIANTS.md`**（完整不变量目录，本文件放不下）。
> 实现细节以 `git log` / `RELEASE_NOTES.md` / `轻画-功能对账清单.md` 为准。

## 项目与架构
- React + Vite + TS + Tauri 纯前端，IndexedDB 唯一主存储，无后端。七层：domain 纯函数 → platform ports → state commands → workbenches UI，depcruise 强制。唯一入口 `store.dispatch(command)`。
- 多工作台 `'canvas'|'comic'`，路由级 lazy。**新增架构约束必须同步落 depcruise 规则，否则静默失效。**
- 持久化按数据形态选型：图结构 → 补丁流 `PersistPlan`；单聚合对象（comic）→ 防抖 800ms 整对象覆盖写一行。

## 节奏与对账
- 按「组」推进，每组完成停下汇报，等「继续」。收口：门禁（tsc/eslint/depcruise/vitest）+ 全量冒烟（`scripts/smoke.mjs`，:1420，chrome，`SMOKE_ONLY=<g>`）+ 提交 + 补记忆 + 同步文档。
- `轻画-功能对账清单.md` 是「文档声明 / 代码实况 / 证据」单一真相源；改功能必须同步，否则清单腐化成第二份谎言。
- **已三次栽在「文档写了 = 已实现」**（M6-23/24/25）。清单只能对照代码生成。
- 提交前别 `git add -A`：一次性探针 `scripts/probe-*.mjs` 与搁置的漫剧调研稿不入库。

## 进度
M0–M6 完成，comic 侧推迟项清零；画布侧收尾至 **M6-27 小地图（§6.4）**（范围只由内容决定防拖拽自我放大、视口框保尺寸钉回框内；G56 含像素断言 + 故障注入）。
剩余缺口顺位：#8 日志「请求/实际像素」→ #11 右键菜单补项 → #14′ 结果组整体移动/解散入口 → #10 无障碍。
第三工作台「漫剧」已搁置（设计稿未提交）；条漫（竖屏无限滚动）经决策不纳入。

## 工具教训（精）
- 渲染类缺陷判据只能是像素（DOM 全绿证明不了已绘制）。`countEdgeInk`/`countWarnInk`/`countMediaInk`/`countMinimapInk`；按色相特征摘目标，取样前状态归位。
- 故障注入是验证断言有效性的唯一办法；状态类样式必须有 `data-*` 锚点（选中态只在 CSS module 哈希类里 ⇒ 断言恒真）。
- **「点空白」一律走 `blankPoint`/`clickBlankCanvas` 运行时扫点，禁止写死坐标**：小地图是 `[data-canvas-surface]` 的**后代**，Playwright 命中检查不报 `intercepts`，点错不报错只静默连锁失败。
- 同一文件的多处 Edit 必须串行（并行静默丢失）。文档表格追加行别拿「下一行行首」当锚点。
- 探针优先于推理，但已有冒烟组就直接把断言写进去；异步后立刻 `count()` 是必然竞态（用 `waitForFunction`）。
- **别把稳定红灯叫 flaky**：`App.render` 曾三次记为「偶发超时」，实测全量 7962ms > 默认 5s，是超时配错。看耗时数字，不看「上次是绿的」。
- 别在对象可能被回收时用 `git stash -u`（曾清空 `.git/refs`，31 个对象永久丢失；备份 `E:/软件/无限画布/.git-backup-20260913/git`）。
- **2026-09-15：旧历史已判定不可恢复并停用**。当前默认分支 `main` 只有一个工作区快照提交（`749f01d`，349 文件）；旧历史改名 `legacy/broken-history` 仅存本地、永不推送。全量 `.git` 副本在 `E:/软件/无限画布/.git-backup-20260914-prepush`。
- 重建快照后必须校验 `git rev-list --objects main --missing=print | grep -c '^?'` == 0：`git add -A` 会走 cache-tree 捷径，复用缺失 tree 的 sha 却不写盘。
- SSR 冒烟遇 `React.lazy` 须 `renderToReadableStream` + `allReady`。
