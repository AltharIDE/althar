import { describe, expect, it } from 'vitest'

import { commandGlance, statementsOf } from '../src/lib/commandGlance'

describe('commandGlance heredocs', () => {
  it('folds a body whichever way its end word is written', () => {
    const script = [
      'cat > a.txt <<"END"',
      'one',
      'END',
      'cat > b.txt <<-TABS',
      '\ttwo',
      '\tTABS',
      'cat > c.txt << \\RAW',
      'three',
      'RAW',
    ].join('\n')
    expect(statementsOf(script)).toEqual([
      { text: 'cat > a.txt <<"END"', body: 1 },
      { text: 'cat > b.txt <<-TABS', body: 1 },
      { text: 'cat > c.txt << \\RAW', body: 1 },
    ])
    expect(commandGlance(script)).toEqual({
      lines: ['cat > a.txt <<"END" …', 'cat > b.txt <<-TABS …'],
      summary: `and 1 more · 9 lines in all`,
    })
  })

  it('folds every line after a body whose end never comes', () => {
    expect(statementsOf('cat <<EOF\nline one\nline two && not a command')).toEqual([{ text: 'cat <<EOF', body: 2 }])
  })

  it('gives the body to the last command on the line that opens it', () => {
    expect(statementsOf("cd out && cat > x <<'EOF'\nbody\nEOF")).toEqual([
      { text: 'cd out', body: 0 },
      { text: "cat > x <<'EOF'", body: 1 },
    ])
  })
})

describe('commandGlance quoting', () => {
  it('doesn’t end a command at an escaped quote inside double quotes', () => {
    expect(commandGlance('echo "a \\" && b" && ls').lines).toEqual(['echo "a \\" && b"', 'ls'])
  })

  it('takes a backslash in single quotes as itself', () => {
    expect(commandGlance("echo 'a\\' && ls").lines).toEqual(["echo 'a\\'", 'ls'])
  })

  it('doesn’t end a command at an escaped separator', () => {
    expect(commandGlance('find . -exec rm {} \\; && ls').lines).toEqual(['find . -exec rm {} \\;', 'ls'])
  })

  it('takes a single & or | as part of the command', () => {
    expect(commandGlance('sleep 1 & wait | cat').lines).toEqual(['sleep 1 & wait | cat'])
  })

  it('shows a command of nothing but separators as it is', () => {
    expect(commandGlance(' ; ; ')).toEqual({ lines: ['; ;'], summary: null })
  })
})

describe('commandGlance words', () => {
  it('says what is left out in the words given', () => {
    const glance = commandGlance('a && b && c && d\ne\nf\ng', { more: (n) => `+${n}`, lines: (n) => `${n} rows` })
    expect(glance).toEqual({ lines: ['a', 'b'], summary: '+5 · 4 rows' })
    expect(commandGlance(`echo ${'x'.repeat(120)}`, { characters: (n) => `${n} chars` }).summary).toBe('125 chars')
  })
})
