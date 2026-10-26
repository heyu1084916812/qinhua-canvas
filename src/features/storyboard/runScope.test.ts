import { describe, expect, it } from 'vitest'
import {
  STORYBOARD_RUN_SCOPE_FIELDS,
  storyboardRunRecordScopeOf,
  storyboardRunScopeHintOf,
  withStoryboardRunScope,
} from './runScope'

describe('storyboard run scope metadata', () => {
  it('保留原节点数据并写入镜头业务作用域', () => {
    const data = withStoryboardRunScope(
      { prompt: '镜头画面', mode: 'image' },
      { subjectKind: 'shot-image', subjectId: ' shot-1 ', scopeId: ' episode-1 ' },
    )

    expect(data).toMatchObject({
      prompt: '镜头画面',
      mode: 'image',
      [STORYBOARD_RUN_SCOPE_FIELDS.version]: 1,
      [STORYBOARD_RUN_SCOPE_FIELDS.subjectKind]: 'shot-image',
      [STORYBOARD_RUN_SCOPE_FIELDS.subjectId]: 'shot-1',
      [STORYBOARD_RUN_SCOPE_FIELDS.scopeId]: 'episode-1',
    })
    expect(storyboardRunScopeHintOf(data)).toEqual({
      subjectKind: 'shot-image',
      subjectId: 'shot-1',
      scopeId: 'episode-1',
    })
  })

  it('旧节点、损坏字段和空主体安全回落为 null', () => {
    expect(storyboardRunScopeHintOf({ prompt: 'old' })).toBeNull()
    expect(
      storyboardRunScopeHintOf({
        [STORYBOARD_RUN_SCOPE_FIELDS.version]: 1,
        [STORYBOARD_RUN_SCOPE_FIELDS.subjectKind]: 'shot-image',
        [STORYBOARD_RUN_SCOPE_FIELDS.subjectId]: ' ',
        [STORYBOARD_RUN_SCOPE_FIELDS.scopeId]: 'episode-1',
      }),
    ).toBeNull()
    expect(
      storyboardRunScopeHintOf({
        [STORYBOARD_RUN_SCOPE_FIELDS.version]: 1,
        [STORYBOARD_RUN_SCOPE_FIELDS.subjectKind]: 'unknown',
        [STORYBOARD_RUN_SCOPE_FIELDS.subjectId]: 'shot-1',
        [STORYBOARD_RUN_SCOPE_FIELDS.scopeId]: 'episode-1',
      }),
    ).toBeNull()
  })

  it('拒绝写入空主体或空范围', () => {
    expect(() =>
      withStoryboardRunScope({}, { subjectKind: 'asset', subjectId: '', scopeId: 'p1' }),
    ).toThrow('漫剧运行主体不能为空')
    expect(() =>
      withStoryboardRunScope({}, { subjectKind: 'asset', subjectId: 'char-1', scopeId: ' ' }),
    ).toThrow('漫剧运行范围不能为空')
  })

  it('生成漫剧 RunRecord 作用域，operationId 由计划实例区分', () => {
    const data = withStoryboardRunScope(
      {},
      { subjectKind: 'shot-video', subjectId: 'shot-1', scopeId: 'episode-1' },
    )

    expect(storyboardRunRecordScopeOf(data, 'plan-a')).toEqual({
      scopeVersion: 1,
      workbench: 'storyboard',
      subjectId: 'shot-1',
      scopeId: 'episode-1',
      operationId: 'storyboard:plan-a:shot-1',
    })
    expect(storyboardRunRecordScopeOf(data, 'plan-b')?.operationId).toBe(
      'storyboard:plan-b:shot-1',
    )
    expect(storyboardRunRecordScopeOf({}, 'plan-a')).toBeNull()
  })
})
