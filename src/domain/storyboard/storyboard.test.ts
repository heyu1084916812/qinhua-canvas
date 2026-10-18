import { describe, expect, it } from 'vitest'
import {
  ASSET_BLOCK_HEADER,
  addCharacter,
  addScene,
  addShotLine,
  assetBasePrompt,
  assetTurnaroundPrompt,
  attachShotImages,
  attachShotNodes,
  attachShotVideos,
  bindShotScene,
  characterNamesOf,
  DEFAULT_SHOT_SECONDS,
  addEpisode,
  addShot,
  emptyStoryboard,
  exportStoryboardMarkdown,
  moveEpisode,
  moveShot,
  mergeAsset,
  parseStoryboard,
  planShotRefEdges,
  removeCharacter,
  removeEpisode,
  removeScene,
  removeShot,
  removeShotLine,
  sceneNameOf,
  setAssetBaseHash,
  setAssetNode,
  setAssetTurnaroundHash,
  setAssetTurnaroundNode,
  setShotVideoNode,
  shotDialogueTextOf,
  shotPrompt,
  shotPromptWithAssets,
  shotRefNodeIds,
  shotVideoPrompt,
  shotsNeedingNode,
  shotsOf,
  storyboardStats,
  toggleShotCharacter,
  updateCharacter,
  updateEpisode,
  updateScene,
  updateScript,
  updateShot,
  updateShotLine,
  updateSourceText,
  type StoryboardDoc,
} from './storyboard'

/**
 * 漫剧工作台第一阶段（对账 #382）：剧本 → 分集 → 分镜。
 *
 * 这一层全是**纯函数**，所以这里守的都是"改一条会影响到谁"：
 * 删集要不要连镜头一起删、新增的镜头插在哪儿、时长怎么夹、
 * 导出表遇到竖线 / 换行会不会把表格撑坏 —— 这些错了在界面上都很难看出来。
 */

/** 造一份"两集三镜"的底稿（第一集两镜、第二集一镜） */
function sample(): StoryboardDoc {
  let doc = emptyStoryboard('p1', 1)
  doc = addEpisode(doc, 2)
  doc = addEpisode(doc, 3)
  const [ep1, ep2] = doc.episodes
  doc = addShot(doc, ep1!.id, 4)
  doc = addShot(doc, ep1!.id, 5)
  doc = addShot(doc, ep2!.id, 6)
  doc = updateShot(doc, shotsOf(doc, ep1!.id)[0]!.id, { scene: '客厅，清晨' }, 7)
  return doc
}

describe('storyboard · 文档读写', () => {
  it('空文档：一集没有、镜头没有，标题给个能改的默认', () => {
    const doc = emptyStoryboard('p1', 10)
    expect(doc.projectId).toBe('p1')
    expect(doc.script.title).toBe('未命名漫剧')
    expect(doc.episodes).toEqual([])
    expect(doc.shots).toEqual([])
    expect(doc.updatedAt).toBe(10)
  })

  it('★★ 脏数据只补坏的那一项，并且丢掉"孤儿镜头"（指向不存在的集）', () => {
    const doc = parseStoryboard(
      {
        script: { title: 42, logline: '一句话', body: '正文' },
        episodes: [{ id: 'e1', title: '', summary: null }, { id: '', title: '没 id' }, 'garbage'],
        shots: [
          { id: 's1', episodeId: 'e1', scene: '画面', durationSec: 'abc' },
          { id: 's2', episodeId: '不存在', scene: '孤儿' },
          { id: 's3', episodeId: 'e1' },
        ],
        updatedAt: 'nope',
      },
      'p9',
    )
    expect(doc.projectId).toBe('p9')
    expect(doc.script.title).toBe('未命名漫剧') // 42 不是字符串 ⇒ 回落默认
    expect(doc.script.logline).toBe('一句话')
    expect(doc.episodes).toHaveLength(1)
    expect(doc.episodes[0]!.title).toBe('未命名一集') // 空标题补默认
    expect(doc.shots.map((s) => s.id)).toEqual(['s1', 's3']) // 孤儿 s2 被丢掉
    expect(doc.shots[0]!.durationSec).toBe(DEFAULT_SHOT_SECONDS) // 脏数字回落默认
    expect(doc.updatedAt).toBe(0)
  })

  it('剧本三件（标题 / 一句话 / 正文）都能改，且只改传进来的那些', () => {
    let doc = emptyStoryboard('p1')
    doc = updateScript(doc, { title: '小猫钓鱼', logline: '一只猫想钓到月亮' }, 5)
    expect(doc.script.title).toBe('小猫钓鱼')
    expect(doc.script.logline).toBe('一只猫想钓到月亮')
    expect(doc.script.body).toBe('')
    expect(doc.updatedAt).toBe(5)
  })
})

describe('storyboard · 分集', () => {
  it('新增一集：默认叫「第 N 集」，顺序即数组顺序', () => {
    let doc = emptyStoryboard('p1')
    doc = addEpisode(doc, 1)
    doc = addEpisode(doc, 2)
    expect(doc.episodes.map((e) => e.title)).toEqual(['第 1 集', '第 2 集'])
  })

  it('改一集：只动那一集，别的原样', () => {
    const doc0 = sample()
    const doc = updateEpisode(doc0, doc0.episodes[0]!.id, { title: '起', summary: '开场' }, 9)
    expect(doc.episodes[0]!.title).toBe('起')
    expect(doc.episodes[1]!.title).toBe('第 2 集')
    expect(doc.updatedAt).toBe(9)
  })

  it('★★ 删一集要连它的镜头一起删（否则那些镜头变成界面上看不到的孤儿）', () => {
    const doc0 = sample()
    const ep1 = doc0.episodes[0]!.id
    const doc = removeEpisode(doc0, ep1, 10)
    expect(doc.episodes.map((e) => e.id)).toEqual([doc0.episodes[1]!.id])
    expect(doc.shots).toHaveLength(1) // 原本 3 镜，第一集的 2 镜随集删掉
    expect(doc.shots.every((s) => s.episodeId !== ep1)).toBe(true)
  })

  it('上下移一集：到边界就原样返回（不抛错、不改 updatedAt）', () => {
    const doc0 = sample()
    const first = doc0.episodes[0]!.id
    const second = doc0.episodes[1]!.id
    expect(moveEpisode(doc0, first, -1)).toBe(doc0)
    const moved = moveEpisode(doc0, second, -1, 11)
    expect(moved.episodes.map((e) => e.id)).toEqual([second, first])
    expect(moved.updatedAt).toBe(11)
    expect(moveEpisode(moved, first, 5)).toBe(moved)
  })
})

