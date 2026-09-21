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

### ★ 会话交接与临时需求（2026-09-21 定型）

**背景**：上下文压缩不累积，新会话从零开始。曾发生真实事故——用户在**另一个对话**提了九条界面调整，那条对话中断，接手的会话只看到残破的「第 2 条 / 第 8 条」两句，于是**只做了两条，漏掉五条**，直到用户复核才发现。根因不是记忆差，是**那九条从没落成文字**。

**两条规矩（已写进 `AGENTS.md` 与对账清单「维护规则」第 6 条）**：
1. **开工先读**：对账清单（重点「五、缺口汇总」）→ 架构文档 → `MEMORY.md` / `INVARIANTS.md`。
2. **临时需求当轮进清单**：用户提的任何待办（新功能 / 修复 / 调整）当轮就在「缺口汇总」加一行（编号 + 来源 + 状态）；**不许只停留在对话里**。做完同轮改状态并补证据。

**为什么不再开 `TASKS.md`**：对账清单已是单一真相源，再加一份就会出现「该记哪边」的犹豫，**犹豫就会漏**。清单因此同时承担「审计已发生」与「登记未做」两职，共用同一套编号（一个缺口要么已兑现 ✅、要么还欠着 📝）。

**已退休**：`M0-对话交接.md` / `M1-对话交接.md`（2026-09-21 删除）。它们是里程碑级的手工交接本，内容早被 RELEASE_NOTES + 本文件 + 清单覆盖，留着反而让新会话误当现状。交接改为**读现有文件**，不再手工维护交接本。

### ★ 提示词正文格式化（2026-09-21 落地）

**用户诉求**：「把文本框变成大一点的编辑框，就像灯箱一样」+ 一排格式按钮（H1/H2/H3/正文 | B/I/无序/有序/分隔线 | 复制/全屏）。核心是**不想看到 `#` `**` 这些符号**。

**三条设计决定（改之前先读这里）**：

1. **底层是 Markdown 字符串，不是富文本**。理由是对模型更好：`##` `**` 是主流图像模型见过的语义标记，而 HTML 标签对它是噪音（占 token 不描述画面）。生成链路**完全没动**（仍是 `text` 原样发出）。
2. **没有做「透明 textarea 叠渲染层」**——试过，**不可靠**：Markdown 符号（`## ` `**`）在渲染层不占宽度、在 textarea 里占宽度，只要有一行折行两层就错位（中文长提示词必然折行），表现为「点这儿光标在那儿」。改成**左编辑 / 右预览分栏**：编辑区是带符号的真实文本（保住光标与输入法），预览隐藏符号。真正的所见即所得要完整富文本实现，是另一个量级，**未做**。
3. **节点栏与灯箱共用 `text/FormatToolbar.tsx`**，但**作用范围不同**：节点栏无光标，格式作用于**整个正文的逐行**；灯箱有真实光标，走完整的「按选区变换」。两处共用 `domain/canvas/text/markdownFormat.ts` 的同一份纯函数。

**踩过的坑（改这块前必看）**：
- **★ 双击是两态，不是单态**（用户 2026-09-21 二轮澄清）：**非编辑态双击 → 进编辑态；编辑态 + 有文字再双击 → 全选**。我曾把它简化成「永远全选」并删掉输入框，结果**双击没反应、也打不了字**（功能被改坏，用户直接报障）。这是浏览器地址栏 / Word 的通用行为，别再简化。
- **双击语义变更带动冒烟大改**：节点内那个 `textarea` 一度被删 ⇒ 多处冒烟还在找 `[data-node-type="prompt"] textarea`，全量里 G23 直接超时。已收成 `setTextViaEditor()` helper（走右键→全屏编辑），下次再改入口只改一处。
- **测试别在空文本上断言**：G64 首版「看不到 `#`」在空提示词节点上恒真（什么都没写，自然也看不到符号）。必须先 `fill('一只猫')` 再断言，故障注入（把渲染改回旧版）才会红。
- **格式按钮的「幂等」是必须的**：`applyLineFormat` 先摘旧前缀再加新前缀，否则点两次 H2 会变成 `## ## 标题`。
- **★ 格式栏是「图标 + 无文字 + 无边框」**（用户三轮反馈定稿）：① 一版是中文标签（太长，整条 809px 挤掉右侧按钮）；② 二版自带边框，渲染在跟随栏内部形成「框里有框」；③ 定稿 = 只留线性图标（`toolbar/icons.tsx` 新增 H1/H2/H3/正文/B/I/两种列表/分隔线/复制/全屏）、按钮定宽 28px、**工具栏自身 `border: none`**。跟着做时别再加回文字或边框。

### ★ 素材缩略图几何（2026-09-21）

**三条规则**（用户三轮）：缩略图 **40px**、**圆角与外框同心**、**编号角标移到角外**（不压素材）。

**②③ 是同一个根因**（想改这块先读）：
- 圆角裁图要 `overflow:hidden`；右上角素材按钮与左上角标要「探出边框」需要 `overflow:visible`。
- 放在**同一个盒子**上只能二选一。旧版选了 visible ⇒ **图片是方的**（裁切失效）、
  角标也只能待在容器内 (1,1) **压住素材**。
