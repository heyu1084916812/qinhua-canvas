import { describe, it, expect } from 'vitest'
import {
  emptyComicProject,
  newComicPanel,
  type ComicPanel,
  type ComicProject,
  type LayoutNode,
} from '../model/comicProject'
import {
  buildPanelRunPlan,
  panelCanGenerate,
  panelFingerprintOf,
  panelInputsOf,
  panelPromptOf,
  panelToRunRequest,
} from './panelRun'

const leaf = (panelId: string): LayoutNode => ({ kind: 'panel', panelId })

function withPanel(panel: Partial<ComicPanel> = {}, refs: string[] = []): {
  project: ComicProject
  panelId: string
} {
  const base = newComicPanel()
  const full: ComicPanel = { ...base, ...panel }
  const project: ComicProject = {
    ...emptyComicProject('p1', 'T'),
    characters: [{ id: 'ch1', name: '阿花', description: '红色双马尾', referenceHashes: refs }],
    episodes: [
      {
        id: 'ep1',
        index: 0,
        title: '第 1 话',
        pages: [{ id: 'pg1', index: 0, title: '', layout: [leaf(full.id)], panels: [full] }],
      },
    ],
  }
  return { project, panelId: full.id }
}

const ready = { scene: '少女站在天台', channelId: 'ch-mock', model: 'mock-image-1' }

describe('panelCanGenerate / 生成配置门槛', () => {
  it('缺渠道 / 模型 / 画面描述 → 不可生成', () => {
    const { project } = withPanel({ scene: 'x', channelId: 'c', model: 'm' })
    expect(panelCanGenerate(project.episodes[0]!.pages[0]!.panels[0]!)).toBe(true)
    for (const patch of [{ channelId: undefined }, { model: undefined }, { scene: '   ' }]) {
      const p = withPanel({ ...ready, ...patch })
      const panel = p.project.episodes[0]!.pages[0]!.panels[0]!
      expect(panelCanGenerate(panel), JSON.stringify(patch)).toBe(false)
      expect(buildPanelRunPlan(p.project, p.panelId)).toBeNull()
    }
    expect(buildPanelRunPlan(project, 'ghost')).toBeNull()
  })
})

describe('panelPromptOf / 提示词组装（三层分离）', () => {
  it('画面描述 + 镜头语言 + 角色约束，按「，」连接', () => {
    const { project, panelId } = withPanel({
      ...ready,
      shot: { framing: 'close-up', angle: 'low' },
      characterIds: ['ch1'],
    })
    const panel = project.episodes[0]!.pages[0]!.panels[0]!
    expect(panelPromptOf(project, panel)).toBe('少女站在天台，close-up，low angle，阿花：红色双马尾')
    expect(panelId).toBe(panel.id)
  })

  it('无角色时不含角色片段；角色无描述时只有名字', () => {
    const { project } = withPanel({ ...ready })
    const panel = project.episodes[0]!.pages[0]!.panels[0]!
    expect(panelPromptOf(project, panel)).toBe('少女站在天台，medium shot，eye level')
    const withChar = withPanel({ ...ready, characterIds: ['ch1'] }, [])
    withChar.project.characters[0]!.description = ''
    const p2 = withChar.project.episodes[0]!.pages[0]!.panels[0]!
    expect(panelPromptOf(withChar.project, p2)).toContain('阿花')
    expect(panelPromptOf(withChar.project, p2)).not.toContain('：')
  })
})

describe('panelInputsOf / 角色参考图 → asset 输入', () => {
  it('每个参考哈希一条 asset 输入，nodeId = 角色卡 id', () => {
    const { project } = withPanel({ ...ready, characterIds: ['ch1'] }, ['h1', 'h2'])
    const panel = project.episodes[0]!.pages[0]!.panels[0]!
    expect(panelInputsOf(project, panel)).toEqual([
      { kind: 'asset', nodeId: 'ch1', assetHash: 'h1', mime: 'image/png' },
      { kind: 'asset', nodeId: 'ch1', assetHash: 'h2', mime: 'image/png' },
    ])
  })

  it('无参考图 → 空数组', () => {
    const { project } = withPanel({ ...ready, characterIds: ['ch1'] })
    const panel = project.episodes[0]!.pages[0]!.panels[0]!
    expect(panelInputsOf(project, panel)).toEqual([])
  })
})

