import { describe, expect, it } from 'vitest'

import { fillPattern, patternProblem } from '../src/names'

describe('a name made by a pattern', () => {
  it('fills the key and the name, and leaves out a key the task hasn’t, with what holds it', () => {
    expect(fillPattern('feature/{key}-{slug}', { key: 'PROJ-123', slug: 'fix-login' })).toBe('feature/PROJ-123-fix-login')
    expect(fillPattern('feature/{key}-{slug}', { key: null, slug: 'fix-login' })).toBe('feature/fix-login')
    expect(fillPattern('{key}: {title}', { key: null, title: 'Fix login' })).toBe('Fix login')
    expect(fillPattern('[{key}] {title}', { key: null, title: 'Fix login' })).toBe('Fix login')
    expect(fillPattern('{slug}-{key}', { key: null, slug: 'fix-login' })).toBe('fix-login')
  })

  it('says what is wrong with a pattern Althar can’t follow', () => {
    expect(patternProblem('branch', 'feature/{key}-{slug}')).toBeNull()
    expect(patternProblem('title', '{key}: {title}')).toBeNull()
    expect(patternProblem('branch', 'feature/{key}')).toMatch(/needs \{slug\}/)
    expect(patternProblem('branch', '{type}/{slug}')).toMatch(/\{type\} isn't something/)
    expect(patternProblem('branch', 'my feature/{slug}')).toMatch(/Git doesn’t allow/)
    expect(patternProblem('title', '{key}')).toMatch(/needs \{title\}/)
    expect(patternProblem('branch', 'feature/{issue-id}/{slug}')).toMatch(/\{issue-id\} isn't something/)
    expect(patternProblem('branch', '{{slug}}')).toMatch(/Braces go round a placeholder only/)
    expect(patternProblem('branch', '-{slug}')).toMatch(/Git doesn’t allow/)
  })
})
