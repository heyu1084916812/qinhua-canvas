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
import styles from './StoryboardPage.module.css'

function props(options: { shotImageHash?: string } = {}): StoryboardEditorViewProps {
  const withEpisode = addEpisode(emptyStoryboard('project-1', 1), 2)
  const episode = withEpisode.episodes[0]!
  const withShot = addShot(withEpisode, episode.id, 3)
  const shot = withShot.shots[0]!
  const withLine = addShotLine(withShot, shot.id, { text: '测试台词' }, 4)
  const doc = options.shotImageHash
    ? {
        ...withLine,
        shots: withLine.shots.map((item) =>
          item.id === shot.id
            ? { ...item, imageHash: options.shotImageHash }
            : item,
        ),
      }
    : withLine
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
    projection: {} as never,
    graph: { nodes: [], edges: [] },
    executionStatus: {
      subjectStateOf: () => undefined,
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

  it('keeps the frozen page/body/left/right/block/shots layout classes', () => {
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

    for (const className of [
      styles.page,
      styles.body,
      styles.left,
      styles.right,
      styles.block,
      styles.shots,
    ]) {
      expect(html).toContain(className)
    }

    const page = html.indexOf(styles.page)
    const body = html.indexOf(styles.body)
    const left = html.indexOf(styles.left)
    const right = html.indexOf(styles.right)
    const rightBlock = html.indexOf(styles.block, right)
    const shots = html.indexOf(styles.shots)

    expect(page).toBeLessThan(body)
    expect(body).toBeLessThan(left)
    expect(left).toBeLessThan(right)
    expect(right).toBeLessThan(rightBlock)
    expect(rightBlock).toBeLessThan(shots)
  })

  it('uses business media before canvas projection for status and generation', () => {
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
        createElement(
          StoryboardEditorView,
          props({ shotImageHash: 'image-hash' }),
        ),
      ),
    )
    const runButton = html.match(
      /<button[^>]*data-storyboard-shot-run[^>]*>/,
    )?.[0]

    expect(html).toContain('data-kind="done"')
    expect(runButton).toBeDefined()
    expect(runButton).not.toContain('disabled')
  })
})
