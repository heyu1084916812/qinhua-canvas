# CanvasFlow 不变量详表

> `MEMORY.md` 放不下，本文件是完整版。**改动 canvas / comic 内部前必读**（由 MEMORY.md 顶部指引到此）。
> 排序：canvas 通用 → 结果组/容器 → 生成与执行 → 复制粘贴 → 渠道与协议 → comic。

## canvas · 通用

- **执行引擎**：`runEngine<TTask,TCommand>` 对工作台命令零认知，**落位/写回全委托注入的 `ExecutionPlacement`**（canvas → `CanvasPlacement`，comic → `ComicPlacement`）。
- **生成节点本体 = 媒体框（§6.8）**：参数/提示词/生成按钮全在下方创作面板；标题浮出节点外（`.header` `bottom:100%`，`HEADER_H` 高度补偿须同步删）。**发现「两套 UI」时修法是减重，不是给旧的那套加壳。**
- **节点内部一律白底 `--bg-surface`**，节点间不靠底色差区分；UI：无投影、1px 细描边、8px 圆角（同 chip）、选中黑边框（非蓝）、参数文字 font-weight 600、`max-content`。
- **可拖动把手内的文字必须 `user-select:none`**：否则原生文本拖拽（`dragstart`→`pointercancel`）掐断自定义指针流（G15/G16/G17 根因）。判据：捕获事件流看有没有 `pointerup`。
- **`beginPlan/endPlan` 不可嵌套**（`activePlan` 是单个变量）⇒ 批量落节点由调用方整批开一次计划，且计划区间内不夹 `await`。
- **模板套用幂等**：判据必须落**持久数据**（hydrate 结果为空 = 新建项目），不能落内存 ref 或跨刷新存活的 `location.state`。**通则：任何「只做一次」的守卫，判据要落在持久数据上。**
- **创作面板**：ParamPicker 上拉浮层（父级单一 `openPicker` 保「只开一个」，Esc 只关浮层不关面板，点外关闭挂**捕获**阶段）；功能类别（图片/视频）= 同一节点 `data.mode`；比例九档兜底与协议能力表**同一套**。

## canvas · 浮层菜单与指针事件（2026-09-15 实测）

- **★★ 浮层菜单（ContextMenu / LinkMenu）渲染在 `[data-canvas-surface]` 内部** ⇒ 点菜单项的 `pointerdown` 会一路冒泡到 surface 的手势处理。**判定「这一下点在菜单上」必须落到 `e.target.closest('[data-link-menu], [data-context-menu]')`，绝不能只看「菜单是否开着」**——后者会让菜单在自己的 `click` 到达前被卸载，表现为「点了只关菜单、什么都不执行」，还不报错（`CanvasSurface.tsx#isInsideMenu`）。
- **★★ 测菜单项一律用物理鼠标点击，别用 `btn.click()`**：程序化 click 只派发 `click`、不产生 `pointerdown`，恰好绕开上面那类 bug。曾因此把「新建并连接点了没反应」测成「功能正常」。
- **`beginPlan` / `endPlan` 的合并靠 `activePlan` 非空** ⇒ `endPlan()` 必须写在**最后一个命令之后**。写在中间等于白开：撤销会分成两步，留下一个孤立新节点。（与「不可嵌套」并列的两条纪律。）
- **`canConnect` 的替身节点必须真的放进 `graph.nodes`**：它内部按 id 回溯父链（画板内外不建立边、容器内不外连）。替身不在表里 ⇒ `index.get(id)` 为 undefined ⇒ 被当成「无祖先」⇒ 画板内拖线时新建项整批消失。（`linkMenu.ts` 里造 `{...graph, nodes:[...graph.nodes, probe]}` 再判。）
- **React 的 `onWheel` 是 passive**，`preventDefault()` 被静默忽略（控制台 `Unable to preventDefault inside passive event listener invocation`）。要阻止页面滚动必须 `addEventListener('wheel', fn, { passive: false })`；顺带把 `useViewport.onWheel` 的参数类型改成 `WheelLike{ deltaY, clientX, clientY }`，原生事件才能直接喂进去。**症状是「缩放时固定浮层跟着往上跳」——看着像定位 bug，实则是文档在滚**（`body` 默认 8px 外边距 + `.page` 100vh = 16px 可滚区，已由 `ui/base.css` 归零）。