describe('storyboard · 分镜', () => {
  it('★★ 新增镜头插在"这一集最后一镜"之后（不是整个数组末尾 —— 跨集顺序会乱）', () => {
    const doc0 = sample()
    const ep1 = doc0.episodes[0]!.id
    const doc = addShot(doc0, ep1, 20)
    expect(doc.shots.map((s) => s.episodeId)).toEqual([
      ep1,
      ep1,
      ep1, // 新镜头插在这里
      doc0.episodes[1]!.id,
    ])
  })

  it('★ 往不存在的集加镜头：原样返回（不造孤儿）', () => {
    const doc = sample()
    expect(addShot(doc, '不存在')).toBe(doc)
  })

  it('★ 改镜头：时长夹在 ≥1 秒并取整（脏输入不至于把节奏算成 0 或小数）', () => {
    const doc0 = sample()
    const shot = doc0.shots[0]!
    expect(updateShot(doc0, shot.id, { durationSec: 0 }).shots[0]!.durationSec).toBe(1)
    expect(updateShot(doc0, shot.id, { durationSec: 4.6 }).shots[0]!.durationSec).toBe(5)
    expect(updateShot(doc0, shot.id, { durationSec: Number.NaN }).shots[0]!.durationSec).toBe(
      shot.durationSec,
    )
  })

  it('★★ 上下移镜头只在同一集内换位（跨集是另一件事，这里不偷偷搬）', () => {
    const doc0 = sample()
    const ep1 = doc0.episodes[0]!.id
    const [a, b] = shotsOf(doc0, ep1)
    const moved = moveShot(doc0, b!.id, -1, 21)
    expect(shotsOf(moved, ep1).map((s) => s.id)).toEqual([b!.id, a!.id])
    /** 第一镜再往上移：到边界 ⇒ 原样 */
    expect(moveShot(moved, b!.id, -1)).toBe(moved)
  })

  it('删镜头只删它自己', () => {
    const doc0 = sample()
    const doc = removeShot(doc0, doc0.shots[0]!.id, 22)
    expect(doc.shots).toHaveLength(2)
    expect(doc.updatedAt).toBe(22)
  })

  it('提示词留空时由画面描述派生（"画面描述即提示词"是最省事的默认）', () => {
    const doc0 = sample()
    const shot = shotsOf(doc0, doc0.episodes[0]!.id)[0]!
    expect(shotPrompt(shot)).toBe('客厅，清晨')
    const withPrompt = { ...shot, prompt: '动漫风格，暖光' }
    expect(shotPrompt(withPrompt)).toBe('动漫风格，暖光')
  })

  it('统计：集数 / 镜数 / 粗排总时长（按每镜时长累加）', () => {
    let doc = sample()
    const second = doc.shots[1]!
    doc = updateShot(doc, second.id, { durationSec: 7 }, 23)
    expect(storyboardStats(doc)).toEqual({ episodes: 2, shots: 3, durationSec: 3 + 7 + 3 })
  })
})

describe('storyboard · 导出分镜表（Markdown）', () => {
  it('★★ 导出：标题 / 一句话 / 统计 / 剧本 / 逐集逐镜的表都在', () => {
    let doc = sample()
    doc = updateScript(doc, { title: '小猫钓鱼', logline: '一只猫想钓到月亮', body: '第一场……' }, 30)
    doc = updateEpisode(doc, doc.episodes[0]!.id, { summary: '开场' }, 31)
    doc = updateShot(doc, doc.shots[0]!.id, { scene: '客厅，清晨', durationSec: 5 }, 32)
    /* 对白走专属那三条路径（#435）：加一句 → 写字 */
    doc = addShotLine(doc, doc.shots[0]!.id, {}, 32)
    doc = updateShotLine(doc, doc.shots[0]!.id, doc.shots[0]!.lines[0]!.id, { text: '早啊' }, 32)

    const md = exportStoryboardMarkdown(doc)
    expect(md).toContain('# 小猫钓鱼')
    expect(md).toContain('> 一只猫想钓到月亮')
    expect(md).toContain('共 2 集 / 3 镜 / 粗排 11 秒')
    expect(md).toContain('## 剧本')
    expect(md).toContain('## 第 1 集 · 第 1 集')
    expect(md).toContain('> 开场')
    /* 表头在 #416 加了两列（场景 / 出场角色）—— 这里跟着口径走，不是放宽 */
    expect(md).toContain('| # | 画面 | 场景 | 出场角色 | 台词 / 旁白 | 时长 | 画面提示词 |')
    expect(md).toContain('| 1 | 客厅，清晨 | — | — | 早啊 | 5s | 客厅，清晨 |')
  })

  it('★ 单元格里的竖线与换行会把表格撑坏 ⇒ 导出前换掉（换行变空格、竖线转义）', () => {
    let doc = sample()
    doc = updateShot(
      doc,
      doc.shots[0]!.id,
      { scene: '客厅 | 厨房' },
      33,
    )
    doc = addShotLine(doc, doc.shots[0]!.id, { text: '第一行\n第二行' }, 33)
    const md = exportStoryboardMarkdown(doc)
    expect(md).toContain('客厅 \\| 厨房')
    expect(md).toContain('| 第一行 第二行 |')
    expect(md).not.toContain('第一行\n第二行')
  })

  it('★ 没有分镜的集：表头不出现，改写成一句"还没有分镜"（导出照样能读）', () => {
    let doc = emptyStoryboard('p1')
    doc = addEpisode(doc, 1)
    const md = exportStoryboardMarkdown(doc)
    expect(md).toContain('（这一集还没有分镜）')
    expect(md).not.toContain('| # | 画面 |')
  })
})

/**
 * 铺到画布：镜头 ↔ 生成节点的对应（对账 #415）。
 *
 * 这组守的是**"缓存不是真相"**那一条：`nodeId` 只是缓存，用户在画布上删掉节点后，
 * 判据必须能识别"悬空"并把这一镜重新铺一次；换节点时那张旧图（imageHash）
 * 也必须一起清掉 —— 不然列表里会挂着一张画布上已经不存在的图。
 */
describe('铺到画布', () => {
  it('nodeId / imageHash 读得回来；非字符串一律丢掉（脏数据不当真）', () => {
    const doc = parseStoryboard(
      {
        episodes: [{ id: 'ep1', title: '一' }],
        shots: [
          { id: 's1', episodeId: 'ep1', scene: 'a', nodeId: 'n1', imageHash: 'h1' },
          { id: 's2', episodeId: 'ep1', scene: 'b', nodeId: 42, imageHash: {} },
        ],
      },
      'p1',
    )
    expect(doc.shots[0]!.nodeId).toBe('n1')
    expect(doc.shots[0]!.imageHash).toBe('h1')
    expect('nodeId' in doc.shots[1]!).toBe(false)
    expect('imageHash' in doc.shots[1]!).toBe(false)
  })

  it('★★ 要铺的判据：没铺过要铺；铺过但节点没了（悬空）也要铺；节点活着的不铺', () => {
    const doc = sample()
    const [a, b, c] = doc.shots
    const withNodes: StoryboardDoc = {
      ...doc,
      shots: [
        { ...a!, nodeId: 'n-live' },
        { ...b!, nodeId: 'n-deleted' },
        c!,
      ],
    }
    const need = shotsNeedingNode(withNodes.shots, new Set(['n-live']))
    expect(need.map((s) => s.id)).toEqual([b!.id, c!.id])
  })

  it('写回节点 id；换节点时顺手清掉旧 imageHash（旧图属于旧节点）', () => {
    const doc = sample()
    const shot = doc.shots[0]!
    const withImage: StoryboardDoc = {
      ...doc,
      shots: [{ ...shot, nodeId: 'n-old', imageHash: 'h-old' }, ...doc.shots.slice(1)],
    }
    const next = attachShotNodes(withImage, [{ shotId: shot.id, nodeId: 'n-new' }], 99)
    expect(next.shots[0]!.nodeId).toBe('n-new')
    expect('imageHash' in next.shots[0]!).toBe(false)
    expect(next.updatedAt).toBe(99)
  })

  it('没有变化时返回原引用（调用方据此不做多余落库）', () => {
    const doc = sample()
    expect(attachShotNodes(doc, [], 9)).toBe(doc)
    const same: StoryboardDoc = { ...doc, shots: [{ ...doc.shots[0]!, nodeId: 'n1' }, ...doc.shots.slice(1)] }
    expect(attachShotNodes(same, [{ shotId: doc.shots[0]!.id, nodeId: 'n1' }], 9)).toBe(same)
    expect(attachShotImages(doc, [], 9)).toBe(doc)
  })

  it('镜像出图 hash；同一个 hash 再来一次是空操作（不会把防抖保存搅起来）', () => {
    const doc = sample()
    const shotId = doc.shots[0]!.id
    const once = attachShotImages(doc, [{ shotId, hash: 'h1' }], 3)
    expect(once.shots[0]!.imageHash).toBe('h1')
    expect(attachShotImages(once, [{ shotId, hash: 'h1' }], 4)).toBe(once)
    const twice = attachShotImages(once, [{ shotId, hash: 'h2' }], 5)
    expect(twice.shots[0]!.imageHash).toBe('h2')
  })
})