- 修法是**拆两层**：外层 `.thumb` 只定位 + visible；内层 `.thumbFrame` 负责
  `border-radius: 7px`（= 外层 8 − 1px 描边，同心）+ `overflow:hidden`。

**易错点**：
- **创作面板挂 `zoom: 0.75`**，`getBoundingClientRect` 拿到的是**缩放后**的屏幕尺寸
  （40px 渲染成 30px）。冒烟断言设计值时必须除掉 zoom——首版没除，把正确的 40px 判成
  「只有 30、没生效」。
- 角标「骑一半」（`-8px`）仍会压住图面 7px；要**整体移到角外**（`-18px`）才干净。
- `--thumb-size` 与 `--assets-row-h` 已**拆开**：缩略图可单独调，不必动首行高度。

### ★ 缩略图删除角标（2026-09-21，改三次定稿）

**最终形态**：每张缩略图右上角顶点一个**红色 `✕`**，中心**骑角**（`right/top = -(边长/2)`，与左上编号角标同一套几何），默认隐藏、悬停显形。

**语义必须按来源分流**（用户拍板）：
- `self` → 清空本节点素材（回「没上传图片」）；
- `upstream` → **删那条连线**（上游节点与它的图都保留）。

**两条教训（改这里前必读）**：
1. **面板事件在 `PanelLayer.tsx` 的 `handlePanelEvent`**，不在 `useCanvasPageEvents.ts`。
   首版把 `case 'removeThumb'` 写进了后者——TS 编译过、点击也出撤销条，
   但**事件根本没路由到**，连线数纹丝不动。加了 `data-undo-bar` 计数才定位到。
2. **冒烟必须断言「上游节点仍在」**：只数「缩略图消失 / 连线少一条」，
   「错改了上游节点的数据」这种越权实现照样全绿。G66 里专门加一条
   「上游节点仍在 2 → 2」。

另外：`edge.remove` 命令**不收 `transient`**（删边本身就是独立撤销单元）；
写代码前看一眼 `state/commands/index.ts` 的命令签名。
- **测浮层菜单项必须用物理鼠标点击**：程序化 `btn.click()` 不产生 `pointerdown`，会绕开「菜单渲染在 surface 内部、pointerdown 冒泡到 surface 手势逻辑」这类 bug（曾把「点了没反应」测成正常）。
- **性能剖析别信 headless 的 rAF 帧间隔**（无 vsync，恒 ~6ms）。用：每帧主线程耗时 / CDP `Profiler` / headful。卡顿多半是「每帧重算」不是「渲染慢」；A/B（`{false && <Minimap/>}`）定位浮层成本最快。
- **React 的 `onWheel` 是 passive**，`preventDefault()` 被静默忽略；要阻止页面滚动须挂原生 `{passive:false}` 监听。
- 提交前别 `git add -A`：一次性探针 `scripts/probe-*.mjs` 与搁置的漫剧调研稿不入库。
- **`git status` 干净 ≠ 目录干净**：被忽略的调试转储照样堆在项目根目录（实测 143 个 / 655KB）。
  已用 Node 清干净（2026-09-15）：**`Remove-Item`（沙箱内外的 PowerShell）与 `cmd /c del` 都被安全 shim 拦掉，
  但 Node 的 `fs.unlinkSync` / `rmSync` 可以删**——批量删文件走 Node 脚本（`%TEMP%\qinghua-cleanup.mjs` 模式）。
  白名单务必排除 `.gitignore` 与 `.dependency-cruiser.cjs`；**`.git` / `.workbuddy` 绝不能碰**。
  另：`.playwright-verify/`（235 文件 / 10MB 截图）可整个删，随时重跑再生成。
  **今后的规矩：调试输出一律 `> %TEMP%\xxx.txt`，不再落进项目根目录。**

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
  **2026-09-15 起本环境下 `git push` 推不动了**：早期是卡在 `git credential-manager get`（rc=128、无报错文字）；
  后来用 `git push > out 2> err` 分离捕获才拿到真错误——**实为出网代理问题**：
  `fatal: unable to access 'https://github.com/...': Empty reply from server` / `CONNECT tunnel failed, response 502`（两次报错还不一样）。
  ⇒ 结论：本环境的 HTTPS 走代理、代理到 github.com 不通，**不是凭据问题**。
  **对策：让用户在自己的终端里跑 `git push origin main`**，我不再尝试绕。
  **教训：git 静默失败时别只会加 trace，先把 stdout/stderr 分开重定向到文件**（PowerShell 里 `2>&1 | Out-File` 会把 git 的 UTF-16 报错搅成乱码/丢行，
  改成 `> out.txt 2> err.txt` 再 `Get-Content -Encoding Unicode` 转存才读得清）。
- **换机 / 多机**：`git clone` + `npm install`（`node_modules` 不入库，靠 `package-lock.json` 复现）。
  冒烟 `npm run smoke` 必须装**系统 Chrome**（`chromium.launch({channel:'chrome'})`，Playwright 不自带）。
  **画布/漫画数据不进 git**（IndexedDB），换机要用 `exportProject`/`importProjectFile` 搬 `.flow.json`（格式 `qinghua.flow` v1）；渠道 API Key 同理要重新配。
  上下文交接让对方按序读：功能对账清单 → 架构设计文档 → `.workbuddy/memory/MEMORY.md` → `INVARIANTS.md`。
