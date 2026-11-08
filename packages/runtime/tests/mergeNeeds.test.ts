import type { MergeRules } from '@althar/connectors'
import type { ChangeSummary, ChecksSummary } from '@althar/contracts'
import { assert, describe, it } from '@effect/vitest'

import { changeOf } from '../src/Queries'
import { checksNeedOf, heldBack, mergeNeedsOf, withPushed } from '../src/mergeNeeds'
import { isMergeable } from '../src/needsYou'

type Ran = ChecksSummary['list'][number]
const ran = (name: string, state: Ran['state']): Ran => ({ name, state, summary: null })

const checks = (...list: ReadonlyArray<Ran>): ChecksSummary => ({
  outcome: list.some((one) => one.state === 'failed')
    ? 'failed'
    : list.some((one) => one.state === 'running' || one.state === 'queued')
      ? 'running'
      : list.length === 0
        ? 'none'
        : 'passed',
  passed: list.filter((one) => one.state === 'passed').length,
  failed: list.filter((one) => one.state === 'failed').length,
  running: list.filter((one) => one.state === 'running').length,
  total: list.length,
  failing: list.filter((one) => one.state === 'failed').map((one) => one.name),
  list: [...list],
})

const change = (more: Partial<ChangeSummary> = {}): ChangeSummary => ({
  product: 'github',
  number: 113,
  title: 'Add a retry',
  url: 'https://github.com/acme/app/pull/113',
  state: 'open',
  draft: false,
  noun: 'pull request',
  short: 'PR',
  prefix: '#',
  repository: 'acme/app',
  slug: null,
  additions: null,
  deletions: null,
  changedFiles: null,
  checks: checks(ran('test', 'passed')),
  target: 'main',
  conflicts: false,
  head: 'abc',
  listening: true,
  localHead: 'abc',
  unpushed: 0,
  diverged: null,
  ...more,
})

