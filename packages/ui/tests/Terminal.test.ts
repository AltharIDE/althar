import { describe, expect, it } from 'vitest'

import { plainTerminalLine, tidyTerminalLines } from '../src/thread/Terminal/Terminal'

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

describe('tidyTerminalLines', () => {
  it('takes off the indent every line shares, keeping the indent between them', () => {
    expect(tidyTerminalLines(['   ✓ a', '     ✓ a/b', '', '   ✗ c'])).toEqual(['✓ a', '  ✓ a/b', '', '✗ c'])
  })

  it('drops the padding wc sets a lone count in', () => {
    expect(tidyTerminalLines(['docs/a.md', '      95'])).toEqual(['docs/a.md', '95'])
    expect(tidyTerminalLines(['      95'])).toEqual(['95'])
    expect(tidyTerminalLines(['  12 docs/a.md', '   3 docs/b.md'])).toEqual(['12 docs/a.md', ' 3 docs/b.md'])
  })

  it('leaves lines without indent as they are', () => {
    expect(tidyTerminalLines(['a', '  b'])).toEqual(['a', '  b'])
    expect(tidyTerminalLines([])).toEqual([])
  })
})

describe('tidyTerminalLines on structured output', () => {
  it('keeps an indented number where it sits in YAML, a tree or a log', () => {
    expect(tidyTerminalLines(['values:', '  - 1', '    2'])).toEqual(['values:', '  - 1', '    2'])
    expect(tidyTerminalLines(['counts:', '  total:', '      95'])).toEqual(['counts:', '  total:', '      95'])
    expect(tidyTerminalLines(['retries', '  3', '  12'])).toEqual(['retries', '  3', '  12'])
  })
})
