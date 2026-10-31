import { describe, expect, it } from 'vitest'

import { plainTerminalLine } from '../src/thread/Terminal/Terminal'

describe('plainTerminalLine', () => {
  it('takes off colour, cursor, title and link codes', () => {
    expect(plainTerminalLine('\u001b[31mFAIL\u001b[0m a.test.ts')).toBe('FAIL a.test.ts')
    expect(plainTerminalLine('\u001b]0;bun test\u0007done')).toBe('done')
    expect(plainTerminalLine('see \u001b]8;;https://a.test\u001b\\a.test\u001b]8;;\u001b\\')).toBe('see a.test')
  })

  it('keeps a log of unended title codes as text', () => {
    // A check's log is anyone's text; how long this takes is the performance run's (Terminal.bench.ts).
    const line = '\u001b]'.repeat(50_000)
    expect(plainTerminalLine(line)).toBe(line)
  })
})
