import { describe, expect, it } from 'vitest'

import { changeSetText } from '../src/outputs/ChangeSet/ChangeSet'

describe('the change’s words', () => {
  it('count commits, checks and files, one and many alike', () => {
    expect(changeSetText.behindOn(1, 'origin')).toBe('1 commit not on origin yet')
    expect(changeSetText.behindOn(3, 'origin')).toBe('3 commits not on origin yet')
    expect(changeSetText.checksPassed(1)).toBe('1 check passed')
    expect(changeSetText.checksPassed(12)).toBe('12 checks passed')
    expect(changeSetText.checksFailed(['build'])).toBe('build failed')
    expect(changeSetText.checksFailed(['build', 'lint'])).toBe('2 checks failed: build, lint')
    expect(changeSetText.files(1)).toBe('1 file')
    expect(changeSetText.files(1234)).toBe('1,234 files')
  })
})
