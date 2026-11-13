import { describe, expect, it } from 'vite-plus/test'

import { moreRuns, plan } from '../src/stress'

describe('the stress plan', () => {
  it('runs a changed test three times on a pull request, and twenty on Linux and ten on Windows at night', () => {
    const changed = ['packages/runtime/tests/limits.test.ts', 'packages/runtime/src/limits.ts']
    const parts = [{ dir: 'packages/runtime', files: ['tests/limits.test.ts'] }]
    expect(plan(changed).linux).toEqual({ parts, runs: 3, seconds: 900 })
    expect(plan(changed, 'nightly').linux).toEqual({ parts, runs: 20, seconds: 2400 })
    expect(plan(changed, 'nightly').windows).toEqual({ parts, runs: 10 })
    expect(plan(changed).specs.files).toEqual([])
  })

  it('runs each of many changed tests fewer times at night, never fewer than three on Linux and two on Windows', () => {
    const many = Array.from({ length: 40 }, (_, index) => `packages/runtime/tests/t${index}.test.ts`)
    expect(plan(many, 'nightly').linux.runs).toBe(5)
    expect(plan(many, 'nightly').windows.runs).toBe(2)
    expect(plan(many).linux.runs).toBe(3)
    const more = Array.from({ length: 150 }, (_, index) => `packages/runtime/tests/t${index}.test.ts`)
    expect(plan(more, 'nightly').linux.runs).toBe(3)
  })

  it("groups the tests by package, and leaves Windows those it doesn't run there", () => {
    const planned = plan(['apps/site/tests/og.test.ts', 'packages/ui/tests/Menu.test.tsx', 'packages/ui/tests/Select.test.tsx'])
    expect(planned.linux.parts).toEqual([
      { dir: 'apps/site', files: ['tests/og.test.ts'] },
      { dir: 'packages/ui', files: ['tests/Menu.test.tsx', 'tests/Select.test.tsx'] },
    ])
    expect(planned.windows.parts).toEqual([{ dir: 'packages/ui', files: ['tests/Menu.test.tsx', 'tests/Select.test.tsx'] }])
  })

  it('leaves out tests of real agents and accounts, fixtures and support files', () => {
    const planned = plan([
      'packages/runtime/tests/agents/claude.test.ts',
      'packages/connectors/tests/real/github.test.ts',
      'packages/testing/tests/fixtures/once.fixture.ts',
      'packages/runtime/tests/support.ts',
    ])
    expect(planned.linux.parts).toEqual([])
  })

  it('runs a changed spec twice on a pull request and up to five times at night, on up to four machines', () => {
    const changed = ['apps/desktop/e2e/limits.spec.ts', 'apps/desktop/e2e/support.ts', 'apps/desktop/e2e/real.spec.ts']
    expect(plan(changed).specs).toEqual({ files: ['e2e/limits.spec.ts'], runs: 2, shards: ['1/1'] })
    expect(plan(changed, 'nightly').specs).toEqual({ files: ['e2e/limits.spec.ts'], runs: 5, shards: ['1/1'] })
    const many = Array.from({ length: 30 }, (_, index) => `apps/desktop/e2e/s${index}.spec.ts`)
    expect(plan(many, 'nightly').specs.runs).toBe(2)
    expect(plan(many, 'nightly').specs.shards).toEqual(['1/4', '2/4', '3/4', '4/4'])
    expect(plan(many).specs.shards).toEqual(['1/4', '2/4', '3/4', '4/4'])
  })

  it('runs a slow file at night as many times as fit in its share of the time, never fewer than three, never more than planned', () => {
    // One file of 220 s, alone: ten runs fit in forty minutes, not twenty.
    expect(1 + moreRuns(20, 220, 2400)).toBe(10)
    // A fast one runs as many times as planned.
    expect(1 + moreRuns(20, 2, 2400)).toBe(20)
    // One slower than its whole share still runs three times, as on a pull request.
    expect(1 + moreRuns(20, 3000, 2400)).toBe(3)
    expect(1 + moreRuns(3, 220, 900)).toBe(3)
    expect(1 + moreRuns(20, 0, 2400)).toBe(20)
  })
})
