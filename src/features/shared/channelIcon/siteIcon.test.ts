import { describe, expect, it } from 'vitest'
import {
  fetchSiteIcon,
  isRasterImageType,
  siteIconCandidates,
  type SiteIconDeps,
} from './siteIcon'

/**
 * 「从网站抓站点图标」（对账 #396）。
 *
 * 测的是**判断**，不是网络：取字节那一步注入假实现，所以 node 环境里就能跑完
 * （真去发请求既慢又不稳，还会把测试变成"看别人家站点脸色"）。
 */

const bytes = new Uint8Array([1, 2, 3])

function deps(
  get: SiteIconDeps['get'],
  toIcon: SiteIconDeps['toIcon'] = async () => 'data:image/png;base64,AAA',
): SiteIconDeps {
  return { get, toIcon }
}

describe('siteIconCandidates', () => {
  it('只取 origin：用户填的 API 路径不要带进图标地址', () => {
    expect(siteIconCandidates('https://api.example.com/v1')).toEqual([
      'https://api.example.com/favicon.ico',
      'https://api.example.com/apple-touch-icon.png',
    ])
  })

  it('没写协议按 https 补（用户多半只敲域名）', () => {
    expect(siteIconCandidates('example.com')[0]).toBe('https://example.com/favicon.ico')
  })

  it('端口要留着（本地服务常挂在非常规端口上）', () => {
    expect(siteIconCandidates('http://127.0.0.1:1420/')).toEqual([
      'http://127.0.0.1:1420/favicon.ico',
      'http://127.0.0.1:1420/apple-touch-icon.png',
    ])
  })

  it('空串 / 非 http 协议给空数组（调用方据此提示，而不是去发奇怪请求）', () => {
    expect(siteIconCandidates('')).toEqual([])
    expect(siteIconCandidates('   ')).toEqual([])
    expect(siteIconCandidates('ftp://example.com')).toEqual([])
  })
})

describe('isRasterImageType', () => {
  it('带参数的 image/png 算图片', () => {
    expect(isRasterImageType('image/png; charset=binary')).toBe(true)
    expect(isRasterImageType('IMAGE/PNG')).toBe(true)
  })

  it('SVG 不算（canvas 解不了矢量图，收下只会变成之后那一步失败）', () => {
    expect(isRasterImageType('image/svg+xml')).toBe(false)
  })

  it('网页 / 空类型都不算', () => {
    expect(isRasterImageType('text/html; charset=utf-8')).toBe(false)
    expect(isRasterImageType('')).toBe(false)
  })
})

describe('fetchSiteIcon', () => {
  it('第一条没抓到就用第二条，并如实回报实际抓的那条地址', async () => {
    const asked: string[] = []
    const out = await fetchSiteIcon(
      'https://shop.example.com',
      deps(async (req) => {
        asked.push(req.url)
        if (req.url.endsWith('/favicon.ico')) {
          return { status: 404, contentType: 'text/html', bytes }
        }
        return { status: 200, contentType: 'image/png', bytes }
      }),
    )
    expect(asked).toEqual([
      'https://shop.example.com/favicon.ico',
      'https://shop.example.com/apple-touch-icon.png',
    ])
    expect(out).toEqual({
      ok: true,
      dataUrl: 'data:image/png;base64,AAA',
      sourceUrl: 'https://shop.example.com/apple-touch-icon.png',
    })
  })

  it('站点把首页 HTML 当成 200 回：不当成图标，且告诉用户拿到的是网页', async () => {
    const out = await fetchSiteIcon(
      'https://example.com',
      deps(async () => ({ status: 200, contentType: 'text/html; charset=utf-8', bytes })),
    )
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toContain('网页')
  })

  it('全部取不回来（超时 / 拒绝）：给一句能行动的失败话术，不抛', async () => {
    const out = await fetchSiteIcon(
      'https://example.com',
      deps(async () => {
        throw new Error('timeout')
      }),
    )
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.message).toContain('没抓到图标')
      expect(out.message).toContain('手动上传')
    }
  })

  it('拿到字节但解不成图：同样回落成"手动上传"，不做半截写入', async () => {
    const out = await fetchSiteIcon(
      'https://example.com',
      deps(
        async () => ({ status: 200, contentType: 'image/png', bytes }),
        async () => {
          throw new Error('decode failed')
        },
      ),
    )
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toContain('解不成图片')
  })

  it('地址是空的：提示先填地址，一次请求都不发', async () => {
    let calls = 0
    const out = await fetchSiteIcon(
      '',
      deps(async () => {
        calls += 1
        return { status: 200, contentType: 'image/png', bytes }
      }),
    )
    expect(calls).toBe(0)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toContain('地址')
  })

  it('把超时传给网络层（默认 8s：抓图标不该等半分钟）', async () => {
    const seen: (number | undefined)[] = []
    await fetchSiteIcon(
      'https://example.com',
      deps(async (req) => {
        seen.push(req.timeoutMs)
        return { status: 404, contentType: '', bytes }
      }),
    )
    expect(seen).toEqual([8000, 8000])
  })
})
