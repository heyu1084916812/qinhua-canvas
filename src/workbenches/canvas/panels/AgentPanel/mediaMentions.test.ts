import { describe, expect, it } from 'vitest'
import {
  explicitMediaModelsFromMentions,
  preferredGeneratedModel,
} from './mediaMentions'

describe('explicitMediaModelsFromMentions', () => {
  it('keeps the first explicit image and video model from this user turn', () => {
    expect(
      explicitMediaModelsFromMentions(
        [
          { kind: 'node', id: 'node-1' },
          { kind: 'model', id: 'GPT Image 2' },
          { kind: 'model', id: 'Nano Banana 2.1' },
          { kind: 'model', id: 'Seedance 2.5' },
          { kind: 'model', id: 'Video Model B' },
        ],
        (model) =>
          model === 'GPT Image 2' || model === 'Nano Banana 2.1'
            ? 'image'
            : model.includes('Video') || model === 'Seedance 2.5'
              ? 'video'
              : 'chat',
      ),
    ).toEqual({ image: 'GPT Image 2', video: 'Seedance 2.5' })
  })

  it('ignores chat and unknown models', () => {
    expect(
      explicitMediaModelsFromMentions(
        [
          { kind: 'model', id: 'Deepseek 4.1 Flash' },
          { kind: 'model', id: 'Unknown' },
        ],
        (model) => (model.includes('Deepseek') ? 'chat' : 'unknown'),
      ),
    ).toEqual({})
  })

  it('lets this turn’s model chip beat inherited, sticky and selected-node models', () => {
    expect(
      preferredGeneratedModel({
        explicit: 'GPT Image 2',
        planned: 'Nano Banana 2.1',
        sessionPicked: 'Seedream 4',
        sticky: 'Old Sticky',
        selected: 'Selected',
      }),
    ).toBe('GPT Image 2')
    expect(
      preferredGeneratedModel({
        explicit: '',
        planned: '',
        sessionPicked: 'Seedream 4',
        sticky: 'Old Sticky',
        selected: 'Selected',
      }),
    ).toBe('Seedream 4')
  })
})