## canvas · 创作面板第一部分首行（2026-09-15，用户口径）

- **首行 = 素材条 / 空态框（左，flex:1） + 「图片 / 视频」类别切换（右，贴最右端）**，二者**同一行等高 30px**（`--assets-row-h`，定义在 `.panel` 上，子选择器继承）。空态时左边是「拖入素材」虚线框（吃满剩余宽度、文字居中）；有素材时左边是缩略图条（30×30 方块 + 集合卡改同高横向胶囊），素材多时条内换行、切换垂直居中。
- **钉死高度 + 有边框 ⇒ 必须 `box-sizing: border-box`**（`.assetEmpty` / `.thumb` / `.collection`）。踩过两次：漏写就被 1px 边框撑到 32px，比类别切换高 2px。**不要用 `align-items: stretch` 代替**——flex 拉伸按 content-box 算，同样多出 2px。
- 判据只能是**几何**（右边界 / 高度 Δ / 中心 Δ），DOM 结构「同一行」证明不了排版对。
- **mock 渠道出的是纯灰 64×64 PNG**（`mock.ts` `GRAY=0x8a8a8a`；带图输入才出品红）。探针/冒烟截图里看到灰块**不是渲染缺陷**，别去查 CSS——先 `img.complete && naturalWidth>0` 再对照 mock 源码。用户截图里的真人真图来自他自己的真渠道。

## canvas · 拖动性能剖析手法（2026-09-15）

- **headless Chrome 没有 vsync**，rAF 帧间隔恒为 ~6ms，**用帧间隔判断卡顿毫无意义**。三种可靠的量法：① 每帧主线程工作耗时（`pointermove` 记 t0 → 双 rAF → t1）；② CDP `Profiler` 采样看热点函数；③ **headful**（`headless:false`）才有真实 vsync 帧间隔。
- **热点往往不是「渲染慢」而是「每帧重算」**：本次是 `NodeLayer` 每帧重建边索引（O(N·E)）与节点索引（O(N²)），外加小地图每帧全量重投影。缓存键要按**内容**（节点 id/type/parentId/data 的引用，不含坐标），平移且 zoom 不变时直接复用上一次可见列表；小地图把「内容投影」与「视口框」拆成两份 memo，节点表节流 8Hz。
- **A/B 法定位浮层开销最省事**：临时 `{false && <Minimap />}` 渲染/不渲染各跑一次同样的拖动，差值就是它的成本。
- 复测口径（headful、300 节点、60 步）：p50 6.1ms / p90 12.2 / p99 30.2 / >33ms **0** 次（修前 p50 34ms、>33ms 占 38/60）。

## canvas · 小地图（M6-27）

