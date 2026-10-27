/**
 * 「全局设置」浮层的**纯 UI 态**（用户 2026-10-06 定，对账 #259）。
 *
 * 三条口径（都是用户原话）：
 * 1. 它是**模态浮层**：打开时整窗盖一层遮罩，「需要关掉才能点击其他的功能」；
 * 2. 入口在**侧栏底部**、排在「检查更新」**上方**（不是一级导航）；
 * 3. 打开时**可以直接落到某一栏**：画布里的「去后台设置」= 打开浮层**并落到渠道配置**
 *    （用户明确「不单单是打开浮层」）—— 所以 `open()` 收一个栏目参数。
 *
 * 与 `sidebarState` 同一套路子：模块级订阅值 + **不落盘**。
 * 它是"现在有没有挡着一层窗"，跟业务数据无关，也不该被持久化
 * （谁都不想重启后被设置挡住）。
 *
 * ⚠️ **为什么它在 `state/ui/` 而不在 `app/`**：`侧栏状态` 只有壳层用，放 `app/` 没问题；
 * 但这一份**画布页也要用**（画布里的「去后台设置」= 打开浮层并落到渠道配置）。
 * 分层表里 `pages` 不能依赖 `app`（那是向上依赖），而 `state` 是两侧都能依赖的一层 ——
 * 架构 §2.1 的分层图里本来就留了 `state/ui` 这个切片，这里就落在它身上。
 */

export type GlobalSettingsSection =
  | 'channels'
  | 'cli'
  | 'hosting'
  | 'storage'
  /** 总日志：跨项目汇总同一份 RunRecord，不复制日志库。 */
  | 'allLogs'
  /**
   * 主题与颜色（用户 2026-10-25）：明暗主题与强调色。
   *
   * 它是**本机界面偏好**：字体 / 字号 / 字距。与业务配置分栏放，
   * 因为改它不会影响任何项目数据（也正因为如此，它是这一批里风险最低的一栏）。
   */
  | 'appearance'
  | 'typography'
  | 'canvasLook'
  /**
   * 备份与恢复（用户 2026-10-09，对账 #378）。
   *
   * 与「存储」分工：「存储」回答"东西在哪"，「备份与恢复」回答"出事怎么办"。
   * 两件事紧急程度不同，混在一起会被日常项淹没，故单开一栏。
   */
  | 'backup'
  | 'snapshots'
  /**
   * 扩展包（用户 2026-10-09：「toonflow 的那个插件市场这种」，对账 #386）。
   *
   * 它装的是**内容**（技能 + 电商平台规则），归「生成」组 ——
   * 与「技能库」同类：都是"改一次、以后每次生成都用得上"的东西。
   */
  | 'packs'
  /**
   * 帮助（对账 #388 / E7）：快捷键 / 常见问题 / 版本与更新 + 重看新手引导。
   *
   * 归「系统」组：它不配置任何东西，只回答"我现在卡住了怎么办"。
   */
  | 'help'
  | 'shortcuts'
  /**
   * 关于与隐私（对账 #386 的 E6）：数据在哪 / 何时联网 / 凭据怎么存 / 卸载与清数据 / 开源许可。
   *
   * 与「帮助」分开：帮助回答"怎么用"，这里回答"交给你用之前我要知道的事"。
   */
  | 'about'
  /**
   * 默认参数（对账 #386 的 E4）：默认模型 / 比例 / 画质 / 张数 + 记住上次参数。
   *
   * 归「生成」组：它改的正是"新建节点时填什么"。
   */
  | 'defaults'
  /** 个人记忆：只保存用户确认过的长期偏好、事实和约束。 */
  | 'agentMemory'
  /**
   * 通知（对账 #386 的 E5）：完成 / 失败 / 批量进度三档 + 系统通知能力说明。
   *
   * 归「数据」组：它与「备份与恢复」是同一类东西 —— 出事时怎么知道、
   * 东西在哪；都不改生成行为（三档全关也照常出图）。
   */
  | 'notify'

export interface GlobalSettingsState {
  open: boolean
  /** 打开时落在哪一栏。关闭后保留 —— 下次打开回到上次看的那一栏，符合直觉。 */
  section: GlobalSettingsSection
}

