import { assert, describe, it } from '@effect/vitest'
import { Schema } from 'effect'

import { AutomationDefinition } from '../src/automations'
import { daysWords, ordinal, Schedule, scheduleInLine, scheduleWords, shortMonthsApply, timeWords } from '../src/schedules'

describe('schedules', () => {
  it('says a schedule in words', () => {
    assert.strictEqual(scheduleWords({ every: 'week', days: [1, 2, 3, 4, 5], at: '09:00' }), 'Every weekday at 9:00')
    assert.strictEqual(scheduleWords({ every: 'week', days: [7, 1, 2, 3, 4, 5, 6], at: '02:00' }), 'Every night at 2:00')
    assert.strictEqual(scheduleWords({ every: 'week', days: [1, 2, 3, 4, 5, 6, 7], at: '09:00' }), 'Every day at 9:00')
    assert.strictEqual(scheduleWords({ every: 'week', days: [5], at: '16:30' }), 'Every Friday at 16:30')
    assert.strictEqual(scheduleWords({ every: 'week', days: [6, 7], at: '10:00' }), 'Every weekend at 10:00')
    assert.strictEqual(scheduleWords({ every: 'week', days: [4, 1, 1], at: '09:00' }), 'Every Monday and Thursday at 9:00')
    assert.strictEqual(daysWords([1, 3, 5]), 'Every Monday, Wednesday and Friday')
    assert.strictEqual(scheduleWords({ every: 'hour', minute: 0 }), 'Every hour')
    assert.strictEqual(scheduleWords({ every: 'hour', minute: 5 }), 'Every hour at :05')
    assert.strictEqual(timeWords('22:30'), '22:30')
    assert.strictEqual(scheduleInLine({ every: 'week', days: [5], at: '16:00' }), 'every Friday at 16:00')
  })

  it('says a monthly schedule in words', () => {
    assert.strictEqual(scheduleWords({ every: 'month', on: { weekday: 1, nth: 1 }, at: '09:00' }), 'Monthly, on the first Monday at 9:00')
    assert.strictEqual(
      scheduleWords({ every: 'month', on: { weekday: 2, nth: 2 }, at: '14:30' }),
      'Monthly, on the second Tuesday at 14:30',
    )
    assert.strictEqual(scheduleWords({ every: 'month', on: { weekday: 5, nth: -1 }, at: '16:00' }), 'Monthly, on the last Friday at 16:00')
    assert.strictEqual(scheduleWords({ every: 'month', on: { day: 1 }, at: '09:00' }), 'Monthly, on the 1st at 9:00')
    assert.strictEqual(scheduleWords({ every: 'month', on: { day: 22 }, at: '09:00' }), 'Monthly, on the 22nd at 9:00')
    assert.strictEqual(scheduleWords({ every: 'month', on: { day: 13 }, at: '09:00' }), 'Monthly, on the 13th at 9:00')
    assert.strictEqual(scheduleWords({ every: 'month', on: { day: -1 }, at: '09:00' }), 'Monthly, on the last day at 9:00')
    assert.strictEqual(scheduleInLine({ every: 'month', on: { day: 3 }, at: '09:00' }), 'monthly, on the 3rd at 9:00')
    assert.strictEqual([1, 2, 3, 4, 11, 12, 13, 21, 31].map(ordinal).join(), '1st,2nd,3rd,4th,11th,12th,13th,21st,31st')
  })

  it('tells which monthly days a short month cuts short', () => {
    assert.isTrue(shortMonthsApply({ every: 'month', on: { day: 29 }, at: '09:00' }))
    assert.isTrue(shortMonthsApply({ every: 'month', on: { day: 31 }, at: '09:00' }))
    assert.isFalse(shortMonthsApply({ every: 'month', on: { day: 28 }, at: '09:00' }))
    assert.isFalse(shortMonthsApply({ every: 'month', on: { day: -1 }, at: '09:00' }))
    assert.isFalse(shortMonthsApply({ every: 'month', on: { weekday: 5, nth: -1 }, at: '09:00' }))
    assert.isFalse(shortMonthsApply({ every: 'hour', minute: 0 }))
  })

  it('takes a monthly day of 1 to 31 or the last, and a weekday as the first to the fourth or the last', () => {
    const decode = Schema.decodeUnknownExit(Schedule)
    const day = (on: unknown) => decode({ every: 'month', on, at: '09:00' })._tag === 'Success'
    assert.isTrue(day({ day: 1 }) && day({ day: 31 }) && day({ day: -1 }))
    assert.isFalse(day({ day: 0 }) || day({ day: 32 }) || day({ day: -2 }) || day({ day: 1.5 }))
    assert.isTrue(day({ weekday: 1, nth: 1 }) && day({ weekday: 7, nth: -1 }) && day({ weekday: 3, nth: 4 }))
    assert.isFalse(day({ weekday: 1, nth: 5 }) || day({ weekday: 1, nth: 0 }) || day({ weekday: 8, nth: 1 }) || day({ weekday: 1 }))
    assert.isFalse(decode({ every: 'month', on: { day: 1 }, at: '9:00' })._tag === 'Success')
  })

  it('still takes the schedules kept before monthly ones', () => {
    const decode = Schema.decodeUnknownExit(Schedule)
    assert.isTrue(decode({ every: 'week', days: [1, 5], at: '09:00' })._tag === 'Success')
    assert.isTrue(decode({ every: 'hour', minute: 30 })._tag === 'Success')
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