- **范围只由内容决定**：顶层节点 + 结果组；无内容才退化为视口。**千万别把视口并进范围**——一边拖一边改视口会反过来改 `scale`，同一光标位置映射到的世界坐标越拖越远（自我放大的回路）。范围与视口无关，映射恒定，拖拽天然稳定。
- **视口框越界「保尺寸、挪位置」钉回框内**：求交会让框变小、被读成「看得更少了」，而真正的含义是「已经偏出去了」；视口比内容还大（全图都在视野里）则铺满整框。
- **只画顶层节点与结果组**：容器内子节点 x/y 是局部坐标（与 `fitCanvasView` / 框选命中同一口径，混进来范围被拉偏）。
- **★★ 两个「框」不是一个东西（G56 曾因此 6 项挂掉）**：`container` = **画布可视区**尺寸，只喂 `viewWorldRect(vp, container)` 反算视口覆盖的世界范围；`MINIMAP_BOX`（200×140）= **小地图自身**尺寸，投影缩放与「钉回框内」都按它算。原实现 `buildMinimapModel({sources, view: viewWorldRect(viewport, box)})` 里投影框走默认值，重构时若顺手把同一个 `box` 也传给 `minimapProjection` / `minimapViewRect`，scale 会大好几倍 ⇒ 视口框撑爆小地图、点击跳不准。**性能探针和 domain 单测都发现不了**（只量耗时 / 函数是纯对的，错在接线）——必须跑全量冒烟。
- **焦点在小地图内时，画布那套 Tab/方向键导航整体让位**：否则一次按键同时改视口和选中节点。
- **指针处理读 ref 里的最新模型**：拖拽期间每拍都改视口并重渲染，闭包里的 model/viewport 会陈旧 ⇒ 落点越拖越偏。
- **测「拖拽跟手」别指望中间帧**：指针移动走 rAF 合帧，同帧内中间位置是**有意**丢掉的；断言写成「未松手即已跟到中途点」，别断言「中途 ≠ 终点」。
- `clickBlankCanvas` 已把 `[data-canvas-minimap]` 排除出「空白」候选——新增画布浮层时记得同步这个清单。
- **层叠 `z-index: 18`**：高于工具栏（15/16）、**低于创作面板（20）**与日志/参数/版本面板（30）。它与右下角的创作面板物理重叠，同级时后渲染的小地图会盖住面板「生成」按钮。规则：**常驻环境控件让位于临时作业面**。
- **`tabIndex={-1}`（刻意不进 Tab 序列）**：画布的 Tab 已被 §6.3「逐个选中节点」`preventDefault` 占用，挂 `tabIndex=0` 只是多一个走不到的停靠点，却会在焦点从顶栏进来时吃掉一站。键盘导航改为**点击后即聚焦**（`onPointerDown` 里 `focus()`），方向键 / Home 随即可用。
- **★★ 测试台陷阱：小地图是 `[data-canvas-surface]` 的后代** ⇒ Playwright 命中检查**不报** `intercepts pointer events`。写死的「右下角 = 空白」坐标会**静悄悄**把点击发给它（没清选中 + 顺带把视口带跑），断言连锁失败却不报点错。**凡是「点空白」一律走 `blankPoint(page,{dx,dy})` 运行时扫点，禁止写死坐标。**

## canvas · 素材读写与性能（2026-09-14 实测；**三处瓶颈已于 M6-26 修复**）

- **★★ `assets` 表插队立即落库，不等 800ms 防抖**（M6-26）：`useAsset` 只查 IndexedDB，而 `asset.put` 原先靠防抖才落库 ⇒ 上传后**必然** miss。更要命的是 `useAsset` 的重试窗口只有 12×250ms=3s，**多张连传时主线程被占、防抖计时器被推迟 ⇒ 落库晚于 3s ⇒ 那张图永久空白**（是显示失败，不是慢）。现在 `URGENT_TABLES = {assets}` 命中即 `flush()`；冲刷改为**串行链**防交错丢写。其余表仍走防抖（拖节点每帧一次 `node.move`，逐次落库才真卡）。
- **★★ `fingerprintBytes` 是异步的**（M6-26）：优先 `crypto.subtle.digest`（原生线程，7MB 实测 4ms），无 `crypto.subtle` 时回落纯 JS `sha1Bytes`。**原同步实现对全部字节跑 80 轮：3.5MB→120ms、7MB→233ms 主线程阻塞**（这才是用户说的「卡」）。**两条路径都是标准 SHA-1、哈希值一致**（固定向量单测钉住）——否则同图存两行、内容寻址失效。
- **宽高读文件头，不再全量解码**（M6-26）：`domain/shared/imageSize.ts#imageSizeFromHeader`（PNG IHDR / JPEG SOF / GIF / WebP VP8·VP8L·VP8X），读不出才回落 `createImageBitmap`。原先 6000×4000 要 114ms + 约 96MB 位图峰值，只为拿两个数字。
- **`useAsset` 重试窗口 3s → 约 20s**（前 3s 每 250ms、其后 500ms，上限 48 次）；且图一变更就重跑 effect 并把计数归零 ⇒ 不存在「重试完就永久空白」。
- **素材全程无降采样**（仍未做）：原图入库、原图渲染（节点 / 结果组 / 时间轴 / 日志 / 版本历史都直接挂原图 objectURL）。单张 4000×3000 解码后常驻约 48MB，多图会累积成内存压力。
- **已证伪的怀疑**：拖动 / 缩放 / 平移**不会**让 `useAsset` 重建 blob（`createObjectURL` 增量为 0，帧间隔 p50=6ms、零掉帧）。`useSyncGraph` 的 tick 只在 graph 变化时 +1，而 selection / viewport 不在 graph 里。别往这个方向查。
- **冒烟计时只认「应用侧时钟」**（M6-26 教训）：起点取页面里第一次 `blob.arrayBuffer()`。Node 侧点按钮那一刻含 Playwright 经 CDP 灌几 MB 字节的开销——同一张 5.4MB 图 drop 路径 270ms、`setFiles` 路径端到端多出约 1s（曾误测成 1249ms + 728ms 长任务，虚惊一场）。**能计数的就别计时**：G55 的「走 `crypto.subtle`」「未调 `createImageBitmap`」都改用探针计数断言。

