import { describe, expect, it } from 'vitest'
import { recent, search, type Context, type Entry } from '../src/renderer/features/finder/model'
import { passageOf } from '../src/renderer/features/finder/match'
import { entriesFor } from '../src/renderer/features/finder/entries'
import type { SearchDocument } from '@althar/contracts'
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
  it('lists the tasks changed last under Recent, and says where a pull request or an issue stands', () => {
    const entries = [entry('old', 'Old', { ago: 9000 }), entry('new', 'New', { ago: 5 }), entry('mid', 'Mid', { ago: 300 })]
    expect(recent(entries, context, 2).map((one) => one.id)).toEqual(['new', 'mid'])
    const doc = (id: string, kind: SearchDocument['kind'], state: string): SearchDocument => ({
      id,
      kind,
      projectId: 'p1',
      threadId: 't',
      taskId: null,
      itemId: null,
      title: id,
      body: '',
      ref: id,
      url: null,
      changedAt: new Date().toISOString(),
      state,
    })
    const stands = entriesFor(
      [
        doc('a', 'pull', 'merged'),
        doc('b', 'pull', 'draft'),
        doc('c', 'pull', 'closed'),
        doc('d', 'issue', 'In Progress'),
        doc('e', 'issue', ''),
      ],
      [],
      context,
      [],
      null,
    )
    expect(stands.filter((one) => one.id.length === 1).map((one) => one.stand?.word)).toEqual([
      'Merged',
      'Draft',
      'Closed',
      'In Progress',
      undefined,
    ])
  })
})
