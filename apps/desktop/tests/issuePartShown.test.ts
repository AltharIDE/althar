import { describe, expect, it } from 'vitest'

import { issuePartShown } from '../src/renderer/features/task/actions'

/* The "Only part of" switch talks about a merge: it shows only where the task has a pull request to merge. */

const open = { state: 'open' as const }
const closed = { state: 'closed' as const }

describe('issuePartShown', () => {
  it('shows where the task ends in a pull request', () => {
    expect(issuePartShown({ state: 'working', end: 'draft', changes: [] })).toBe(true)
    expect(issuePartShown({ state: 'working', end: 'ready', changes: [] })).toBe(true)
  })

  it('hides where the task ends with no pull request, a prototype or a chat', () => {
    expect(issuePartShown({ state: 'working', end: 'none', changes: [] })).toBe(false)
    expect(issuePartShown({ state: 'working', end: null, changes: [] })).toBe(false)
  })

  it('hides after the ending moved to none and its pull request closed, though the record stays', () => {
    expect(issuePartShown({ state: 'working', end: 'none', changes: [closed] })).toBe(false)
  })

  it('shows for a pull request open on a task with no pull request ending', () => {
    expect(issuePartShown({ state: 'working', end: 'none', changes: [open] })).toBe(true)
  })

  it('hides once the task is done or abandoned', () => {
    expect(issuePartShown({ state: 'done', end: 'ready', changes: [open] })).toBe(false)
    expect(issuePartShown({ state: 'abandoned', end: 'ready', changes: [open] })).toBe(false)
  })
})
