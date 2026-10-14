import { describe, expect, it } from 'vitest'
import type { InspirationCase } from '../../domain/inspiration/cases'
import { downloadNameOf } from './InspirationDetail'

const CASE: InspirationCase = {
  id: 'demo:1',
  sourceId: 'demo',
  sourceName: 'Demo 源',
  title: '苹果风格海报',
  prompt: 'a poster',
  imageUrl: 'https://cdn.example.com/images/apple.png',
  tags: [],
}

describe('downloadNameOf', () => {
  it('★★ 优先用图片 URL 的真实文件名（外部来源的落盘名要和原图一致）', () => {
    expect(downloadNameOf({ ...CASE, imageUrl: 'https://cdn.example.com/a/b/cloud.jpg' })).toBe(
      'cloud.jpg',
    )
    expect(
      downloadNameOf({ ...CASE, imageUrl: 'https://cdn.example.com/a/%E4%BA%91%E6%9C%B5.png' }),
    ).toBe('云朵.png')
  })

  it('★ 不是绝对地址 / 没有文件名时用标题兜底，并清掉文件名非法字符', () => {
    expect(downloadNameOf({ ...CASE, imageUrl: '/images/1.png' })).toBe('苹果风格海报.jpg')
    expect(downloadNameOf({ ...CASE, imageUrl: 'https://cdn.example.com/' })).toBe(
      '苹果风格海报.jpg',
    )
    expect(
      downloadNameOf({ ...CASE, title: 'a/b:c*d?e"f<g>h|i', imageUrl: 'not-a-url' }),
    ).toBe('a_b_c_d_e_f_g_h_i.jpg')
  })

  it('★ 标题也空时仍给一个能落盘的名字（不把空串交给保存框）', () => {
    expect(downloadNameOf({ ...CASE, title: '', imageUrl: '' })).toBe('inspiration.jpg')
  })
})
