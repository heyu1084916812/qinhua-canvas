import { describe, expect, it } from 'vitest'
import {
  addCharacter,
  addEpisode,
  addShot,
  addShotLine,
  emptyStoryboard,
  mergeStoryboardRunResults,
  type StoryboardDoc,
} from './storyboard'

function fixture(): {
  current: StoryboardDoc
  characterId: string
  shotId: string
  lineId: string
} {
  let current = emptyStoryboard('project-1', 1)
  current = addCharacter(current)
  const characterId = current.characters[0]!.id
  current = addEpisode(current)
  const episodeId = current.episodes[0]!.id
  current = addShot(current, episodeId)
  const shotId = current.shots[0]!.id
  current = addShotLine(current, shotId, {
    text: '标题',
    speakerId: characterId,
  })
  const lineId = current.shots[0]!.lines[0]!.id
  return { current, characterId, shotId, lineId }
}

describe('mergeStoryboardRunResults', () => {
  it('只合并产物字段，不覆盖执行期间用户的其它编辑', () => {
    const { current, characterId, shotId, lineId } = fixture()
    const edited: StoryboardDoc = {
      ...current,
      script: { ...current.script, title: '用户刚改的标题' },
      characters: current.characters.map((item) => ({
        ...item,
        name: '用户刚改的角色名',
      })),
      shots: current.shots.map((shot) => ({
        ...shot,
        scene: '用户刚改的画面描述',
        lines: shot.lines.map((line) => ({
          ...line,
          text: '用户刚改的台词',
        })),
      })),
    }
    const produced: StoryboardDoc = {
      ...current,
      characters: current.characters.map((item) => ({
        ...item,
        baseHash: 'base-hash',
      })),
      shots: current.shots.map((shot) => ({
        ...shot,
        imageHash: 'image-hash',
        videoHash: 'video-hash',
        lines: shot.lines.map((line) => ({
          ...line,
          audioHash: 'audio-hash',
          audioName: '配音.mp3',
        })),
      })),
    }

    const merged = mergeStoryboardRunResults(edited, produced, 20)

    expect(merged.script.title).toBe('用户刚改的标题')
    expect(merged.characters[0]).toMatchObject({
      id: characterId,
      name: '用户刚改的角色名',
      baseHash: 'base-hash',
    })
    expect(merged.shots[0]).toMatchObject({
      id: shotId,
      scene: '用户刚改的画面描述',
      imageHash: 'image-hash',
      videoHash: 'video-hash',
    })
    expect(merged.shots[0]!.lines[0]).toMatchObject({
      id: lineId,
      text: '用户刚改的台词',
      audioHash: 'audio-hash',
      audioName: '配音.mp3',
    })
    expect(merged.updatedAt).toBe(20)
  })

  it('没有业务变化时保持原引用，不搅动防抖保存', () => {
    const { current } = fixture()
    expect(mergeStoryboardRunResults(current, current)).toBe(current)
  })
})
