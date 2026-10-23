<p align="center">
  <img src="src-tauri/icons/128x128.png" width="96" alt="轻画 QING HUA" />
</p>

<h1 align="center">轻画 · QING HUA</h1>

<p align="center">本地优先的 AI 图片 / 视频创作工作台</p>

<p align="center">
  <a href="https://github.com/heyu1084916812/qinhua-canvas/releases/latest">下载最新版</a>
  ·
  <a href="文档总索引.md">文档索引</a>
  ·
  <a href="RELEASE_NOTES.md">发行说明</a>
</p>

---

轻画把**无限画布、电商套图、漫剧分镜、素材库和多渠道模型配置**收在一个本地优先的工作空间里。
目标不是堆功能，而是让素材能一路走到生成、比较、编辑、保存和复用——数据留在自己的机器上，
不因为换工具而反复搬运文件。

## 下载

当前桌面版：**v0.1.5**（Windows 10 / 11 x64）

- [GitHub Releases](https://github.com/heyu1084916812/qinhua-canvas/releases/latest)
- 安装包：`qinghua_0.1.5_x64-setup.exe`（约 40.2 MiB）
- 桌面端基于 Tauri 2；首次运行需要系统具备 WebView2（Windows 10/11 通常已自带）

## 核心能力

- **无限画布**：提示词、生成、对比、批量、循环、融合等节点自由编排；单点生成、批量展开、局部回填都能回到可继续编辑的节点。
- **提示词工作流**：面板草稿 → LLM → 节点正文；支持技能、优化、翻译、反推，也可以直接双击节点手写正文。
- **多模型渠道**：OpenAI 兼容中转、65535、SoonStudio、ComfyUI、RunningHub、ModelScope 等；按模型能力与渠道规则路由。
- **电商工作台**：商品套图、主图、详情页、白牌图、精修、换色、视频复刻、模特穿戴等连续任务；任务与结果持久化，不因刷新丢失。
- **漫剧工作台**：小说 → 分集 → 分镜 → 提示词 → 出图 / 视频；角色与场景资产库跨集复用。
- **素材与灵感库**：生成历史、收藏、标签、项目素材和外部灵感来源统一管理；删除与回收站区分“移除记录”和“删除文件”。
- **技能库**：内置技能与用户技能分层管理，支持导入、编辑、导出；Agent 与提示词节点共用同一套技能正文。
- **桌面壳**：Tauri 2 + Rust 本地共享存储 sidecar；NSIS 安装包与自动更新清单。

## 快速开始

1. 从 [Releases](https://github.com/heyu1084916812/qinhua-canvas/releases/latest) 下载并安装。
2. 打开「全局设置 → 渠道配置」，填入你自己的渠道地址、密钥并勾选模型。
3. 新建画布项目，或从「电商 / 漫剧」进入对应工作台。
4. 生成结果会落在本地素材链里，可继续对比、编辑、收藏或导出。

密钥只保存在本机，由你配置的渠道直接请求上游；轻画不提供云端账号体系，也不把项目内容上传到自有服务器。

## 本地开发

环境要求：Node.js `^20.19.0 || >=22.12.0`、Rust stable（桌面端）、Windows 10/11。

```bash
npm install

# 浏览器开发版：Vite + 本地共享存储
npm run dev

# 桌面开发版：Tauri + Vite + 本地共享存储
npm run tauri dev
```

常用校验：

```bash
npm test          # Vitest 全量单测
npm run check     # tsc + eslint + 依赖边界 + 主题/文档等守卫
npm run build     # 前端生产构建
```

桌面安装包：

```bash
node scripts/release-desktop.mjs
```

发版脚本会构建前端 + Rust + NSIS、生成 updater 签名与 `latest.json`，并对 release 产物做真机启动门禁。
更新私钥默认从 `%USERPROFILE%\.tauri\qinghua-updater.key` 读取，不会进入仓库。

## 项目结构

```text
src/
  app/          应用壳、路由、全局 Provider
  pages/        首页 / 项目 / 画布 / 电商 / 漫剧 / 技能库 / 灵感库 / 设置
  workbenches/  画布、漫剧等工作台交互
  domain/       节点规格、执行计划、提示词与渠道领域逻辑
  features/     跨页面能力（执行、导入、提示词工具等）
  state/        项目、画布、渠道、技能、素材状态
  platform/     浏览器 / Tauri / 渠道适配
src-tauri/      Tauri 桌面壳
shared-store/   本地共享存储 sidecar（Rust）
scripts/        测试、冒烟、发版与交付门禁
```

## 文档

项目文档较多，**判断“某功能到底做没做”以对账清单为准**：

- [文档总索引](文档总索引.md) —— 哪份文档是什么、冲突时信哪份
- [功能对账清单](轻画-功能对账清单.md) —— 唯一真相源：已实现 / 缺口 / 证据
- [产品设计文档](轻画-产品设计文档.md) —— 产品语义与交互
- [架构设计文档](轻画-架构设计文档.md) —— 分层、依赖方向与契约
- [Agent 设计文档](轻画-Agent设计文档.md) —— 画布 Agent 的机制与工具
- [桌面封装方案](轻画-桌面封装方案.md) —— Tauri、自动更新与发版
- [发行说明](RELEASE_NOTES.md) —— 各版本交付内容与已知问题
- [AGENTS.md](AGENTS.md) —— 开发约定、测试与提交流程

## 已知限制

- 当前主要发行形态是 **Windows 桌面版**；macOS / Linux 尚未提供正式安装包。
- AI 能力取决于你配置的渠道与模型；不同上游对图片、视频、工具调用和多模态输入的支持并不一致。
- 项目仍在持续开发中。功能状态、缺口与优先级以[功能对账清单](轻画-功能对账清单.md)为准。

## 参与开发

- 开工前先读 `AGENTS.md`、`文档总索引.md` 和 `轻画-功能对账清单.md`。
- 新需求先登记到对账清单，完成后同轮补状态与证据。
- 提交前至少跑 `npm test`、`npm run check`、`npm run build`；改动可见界面时补冒烟或截图级断言。
- 每次改动单独提交；**未经确认不推送**。

## 许可证

本仓库目前未附带 `LICENSE` 文件。未明确授权前默认保留所有权利；如需商用、二次分发或基于本项目提供服务，请先联系作者确认。
