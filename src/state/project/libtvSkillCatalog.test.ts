import { describe, expect, it } from 'vitest'
import {
  LIBTV_BODY_TOTAL,
  LIBTV_CATEGORY_COUNTS,
  LIBTV_SKILLS,
  loadLibtvSkillBody,
} from './libtvSkillCatalog'
import { LIBTV_CATEGORIES, libtvHasBody } from '../../domain/prompt/libtvSkill'

describe('LibTV Skill 目录资源', () => {
  it('导入完整目录，分类总和等于目录数', () => {
    expect(LIBTV_SKILLS).toHaveLength(1472)
    const total = LIBTV_CATEGORIES.reduce(
      (sum, category) => sum + (LIBTV_CATEGORY_COUNTS.get(category) ?? 0),
      0,
    )
    expect(total).toBe(LIBTV_SKILLS.length)
    expect(LIBTV_CATEGORY_COUNTS.get('推荐')).toBe(110)
    expect(LIBTV_CATEGORY_COUNTS.get('发现')).toBeGreaterThan(1000)
  })

  it('有正文的 Skill 能按需加载，目录缺正文时返回 null', async () => {
    expect(LIBTV_BODY_TOTAL).toBeGreaterThan(690)
    const withBody = LIBTV_SKILLS.find((skill) => skill.name === '分镜升镜师')!
    const body = await loadLibtvSkillBody(withBody)
    expect(body).toBeTruthy()
    expect(body!.length).toBeGreaterThan(100)

    const catalogOnly = LIBTV_SKILLS.find((skill) => skill.name === '爆款拉片复刻')!
    expect(libtvHasBody(catalogOnly)).toBe(false)
    await expect(loadLibtvSkillBody(catalogOnly)).resolves.toBeNull()
  })

  it('画布案例 URL 被保留到目录投影中', () => {
    const item = LIBTV_SKILLS.find((skill) => skill.name === '爆款拉片复刻')!
    expect(item.cases.some((entry) => entry.canvasCaseUrl?.includes('shareId='))).toBe(true)
  })
})