/**
 * 角色 / 场景资产库（对账 #416；调研稿 §6.1 / §6.3）。
 *
 * 守三件事：**项目级、可编辑、删了不留悬空引用**。
 * 第三条最容易漏 —— 界面上那一格空了、导出里却还印着一个已经不存在的名字。
 */
describe('角色 / 场景资产库', () => {
  it('新增：默认名按数量排（角色 1 / 场景 1），id 前缀区分两类', () => {
    const doc = addCharacter(addScene(emptyStoryboard('p1', 1), 2), 3)
    expect(doc.characters[0]!.name).toBe('角色 1')
    expect(doc.scenes[0]!.name).toBe('场景 1')
    expect(doc.characters[0]!.id).toMatch(/^char_/)
    expect(doc.scenes[0]!.id).toMatch(/^scene_/)
    expect(doc.updatedAt).toBe(3)
  })

  it('改名 / 改描述；别名去重且不把正式名重复塞进别名；空名不许改成空', () => {
    let doc = addCharacter(emptyStoryboard('p1'), 1)
    const id = doc.characters[0]!.id
    doc = updateCharacter(doc, id, { name: '  林轩  ', aliases: ['林公子', ' 林公子 ', '林轩'] }, 2)
    expect(doc.characters[0]!.name).toBe('林轩')
    expect(doc.characters[0]!.aliases).toEqual(['林公子'])
    doc = updateCharacter(doc, id, { name: '   ' }, 3)
    expect(doc.characters[0]!.name).toBe('林轩')
  })

  it('★★ 删角色：连镜头上的引用一起清（不留悬空 id），空数组字段也删掉', () => {
    let doc = sample()
    doc = addCharacter(doc, 1)
    doc = addCharacter(addScene(doc, 1), 1)
    const [c1, c2] = doc.characters
    const sceneId = doc.scenes[0]!.id
    const [s1, s2] = doc.shots
    doc = toggleShotCharacter(toggleShotCharacter(doc, s1!.id, c1!.id, 2), s1!.id, c2!.id, 2)
    doc = toggleShotCharacter(doc, s2!.id, c1!.id, 2)
    doc = bindShotScene(doc, s1!.id, sceneId, 2)
    const after = removeCharacter(doc, c1!.id, 9)
    expect(after.characters.map((c) => c.id)).toEqual([c2!.id])
    expect(shotsOf(after, s1!.episodeId)[0]!.characterIds).toEqual([c2!.id])
    /* 第二镜只有 c1 一个角色 ⇒ 字段整个消失，不是留一个 `[]` */
    expect('characterIds' in after.shots.find((s) => s.id === s2!.id)!).toBe(false)
    expect(after.updatedAt).toBe(9)
  })

  it('★★ 删场景：镜头上指向它的 sceneId 一起清', () => {
    let doc = addScene(sample(), 1)
    const sceneId = doc.scenes[0]!.id
    doc = bindShotScene(doc, doc.shots[0]!.id, sceneId, 2)
    const after = removeScene(doc, sceneId, 3)
    expect(after.scenes).toHaveLength(0)
    expect('sceneId' in after.shots[0]!).toBe(false)
  })

  it('删不存在的资产 / 绑不存在的场景：原引用返回（不制造无意义落库）', () => {
    const doc = addCharacter(sample(), 1)
    expect(removeCharacter(doc, 'char_x', 2)).toBe(doc)
    expect(bindShotScene(doc, doc.shots[0]!.id, 'scene_x', 2)).toBe(doc)
    expect(toggleShotCharacter(doc, doc.shots[0]!.id, 'char_x', 2)).toBe(doc)
    expect(removeScene(doc, 'scene_x', 2)).toBe(doc)
  })

  it('绑场景：绑 / 解绑（传 null）/ 同值空操作；切角色是一下加一下去', () => {
    let doc = addScene(sample(), 1)
    const sceneId = doc.scenes[0]!.id
    const shotId = doc.shots[0]!.id
    doc = bindShotScene(doc, shotId, sceneId, 2)
    expect(doc.shots[0]!.sceneId).toBe(sceneId)
    expect(bindShotScene(doc, shotId, sceneId, 3)).toBe(doc)
    const off = bindShotScene(doc, shotId, null, 4)
    expect('sceneId' in off.shots[0]!).toBe(false)
    let withChar = addCharacter(off, 5)
    const charId = withChar.characters[0]!.id
    withChar = toggleShotCharacter(withChar, shotId, charId, 6)
    expect(withChar.shots[0]!.characterIds).toEqual([charId])
    withChar = toggleShotCharacter(withChar, shotId, charId, 7)
    expect('characterIds' in withChar.shots[0]!).toBe(false)
  })

  it('名字读法：场景名 / 出场角色名（角色按库里顺序，导出稳定）', () => {
    let doc = addCharacter(addCharacter(addScene(sample(), 1), 1), 1)
    const [c1, c2] = doc.characters
    const sceneId = doc.scenes[0]!.id
    const shotId = doc.shots[0]!.id
    doc = bindShotScene(doc, shotId, sceneId, 2)
    doc = toggleShotCharacter(doc, shotId, c2!.id, 2)
    doc = toggleShotCharacter(doc, shotId, c1!.id, 2)
    const shot = doc.shots.find((s) => s.id === shotId)!
    expect(sceneNameOf(doc, shot)).toBe('场景 1')
    /* 先点的是 c2，但输出按角色库顺序（c1 在前）—— 同一份数据每次导出都一样 */
    expect(characterNamesOf(doc, shot)).toEqual([c1!.name, c2!.name])
    expect(sceneNameOf(doc, { ...shot, sceneId: undefined })).toBe('')
  })

  it('★ 脏数据：悬空的 sceneId / characterIds 读回时丢掉（手改过的备份也进不来）', () => {
    const doc = parseStoryboard(
      {
        characters: [{ id: 'c1', name: '林轩', aliases: ['林公子', '林公子'] }, { id: '', name: 'x' }, 'bad'],
        scenes: [{ id: 's1', name: '雨夜街道' }],
        episodes: [{ id: 'ep1', title: '一' }],
        shots: [
          {
            id: 'sh1',
            episodeId: 'ep1',
            scene: 'a',
            sceneId: 's1',
            characterIds: ['c1', 'c-gone', 'c1'],
          },
          { id: 'sh2', episodeId: 'ep1', scene: 'b', sceneId: 's-gone', characterIds: ['c-gone'] },
        ],
      },
      'p1',
    )
    expect(doc.characters).toHaveLength(1)
    expect(doc.characters[0]!.aliases).toEqual(['林公子'])
    expect(doc.shots[0]!.sceneId).toBe('s1')
    expect(doc.shots[0]!.characterIds).toEqual(['c1'])
    expect('sceneId' in doc.shots[1]!).toBe(false)
    expect('characterIds' in doc.shots[1]!).toBe(false)
  })

  it('导出表多了「场景 / 出场角色」两列，没绑定就写 —', () => {
    let doc = addCharacter(addScene(emptyStoryboard('p1'), 1), 1)
    doc = addEpisode(doc, 1)
    const ep = doc.episodes[0]!
    doc = addShot(doc, ep.id, 1)
    const shotId = doc.shots[0]!.id
    doc = updateShot(doc, shotId, { scene: '雨夜的街道' }, 1)
    const bare = exportStoryboardMarkdown(doc)
    expect(bare).toContain('| # | 画面 | 场景 | 出场角色 | 台词 / 旁白 | 时长 | 画面提示词 |')
    expect(bare).toContain('| 1 | 雨夜的街道 | — | — |')

    doc = updateCharacter(doc, doc.characters[0]!.id, { name: '林轩' }, 1)
    doc = updateScene(doc, doc.scenes[0]!.id, { name: '雨夜街道' }, 1)
    doc = bindShotScene(doc, shotId, doc.scenes[0]!.id, 1)
    doc = toggleShotCharacter(doc, shotId, doc.characters[0]!.id, 1)
    const full = exportStoryboardMarkdown(doc)
    expect(full).toContain('| 1 | 雨夜的街道 | 雨夜街道 | 林轩 |')
  })
})

