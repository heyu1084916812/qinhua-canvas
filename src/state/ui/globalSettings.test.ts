import { beforeEach, describe, expect, it } from 'vitest'
import {
  GLOBAL_SETTINGS_GROUPS,
  GLOBAL_SETTINGS_SECTIONS,
  __resetGlobalSettingsForTest,
  closeGlobalSettings,
  getGlobalSettings,
  matchSettingsSections,
  openGlobalSettings,
  subscribeGlobalSettings,
} from './globalSettings'

/**
 * 全局设置浮层的状态（用户 2026-10-06 定，对账 #259）。
 *
 * 它是模块级单例 ⇒ 每个用例前复位（与 `sidebarState` 同一套路子）。
 * 这里钉住的都是"写错就没人发现"的地方：**默认落在渠道配置**、
 * **关掉后记住上次那一栏**、以及**已开着且栏目没变时不重复通知**（免得白重渲）。
 */
describe('globalSettings · 全局设置浮层', () => {
  beforeEach(() => {
    __resetGlobalSettingsForTest()
  })

  it('★ 初始是关着的（不替用户打开）', () => {
    expect(getGlobalSettings().open).toBe(false)
    expect(getGlobalSettings().section).toBe('channels')
  })

  it('★ 默认落在「渠道配置」；也可以直接指定栏目', () => {
    openGlobalSettings()
    expect(getGlobalSettings().open).toBe(true)
    expect(getGlobalSettings().section).toBe('channels')

    openGlobalSettings('hosting')
    expect(getGlobalSettings().section).toBe('hosting')
  })

  it('★★ 画布里的「去后台设置」能一步落到渠道配置（不是只打开浮层）', () => {
    openGlobalSettings('hosting')
    closeGlobalSettings()
    openGlobalSettings('channels')
    expect(getGlobalSettings()).toEqual({ open: true, section: 'channels' })
  })

  it('★★ 关掉后保留上次那一栏（下次打开回到原处）', () => {
    openGlobalSettings('hosting')
    closeGlobalSettings()
    expect(getGlobalSettings().open).toBe(false)
    expect(getGlobalSettings().section).toBe('hosting')
    openGlobalSettings('hosting')
    expect(getGlobalSettings()).toEqual({ open: true, section: 'hosting' })
  })

  it('★★ 已开着且栏目没变时不通知订阅者（避免白重渲）', () => {
    openGlobalSettings('channels')
    let hits = 0
    const off = subscribeGlobalSettings(() => {
      hits += 1
    })
    openGlobalSettings('channels') // 同栏、已开着 ⇒ 无事发生
    expect(hits).toBe(0)
    openGlobalSettings('hosting') // 换栏 ⇒ 要通知
    expect(hits).toBe(1)
    closeGlobalSettings()
    expect(hits).toBe(2)
    closeGlobalSettings() // 已经关着 ⇒ 不通知
    expect(hits).toBe(2)
    off()
  })

  it('★ 子菜单与内容一一对应（标签与内容一处定义）', () => {
    // 顺序即浮层里那排标签的顺序：渠道配置 / CLI / 素材传输 / 存储 / 主题与颜色 / 字体与文字 /
    // 画布外观 / 备份与恢复 / 快照 / 默认参数 / Agent 与记忆 / 扩展包 / 帮助 / 快捷键 / 关于与隐私 / 通知
    // （#259 + #261 + #308；「外观与体验」与「备份与恢复」为用户 2026-10-09 新增：
    //   前者 = 自定义字体 / 界面字号 / 字距；后者 = 全量备份导出与导入 #378；
    //   「扩展包」= 数据型扩展包（技能 + 电商平台规则），对账 #386 阶段一）。
    // CLI 必须**紧跟在渠道配置下面** —— 用户 2026-10-06 第 11 批第 4 条的原话就是
    // 「就在渠道配置的下面」，所以这条断言也锁顺序，不只是锁"有没有"。
    // ⚠️ 新增栏目要追加在**末尾**：CLI 与渠道配置的相对顺序是用户拍过的，不能动。
    expect(GLOBAL_SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
      'channels',
      'cli',
      'hosting',
      'storage',
      'allLogs',
      'appearance',
      'typography',
      'canvasLook',
      'backup',
      'defaults',
      'agentMemory',
      'packs',
      'snapshots',
      'help',
      'shortcuts',
      'about',
      'notify',
    ])
    expect(GLOBAL_SETTINGS_SECTIONS.map((s) => s.label)).toEqual([
      '模型服务',
      'CLI',
      '素材传输',
      '存储',
      '总日志',
      '主题与颜色',
      '字体与文字',
      '画布外观',
      '备份与恢复',
      '默认参数',
      'Agent 与记忆',
      '扩展包',
      '快照',
      '帮助',
      '快捷键',
      '关于与隐私',
      '通知',
    ])
  })

  it('★★ 每个栏目都归到五组之一，且组顺序固定（新增栏目忘了分组会在这里红）', () => {
    const groups = GLOBAL_SETTINGS_SECTIONS.map((s) => s.group)
    // 组只能取这五个（漏写 group 会是 undefined ⇒ 立刻红）
    for (const g of groups) {
      expect(GLOBAL_SETTINGS_GROUPS).toContain(g)
    }
    // 归属：连接类进"连接"、备份与存储进"数据"、字体进"外观"
    const byId = new Map(GLOBAL_SETTINGS_SECTIONS.map((s) => [s.id, s.group]))
    expect(byId.get('channels')).toBe('连接')
    expect(byId.get('cli')).toBe('连接')
    expect(byId.get('hosting')).toBe('连接')
    expect(byId.get('storage')).toBe('数据')
    expect(byId.get('allLogs')).toBe('数据')
    expect(byId.get('backup')).toBe('数据')
    expect(byId.get('notify')).toBe('数据')
    expect(byId.get('appearance')).toBe('外观')
    expect(byId.get('typography')).toBe('外观')
    expect(byId.get('canvasLook')).toBe('外观')
    expect(byId.get('snapshots')).toBe('数据')
    expect(byId.get('shortcuts')).toBe('系统')
    // 组顺序 = 界面渲染顺序，不能随手调
    expect(GLOBAL_SETTINGS_GROUPS).toEqual(['连接', '生成', '外观', '数据', '系统'])
  })
})

