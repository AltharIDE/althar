import { describe, expect, it } from 'vitest'

import { commandsIn, copied, parseCommandLine, takesScript, unwrap, withoutQuotedHeredocs } from '../src/shellCommands'

/*
 * Command lines written less usually than the rules' own cases: a shell's script inside a compound command, a `case`
 * pattern or a function head spelled another way, and wrappers and copies given their options in rarer forms. Each is
 * read as the shell would run it.
 */

describe('a shell’s script inside a compound command', () => {
  it('runs as what holds it does: after `&&`, maybe in an `if`, many times in a loop, whenever a function is called', () => {
    expect(parseCommandLine("a && sh -c 'ls'").scopes?.[1]).toEqual({ opens: 1, closes: 1, joined: '&&' })
    expect(parseCommandLine("if x; then sh -c 'ls'; fi").scopes?.[1]).toEqual({ opens: 1, closes: 1, maybe: true })
    expect(parseCommandLine("while x; do sh -c 'ls'; done").scopes?.[1]).toEqual({ opens: 1, closes: 1, maybe: true, repeats: true })
    expect(parseCommandLine("f() { sh -c 'ls'; }")).toMatchObject({
      commands: [['ls'], ['}']],
      scopes: [
        { opens: 1, closes: 1, maybe: true, repeats: true, called: true },
        { opens: 0, closes: 0 },
      ],
    })
  })
})

describe('a `case` pattern and a function head, written another way', () => {
  it('reads past a pattern whose `)` stands apart, and a function named with `function f ()`', () => {
    expect(parseCommandLine('case x in a ) rm y;; esac').commands[0]).toEqual(['rm', 'y'])
    expect(parseCommandLine('function f () { rm x; }')).toMatchObject({ commands: [['rm', 'x'], ['}']], scopes: [{ called: true }, {}] })
  })

  it('keeps the subshell around a function or a `case` that opens with a parenthesis', () => {
    expect(parseCommandLine('(f() { rm x; })')).toMatchObject({
      commands: [['rm', 'x'], ['})']],
      scopes: [{ opens: 1, closes: 0 }, { closes: 1 }],
    })
    expect(parseCommandLine('(case x in a) rm y;; esac)')).toMatchObject({
      commands: [['rm', 'y'], ['esac)']],
      scopes: [{ opens: 1, closes: 0, maybe: true }, { closes: 1 }],
    })
  })

  it('reads a `case` head alone on its line as no subshell, its pattern on the next', () => {
    expect(parseCommandLine('case x in\na) ls;;\nesac')).toMatchObject({
      commands: [['case', 'x', 'in'], ['ls'], ['esac']],
      scopes: [{ opens: 0, closes: 0, maybe: true }, { maybe: true }, {}],
    })
  })
})

describe('wrappers and copies with rarer options', () => {
  it('reads past `flatpak-spawn`’s valued options and its `--`, and a package runner’s `--`', () => {
    expect(unwrap(['flatpak-spawn', '--env', 'A=1', '--', 'rm', 'x'])).toEqual(['rm', 'x'])
    expect(commandsIn(['npx', '--', 'vercel', 'deploy'])).toContainEqual(['vercel', 'deploy'])
    // `cmd` without `/c` hands no script on.
    expect(commandsIn(['cmd', 'dir'])).toEqual([['cmd', 'dir']])
  })

  it('takes a copy’s folder from an abbreviated `--target-directory`, and none where it’s left without one', () => {
    expect(copied(['cp', '--t=out', 'a'])).toEqual({ sources: ['a'], target: 'out' })
    expect(copied(['cp', '--verbose', 'a', 'b'])).toEqual({ sources: ['a'], target: 'b' })
    expect(copied(['cp', 'a', '--target-directory'])).toEqual({ sources: ['a'], target: '' })
    expect(copied(['cp', 'a', '-t'])).toEqual({ sources: ['a'], target: '' })
    expect(copied([])).toEqual({ sources: [], target: undefined })
  })

  it('never takes a shell for text where a variable changes what runs', () => {
    expect(takesScript(['PATH=/x', 'sh'])).toBe(false)
    expect(takesScript(['cat'])).toBe(true)
  })
})

describe('a quoted heredoc’s body beside rarer operators', () => {
  it('drops it where `>|` only redirects what reads it, and keeps it where `|&` pipes it to a shell', () => {
    expect(withoutQuotedHeredocs("cat <<'EOF' >| out\nx $(rm y)\nEOF")).toBe("cat <<'EOF' >| out\n")
    expect(withoutQuotedHeredocs("cat <<'EOF' |& sh\nrm x\nEOF")).toContain('rm x')
    // A comment on its line, to the end of the text, opens nothing.
    expect(withoutQuotedHeredocs("cat <<'EOF' # note")).toBe("cat <<'EOF' # note")
  })
})