## canvas · 结果组与容器坐标

- **结果落位（§6.8 / §6.16）**：`shouldCollect` 四条 —— `assets>1` ‖ `callCount>1`（批量展开，逐次只看得见 1 张）‖ `containerKind`（容器运行）‖ `sourceType∈{group,batch}`。N=1 独立生成节点不建组、产物直接回填并按真实比例呈现；N≥2 进结果组、组内统一 `RESULT_CELL`（200×200）；**拖出 / 复制出**再按 `naturalSize` 恢复真实比例。
- **`naturalSize` 存在节点 data 上，不查库**：纯函数层（reducer / clipboard / 拖出）不必 `await` 素材库。**产物属性不是输入，绝不能进指纹**（否则「刚生成完就把自己标陈旧」，G41 实测）。
- **素材只在 `commit` 落库一次**（`finalize` 只负责建组；N=1 根本不走 finalize ⇒ 放 finalize 就永远不落库）。
- **容器运行必须显式声明**：画板运行传的是 `boardSubgraph`（**子图里没有容器自己**），故「是不是容器运行」推断不出来，由调用方在 `RunOrigin.subgraph.containerKind` 声明（`containerKindOf(node)` 只能覆盖分组/批量这类「父在子图内」的情形）。
- **容器内布局一律用局部坐标**：绝对定位子元素传世界坐标会二次累加（图整片飞到框外而 DOM 全绿）；折叠几何**现算不落库**（`resultGroupViewRect`）故往返无损；**派生 > 照抄没人写的字段**（`rg.summary` 从不回写）。
- **世界坐标换算：父级不一定是节点** —— 结果组子节点要回 `resultGroups` 表查原点，用 `toWorldRectInGraph(node, graph)`，不能 `toWorldRect(node, parent)`（M6-25 由此修掉两个坐标洞：`dropPointOf` 落点、`PanelLayer` 面板锚定飞到画布原点）。
- **组内子结果 = 真节点（M6-25）**：`NodeLayer.renderChild` 经 `renderChild` prop 注入 `ResultGroupLayer`；`.group` 整层 `pointer-events:none`，须 `.group [data-node-id]{pointer-events:auto}` 显式打开（继承属性）。组内子节点**不渲染端点**（`portsHidden`）。
- **拖动即取出**：越过 `EXTRACT_THRESHOLD = 4`（屏幕 px）即 `armExtractOnMove` 派发 `node.reparent`（监听注册在 `drag.begin` 之后 ⇒ 先改 local 再换算落库）。**单击不得误取出**：`resolveDropOutcome` 加「结果组子节点落点仍在组内 → `{kind:'none'}`」。**拖集合时组内子节点要剔除**（`resolveDragIds`，挪 local 会拖乱组内版面）。
- **取出 / 删除后剩余按格位前移补位**（`reflowResultGroup`，reducer 辅助；仅 patch 有位移的），**容器尺寸刻意不缩**。

## canvas · 生成与陈旧

- **陈旧判定**：`staleReport` 唯一式子「当前指纹 ≠ 最近一次成功生成的指纹」；无基线（从未成功）两边都不进；**清除依据是 `fresh` 集合**（「不在陈旧里」不构成清除理由）；手动清除记「清除那一刻的指纹」，指纹再变即失效。指纹排除 `assetHash` / `naturalSize` / `thumbOrder` / `upstreamHidden` / `hiddenIds` / `hiddenPromptIds`。
- **按范围重跑**：全图口径（仅刷新陈旧 / 全图重跑）只在顶栏，节点口径在右键菜单；「仅刷新陈旧」走**现算指纹**而非读 `node.stale`。
- **复制粘贴**：剪贴板存**快照**（可跨删除 / 跨项目），顶层包围盒归零 + `parentId:null`、后代保持 parentId 与 local；**id 列表字段必须重映射**（否则粘出的容器指向原件的孩子）；只复制两端都在集合内的连线。