/** 子菜单（浮层内那一排标签）。**标签与内容一处定义**，免得"标签写 A、内容是 B"。 */
/**
 * 设置栏目的**分组顺序**（用户 2026-10-09：「就像 cherry 的截图那个，有很多的设置而已」）。
 *
 * 参考 Cherry Studio 的组织逻辑：按**能力域**分组，而不是按"新加的就往下堆"。
 * 组标题本身即口径 —— 连接类（要去哪儿取东西）、生成类（每次出图都要动）、
 * 外观类（只改界面）、数据类（东西在哪 + 出事怎么办）、系统类（版本与说明）。
 * 顺序即界面顺序，新增组要追加在末尾。
 */
export const GLOBAL_SETTINGS_GROUPS = ['连接', '生成', '外观', '数据', '系统'] as const
export type GlobalSettingsGroup = (typeof GLOBAL_SETTINGS_GROUPS)[number]

export const GLOBAL_SETTINGS_SECTIONS: {
  id: GlobalSettingsSection
  label: string
  group: GlobalSettingsGroup
  /**
   * **搜索用的词**（对账 #385 的"搜索基线"，用户 2026-10-09：
   * 「cherry那个我是让你看他的全局设置，重点参考他的一个制作全局设置的逻辑」）。
   *
   * 为什么不是"拿标签搜就够了"：用户找设置时想的是**事情**，不是栏目名 ——
   * 「字体」在「外观与体验」里、「图床」在「素材传输」里、「快照」在「备份与恢复」里。
   * 标签里一个都对不上，搜索就白做了。所以每个栏目列一组**用户可能敲的词**（含英文与别名）。
   *
   * 口径：小写存、匹配时两边都小写（`CLI` / `cli` 都能命中）；组名也参与匹配
   * （敲「数据」能同时找到存储 / 备份与恢复 / 通知）。
   */
  keywords: readonly string[]
}[] = [
  {
    id: 'channels',
    label: '模型服务',
    group: '连接',
    keywords: ['模型服务', '渠道', '模型', '令牌', 'key', 'token', 'apikey', 'api key', '验证', '拉取', '接口', '站点'],
  },
  // 「CLI」（对账 #308）：用户点名"就在渠道配置的**下面**"——顺序即口径，别往后挪
  {
    id: 'cli',
    label: 'CLI',
    group: '连接',
    keywords: ['命令行', '本机', '终端', '一键设置', '一键登录', '安装', 'codex', 'runninghub', '即梦'],
  },
  {
    id: 'hosting',
    label: '素材传输',
    group: '连接',
    keywords: ['图床', '上传', '素材', '公网', '直链', '外链', '图床配置'],
  },
  // 「存储」（对账 #261）：存储概况 / 数据目录 / 网页缓存 / 素材文件夹
  {
    id: 'storage',
    label: '存储',
    group: '数据',
    keywords: ['数据目录', '缓存', '占用', '磁盘', '空间', '清理', '素材文件夹', '存放'],
  },
  {
    id: 'allLogs',
    label: '总日志',
    group: '数据',
    keywords: ['日志', '运行记录', '失败原因', '成功', '失败', '取消', '中断', '未分类', '路由'],
  },
  // 外观拆成三项：本机文字、主题颜色、项目画布（2026-10-25）
  {
    id: 'appearance',
    label: '主题与颜色',
    group: '外观',
    keywords: [
      '主题', '深色', '浅色', '暗色', '强调色', '颜色', '动效', '动画', '小地图', '界面',
    ],
  },
  {
    id: 'typography',
    label: '字体与文字',
    group: '外观',
    keywords: ['字体', '字号', '字距', '文本', '界面文字', '导入字体', '粗体'],
  },
  {
    id: 'canvasLook',
    label: '画布外观',
    group: '外观',
    keywords: ['画布', '画布外观', '背景色', '画布底色', '节点底色', '节点字号', '节点尺寸', '点阵', '网格', '纯色'],
  },
  // 「备份与恢复」（用户 2026-10-09）：全量备份导出 / 导入（#378）
  {
    id: 'backup',
    label: '备份与恢复',
    group: '数据',
    keywords: ['备份', '恢复', '导出', '导入', '快照', '还原', '回收站', '数据安全', '换机器'],
  },
  // 「扩展包」（对账 #386 阶段一）：数据型扩展包 —— 技能 + 电商平台规则
  {
    id: 'defaults',
    label: '默认参数',
    group: '生成',
    keywords: ['默认', '模型', '比例', '尺寸', '画质', '张数', '参数', '记住上次'],
  },
  {
    id: 'agentMemory',
    label: 'Agent 与记忆',
    group: '生成',
    keywords: [
      'agent',
      '记忆',
      '偏好',
      '个人偏好',
      '长期记忆',
      '上下文',
      '约束',
      '事实',
    ],
  },
  {
    id: 'packs',
    label: '扩展包',
    group: '生成',
    keywords: ['插件', '市场', '技能', '平台规则', '安装', '扩展', '包'],
  },
  {
    id: 'snapshots',
    label: '快照',
    group: '数据',
    keywords: ['快照', '还原', '历史', '自动快照', '项目结构'],
  },
  {
    id: 'help',
    label: '帮助',
    group: '系统',
    keywords: ['常见问题', '教程', '引导', '新手', '版本', '更新', '怎么用', '帮助'],
  },
  {
    id: 'shortcuts',
    label: '快捷键',
    group: '系统',
    keywords: ['快捷键', '键盘', 'hotkey', 'shortcut', '按键', '撤销', '重做'],
  },
  {
    id: 'about',
    label: '关于与隐私',
    group: '系统',
    keywords: ['关于', '隐私', '许可', '开源', '数据在哪', '联网', '卸载', '版本', '清数据'],
  },
  // 「通知」（对账 #386 的 E5）：完成 / 失败 / 批量进度三档 + 系统通知能力说明。
  // 追加在**末尾**（数组顺序即"新增顺序"），但 `group: '数据'` 决定它显示在
  // 「备份与恢复」下面 —— 渲染按组过滤，两件事互不冲突。
  {
    id: 'notify',
    label: '通知',
    group: '数据',
    keywords: ['通知', '提醒', '弹窗', '完成', '失败', '进度', '系统通知'],
  },
]

