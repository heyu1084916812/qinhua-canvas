import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  addEpisode,
  addShot,
  addShotLine,
  emptyStoryboard,
  shotsOf,
  storyboardStats,
} from '../../domain/storyboard/storyboard'
import { AssetPlatformProvider } from '../../features/shared/assets/AssetPlatformContext'
import { StoryboardEditorView } from './StoryboardEditorView'
import type { StoryboardEditorViewProps } from './StoryboardEditor.types'

function props(): StoryboardEditorViewProps {
  const withEpisode = addEpisode(emptyStoryboard('project-1', 1), 2)
  const episode = withEpisode.episodes[0]!
  const withShot = addShot(withEpisode, episode.id, 3)
  const shot = withShot.shots[0]!
  const doc = addShotLine(withShot, shot.id, { text: '测试台词' }, 4)
  const shots = shotsOf(doc, episode.id)
  const noop = () => undefined
  const actions = new Proxy(
    {},
    { get: () => noop },
  ) as unknown as StoryboardEditorViewProps['actions']

  return {
    projectId: doc.projectId,
    projectName: '结构测试',
    status: '',
    doc,
    stats: storyboardStats(doc),
    episodes: doc.episodes,
    selected: episode,
    selectedIndex: 0,
    shots,
    selectedSourceText: '',
    liveNodeIds: new Set<string>(),
    needNodes: shots,
    laidCount: 0,
    videoPending: 0,
    voicePending: 0,
    timeline: { clips: [], missing: [] },
    timelineSrt: '',
    timelineSrtCues: 0,
    confirming: '',
    merge: null,
    merges: [],
    mergeScan: { kind: 'idle', text: '' },
    mergeConfirmId: '',
    split: { kind: 'idle', text: '' },
    splitConfirm: false,
    breaking: 'idle',
    breakMsg: '',
    breakConfirm: false,
    lay: { kind: 'idle', text: '' },
    preview: null,
    sourcePreview: null,
    rendering: false,
    voiceBusy: {},
    digitalHumanBusy: null,
    videoUpscaleBusy: null,
    videoEraseBusy: null,
    videoEditBusy: null,
    videoExtendBusy: null,
    chatTarget: null,
    speechTarget: null,
    digitalHumanTarget: null,
    videoUpscaleTargets: [],
    videoEraseTargets: [],
    videoEditTargets: [],
    videoExtendTargets: [],
    canvas: {
      nodeStateOf: () => undefined,
      isRunning: false,
    },
    canRenderLocally: false,
    actions,
    imageActions: new Proxy({}, { get: () => noop }) as never,
    videoActions: new Proxy({}, { get: () => noop }) as never,
    digitalHumanActions: new Proxy({}, { get: () => noop }) as never,
    audioActions: new Proxy({}, { get: () => noop }) as never,
    authoringActions: new Proxy({}, { get: () => noop }) as never,
    exportActions: new Proxy({}, { get: () => noop }) as never,
    shotActions: {
      layOut: async () => undefined,
      syncPrompts: noop,
    },
  }
}

function dataAttributesInOrder(html: string): string[] {
  return Array.from(html.matchAll(/(data-[a-z-]+)(?:=|\s|>)/g), (match) => match[1]!)
}

describe('StoryboardEditorView structure', () => {
  it('keeps the stable storyboard marker hierarchy and shot list contract', () => {
    const html = renderToStaticMarkup(
      createElement(
        AssetPlatformProvider,
        {
          platform: {
            assets: {
              read: async () => null,
              readUrl: async () => null,
            },
          } as never,
        },
        createElement(StoryboardEditorView, props()),
      ),
    )
    const attributes = dataAttributesInOrder(html)

    expect(html.startsWith('<div')).toBe(true)
    expect(attributes[0]).toBe('data-storyboard-page')
    expect(attributes).toContain('data-storyboard-title')
    expect(attributes).toContain('data-storyboard-source-text')
    expect(attributes).toContain('data-storyboard-add-episode')
    expect(attributes).toContain('data-storyboard-add-character')
    expect(attributes).toContain('data-storyboard-episode-title')
    expect(attributes).toContain('data-storyboard-shot')
    expect(attributes).not.toContain('data-storyboard-shots-empty')

    const page = attributes.indexOf('data-storyboard-page')
    const source = attributes.indexOf('data-storyboard-source-text')
    const episodes = attributes.indexOf('data-storyboard-add-episode')
    const characters = attributes.indexOf('data-storyboard-add-character')
    const workspace = attributes.indexOf('data-storyboard-episode-title')
    const shot = attributes.indexOf('data-storyboard-shot')
    expect(page).toBeLessThan(source)
    expect(source).toBeLessThan(episodes)
    expect(episodes).toBeLessThan(characters)
    expect(characters).toBeLessThan(workspace)
    expect(workspace).toBeLessThan(shot)
  })
})