describe('panelToRunRequest / 生成请求', () => {
  it('配置齐全 → image 请求，渠道/模型来自格', () => {
    const { project } = withPanel({ ...ready, characterIds: ['ch1'] }, ['h1'])
    const panel = project.episodes[0]!.pages[0]!.panels[0]!
    const req = panelToRunRequest(project, panel)!
    expect(req.kind).toBe('image')
    expect(req.channelId).toBe('ch-mock')
    expect(req.model).toBe('mock-image-1')
    expect(req.prompt).toContain('少女站在天台')
    expect(req.inputs).toEqual([{ kind: 'asset', nodeId: 'ch1', assetHash: 'h1', mime: 'image/png' }])
  })
})

describe('panelFingerprintOf / 生成指纹', () => {
  it('画面描述变化 → 指纹变化', () => {
    const a = withPanel({ ...ready })
    const panelA = a.project.episodes[0]!.pages[0]!.panels[0]!
    const b = withPanel({ ...ready, scene: '少年在雨里奔跑' })
    const panelB = b.project.episodes[0]!.pages[0]!.panels[0]!
    expect(panelFingerprintOf(a.project, panelA)).not.toBe(panelFingerprintOf(b.project, panelB))
  })

  it('镜头语言变化 → 指纹变化', () => {
    const a = withPanel({ ...ready })
    const panelA = a.project.episodes[0]!.pages[0]!.panels[0]!
    const b = withPanel({ ...ready, shot: { framing: 'extreme-wide', angle: 'eye-level' } })
    const panelB = b.project.episodes[0]!.pages[0]!.panels[0]!
    expect(panelFingerprintOf(a.project, panelA)).not.toBe(panelFingerprintOf(b.project, panelB))
  })

  it('模型 / 参考图变化 → 指纹变化', () => {
    const a = withPanel({ ...ready, characterIds: ['ch1'] }, ['h1'])
    const panelA = a.project.episodes[0]!.pages[0]!.panels[0]!
    const b = withPanel({ ...ready, model: 'other', characterIds: ['ch1'] }, ['h1'])
    const panelB = b.project.episodes[0]!.pages[0]!.panels[0]!
    expect(panelFingerprintOf(a.project, panelA)).not.toBe(panelFingerprintOf(b.project, panelB))
    const c = withPanel({ ...ready, characterIds: ['ch1'] }, ['h2'])
    const panelC = c.project.episodes[0]!.pages[0]!.panels[0]!
    expect(panelFingerprintOf(a.project, panelA)).not.toBe(panelFingerprintOf(c.project, panelC))
  })

  it('对白 / 产物变化**不影响**指纹（改对白不该判过期）', () => {
    const { project, panelId } = withPanel({ ...ready })
    const panel = project.episodes[0]!.pages[0]!.panels[0]!
    const before = panelFingerprintOf(project, panel)
    const mutated: ComicProject = {
      ...project,
      episodes: [
        {
          ...project.episodes[0]!,
          pages: [
            {
              ...project.episodes[0]!.pages[0]!,
              panels: [
                {
                  ...panel,
                  assetHash: 'h-generated',
                  balloons: [
                    { id: 'b1', type: 'speech', text: '台词', x: 0, y: 0, w: 1, h: 1 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(panelFingerprintOf(mutated, mutated.episodes[0]!.pages[0]!.panels[0]!)).toBe(before)
    expect(panelId).toBe(panel.id)
  })
})

describe('buildPanelRunPlan / 单格生成计划', () => {
  it('一个 task，nodeId = panelId，scope=node / mode=single / 无需新下游', () => {
    const { project, panelId } = withPanel({ ...ready, characterIds: ['ch1'] }, ['h1'])
    const plan = buildPanelRunPlan(project, panelId)!
    expect(plan.tasks).toHaveLength(1)
    expect(plan.scope).toBe('node')
    expect(plan.mode).toBe('single')
    expect(plan.newDownstream).toBe(false)
    const task = plan.tasks[0]!
    expect(task.nodeId).toBe(panelId)
    expect(task.dependsOn).toEqual([])
    expect(task.seq).toBe(0)
    expect(task.request.kind).toBe('image')
    expect(typeof task.fingerprint).toBe('string')
    // 参数快照：镜头被字段化，不用拼进提示词
    expect(task.params).toMatchObject({
      framing: 'medium',
      angle: 'eye-level',
      channelId: 'ch-mock',
      model: 'mock-image-1',
      characterIds: ['ch1'],
    })
  })

  it('两次构建的指纹一致（同输入 → 同指纹，便于陈旧判定）', () => {
    const { project, panelId } = withPanel({ ...ready })
    const a = buildPanelRunPlan(project, panelId)!
    const b = buildPanelRunPlan(project, panelId)!
    expect(a.tasks[0]!.fingerprint).toBe(b.tasks[0]!.fingerprint)
  })
})