/**
 * 原文与溯源（对账 #417）：`sourceText` + 集的 `sourceRange` / 两个钩子。
 *
 * 溯源是"用户校对 LLM 产出的唯一抓手"（调研稿 §6.1 取舍表），所以：
 * 脏范围宁可当没有，也不猜一个 —— 错的范围比没有范围更坏（导出里印着错的行号）。
 */
describe('原文与溯源', () => {
  it('updateSourceText：文本没变返回原引用（调用方据此不做多余落库）', () => {
    const doc = emptyStoryboard('p1')
    expect(updateSourceText(doc, '', 1)).toBe(doc)
    const next = updateSourceText(doc, '雨。', 2)
    expect(next.sourceText).toBe('雨。')
    expect(next.updatedAt).toBe(2)
  })

  it('★ 读回：sourceText / sourceRange / 两个钩子都在；脏范围（from≥to、非数字）丢掉', () => {
    const doc = parseStoryboard(
      {
        sourceText: '原文若干',
        episodes: [
          {
            id: 'e1',
            title: '一',
            summary: 's',
            sourceRange: { from: 0, to: 4 },
            hookOpen: '开场',
            hookEnd: '结尾',
          },
          { id: 'e2', title: '二', summary: '', sourceRange: { from: 9, to: 3 } },
          { id: 'e3', title: '三', summary: '', sourceRange: { from: 'x', to: 'y' } },
        ],
        shots: [],
      },
      'p1',
    )
    expect(doc.sourceText).toBe('原文若干')
    expect(doc.episodes[0]!.sourceRange).toEqual({ from: 0, to: 4 })
    expect(doc.episodes[0]!.hookOpen).toBe('开场')
    expect('sourceRange' in doc.episodes[1]!).toBe(false)
    expect('sourceRange' in doc.episodes[2]!).toBe(false)
  })

  it('★ 导出带上原文范围与两个钩子（交出去的表格里也能对上原文）', () => {
    let doc = emptyStoryboard('p1')
    doc = addEpisode(doc, 1)
    doc = updateEpisode(doc, doc.episodes[0]!.id, { title: '雨夜', summary: '梗概' }, 1)
    doc = {
      ...doc,
      episodes: [
        {
          ...doc.episodes[0]!,
          sourceRange: { from: 0, to: 120 },
          hookOpen: '开场钩子',
          hookEnd: '结尾钩子',
        },
      ],
    }
    const md = exportStoryboardMarkdown(doc)
    expect(md).toContain('> 原文第 1–120 字')
    expect(md).toContain('> 开场钩子：开场钩子')
    expect(md).toContain('> 结尾钩子：结尾钩子')
  })

  it('★ BGM：写入、音量夹取、清空时三个字段一起删；导出能读出曲名与音量', () => {
    let doc = emptyStoryboard('p1')
    doc = addEpisode(doc, 1)
    const id = doc.episodes[0]!.id
    doc = updateEpisode(
      doc,
      id,
      { bgmHash: 'music-hash', bgmName: '雨夜主题.mp3', bgmVolume: 1.8 },
      2,
    )
    expect(doc.episodes[0]).toMatchObject({
      bgmHash: 'music-hash',
      bgmName: '雨夜主题.mp3',
      bgmVolume: 1,
    })
    expect(exportStoryboardMarkdown(doc)).toContain('背景音乐：雨夜主题.mp3')
    expect(exportStoryboardMarkdown(doc)).toContain('音量 100%')

    doc = updateEpisode(doc, id, { bgmHash: '' }, 3)
    expect('bgmHash' in doc.episodes[0]!).toBe(false)
    expect('bgmName' in doc.episodes[0]!).toBe(false)
    expect('bgmVolume' in doc.episodes[0]!).toBe(false)
  })

  it('★ 读回：有 hash 才认 BGM；音量脏值回落默认，没有 hash 时字段整体丢弃', () => {
    const doc = parseStoryboard(
      {
        episodes: [
          { id: 'e1', title: '一', summary: '', bgmHash: 'h1', bgmName: 'a.mp3', bgmVolume: -1 },
          { id: 'e2', title: '二', summary: '', bgmName: 'orphan.mp3', bgmVolume: 0.9 },
        ],
        shots: [],
      },
      'p1',
    )
    expect(doc.episodes[0]).toMatchObject({ bgmHash: 'h1', bgmName: 'a.mp3', bgmVolume: 0 })
    expect('bgmHash' in doc.episodes[1]!).toBe(false)
    expect('bgmName' in doc.episodes[1]!).toBe(false)
  })
})

/**
 * 资产设定进提示词（对账 #418）。
 *
 * 资产库不该只是元数据 —— 它要影响**真正发出去的那段提示词**，
 * 否则"同一角色跨集长得一样"就只是一句口号。
 */
describe('资产设定进提示词', () => {
  it('★★ 没绑定资产 ⇒ 与 shotPrompt 逐字相同（手写分镜 / 旧项目零变化）', () => {
    const doc = sample()
    const shot = doc.shots[0]!
    expect(shotPromptWithAssets(doc, shot)).toBe(shotPrompt(shot))
  })

  it('★★ 绑了场景与角色 ⇒ 拼上设定块：场景在前、角色按库序、描述为空只写名字', () => {
    let doc = addCharacter(addCharacter(addScene(sample(), 1), 1), 1)
    const [c1, c2] = doc.characters
    doc = updateCharacter(doc, c1!.id, { name: '骑手', description: '二十出头，雨衣' }, 1)
    doc = updateCharacter(doc, c2!.id, { name: '收货人' }, 1)
    doc = updateScene(doc, doc.scenes[0]!.id, { name: '雨夜街道', description: '霓虹、积水' }, 1)
    const shotId = doc.shots[0]!.id
    doc = updateShot(doc, shotId, { prompt: 'cinematic wide' }, 1)
    doc = bindShotScene(doc, shotId, doc.scenes[0]!.id, 1)
    /* 先点「收货人」再点「骑手」：拼出来的顺序必须仍按角色库（骑手在前） */
    doc = toggleShotCharacter(doc, shotId, c2!.id, 1)
    doc = toggleShotCharacter(doc, shotId, c1!.id, 1)
    const prompt = shotPromptWithAssets(doc, doc.shots.find((s) => s.id === shotId)!)
    expect(prompt.startsWith('cinematic wide\n\n')).toBe(true)
    expect(prompt).toContain(ASSET_BLOCK_HEADER)
    expect(prompt).toContain('场景「雨夜街道」：霓虹、积水')
    expect(prompt).toContain('角色「骑手」：二十出头，雨衣')
    /* 描述为空只写名字：这一行整行就是「角色「收货人」」，后面没有冒号也没有编出来的描述 */
    const lines = prompt.split('\n')
    expect(lines[lines.length - 1]).toBe('角色「收货人」')
    expect(prompt.indexOf('场景「雨夜街道」')).toBeLessThan(prompt.indexOf('角色「骑手」'))
    expect(prompt.indexOf('角色「骑手」')).toBeLessThan(prompt.indexOf('角色「收货人」'))
  })

  it('★ 导出用的是**真正会跑的**那段提示词（绑了资产就带设定块）', () => {
    let doc = addScene(addCharacter(emptyStoryboard('p1'), 1), 1)
    doc = addEpisode(doc, 1)
    doc = addShot(doc, doc.episodes[0]!.id, 1)
    const shotId = doc.shots[0]!.id
    doc = updateShot(doc, shotId, { scene: '雨夜街道' }, 1)
    doc = updateScene(doc, doc.scenes[0]!.id, { name: '雨夜街道', description: '霓虹' }, 1)
    doc = bindShotScene(doc, shotId, doc.scenes[0]!.id, 1)
    expect(exportStoryboardMarkdown(doc)).toContain(ASSET_BLOCK_HEADER)
  })
})