## canvas · 渠道与协议

- **`ChannelAdapter` 五方法**：`verify` / `listModels` / `generateImage` / `generateVideo` / `completeText`；依赖 `ChannelDeps = Pick<PlatformKit,'network'|'assets'>`。
- **生图按输入分叉**：`imageInputsOf(request.inputs)` 非空 → `/v1/images/edits`（multipart，重复 `image` 字段，≤4 张、按 hash 去重）；否则 `/v1/images/generations`。**素材读不到**才回落 generations；**端点不支持如实报错、不静默降级**（否则用户以为参考图生效了）。挑选规则收口在 `domain/shared/execution/inputs.ts`（`flattenInputs` / `imageInputsOf` / `MAX_IMAGE_INPUTS=4`）。
- **`models`（用户勾选）vs `modelCache`（拉回全部）双层**；**未声明能力 = 不设限，不能 `?? 1` 取最小值**（把「没有信息」渲染成「参数坏了」）。
- 设置页三按钮分问三个问题（验证地址 / 验证协议 / 拉取模型）；**「填一处 → 点另一处」的按钮必须先落库**（表单态 vs 落库态）。`asAppError`：平台层抛的不是 `Error`，用户可见面不许出现 `[object Object]`。
- **OpenAI 协议**：`normalizeBaseUrl`（剥 `/v1`）/ `openAiImageSize`（比例→像素，表外不发）/ `openAiImageQuality`（只放行 4 档）；`resolution` 刻意不发。**协议适配器不能只有 mock 一个联调对象**（mock 不看参数、不校验地址，会把整类缺陷挡在视野外）。

## comic

- 模型 Project→Episode(话)→Page(页)→Panel(格)。页 = 切割树 `layout`（叶子只持 `panelId`）+ 内容池 `panels`（**版式与内容解耦**）；格 = `scene` / `shot` / `balloons`（对白贴纸，格内 0..1 相对坐标，**不烘进图**）。**几何与顺序彻底解耦**：h 切沿 y 分行、v 切沿 x 分列，`children[0]` 恒最上/最左；**RTL 只重排阅读序号、不动几何**。空 `layout` = 未排版。读回 `normalizeComicProject` 只补不删。
- 阅读层：**页序 = 叙事序、不随方向翻转**（方向只管格内顺序与翻页手感，`rtl` 下 `←` 才前进）；双页 `spreadGroups`（`loneFirst`）/ `spreadNeighbor` / `spreadSlots`（定长 2、方向镜像）；**步进变「一组」但边界判定同源**；版式是 UI 态、刷新回落单页。
- **拖拽翻页 `dragNav`**（`dragAxis` / `dragTurnThreshold=clamp(48,120,w*0.28)` / `dragIntent` / `dragTurnOffset` 自由 0.55、撞边阻尼 0.22、上限 ±72 / `dragTurnVerdict`）**必须与 `readerNav` 共用同一套「屏幕方向→叙事增量」映射**，否则出现第二套翻页语义。纵向手势不劫持（`.stage` `touch-action:pan-y`）。reduced-motion 保留跟手、只去掉过场。
- 对白三纯函数（`movedBalloonRect` / `resizedBalloonRect` 左上角固定、尺寸夹 `[MIN,1]`、尾巴按相对比例跟随 / `movedTail` 夹 `[0,1]`、无尾巴返 `null`）：**气泡与尾巴一体参与平移缩放 ⇒ 唯一能改尾巴指向的是拖尾巴**（少了它会同时冒出「拖走气泡尾巴留原地」与「放大把尾巴吞进气泡」两个 bug）。三条命令 `balloon.move` / `balloon.resize` / `balloon.moveTail` 正交，刻意不合并成 patch。`BalloonLayer` 存**起点快照 `base` + 抓取偏移** ⇒ 预览与提交同源。手柄只在选中格渲染；**尾巴堆叠分两态**；尺寸手柄 `translate(-100%,-100%)` 落在贴纸内侧（格子 `overflow:hidden` 骑角会被裁）。
- 留痕与回退（M6-15）：留痕作为 `ComicPanel.runs` **住在格内**（单写通道，不给 comic 另开表 —— 开表立刻制造「两处真相要同步」）；**只增不减**（comic `canUndo()` 恒 false）；版本号由历史自身推出（载荷 `PanelRunInput = Omit<ComicPanelRun,'version'>` 把这条变成类型约束）；**回退本身追加为新版本**（不拨指针）。快照只记影响画面的字段，**不含对白与转场**。`assetHash`（画面真相）vs `livePanelRun`（历史真相），**唯一分叉 = 成功但渠道没回图**。`canRestorePanelRun` 只放行 `succeeded && outputHashes.length>0`（失败版本如实留痕但界面灰掉）。`panelRunFromRecord` 沿用引擎 `record.id` 作留痕 id（幂等）。
- 导出：页码走**页脚带不压画面**（每页下方延伸 4.5% 页高留白带）、**默认关**；锚点帖视觉槽位外侧（与页序无关）；`pageBadgeText` 上移到 `model/pageNumber`，缩略角标与导出页脚共用一个函数；`sheetSvg` 的 `pageNumbers` 收现成文案数组、**长度不匹配整体不打**（宁可缺号不打错号）。SVG 底色写死、折行按字宽估算（保纯函数）。跨页导出**复用 `spreadGroups`/`spreadSlots`**。缺素材不阻塞（跳底图、如实报 `emptyPages`）。
- 缩略（M6-9）：`overviewCells` 把 `layoutRects` → `{x,y,w,h,order,assetHash?}` 并**按阅读顺序输出**（DOM 顺序 = 阅读顺序，rtl 镜像是渲染自然结果）；`assetHash` 缺失即不挂 `useAsset`；**对白层不进缩略**。`pageBadgeText(i)` 是叙事页码，刻意不随方向镜像。

