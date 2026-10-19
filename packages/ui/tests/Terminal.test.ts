import { describe, expect, it } from 'vitest'

import { plainTerminalLine } from '../src/thread/Terminal/Terminal'

describe('plainTerminalLine', () => {
  it('takes off colour, cursor, title and link codes', () => {
    expect(plainTerminalLine('\u001b[31mFAIL\u001b[0m a.test.ts')).toBe('FAIL a.test.ts')
    expect(plainTerminalLine('\u001b]0;bun test\u0007done')).toBe('done')
    expect(plainTerminalLine('see \u001b]8;;https://a.test\u001b\\a.test\u001b]8;;\u001b\\')).toBe('see a.test')
  })

  it('reads a log of unended title codes at once, keeping them as text', () => {
    // A check's log is anyone's text: many title codes that never end once took time growing with their square.
    const line = '\u001b]'.repeat(50_000)
    const started = performance.now()
    expect(plainTerminalLine(line)).toBe(line)
    expect(performance.now() - started).toBeLessThan(200)
  })
})