/**
 * 定妆图 / 基准图（对账 #419；调研稿 §6.3 第 4 条）。
 *
 * 这一批只做**一张纯文生图的基准图**（参考图回喂要等 #81/#113）。
 * 守两件事：提示词的尾巴（角色要中性表情、场景要无人物空镜）与
 * "换节点就清旧图"（同一个事实两个来源必然分叉）。
 */
describe('定妆图 / 基准图', () => {
  it('读回：资产的 nodeId / baseHash 都在；非字符串丢掉', () => {
    const doc = parseStoryboard(
      {
        characters: [
          { id: 'c1', name: '骑手', nodeId: 'n1', baseHash: 'h1' },
          { id: 'c2', name: '路人', nodeId: 7, baseHash: {} },
        ],
        scenes: [{ id: 's1', name: '雨夜街道', nodeId: 'n2', baseHash: 'h2' }],
        episodes: [],
        shots: [],
      },
      'p1',
    )
    expect(doc.characters[0]!.nodeId).toBe('n1')
    expect(doc.characters[0]!.baseHash).toBe('h1')
    expect('nodeId' in doc.characters[1]!).toBe(false)
    expect(doc.scenes[0]!.baseHash).toBe('h2')
  })

  it('★★ 提示词：角色与场景各一套尾巴；描述为空也能跑（只写名字）', () => {
    const rider = { id: 'c1', name: '骑手', description: '二十出头，雨衣', aliases: [] }
    const street = { id: 's1', name: '雨夜街道', description: '霓虹、积水', aliases: [] }
    const charPrompt = assetBasePrompt(rider, 'char')
    expect(charPrompt).toBe(
      '角色定妆图：骑手。二十出头，雨衣。正面半身，中性表情，干净的纯色背景，清晰展示发型、服装与配饰细节，画面里不要出现任何文字',
    )
    const scenePrompt = assetBasePrompt(street, 'scene')
    expect(scenePrompt).toContain('场景基准图：雨夜街道。霓虹、积水。')
    expect(scenePrompt).toContain('无人物空镜')
    expect(scenePrompt).toContain('不要出现任何文字')
    expect(assetBasePrompt({ ...rider, description: '' }, 'char')).toBe(
      '角色定妆图：骑手。正面半身，中性表情，干净的纯色背景，清晰展示发型、服装与配饰细节，画面里不要出现任何文字',
    )
  })

  it('★★ 记节点：写 nodeId；**换节点顺手清掉旧 baseHash**；同值返回原引用', () => {
    let doc = addCharacter(sample(), 1)
    const id = doc.characters[0]!.id
    doc = setAssetNode(doc, 'char', id, 'n1', 2)
    doc = setAssetBaseHash(doc, 'char', id, 'h1', 3)
    expect(doc.characters[0]!.nodeId).toBe('n1')
    expect(doc.characters[0]!.baseHash).toBe('h1')
    const same = setAssetNode(doc, 'char', id, 'n1', 4)
    expect(same).toBe(doc)
    const swapped = setAssetNode(doc, 'char', id, 'n2', 5)
    expect(swapped.characters[0]!.nodeId).toBe('n2')
    expect('baseHash' in swapped.characters[0]!).toBe(false)
    expect(swapped.updatedAt).toBe(5)
  })

  it('镜像基准图 hash：同 hash 空操作；找不到那条资产也返回原引用', () => {
    const doc = addScene(sample(), 1)
    const id = doc.scenes[0]!.id
    const once = setAssetBaseHash(doc, 'scene', id, 'h1', 2)
    expect(once.scenes[0]!.baseHash).toBe('h1')
    expect(setAssetBaseHash(once, 'scene', id, 'h1', 3)).toBe(once)
    expect(setAssetBaseHash(once, 'scene', 'scene_x', 'h9', 4)).toBe(once)
    expect(setAssetNode(once, 'char', id, 'n1', 5)).toBe(once)
  })
})

describe('角色多视角 turnaround', () => {
  const sample = (): StoryboardDoc => {
    let doc = emptyStoryboard('p1', 0)
    doc = addCharacter(doc, 1)
    const id = doc.characters[0]!.id
    return updateCharacter(doc, id, { name: '骑手', description: '二十出头，雨衣' }, 2)
  }

  it('★★ 提示词要求四格、同一角色、同一光照，并且不要文字', () => {
    const doc = sample()
    const prompt = assetTurnaroundPrompt(doc.characters[0]!)
    expect(prompt).toContain('角色多视角设定图：骑手。二十出头，雨衣。')
    expect(prompt).toContain('正面全身、侧面全身、背面全身、正面脸部特写四格并排')
    expect(prompt).toContain('同一角色、同一光照、同一服装与配饰')
    expect(prompt).toContain('画面里不要出现任何文字')
  })

  it('★★ 节点与产物 hash 分开记；换节点清旧 hash，同值空操作', () => {
    let doc = sample()
    const id = doc.characters[0]!.id
    doc = setAssetTurnaroundNode(doc, 'char', id, 'nt1', 3)
    doc = setAssetTurnaroundHash(doc, 'char', id, 'ht1', 4)
    expect(doc.characters[0]!.turnaroundNodeId).toBe('nt1')
    expect(doc.characters[0]!.turnaroundHash).toBe('ht1')
    expect(setAssetTurnaroundHash(doc, 'char', id, 'ht1', 5)).toBe(doc)
    const swapped = setAssetTurnaroundNode(doc, 'char', id, 'nt2', 6)
    expect(swapped.characters[0]!.turnaroundNodeId).toBe('nt2')
    expect('turnaroundHash' in swapped.characters[0]!).toBe(false)
  })

  it('★ 读回按字段读，空值不落占位', () => {
    const doc = sample()
    const id = doc.characters[0]!.id
    const raw = parseStoryboard(
      {
        ...doc,
        characters: [
          { ...doc.characters[0]!, turnaroundNodeId: 'nt1', turnaroundHash: 'ht1' },
        ],
      },
      'p1',
    )
    expect(raw.characters[0]!.turnaroundNodeId).toBe('nt1')
    expect(raw.characters[0]!.turnaroundHash).toBe('ht1')
    const bare = parseStoryboard(
      {
        ...doc,
        characters: [{ ...doc.characters[0]!, id, turnaroundNodeId: '', turnaroundHash: '' }],
      },
      'p1',
    )
    expect('turnaroundNodeId' in bare.characters[0]!).toBe(false)
    expect('turnaroundHash' in bare.characters[0]!).toBe(false)
  })

  it('★ 合并资产时 keep 没有的 turnaround 从 drop 接过来', () => {
    let doc = sample()
    const keepId = doc.characters[0]!.id
    doc = addCharacter(doc, 3)
    const dropId = doc.characters[1]!.id
    doc = {
      ...doc,
      characters: doc.characters.map((c) =>
        c.id === dropId
          ? { ...c, turnaroundNodeId: 'nt-drop', turnaroundHash: 'ht-drop' }
          : c,
      ),
    }
    const merged = mergeAsset(doc, 'char', keepId, dropId, 7)
    const keep = merged.characters.find((c) => c.id === keepId)!
    expect(keep.turnaroundNodeId).toBe('nt-drop')
    expect(keep.turnaroundHash).toBe('ht-drop')
  })
})

