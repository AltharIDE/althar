import { describe, expect, it } from 'vitest'

import { takesKeep, unmovedText, unmovedWhy } from '../src/renderer/shared/calls'

describe('Keep for later', () => {
  it('is offered on a finished task waiting in Needs you, held for Ship or not, but not with its pull request open', () => {
    expect(takesKeep({ phase: 'ready', pullOpen: false })).toBe(true)
    expect(takesKeep({ phase: 'ready', state: 'running', pullOpen: false })).toBe(true)
    expect(takesKeep({ phase: 'ready', pullOpen: true })).toBe(false)
    expect(takesKeep({ phase: 'ready', state: 'done', pullOpen: false })).toBe(false)
    expect(takesKeep({ phase: 'ready', state: 'abandoned', pullOpen: false })).toBe(false)
    expect(takesKeep({ phase: 'waiting', pullOpen: false })).toBe(false)
  })

  it('says why a task it was answered for didn’t move, by how it reads now', () => {
    expect(unmovedWhy({ phase: 'ready', pullOpen: true })).toBe(unmovedText.pullOpen)
    expect(unmovedWhy({ phase: 'waiting', pullOpen: true })).toBe(unmovedText.pullOpen)
    expect(unmovedWhy({ phase: 'waiting', pullOpen: false })).toBe(unmovedText.waits)
    expect(unmovedWhy({ phase: 'running', pullOpen: false })).toBe(unmovedText.other)
  })
})