/**
 * **设置搜索基线**（对账 #385）。
 *
 * 用户找设置时想的是**事情**不是栏目名：「字体」在「外观与体验」里、「图床」在「素材传输」里、
 * 「快照」在「备份与恢复」里 —— 只搜标签的话这些一条都命中不了。
 * 所以每个栏目必须带一组"用户可能敲的词"，这里既守匹配行为，也守"新栏目别忘了带词"。
 */
describe('globalSettings · 搜索', () => {
  const ids = (query: string) => matchSettingsSections(query).map((s) => s.id)

  it('空查询 / 纯空格：菜单是完整的（十五栏一个不少）', () => {
    expect(ids('')).toEqual(GLOBAL_SETTINGS_SECTIONS.map((s) => s.id))
    expect(ids('   ')).toHaveLength(GLOBAL_SETTINGS_SECTIONS.length)
  })

  it('★★ 按"事情"搜得到：字体→字体与文字、画布→画布外观、图床→素材传输、快照→快照', () => {
    expect(ids('字体')).toEqual(['typography'])
    expect(ids('画布外观')).toEqual(['canvasLook'])
    expect(ids('图床')).toEqual(['hosting'])
    expect(ids('快照')).toEqual(['backup', 'snapshots'])
    expect(ids('快捷键')).toEqual(['shortcuts'])
  })

  it('★ 大小写不敏感（CLI / cli 都命中），英文别名也认（key / token）', () => {
    expect(ids('CLI')).toEqual(['cli'])
    expect(ids('cli')).toEqual(['cli'])
    expect(ids('key')).toContain('channels')
  })

  it('★ 组名也参与匹配：敲「数据」能找到整组（外加"关于与隐私"里那条"数据在哪"）', () => {
    /**
     * 精确列出而不是 `toContain`：「关于与隐私」命中是因为它的关键词里有**「数据在哪」**
     * （那一栏确实回答这个问题）—— 这是**有意的**结果，不是漏网的噪声，
     * 所以把它写进期望里，将来谁改关键词都会先看到这条。
     */
    expect(ids('数据')).toEqual([
      'storage',
      'allLogs',
      'backup',
      'snapshots',
      'about',
      'notify',
    ])
  })

  it('搜不到就是空（界面据此给"没有匹配"的提示，而不是留一片空白菜单）', () => {
    expect(ids('zzz-不存在的东西')).toEqual([])
  })

  it('★★ 每个栏目都带搜索词（新增栏目忘了写 keywords 会在这里红）', () => {
    for (const s of GLOBAL_SETTINGS_SECTIONS) {
      expect(s.keywords.length, `${s.id} 缺 keywords`).toBeGreaterThan(0)
    }
  })
})