## 缺口速查（权威版见 `轻画-功能对账清单.md`）

| # | 缺口 | 性质 |
|---|---|---|
| ~~9~~ | ~~**小地图**（§6.4）~~ → **✅ 已交付（M6-27）** | `domain/canvas/minimap`（投影纯函数 16 项单测）+ `surface/Minimap.tsx`；范围只由内容决定（防拖拽自我放大）、视口框保尺寸钉回框内。冒烟 **G56 14 项**（含像素断言 + 抹掉填充塌零的故障注入） |
| ~~8~~ | ~~**日志「请求像素 / 实际像素」**~~ → **✅ 已交付** | §6.18 | 两组字段分开采集：`requestedWidth/Height`（渠道翻译比例后回填）与 `outputWidth/Height`（**从产物字节文件头读**，`imageSizeFromHeader`）。**两个数同源 = 缺口没填上**：照抄请求会让「请求 = 实际」恒成立。故障注入（把 `outputWidth` 改成 `requestedWidth` ⇒ ★ 单测红）是唯一的定性证明；engine 层那条两侧相等的 mock 用例**证明不了这一点**（两个数本就相等），故另配 `stubChannel`（请求 1024×1024 / 产物 7×3） |
| 11 | 右键菜单补项（禁用 / 改写提示词 / 全屏编辑）、画板内空白右键 | 未做 |
| 10 | 无障碍（aria-live、`Alt+方向键`、44×44 命中区） | 覆盖不全 |
| 14′ | 结果组**整体移动 / 解散 / 删除**的界面入口（`resultGroup.dissolve` 命令零调用方） | 子结果交互（原 #14）已由 M6-25 交付，此为其遗留 |
| ~~15~~ | ~~**上传性能**~~ → **✅ 已交付（M6-26）** | `assets` 插队落库 + `fingerprintBytes` 走 `crypto.subtle` + 宽高读文件头 + `useAsset` 重试窗口放宽。同一张 5.4MB 图：端到端 1067ms→230ms（应用侧）、最长长任务 728→62ms、连传 3 张全可见。冒烟 **G55 9 项** |

## 文档索引

产品文档（§15 里程碑、§11 渠道契约、§6.8 生成行为、§6.9 结果组）、架构文档（§5.5 执行引擎、§5.10/§9.4 新工作台）、功能对账清单。随代码同步更新。
