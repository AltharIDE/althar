import { describe, expect, it } from 'vitest'

import { describe as describeParts, plainName, presetOf, type PresetParts } from '../src/presets'

/* How a preset's parts are said: the name an offered preset starts with, its description, and the preset a plan is. */

const parts = (more: Partial<PresetParts> = {}): PresetParts => ({
  workspace: 'worktree',
  checked: 'before',
  shelf: 'board',
  lead: null,
  reviewer: null,
  brief: '',
  ...more,
})

describe('a preset’s name in plain words', () => {
  it('says how it differs from Change, two things at most', () => {
    expect(plainName(parts({ workspace: 'local', checked: 'none', end: 'ready' }))).toBe('Local, no review')
    expect(plainName(parts({ workspace: 'copy', checked: 'after', end: 'none' }))).toBe('In a copy, reviewed after merge')
    expect(plainName(parts({ end: 'none' }))).toBe('No PR')
    expect(plainName(parts())).toBe('My change')
  })
})

describe('a preset described', () => {
  it('says where it works, how it’s checked and ends, and each effort the person set', () => {
    const said = describeParts(
      parts({ workspace: 'copy', checked: 'after', end: 'ready', effort: 'high', reviewer: 'codex/gpt-6.1', reviewerEffort: 'medium' }),
    )
    expect(said).toContain('a copy, reviewed after it merges, a pull request ready for review')
    expect(said).toContain('the coordinator picks its lead, at high effort')
    expect(said).toContain('at medium effort')
  })
})

describe('the preset a plan is', () => {
  it('names a built-in one Althar no longer has by its own parts', () => {
    const gone = { id: 'builtin:gone', name: 'Gone', builtin: true, projectId: null, parts: parts({ workspace: 'local' }) }
    expect(presetOf([gone], parts({ workspace: 'local' }))).toBe('Gone')
    expect(presetOf([gone], parts())).toBe('Change')
  })
})