/**
 * 「这一镜出视频」（对账 #429）。
 *
 * 三条纪律与出图那条**逐条对齐**（同一件事不能两套规矩）：
 * 建完节点就记账、换节点就清旧产物、镜像"变了才写"。
 */
describe('这一镜出视频：节点记账与产物镜像', () => {
  const sample = (): StoryboardDoc => {
    const base = emptyStoryboard('p1', 0)
    const withEp = addEpisode(base, 1)
    const withShot = addShot(withEp, withEp.episodes[0]!.id, 2)
    return withShot
  }

  it('★ 建完节点就写进文档（跑视频中途失败，节点也已经躺在画布上了）', () => {
    const doc = sample()
    const shotId = doc.shots[0]!.id
    const next = setShotVideoNode(doc, shotId, 'nv1', 7, 'n-next')
    expect(next.shots[0]!.videoNodeId).toBe('nv1')
    expect(next.shots[0]!.videoEndNodeId).toBe('n-next')
    expect(next.updatedAt).toBe(7)
  })

  it('★★ 换视频节点时清掉旧 hash（那张视频属于旧节点）', () => {
    const doc = sample()
    const shotId = doc.shots[0]!.id
    const withVideo: StoryboardDoc = {
      ...doc,
      shots: [
        {
          ...doc.shots[0]!,
          videoNodeId: 'nv-old',
          videoEndNodeId: 'n-old-next',
          videoHash: 'hv-old',
        },
      ],
    }
    const next = setShotVideoNode(withVideo, shotId, 'nv-new', 9, 'n-new-next')
    expect(next.shots[0]!.videoNodeId).toBe('nv-new')
    expect(next.shots[0]!.videoEndNodeId).toBe('n-new-next')
    expect('videoHash' in next.shots[0]!).toBe(false)
  })

  it('★★ 同一视频节点换尾帧也要清掉旧 hash（镜头衔接变了，旧成片不再成立）', () => {
    const doc = sample()
    const shotId = doc.shots[0]!.id
    const withVideo: StoryboardDoc = {
      ...doc,
      shots: [
        {
          ...doc.shots[0]!,
          videoNodeId: 'nv1',
          videoEndNodeId: 'n-old-next',
          videoHash: 'hv-old',
        },
      ],
    }
    const next = setShotVideoNode(withVideo, shotId, 'nv1', 10, 'n-new-next')
    expect(next.shots[0]!.videoNodeId).toBe('nv1')
    expect(next.shots[0]!.videoEndNodeId).toBe('n-new-next')
    expect('videoHash' in next.shots[0]!).toBe(false)
  })

  it('★ 同一个节点且尾帧不变 / 不认识的 shotId ⇒ 原样返回原引用', () => {
    const doc = sample()
    const shotId = doc.shots[0]!.id
    const once = setShotVideoNode(doc, shotId, 'nv1', 1, 'n-next')
    expect(setShotVideoNode(once, shotId, 'nv1', 2, 'n-next')).toBe(once)
    expect(setShotVideoNode(doc, 'shot_x', 'nv1', 2)).toBe(doc)
  })

  it('★★ 镜像视频 hash；同值空操作、能换成新 hash（重出视频）', () => {
    const doc = sample()
    const shotId = doc.shots[0]!.id
    expect(attachShotVideos(doc, [], 1)).toBe(doc)
    const once = attachShotVideos(doc, [{ shotId, hash: 'hv1' }], 3)
    expect(once.shots[0]!.videoHash).toBe('hv1')
    expect(attachShotVideos(once, [{ shotId, hash: 'hv1' }], 4)).toBe(once)
    const twice = attachShotVideos(once, [{ shotId, hash: 'hv2' }], 5)
    expect(twice.shots[0]!.videoHash).toBe('hv2')
  })

  it('★★★ 换**图**节点时，连视频一起作废（视频是拿旧那张图做的）', () => {
    const doc = sample()
    const shotId = doc.shots[0]!.id
    const withAll: StoryboardDoc = {
      ...doc,
      shots: [
        {
          ...doc.shots[0]!,
          nodeId: 'n-old',
          imageHash: 'h-old',
          videoNodeId: 'nv-old',
          videoEndNodeId: 'n-old-next',
          videoHash: 'hv-old',
        },
      ],
    }
    const next = attachShotNodes(withAll, [{ shotId, nodeId: 'n-new' }], 11)
    expect(next.shots[0]!.nodeId).toBe('n-new')
    expect('imageHash' in next.shots[0]!).toBe(false)
    expect('videoNodeId' in next.shots[0]!).toBe(false)
    expect('videoEndNodeId' in next.shots[0]!).toBe(false)
    expect('videoHash' in next.shots[0]!).toBe(false)
  })

  it('★ 读回：videoNodeId / videoEndNodeId / videoHash 按字段读，空值不落占位', () => {
    const doc = sample()
    const shotId = doc.shots[0]!.id
    const raw = {
      ...doc,
      shots: [
        {
          ...doc.shots[0]!,
          videoNodeId: 'nv1',
          videoEndNodeId: 'n-next',
          videoHash: 'hv1',
        },
      ],
    }
    const parsed = parseStoryboard(raw, 'p1')
    expect(parsed.shots[0]!.videoNodeId).toBe('nv1')
    expect(parsed.shots[0]!.videoEndNodeId).toBe('n-next')
    expect(parsed.shots[0]!.videoHash).toBe('hv1')
    const bare = parseStoryboard(
      {
        ...doc,
        shots: [
          {
            ...doc.shots[0]!,
            id: shotId,
            videoNodeId: '',
            videoEndNodeId: '',
            videoHash: '',
          },
        ],
      },
      'p1',
    )
    expect('videoNodeId' in bare.shots[0]!).toBe(false)
    expect('videoEndNodeId' in bare.shots[0]!).toBe(false)
    expect('videoHash' in bare.shots[0]!).toBe(false)
  })

  it('★★ 视频提示词只写运镜时仍保留画面基准；首尾帧会追加下一镜衔接', () => {
    let doc = sample()
    const firstId = doc.shots[0]!.id
    doc = updateShot(doc, firstId, { videoPrompt: '镜头缓慢推进，人物抬头' }, 20)
    doc = addShot(doc, doc.episodes[0]!.id, 21)
    const [first, next] = shotsOf(doc, doc.episodes[0]!.id)
    doc = updateShot(doc, next!.id, { scene: '门口，快递箱放下' }, 22)
    const withNext = shotVideoPrompt(doc, first!, shotsOf(doc, doc.episodes[0]!.id)[1])
    expect(withNext).toContain('镜头缓慢推进，人物抬头')
    expect(withNext).toContain('画面基准：')
    expect(withNext).toContain(first!.scene)
    expect(withNext).toContain('镜头衔接：')
    expect(withNext).toContain('门口，快递箱放下')
  })

  it('★ 没写视频提示词时仍补一条自然镜头运动约束', () => {
    const doc = sample()
    const text = shotVideoPrompt(doc, doc.shots[0]!)
    expect(text).toContain('镜头运动：')
    expect(text).toContain('保持人物身份、服装、场景与光线一致')
  })
})

