import { describe, expect, it } from 'vite-plus/test'

import { plan } from '../src/stress'

describe('the stress plan', () => {
  it('runs one changed test twenty times on Linux and ten on Windows', () => {
    const planned = plan(['packages/runtime/tests/limits.test.ts', 'packages/runtime/src/limits.ts'])
    expect(planned.linux).toEqual({ parts: [{ dir: 'packages/runtime', files: ['tests/limits.test.ts'] }], runs: 20 })
    expect(planned.windows).toEqual({ parts: [{ dir: 'packages/runtime', files: ['tests/limits.test.ts'] }], runs: 10 })
    expect(planned.specs.files).toEqual([])
  })

  it('runs each of many changed tests fewer times, never fewer than three on Linux and two on Windows', () => {
    const many = Array.from({ length: 40 }, (_, index) => `packages/runtime/tests/t${index}.test.ts`)
    expect(plan(many).linux.runs).toBe(5)
    expect(plan(many).windows.runs).toBe(2)
    const more = Array.from({ length: 150 }, (_, index) => `packages/runtime/tests/t${index}.test.ts`)
    expect(plan(more).linux.runs).toBe(3)
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

  it('runs changed specs up to five times, on up to four machines', () => {
    const one = plan(['apps/desktop/e2e/limits.spec.ts', 'apps/desktop/e2e/support.ts', 'apps/desktop/e2e/real.spec.ts'])
    expect(one.specs).toEqual({ files: ['e2e/limits.spec.ts'], runs: 5, shards: ['1/1'] })
    const many = plan(Array.from({ length: 30 }, (_, index) => `apps/desktop/e2e/s${index}.spec.ts`))
    expect(many.specs.runs).toBe(2)
    expect(many.specs.shards).toEqual(['1/4', '2/4', '3/4', '4/4'])
  })
})
