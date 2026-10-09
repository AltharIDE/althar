import { describe, expect, it } from 'vite-plus/test'

import { listLayout } from '../src/thesis/prose'

const phrase = (text: string) => ({ text, nested: false })

describe('thesis lists', () => {
  it('puts a long catalogue of short phrases in two columns', () => {
    const items = ['source code', 'Git history', 'documentation', 'architecture notes', 'issue trackers', 'pull requests'].map(phrase)
    expect(listLayout(items, false)).toBe('columns')
  })

  it('keeps a sentence list in one ruled column', () => {
    const items = Array.from({ length: 6 }, (_, i) => phrase(`What belongs at scope ${i}?`))
    expect(listLayout(items, false)).toBe('rows')
  })

  it('gives a long numbered sequence the ruled rows', () => {
    const items = Array.from({ length: 9 }, (_, i) => phrase(`step ${i}`))
    expect(listLayout(items, true)).toBe('rows')
  })

  it('leaves a short list and a nested list alone', () => {
    expect(listLayout([phrase('a'), phrase('b'), phrase('c'), phrase('d')], false)).toBe('plain')
    expect(listLayout([...Array.from({ length: 6 }, () => phrase('note')), { text: 'parent', nested: true }], false)).toBe('plain')
  })
})