/**
 * **参考图回喂**（对账 #430）。
 *
 * #419 的定妆图 / 基准图此前只显示、不喂生成（典型假功能）。这一组守的是
 * 「这一镜该接哪几张图」与「连线该怎么改」两件纯逻辑 —— 真发请求那一段由冒烟 G143 守。
 */
describe('参考图回喂：这一镜该接哪几张图', () => {
  /** 一镜 + 一角色 + 一场景，三者都绑好，且资产都已经出了基准图（节点 n-char / n-scene） */
  const wired = (): StoryboardDoc => {
    let doc = addCharacter(addScene(emptyStoryboard('p1'), 1), 1)
    doc = addEpisode(doc, 1)
    doc = addShot(doc, doc.episodes[0]!.id, 1)
    const shotId = doc.shots[0]!.id
    const charId = doc.characters[0]!.id
    const sceneId = doc.scenes[0]!.id
    doc = setAssetNode(doc, 'char', charId, 'n-char', 1)
    doc = setAssetBaseHash(doc, 'char', charId, 'h-char', 1)
    doc = setAssetNode(doc, 'scene', sceneId, 'n-scene', 1)
    doc = setAssetBaseHash(doc, 'scene', sceneId, 'h-scene', 1)
    doc = bindShotScene(doc, shotId, sceneId, 1)
    doc = toggleShotCharacter(doc, shotId, charId, 1)
    return doc
  }
  const live = new Set(['n-char', 'n-scene', 'n-shot'])

  it('★★★ 场景 + 角色各一张：场景在前、角色按库里顺序（同一份数据每次算出来一样）', () => {
    const doc = wired()
    expect(shotRefNodeIds(doc, doc.shots[0]!, live)).toEqual(['n-scene', 'n-char'])
  })

  it('★★ 有图才接：还没出基准图的资产不接线（接上去也送不出任何字节）', () => {
    let doc = wired()
    doc = setAssetNode(doc, 'char', doc.characters[0]!.id, 'n-char2', 2)
    /* 换节点顺手清了 baseHash（见 setAssetNode）⇒ 这一条此刻不该再接 */
    expect(shotRefNodeIds(doc, doc.shots[0]!, new Set(['n-char2', 'n-scene']))).toEqual(['n-scene'])
  })

  it('★★ 节点是缓存不是真相：用户在画布上删过那个节点，就不再接它', () => {
    const doc = wired()
    expect(shotRefNodeIds(doc, doc.shots[0]!, new Set(['n-scene']))).toEqual(['n-scene'])
  })

  it('★★★ 换角色：接新的、**断旧的**（否则请求里同时喂两个人，画面里混着上一版）', () => {
    let doc = wired()
    const shotId = doc.shots[0]!.id
    const oldChar = doc.characters[0]!.id
    doc = toggleShotCharacter(doc, shotId, oldChar, 2)
    doc = addCharacter(doc, 2)
    const newChar = doc.characters[1]!.id
    doc = setAssetNode(doc, 'char', newChar, 'n-char-b', 2)
    doc = setAssetBaseHash(doc, 'char', newChar, 'h-char-b', 2)
    doc = toggleShotCharacter(doc, shotId, newChar, 2)
    const plan = planShotRefEdges(doc, doc.shots[0]!, ['n-scene', 'n-char'], new Set(['n-scene', 'n-char', 'n-char-b']))
    expect(plan.connect).toEqual(['n-char-b'])
    expect(plan.disconnect).toEqual(['n-char'])
  })

  it('★★ 用户手工连进来的参考图不动（只断我们自己接的那些）', () => {
    const doc = wired()
    const plan = planShotRefEdges(
      doc,
      doc.shots[0]!,
      ['n-scene', 'n-char', 'n-handmade'],
      new Set(['n-scene', 'n-char', 'n-handmade']),
    )
    expect(plan.connect).toEqual([])
    expect(plan.disconnect).toEqual([])
  })

  it('★ 已经接齐了 ⇒ 一条命令都不发（别每次出图都往撤销栈里塞空事务）', () => {
    const doc = wired()
    const plan = planShotRefEdges(doc, doc.shots[0]!, ['n-scene', 'n-char'], live)
    expect(plan).toEqual({ connect: [], disconnect: [] })
  })
})

/**
 * **对白层**（对账 #435）。
 *
 * 这一组守两件事：① 老数据（`dialogue: string`）读回来**一个字都不丢**、而且 id 稳定
 * （每次读都生成新 id，会让用户任何一次编辑把它换掉，而它正是将来配音要对齐的键）；
 * ② 增 / 改 / 删三个动作各自只动该动的那一句，且**没变化就返回原引用**。
 */
describe('对白层', () => {
  const withShot = () => {
    let doc = addEpisode(emptyStoryboard('p1'), 1)
    doc = addShot(doc, doc.episodes[0]!.id, 2)
    return doc
  }

  it('★★★ 老数据迁移：`dialogue` 读成一句 line，**id 稳定**（读两次是同一个 id）', () => {
    const base = withShot()
    const raw = {
      ...base,
      shots: [{ ...base.shots[0]!, dialogue: '早啊' }],
    }
    const once = parseStoryboard(raw, 'p1')
    const twice = parseStoryboard(raw, 'p1')
    expect(once.shots[0]!.lines).toEqual([{ id: 'legacy-1', text: '早啊' }])
    expect(twice.shots[0]!.lines[0]!.id).toBe(once.shots[0]!.lines[0]!.id)
    /* 没有台词的镜头就是空数组（不是一条空 line） */
    expect(parseStoryboard(base, 'p1').shots[0]!.lines).toEqual([])
  })

  it('★★ 多句读回：空的丢掉、说话人悬空就丢掉、情绪留着', () => {
    const base = withShot()
    const charId = base.characters[0]?.id ?? 'c1'
    const raw = {
      ...base,
      characters: [{ id: charId, name: '骑手', description: '', aliases: [] }],
      shots: [
        {
          ...base.shots[0]!,
          lines: [
            { id: 'l1', text: '第一句', speakerId: charId, emotion: ' 冷静 ' },
            { id: 'l2', text: '   ' },
            { text: '没有 id' },
            { id: 'l3', text: '第二句', speakerId: '不存在的人' },
          ],
        },
      ],
    }
    const doc = parseStoryboard(raw, 'p1')
    expect(doc.shots[0]!.lines).toEqual([
      { id: 'l1', text: '第一句', speakerId: charId, emotion: '冷静' },
      { id: 'l3', text: '第二句' },
    ])
  })

  it('★★★ 增 / 改 / 删各只动该动的那一句；没变化就返回原引用', () => {
    let doc = withShot()
    const shotId = doc.shots[0]!.id
    doc = addShotLine(doc, shotId, { text: '第一句' }, 3)
    doc = addShotLine(doc, shotId, { text: '第二句' }, 4)
    expect(doc.shots[0]!.lines.map((l) => l.text)).toEqual(['第一句', '第二句'])

    const first = doc.shots[0]!.lines[0]!.id
    const second = doc.shots[0]!.lines[1]!.id
    const edited = updateShotLine(doc, shotId, second, { text: '改过的第二句' }, 5)
    expect(edited.shots[0]!.lines.map((l) => l.text)).toEqual(['第一句', '改过的第二句'])
    expect(edited.shots[0]!.lines[0]!.id).toBe(first)
    /* 同值 ⇒ 原引用（别搅动防抖保存） */
    expect(updateShotLine(edited, shotId, second, { text: '改过的第二句' }, 6)).toBe(edited)
    expect(updateShotLine(edited, shotId, '不存在', { text: 'x' }, 6)).toBe(edited)

    const removed = removeShotLine(edited, shotId, first, 7)
    expect(removed.shots[0]!.lines.map((l) => l.text)).toEqual(['改过的第二句'])
    expect(removeShotLine(removed, shotId, first, 8)).toBe(removed)

    /* 说话人必须落在角色库里：不在库里的 id 一律落成空 */
    const bad = updateShotLine(removed, shotId, second, { speakerId: '不存在' }, 9)
    expect(bad.shots[0]!.lines[0]!.speakerId).toBeUndefined()
  })

  it('★★ 合并成一句话（导出分镜表用）：带说话人名字；找不到人就只写正文', () => {
    let doc = withShot()
    const charId = doc.characters[0]?.id ?? 'c1'
    doc = {
      ...doc,
      characters: [{ id: charId, name: '骑手', description: '', aliases: [] }],
    }
    const shotId = doc.shots[0]!.id
    doc = addShotLine(doc, shotId, { text: '今天最后一单', speakerId: charId }, 3)
    doc = addShotLine(doc, shotId, { text: '辛苦了' }, 3)
    expect(shotDialogueTextOf(doc, doc.shots[0]!)).toBe('骑手：今天最后一单 / 辛苦了')

    /* 说话人从库里删掉（读回时会丢掉悬空引用）⇒ 只剩正文，不留一个空冒号 */
    const alone = { ...doc, characters: [] }
    expect(shotDialogueTextOf(alone, alone.shots[0]!)).toBe('今天最后一单 / 辛苦了')
  })
})

