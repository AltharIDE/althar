import { describe, expect, it } from 'vitest'
import { search, type Context, type Entry } from '../src/renderer/features/finder/model'
import { passageOf } from '../src/renderer/features/finder/match'
const context: Context = { project: 'p1', task: null, projects: [], usage: {} }
const entry = (id: string, title: string, over: Partial<Entry> = {}): Entry => ({
  id,
  title,
  kind: 'task',
  icon: 'work',
  go: { to: 'task', slug: id },
  ...over,
})
describe('search ranking', () => {
  it('ranks exact keys ahead of habit, supports initials and keeps ties stable', () => {
    const entries = [
      entry('b', 'Search task files'),
      entry('a', 'Search task files'),
      entry('c', 'Something unrelated', { keys: ['DEV-58'] }),
    ]
    expect(search(entries, 'DEV-58', { ...context, usage: { a: { n: 100000, at: Date.now() } } })[0]?.entry.id).toBe('c')
    expect(search(entries, 'stf', context).map((one) => one.entry.id)).toEqual(['a', 'b'])
    expect(search(entries, 'search', context).map((one) => one.entry.id)).toEqual(['a', 'b'])
  })
  it('shows the words around a deep note match', () => {
    const text = `${'Earlier words. '.repeat(30)}Never rebase a published branch.`
    const found = passageOf(text, ['rebase'], 60)!
    expect(found.some((one) => one.hit && one.text.includes('rebase'))).toBe(true)
    expect(found.map((one) => one.text).join('').length).toBeLessThan(text.length)
  })
})
