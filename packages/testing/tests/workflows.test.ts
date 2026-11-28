import { describe, expect, it } from 'vite-plus/test'

import { unmeasured } from '../src/workflows'

const quarantine = { uses: './.github/actions/flaky/quarantine' }

describe('the workflows', () => {
  it('names a job that measures coverage and reads the quarantine without running its lapsed tests', () => {
    expect(
      unmeasured({
        'harness.yml': {
          jobs: {
            coverage: { steps: [quarantine, { run: 'bun run test:coverage' }] },
            measured: { steps: [{ ...quarantine, with: { lapsed: 'run' } }, { run: 'bun run test:coverage --shard=1/4' }] },
          },
        },
        'post-merge.yml': {
          jobs: { packages: { steps: [quarantine, { env: { TESTS: 'test:coverage' }, run: 'bun run "$TESTS"' }] } },
        },
      }),
    ).toEqual(['harness.yml: coverage', 'post-merge.yml: packages'])
  })

  it('leaves a job that only tests, and one that measures coverage without the quarantine', () => {
    expect(
      unmeasured({
        'desktop.yml': {
          jobs: {
            unit: { steps: [quarantine, { run: 'bun run test' }] },
            merged: { steps: [{ run: 'bun run test:coverage --merge-reports=.vitest/blob' }] },
            none: {},
          },
        },
        'empty.yml': {},
      }),
    ).toEqual([])
  })
})