/**
 * **手工合并两条资产**（对账 #436）。
 *
 * 拆镜按 `name + aliases` 自动归并，但模型换个叫法（"林轩" / "林公子"）就会落下两条重复。
 * 这一组的每条断言都对着"合并之后用户的东西还在不在"：引用有没有跟过来、别名有没有留下、
 * 刚出的定妆图会不会白做。
 */
describe('手工合并资产', () => {
  /** 两个角色 + 两镜：第 1 镜只引用 drop，第 2 镜**同时**引用两条 */
  const two = () => {
    let doc = emptyStoryboard('p1', 0)
    doc = addCharacter(doc, 1)
    doc = addCharacter(doc, 1)
    const [keep, drop] = doc.characters
    doc = updateCharacter(doc, keep!.id, { name: '林轩', description: '主角' }, 1)
    doc = updateCharacter(
      doc,
      drop!.id,
      { name: '林公子', description: '主角的另一个叫法', aliases: ['公子'] },
      1,
    )
    doc = addEpisode(doc, 1)
    doc = addShot(doc, doc.episodes[0]!.id, 1)
    doc = addShot(doc, doc.episodes[0]!.id, 1)
    doc = toggleShotCharacter(doc, doc.shots[0]!.id, drop!.id, 1)
    doc = toggleShotCharacter(doc, doc.shots[1]!.id, drop!.id, 1)
    doc = toggleShotCharacter(doc, doc.shots[1]!.id, keep!.id, 1)
    return { doc, keepId: keep!.id, dropId: drop!.id }
  }

  it('★★★ 引用跟过来，且**同一镜同时引用两条时合并成一条**（不留重复 id）', () => {
    const { doc, keepId, dropId } = two()
    const merged = mergeAsset(doc, 'char', keepId, dropId, 9)
    expect(merged.shots[0]!.characterIds).toEqual([keepId])
    expect(merged.shots[1]!.characterIds).toEqual([keepId])
  })

  it('★★★ 名字也变成别名（以后拆镜才认得出"林公子"就是林轩），并去掉重复与空值', () => {
    const { doc, keepId, dropId } = two()
    const merged = mergeAsset(doc, 'char', keepId, dropId, 9)
    const keep = merged.characters.find((c) => c.id === keepId)!
    expect(merged.characters).toHaveLength(1)
    expect(keep.aliases).toEqual(['林公子', '公子'])
  })

  it('★ 与 keep **同名**的那份不留成别名（别名栏里出现一个与名字一样的项没有意义）', () => {
    const { doc, keepId, dropId } = two()
    const sameName = updateCharacter(doc, dropId, { name: '林轩' }, 9)
    const merged = mergeAsset(sameName, 'char', keepId, dropId, 9)
    expect(merged.characters[0]!.aliases).toEqual(['公子'])
  })

  it('★★ 描述：keep 写过就留着；keep 空才借 drop 的', () => {
    const { doc, keepId, dropId } = two()
    const kept = mergeAsset(doc, 'char', keepId, dropId, 9)
    expect(kept.characters[0]!.description).toBe('主角')

    const blank = updateCharacter(doc, keepId, { description: '' }, 9)
    expect(mergeAsset(blank, 'char', keepId, dropId, 9).characters[0]!.description).toBe(
      '主角的另一个叫法',
    )
  })

  it('★★★ 基准图：keep 没有就接 drop 的（nodeId 与 hash 一起）；keep 有就留 keep 的', () => {
    const { doc, keepId, dropId } = two()
    let withBase = setAssetNode(doc, 'char', dropId, 'n-drop', 9)
    withBase = setAssetBaseHash(withBase, 'char', dropId, 'h-drop', 9)
    const carried = mergeAsset(withBase, 'char', keepId, dropId, 9)
    expect(carried.characters[0]!.nodeId).toBe('n-drop')
    expect(carried.characters[0]!.baseHash).toBe('h-drop')

    let both = setAssetNode(withBase, 'char', keepId, 'n-keep', 9)
    both = setAssetBaseHash(both, 'char', keepId, 'h-keep', 9)
    const kept = mergeAsset(both, 'char', keepId, dropId, 9)
    expect(kept.characters[0]!.baseHash).toBe('h-keep')
    expect(kept.characters[0]!.nodeId).toBe('n-keep')
  })

  it('★★★ 场景走同一条路：镜头的 `sceneId` 改成 keep', () => {
    let doc = emptyStoryboard('p1', 0)
    doc = addScene(doc, 1)
    doc = addScene(doc, 1)
    const [keep, drop] = doc.scenes
    doc = updateScene(doc, keep!.id, { name: '雨夜街道' }, 1)
    doc = updateScene(doc, drop!.id, { name: '下雨的街', aliases: ['老街'] }, 1)
    doc = addEpisode(doc, 1)
    doc = addShot(doc, doc.episodes[0]!.id, 1)
    doc = bindShotScene(doc, doc.shots[0]!.id, drop!.id, 1)

    const merged = mergeAsset(doc, 'scene', keep!.id, drop!.id, 9)
    expect(merged.scenes).toHaveLength(1)
    expect(merged.shots[0]!.sceneId).toBe(keep!.id)
    expect(merged.scenes[0]!.aliases).toEqual(['下雨的街', '老街'])
  })

  it('★ 不合法（id 相同 / 找不到其中一条）⇒ 返回原引用', () => {
    const { doc, keepId, dropId } = two()
    expect(mergeAsset(doc, 'char', keepId, keepId, 9)).toBe(doc)
    expect(mergeAsset(doc, 'char', keepId, '不存在', 9)).toBe(doc)
    expect(mergeAsset(doc, 'scene', keepId, dropId, 9)).toBe(doc)
  })
})
