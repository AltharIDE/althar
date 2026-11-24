import type { PermissionRequest } from '@althar/provider-adapters'
import { describe, expect, it } from 'vitest'

import { decideReader } from '../src/rules'

/*
 * The coordinator as a trusted reader (ADR-058), on lines it can't read through: a substitution or arithmetic left
 * open, and variables that may hold more values than it reads. Each is refused with why, never run unread.
 */

const request = (command: string): PermissionRequest => ({
  sessionId: 's',
  toolCallId: 't',
  title: command,
  kind: 'execute',
  paths: [],
  options: [],
  rawInput: { command },
})

const coordinator = (command: string) => {
  const decided = decideReader(request(command), { cwd: '/work/meridian/.coordinator', trusted: true })
  return decided.verdict === 'deny' ? decided.reason : 'allowed'
}

describe('a substitution the coordinator can’t find the end of', () => {
  it('is refused, saying which: `$(…)` with an open quote, `$((…))`, `<(…)` and a backtick', () => {
    expect(coordinator("echo $(git log 'x)")).toBe("Althar can't tell where this `$(…)` ends, and this role only reads.")
    expect(coordinator('echo $((1+2)')).toBe("Althar can't tell where this `$((…))` ends, and this role only reads.")
    expect(coordinator('diff <(git show HEAD:a b')).toBe(
      "Althar can't tell where this process substitution ends, and this role only reads.",
    )
    expect(coordinator('echo `git log')).toBe("Althar can't tell where this backtick ends, and this role only reads.")
    expect(coordinator('echo `git log \\` x`')).toBe("Althar can't tell where this backtick ends, and this role only reads.")
  })

  it('reads an escape or a quoted quote inside one as the shell does', () => {
    expect(coordinator('git log "$(git rev-parse a\\ b)"')).toBe('allowed')
    // Closed, past its inner quote: what it prints may still start with a dash.
    expect(coordinator('git log "$(git log --format="a\\"b" -1)"')).toContain('could start with a dash')
  })
})

describe('variables the coordinator reads through', () => {
  it('reads one set in an `if` as maybe set, and arithmetic standing in a word or a loop’s values', () => {
    expect(coordinator('if true; then d=src; fi; ls $d')).toBe('allowed')
    expect(coordinator('for f in a$((1+2)); do ls $f; done')).toBe('allowed')
    expect(coordinator('ls $((1+2))')).toBe('allowed')
  })

  it('refuses arithmetic that sets a variable among a loop’s values, and more values than it reads through', () => {
    expect(coordinator('for f in $((a=1)); do ls $f; done')).toContain('sets a variable')
    const values = Array.from({ length: 9 }, (_, at) => `v${at}`).join(' ')
    expect(coordinator(`for a in ${values}; do for b in ${values}; do ls $a $b; done; done`)).toContain(
      'may hold more values than Althar reads through',
    )
  })
})
