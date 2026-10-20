import { assert, describe, it } from '@effect/vitest'
import { Schema } from 'effect'

import { AutomationDefinition } from '../src/automations'
import { daysWords, Schedule, scheduleWords, timeWords } from '../src/schedules'

describe('schedules', () => {
  it('says a schedule in words', () => {
    assert.strictEqual(scheduleWords({ every: 'week', days: [1, 2, 3, 4, 5], at: '09:00' }), 'Every weekday at 9:00')
    assert.strictEqual(scheduleWords({ every: 'week', days: [7, 1, 2, 3, 4, 5, 6], at: '02:00' }), 'Every day at 2:00')
    assert.strictEqual(scheduleWords({ every: 'week', days: [5], at: '16:30' }), 'Every Friday at 16:30')
    assert.strictEqual(scheduleWords({ every: 'week', days: [6, 7], at: '10:00' }), 'Every weekend at 10:00')
    assert.strictEqual(scheduleWords({ every: 'week', days: [4, 1, 1], at: '09:00' }), 'Every Monday and Thursday at 9:00')
    assert.strictEqual(daysWords([1, 3, 5]), 'Every Monday, Wednesday and Friday')
    assert.strictEqual(scheduleWords({ every: 'hour', minute: 0 }), 'Every hour')
    assert.strictEqual(scheduleWords({ every: 'hour', minute: 5 }), 'Every hour at :05')
    assert.strictEqual(timeWords('22:30'), '22:30')
  })

  it('takes only times of day, at least a day, and minutes past the hour', () => {
    const decode = Schema.decodeUnknownExit(Schedule)
    assert.isTrue(decode({ every: 'week', days: [1], at: '23:59' })._tag === 'Success')
    assert.isTrue(decode({ every: 'week', days: [1], at: '24:00' })._tag === 'Failure')
    assert.isTrue(decode({ every: 'week', days: [1], at: '9:00' })._tag === 'Failure')
    assert.isTrue(decode({ every: 'week', days: [], at: '09:00' })._tag === 'Failure')
    assert.isTrue(decode({ every: 'week', days: [8], at: '09:00' })._tag === 'Failure')
    assert.isTrue(decode({ every: 'hour', minute: 60 })._tag === 'Failure')
  })

  it('takes a definition with a name of a few words', () => {
    const decode = Schema.decodeUnknownExit(AutomationDefinition)
    const one = {
      name: 'Morning review',
      prompt: 'Review the new pull requests.',
      schedule: { every: 'week', days: [1, 2, 3, 4, 5], at: '09:00' },
      zone: 'Europe/London',
      lead: { agentId: 'claude-code', model: 'opus' },
      work: { kind: 'review' },
      allowEverything: true,
      minutes: 45,
      late: 'once',
    }
    assert.isTrue(decode(one)._tag === 'Success')
    assert.isTrue(decode({ ...one, name: '' })._tag === 'Failure')
    assert.isTrue(decode({ ...one, minutes: 1 })._tag === 'Failure')
    assert.isTrue(decode({ ...one, work: { kind: 'task', review: null, end: 'ready' } })._tag === 'Success')
  })
})
