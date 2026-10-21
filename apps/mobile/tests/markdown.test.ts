import { describe, expect, it } from 'vitest'

import { markdownBlocks } from '../src/model/markdown'

describe('an agent’s markdown, as a phone draws it', () => {
  it('reads paragraphs with emphasis, code and links', () => {
    expect(markdownBlocks('The dry run for **January** matches, see `out/jan.csv` and [the PR](https://x.dev/1).')).toEqual([
      {
        kind: 'paragraph',
        spans: [
          { text: 'The dry run for ' },
          { strong: true, text: 'January' },
          { text: ' matches, see ' },
          { code: true, text: 'out/jan.csv' },
          { text: ' and ' },
          { href: 'https://x.dev/1', text: 'the PR' },
          { text: '.' },
        ],
      },
    ])
  })

  it('reads lists, ordered and not, and where an ordered one starts', () => {
    const [bullets, numbers] = markdownBlocks('- one\n- *two*\n\n3. three\n4. four\n')
    expect(bullets).toEqual({ kind: 'list', ordered: false, start: 1, items: [[{ text: 'one' }], [{ em: true, text: 'two' }]] })
    expect(numbers).toMatchObject({ kind: 'list', ordered: true, start: 3 })
  })

  it('keeps code blocks whole, with their language', () => {
    expect(markdownBlocks('```ts\nconst a = 1 < 2\n```')).toEqual([{ kind: 'code', lang: 'ts', text: 'const a = 1 < 2' }])
  })

  it('reads headings, quotes and rules, and says entities as characters', () => {
    expect(markdownBlocks('## Done\n\n> it&#39;s fine & good\n\n---')).toEqual([
      { kind: 'heading', level: 2, spans: [{ text: 'Done' }] },
      { kind: 'quote', spans: [{ text: "it's fine & good" }] },
      { kind: 'rule' },
    ])
  })
})
