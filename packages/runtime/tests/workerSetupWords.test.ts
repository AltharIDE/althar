import { describe, expect, it } from 'vitest'

import { toldOf } from '../src/Setups'

/* What a lead on a worker is told of its setup there (ADR-103): what failed, and to fix it there and record it for every worker. */

describe('a setup that failed on a worker', () => {
  it('gives its lead the failing step and its output, to fix there without root unasked and record for every worker', () => {
    const said = toldOf(
      [
        {
          name: 'althar',
          setUp: {
            at: '2026-11-20T10:00:00.000Z',
            command: 'bun install --frozen-lockfile',
            code: 127,
            timedOut: false,
            last: 'sh: 1: bun: not found',
          },
          recorded: true,
          checkout: '/Users/person/althar',
          worker: 'runner-1',
        },
      ],
      false,
    )
    expect(said).toContain('When the worktree on runner-1 was made')
    expect(said).toContain('sh: 1: bun: not found')
    expect(said).toContain('ask the person before running anything as root on runner-1')
    expect(said).toContain("kept as the repository's setup for workers, which every worker runs")
    expect(said).not.toContain('/Users/person/althar')
  })

  it('says a setup that went through as it did, and asks for one where none ran', () => {
    const at = '2026-11-20T10:00:00.000Z'
    expect(
      toldOf(
        [
          {
            name: 'althar',
            setUp: { at, command: 'bun install', code: 0, timedOut: false, last: null },
            recorded: true,
            checkout: null,
            worker: 'runner-1',
          },
        ],
        false,
      ),
    ).toContain("that went through: what it installs is there, so don't run it again")
    expect(
      toldOf(
        [
          {
            name: 'althar',
            setUp: { at, command: null, code: null, timedOut: false, last: null },
            recorded: false,
            checkout: null,
            worker: 'runner-1',
          },
        ],
        false,
      ),
    ).toContain('No setup ran in the worktree on runner-1')
  })
})
