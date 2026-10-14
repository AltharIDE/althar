import { describe, expect, it } from 'vitest'

import { commandGlance } from '../src/lib/commandGlance'

const SCRIPT = [
  "cd /Users/me/work/althar && python3 - <<'EOF'",
  ...Array.from({ length: 30 }, (_, i) => `print("<h1>page ${i}</h1>")  # && ; not a split`),
  'EOF',
  "cat > peek.mjs <<'EOF'",
  ...Array.from({ length: 6 }, (_, i) => `console.log(${i})`),
  'EOF',
  'ls',
  'lsof -iTCP:5374 -sTCP:LISTEN',
].join('\n')

describe('commandGlance', () => {
  it('shows a one-liner as it is', () => {
    expect(commandGlance('bun test')).toEqual({ lines: ['bun test'], summary: null })
  })

  it('cuts a long one-liner and says how long it is', () => {
    const long = `curl ${'https://example.com/a/very/long/path/'.repeat(8)}`
    const glance = commandGlance(long)
    expect(glance.lines).toHaveLength(1)
    expect(glance.lines[0]?.endsWith('…')).toBe(true)
    expect(glance.lines[0]?.length).toBeLessThanOrEqual(96)
    expect(glance.summary).toBe(`${long.length} characters in all`)
  })

  it('shows the first two commands of a && chain and counts the rest', () => {
    expect(commandGlance('a && b && c')).toEqual({ lines: ['a', 'b'], summary: 'and 1 more' })
    expect(commandGlance('git add . && git commit -m "x; y" && git push && bun test').lines).toEqual(['git add .', 'git commit -m "x; y"'])
  })

  it('leaves out a leading cd', () => {
    expect(commandGlance('cd /some/dir && bun test').lines).toEqual(['bun test'])
  })

  it('folds a heredoc body into the command that opens it', () => {
    const glance = commandGlance(SCRIPT)
    expect(glance.lines).toEqual(["python3 - <<'EOF' …", "cat > peek.mjs <<'EOF' …"])
    expect(glance.summary).toBe(`and 2 more · ${SCRIPT.split('\n').length} lines in all`)
  })

  it('keeps the whole of a short multi-line script', () => {
    expect(commandGlance('mkdir out\nls out')).toEqual({ lines: ['mkdir out', 'ls out'], summary: null })
  })
})