describe('What merging a change needs, as one list (DEV-204)', () => {
  it('blocked on GitHub by a missing approval, a required check and being behind: each crossed or waiting, the rest ticked', () => {
    const rules: MergeRules = {
      requiredChecks: ['test', 'build'],
      needs: [
        { kind: 'approvals', state: 'unmet', have: 0, need: 1, who: [] },
        { kind: 'changes_requested', state: 'met' },
        { kind: 'up_to_date', state: 'unmet', have: 3 },
      ],
    }
    const seen = change({ checks: checks(ran('test', 'failed'), ran('build', 'running'), ran('lint', 'failed'), ran('docs', 'passed')) })
    assert.deepStrictEqual(mergeNeedsOf(seen, rules), [
      {
        kind: 'checks',
        state: 'unmet',
        have: 0,
        need: 2,
        who: ['test'],
        required: ['test', 'build'],
        apart: { passed: 1, failed: ['lint'], running: 0 },
      },
      { kind: 'approvals', state: 'unmet', have: 0, need: 1, who: [] },
      { kind: 'changes_requested', state: 'met' },
      { kind: 'up_to_date', state: 'unmet', have: 3 },
      { kind: 'conflicts', state: 'met' },
      { kind: 'draft', state: 'met' },
      { kind: 'pushed', state: 'met' },
    ])
  })

  it('the rest its branch requires come last; a conflict the host hasn’t worked out is unknown; a draft is crossed', () => {
    const needs = mergeNeedsOf(change({ draft: true, conflicts: undefined }), {
      requiredChecks: 'all',
      needs: [
        { kind: 'merge_queue', state: 'met' },
        { kind: 'signatures', state: 'unknown' },
        { kind: 'other', state: 'unmet', said: 'Blocked by another merge request' },
        { kind: 'conversations', state: 'met', have: 2, need: 2 },
      ],
    })
    assert.deepStrictEqual(
      needs?.map((one) => [one.kind, one.state]),
      [
        ['checks', 'met'],
        ['conversations', 'met'],
        ['conflicts', 'unknown'],
        ['draft', 'unmet'],
        ['pushed', 'met'],
        ['merge_queue', 'met'],
        ['signatures', 'unknown'],
        ['other', 'unmet'],
      ],
    )
  })

  it('none for a change that isn’t open, or whose host hasn’t said', () => {
    assert.isUndefined(mergeNeedsOf(change({ state: 'merged' }), { requiredChecks: null, needs: [] }))
    assert.isUndefined(mergeNeedsOf(change(), null))
    assert.isUndefined(mergeNeedsOf(change(), undefined))
  })

  describe('its checks', () => {
    it('a required check that hasn’t started is waited on, by name; with none required, the rest are apart and it is met', () => {
      assert.deepStrictEqual(checksNeedOf(checks(ran('lint', 'passed')), ['test']), {
        kind: 'checks',
        state: 'waiting',
        have: 0,
        need: 1,
        who: ['test'],
        required: ['test'],
        apart: { passed: 1, failed: [], running: 0 },
      })
      assert.deepStrictEqual(checksNeedOf(checks(ran('lint', 'failed'), ran('e2e', 'queued')), []), {
        kind: 'checks',
        state: 'met',
        have: 0,
        need: 0,
        required: [],
        apart: { passed: 0, failed: ['lint'], running: 1 },
      })
    })

    it('every check counts where the host holds it to all, or can’t say; a cancelled one as failed, skipped as passed', () => {
      assert.deepStrictEqual(checksNeedOf(checks(ran('test', 'cancelled'), ran('docs', 'skipped')), 'all'), {
        kind: 'checks',
        state: 'unmet',
        have: 1,
        need: 2,
        who: ['test'],
      })
      assert.deepStrictEqual(checksNeedOf(checks(ran('test', 'running')), null), {
        kind: 'checks',
        state: 'waiting',
        have: 0,
        need: 1,
        who: ['test'],
      })
    })

    it('none run yet: waited on where the host holds it to all, unknown where it can’t say; not read at all, unknown', () => {
      assert.strictEqual(checksNeedOf(checks(), 'all').state, 'waiting')
      assert.strictEqual(checksNeedOf(checks(), null).state, 'unknown')
      assert.deepStrictEqual(checksNeedOf(null, ['test']), { kind: 'checks', state: 'unknown' })
    })
  })

  describe('what is left to push', () => {
    const rules: MergeRules = { requiredChecks: [], needs: [] }
    const pushed = (more: Partial<ChangeSummary>) =>
      withPushed({ ...change(more), needs: mergeNeedsOf(change(), rules) ?? [] }).needs?.find((one) => one.kind === 'pushed')

    it('commits the person pushes are crossed; ones that go up on their own are waited on; a parted branch is crossed', () => {
      assert.deepStrictEqual(pushed({ unpushed: 2 }), { kind: 'pushed', state: 'unmet', have: 2 })
      assert.deepStrictEqual(pushed({ unpushed: 2, pushing: { held: null } }), { kind: 'pushed', state: 'waiting', have: 2 })
      assert.deepStrictEqual(pushed({ diverged: { kind: 'moved', local: 1, onPullRequest: 1 } }), { kind: 'pushed', state: 'unmet' })
      assert.deepStrictEqual(pushed({ unpushed: 2, localHead: null }), { kind: 'pushed', state: 'met' })
    })

    it('a change with no list is left as it is', () => {
      const plain = change({ unpushed: 3 })
      assert.strictEqual(withPushed(plain), plain)
    })
  })

  describe('whether it can merge as it stands', () => {
    it('not while anything is crossed or waited on; unknown and its merge queue hold nothing back', () => {
      const rules = (needs: MergeRules['needs']): ChangeSummary => {
        const seen = change()
        return { ...seen, needs: mergeNeedsOf(seen, { requiredChecks: ['test'], needs }) ?? [] }
      }
      assert.isTrue(isMergeable(rules([{ kind: 'signatures', state: 'unknown' }])))
      assert.isTrue(isMergeable(rules([{ kind: 'merge_queue', state: 'waiting' }])))
      assert.isFalse(isMergeable(rules([{ kind: 'approvals', state: 'unmet', have: 0, need: 1 }])))
      assert.isFalse(isMergeable(rules([{ kind: 'code_owners', state: 'waiting', who: ['acme/web'] }])))
      assert.isTrue(isMergeable(change()))
      assert.isFalse(heldBack([{ kind: 'other', state: 'unknown' }]))
    })
  })

  it('read from what Althar kept of it: its host’s rules, at the head they were read', () => {
    const kept = {
      number: 113,
      title: 'Add a retry',
      url: 'https://github.com/acme/app/pull/113',
      state: 'open',
      draft: false,
      headSha: 'abc',
      repository: ['acme', 'app'],
      words: { noun: 'pull request', short: 'PR', prefix: '#' },
      checks: { sha: 'abc', ...checks(ran('test', 'running')) },
      target: 'main',
      conflicts: false,
      rules: {
        requiredChecks: ['test'],
        needs: [{ kind: 'approvals', state: 'waiting', have: 0, need: 1, who: ['ana'] }],
        sha: 'abc',
        at: '2026-11-08T10:00:00.000Z',
      },
    }
    assert.deepStrictEqual(
      changeOf(kept, 'github', true)?.needs?.map((one) => [one.kind, one.state]),
      [
        ['checks', 'waiting'],
        ['approvals', 'waiting'],
        ['conflicts', 'met'],
        ['draft', 'met'],
        ['pushed', 'met'],
      ],
    )
    // Kept before Althar read them, or one the host doesn't read: no list.
    assert.isUndefined(changeOf({ ...kept, rules: undefined }, 'github', true)?.needs)
    assert.isUndefined(changeOf({ ...kept, rules: { needs: 'nonsense' } }, 'github', true)?.needs)
  })
})
