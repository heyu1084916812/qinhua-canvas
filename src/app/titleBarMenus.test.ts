import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AppMenuContent, EditShortcuts, SHORTCUTS } from './titleBarMenus'

/**
 * 自绘标题栏的菜单内容（对账 #283）。
 *
 * 为什么用单测钉而不是冒烟：标题栏**只在桌面壳里渲染**（浏览器里 `isTauri()` 为假直接返回 null），
 * 冒烟跑在浏览器里够不着它。所以"菜单里到底列了什么、格式对不对"由这里守，
 * 布局观感由真窗口截图守。
 */
describe('标题栏 · 编辑菜单（快捷键表）', () => {
  const html = renderToStaticMarkup(createElement(EditShortcuts))

  it('★★ 只保留用户点名的 9 条，顺序一致（其余删掉）', () => {
    expect(SHORTCUTS.map((s) => s.what)).toEqual([
      '撤销',
      '重做',
      '复位视图',
      '打组',
      '下一个节点',
      '运行节点',
      '删除',
      '平移画布',
      '缩放画布',
    ])
    expect((html.match(/data-title-shortcut="/g) ?? []).length).toBe(9)
  })

  it('★★ 文案精简：不出现括号解释（"复位视图（缩放到全部节点）"那种）', () => {
    for (const row of SHORTCUTS) {
      expect(row.what).not.toMatch(/[（(]/)
    }
    expect(html).not.toContain('缩放到全部节点')
    expect(html).not.toContain('打成一组')
  })

  it('★★ 按键**没有胶囊**：不再用 <kbd>，而是普通 span（用户第 3 条）', () => {
    expect(html).not.toContain('<kbd')
    expect((html.match(/data-title-shortcut-keys/g) ?? []).length).toBe(9)
  })

  it('★ 按键文字一个字不少（去掉胶囊后不该顺手删内容）', () => {
    for (const row of SHORTCUTS) {
      expect(html).toContain(row.keys)
    }
  })
})

describe('标题栏 · 应用菜单', () => {
  /** 全屏那一条（用户 2026-10-06 第 11 批第 7 条「顺手加全屏」）的公共 props */
  const base = { fullscreen: false, onToggleFullscreen: () => {} }

  it('★ 有版本号 / 仓库地址 / **全屏**三项；拿不到版本号时如实说"开发预览"', () => {
    const withVersion = renderToStaticMarkup(
      createElement(AppMenuContent, { version: '0.1.0', onOpenRepo: () => {}, ...base }),
    )
    expect(withVersion).toContain('v0.1.0')
    expect(withVersion).toContain('GitHub 项目地址')
    expect((withVersion.match(/data-title-fullscreen/g) ?? []).length).toBe(1)

    const withoutVersion = renderToStaticMarkup(
      createElement(AppMenuContent, { version: '', onOpenRepo: () => {}, ...base }),
    )
    expect(withoutVersion).toContain('开发预览')
  })

  it('★ 全屏那条文案跟着状态变（进/出全屏两个说法），并标出当前态', () => {
    const off = renderToStaticMarkup(
      createElement(AppMenuContent, { version: '0.1.0', onOpenRepo: () => {}, ...base }),
    )
    const on = renderToStaticMarkup(
      createElement(AppMenuContent, {
        version: '0.1.0',
        onOpenRepo: () => {},
        fullscreen: true,
        onToggleFullscreen: () => {},
      }),
    )
    expect(off).toContain('全屏（F11）')
    expect(off).not.toContain('退出全屏')
    expect(on).toContain('退出全屏（F11）')
    expect(on).toContain('aria-pressed="true"')
  })
})
