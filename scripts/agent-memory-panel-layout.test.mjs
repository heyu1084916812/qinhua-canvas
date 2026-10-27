import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/features/settings/AgentMemoryPanel.module.css', import.meta.url)),
  'utf8',
)

describe('AgentMemoryPanel textarea layout', () => {
  it('keeps full-width textareas inside their section', () => {
    const textareaRule = css.match(/\.textarea\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(textareaRule).toMatch(/box-sizing:\s*border-box;/)
    expect(textareaRule).toMatch(/display:\s*block;/)
    expect(textareaRule).toMatch(/width:\s*100%;/)
    expect(textareaRule).toMatch(/max-width:\s*100%;/)
  })
})