export type GlobalSettingsEntry = (typeof GLOBAL_SETTINGS_SECTIONS)[number]

/** 一个栏目的**可搜索文本**：标签 + 组名 + 关键词（全小写，匹配时只做包含判断） */
function searchableText(entry: GlobalSettingsEntry): string {
  return [entry.label, entry.group, ...entry.keywords].join(' ').toLowerCase()
}

/**
 * **按关键词过滤栏目**（对账 #385 的"搜索基线"，纯函数、可单测）。
 *
 * 判据只有一条：**包含**（不做分词、不做模糊拼音）。理由很具体 ——
 * 设置项十五栏（2026-10-25 拆分外观/备份/帮助），输入"字"想找的东西全都带"字"字；上分词器只会引入
 * "输一半就跳出一堆不相干"的新问题，还得维护词典。
 *
 * 空查询（或纯空格）返回**全部**：搜索框空着时菜单就该是完整的。
 */
export function matchSettingsSections(query: string): GlobalSettingsEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return GLOBAL_SETTINGS_SECTIONS
  return GLOBAL_SETTINGS_SECTIONS.filter((entry) => searchableText(entry).includes(needle))
}

let state: GlobalSettingsState = { open: false, section: 'channels' }
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) fn()
}

export function getGlobalSettings(): GlobalSettingsState {
  return state
}

/** 打开（默认落在「模型服务」）。已经开着且栏目没变时不通知 —— 免得白重渲。 */
export function openGlobalSettings(section: GlobalSettingsSection = 'channels'): void {
  if (state.open && state.section === section) return
  state = { open: true, section }
  notify()
}

export function closeGlobalSettings(): void {
  if (!state.open) return
  state = { ...state, open: false }
  notify()
}

export function subscribeGlobalSettings(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 仅供测试：复位成「关着 + 模型服务」。 */
export function __resetGlobalSettingsForTest(): void {
  state = { open: false, section: 'channels' }
  notify()
}
