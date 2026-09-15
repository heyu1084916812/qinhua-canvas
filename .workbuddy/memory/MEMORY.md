# CanvasFlow（轻画）项目记忆

> 🔴 **改动 canvas / comic 内部前，先读同目录 `INVARIANTS.md`**（完整不变量目录，本文件放不下）。
> 实现细节以 `git log` / `RELEASE_NOTES.md` / `轻画-功能对账清单.md` 为准。

## 项目与架构
- React + Vite + TS 纯前端，IndexedDB（dexie）唯一主存储，无后端。七层：domain 纯函数 → platform ports → state commands → workbenches UI，depcruise 强制。唯一入口 `store.dispatch(command)`。
- ⚠️ **代码里目前没有 Tauri**：无 `src-tauri/`、package.json 无 tauri 依赖，实为纯 Vite Web 应用（`npm run dev` → :1420）。「Tauri」只是规划，别再当现状写进文档。
- 多工作台 `'canvas'|'comic'`，路由级 lazy。**新增架构约束必须同步落 depcruise 规则，否则静默失效。**
- 持久化按数据形态选型：图结构 → 补丁流 `PersistPlan`；单聚合对象（comic）→ 防抖 800ms 整对象覆盖写一行。

## 节奏与对账
- 按「组」推进，每组完成停下汇报，等「继续」。收口：门禁（tsc/eslint/depcruise/vitest）+ 全量冒烟（`scripts/smoke.mjs`，:1420，chrome，`SMOKE_ONLY=<g>`）+ 提交 + 补记忆 + 同步文档。
- `轻画-功能对账清单.md` 是「文档声明 / 代码实况 / 证据」单一真相源；改功能必须同步，否则清单腐化成第二份谎言。
- **已六次栽在「文档写了 = 已实现」**（M6-23/24/25、§6.7 面板草稿、§6.16 等比缩放、§6.14 空白松手菜单）。清单只能对照代码生成。
- **测浮层菜单项必须用物理鼠标点击**：程序化 `btn.click()` 不产生 `pointerdown`，会绕开「菜单渲染在 surface 内部、pointerdown 冒泡到 surface 手势逻辑」这类 bug（曾把「点了没反应」测成正常）。
- **性能剖析别信 headless 的 rAF 帧间隔**（无 vsync，恒 ~6ms）。用：每帧主线程耗时 / CDP `Profiler` / headful。卡顿多半是「每帧重算」不是「渲染慢」；A/B（`{false && <Minimap/>}`）定位浮层成本最快。
- **React 的 `onWheel` 是 passive**，`preventDefault()` 被静默忽略；要阻止页面滚动须挂原生 `{passive:false}` 监听。
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
- **已上云**：远程 `origin` = `https://github.com/heyu1084916812/qinhua-canvas.git`（私有）。首次提交 `5348b17`（350 文件 / 67169 行）已推到 `main`，远程只有 `main`，`legacy/broken-history` 未外泄。远端内容用「另克隆一份到临时目录」独立验证过。作者身份 `qinghua-dev <dev@qinghua.local>`。
- 重建快照后必须校验 `git rev-list --objects main --missing=print | grep -c '^?'` == 0：`git add -A` 会走 cache-tree 捷径，复用缺失 tree 的 sha 却不写盘。
- SSR 冒烟遇 `React.lazy` 须 `renderToReadableStream` + `allReady`。
- **bash shim 没有 coreutils**：`ls/cat/grep/head/tail/wc/sort/mkdir/rm` 全部 `command not found`，只有 `git` 能用。
  对策：结果一律 `> 文件` 再 Read；列目录/写文件/删文件走 PowerShell。**PowerShell 的 `Remove-Item` 与 `cmd /c del` 都被安全 shim 拦掉**（删除做不了）。
- **旧 `.git` 的 fetch 会静默删掉 `refs/remotes/origin/*`**：`git fetch` 打印 `[new branch] main -> origin/main`、rc=0、无报错，
  但引用和它的 reflog 都没了 ⇒ `git status -sb` 显示 `[gone]`。定位方法：另克隆一份跑同样的 fetch 作对照（克隆里正常）⇒ 判定为旧 `.git` 旧伤而非 PortableGit。
  **修法：`git update-ref` 无效，需先让引用存在再 `git pack-refs --all`**，改走 packed 存储后 fetch 就不再删它了。
- 无 `gh` CLI、无 SSH 钥匙；凭据靠 Git Credential Manager 里已存的 `git:https://github.com`（HTTPS 直推可用）。
- **换机 / 多机**：`git clone` + `npm install`（`node_modules` 不入库，靠 `package-lock.json` 复现）。
  冒烟 `npm run smoke` 必须装**系统 Chrome**（`chromium.launch({channel:'chrome'})`，Playwright 不自带）。
  **画布/漫画数据不进 git**（IndexedDB），换机要用 `exportProject`/`importProjectFile` 搬 `.flow.json`（格式 `qinghua.flow` v1）；渠道 API Key 同理要重新配。
  上下文交接让对方按序读：功能对账清单 → 架构设计文档 → `.workbuddy/memory/MEMORY.md` → `INVARIANTS.md`。
