import { assert, describe, it } from '@effect/vitest'
import type { Check } from '@althar/connectors'

import { checksReady, externalWaitOf, waitOutcome } from '../src/externalWaits'

const check = (state: Check['state']): Check => ({ id: 'test', name: 'test', state, url: null, summary: null })

describe('external wait conditions', () => {
  it('never treats missing checks as passing, and distinguishes completion from success', () => {
    assert.isFalse(checksReady([], 'checks_passed'))
    assert.isFalse(checksReady([], 'checks_complete'))
    assert.isFalse(checksReady([check('running')], 'checks_complete'))
    assert.isTrue(checksReady([check('failed')], 'checks_complete'))
    assert.isFalse(checksReady([check('failed')], 'checks_passed'))
    assert.isTrue(checksReady([check('passed'), check('skipped')], 'checks_passed'))
  })

  it('waits for every condition in all mode, while an unreadable condition never counts as met', () => {
    assert.strictEqual(waitOutcome('all', [{ met: true }, { met: false }]), 'waiting')
    assert.strictEqual(waitOutcome('any', [{ met: true }, { met: false }]), 'ready')
    assert.strictEqual(waitOutcome('all', [{ met: true }, { met: true }]), 'ready')
    assert.strictEqual(waitOutcome('any', [{ met: false }, { met: false }]), 'waiting')
    assert.strictEqual(waitOutcome('all', [{ met: true }, { met: false, blocked: 'Closed without merging' }]), 'blocked')
  })

  it('validates persisted waits rather than trusting arbitrary output', () => {
    assert.isUndefined(externalWaitOf(null))
    assert.isUndefined(externalWaitOf('{'))
    assert.isUndefined(externalWaitOf('{}'))
    assert.isUndefined(externalWaitOf(JSON.stringify({ externalWait: { reason: 'CI', conditions: [] } })))
  })
})
