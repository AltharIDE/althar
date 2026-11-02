import { describe, expect, it } from 'vitest'

import { AutomationRunState } from '@althar/ui'

import { usualLead } from '../src/renderer/features/automations/lead'
import { blankDefinition } from '../src/renderer/features/automations/useAutomations'
import {
  endsInPullRequest,
  endsValueOf,
  endsWords,
  inOrder,
  limitWords,
  markOf,
  minuteChoices,
  needsYou,
  nextShort,
  nextSlot,
  nextWords,
  runAt,
  runStateOf,
  runWords,
  sameSchedule,
  sameStep,
  scheduleOf,
  standingOf,
  text,
  timeOf,
  weeklyOf,
  whenChoices,
  whenValueOf,
  whenWords,
  workOf,
} from '../src/renderer/features/automations/words'
import { agents, automationRun, automationSummary, card, definition, items } from './fixtures'

/* Times on this Mac's clock: Tuesday 29 September 2026, at noon. */
const local = (day: number, hours: number, minutes = 0) => new Date(2026, 8, day, hours, minutes)
const NOON = local(29, 12)
const weekday = (at: Date, form: 'long' | 'short') => at.toLocaleDateString(undefined, { weekday: form })
const date = (at: Date) => at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

describe('when an automation runs, in words', () => {
  it('names a preset as the When menu does, and any other schedule as the coordinator says it', () => {
    expect(whenWords({ every: 'week', days: [7, 1, 2, 3, 4, 5, 6], at: '02:00' })).toBe('Every night at 2:00')
    expect(whenWords({ every: 'week', days: [5, 1, 2, 3, 4], at: '09:00' })).toBe('Every weekday at 9:00')
    expect(whenWords({ every: 'hour', minute: 0 })).toBe('Every hour')
    expect(whenWords({ every: 'hour', minute: 15 })).toBe('Every hour at :15')
    expect(whenWords({ every: 'week', days: [2, 4], at: '22:30' })).toBe('Every Tuesday and Thursday at 22:30')
  })

  it('offers the presets, and the schedule it is on where it is none of them', () => {
    expect(whenChoices({ every: 'week', days: [1], at: '09:00' }).map((choice) => choice.value)).toEqual([
      'weekdays',
      'daily',
      'monday',
      'friday',
      'nightly',
      'hourly',
    ])
    const own = { every: 'week' as const, days: [6, 7] as const, at: '10:00' }
    expect(whenValueOf(own)).toBe('own')
    expect(whenChoices(own).at(-1)).toEqual({ value: 'own', label: 'Every weekend at 10:00' })
    expect(scheduleOf('own', own)).toBe(own)
    expect(scheduleOf('friday', own)).toEqual({ every: 'week', days: [5], at: '16:00' })
  })

  it('tells schedules apart by their days and time, or their minute', () => {
    expect(sameSchedule({ every: 'hour', minute: 0 }, { every: 'hour', minute: 0 })).toBe(true)
    expect(sameSchedule({ every: 'hour', minute: 0 }, { every: 'hour', minute: 5 })).toBe(false)
    expect(sameSchedule({ every: 'hour', minute: 0 }, { every: 'week', days: [1], at: '09:00' })).toBe(false)
    expect(sameSchedule({ every: 'week', days: [1], at: '09:00' }, { every: 'hour', minute: 0 })).toBe(false)
    expect(sameSchedule({ every: 'week', days: [2, 1], at: '09:00' }, { every: 'week', days: [1, 2], at: '09:00' })).toBe(true)
    expect(sameSchedule({ every: 'week', days: [1], at: '09:00' }, { every: 'week', days: [1], at: '10:00' })).toBe(false)
  })

  it('starts Another time from the schedule’s days and time, or every weekday at 9:00 for one every hour, and makes a weekly one', () => {
    expect(timeOf({ every: 'week', days: [3], at: '07:30' })).toEqual({ days: [3], at: '07:30' })
    expect(timeOf({ every: 'hour', minute: 0 })).toEqual({ days: [1, 2, 3, 4, 5], at: '09:00' })
    expect(weeklyOf({ days: [6, 9, 7], at: '08:00' })).toEqual({ every: 'week', days: [6, 7], at: '08:00' })
  })

  it('works out when a schedule comes next on this Mac, for a card not turned on yet', () => {
    expect(nextSlot({ every: 'week', days: [1, 2, 3, 4, 5], at: '09:00' }, NOON)).toEqual(local(30, 9))
    expect(nextSlot({ every: 'week', days: [2], at: '14:00' }, NOON)).toEqual(local(29, 14))
    expect(nextSlot({ every: 'week', days: [2], at: '09:00' }, NOON)).toEqual(local(36, 9))
    expect(nextSlot({ every: 'hour', minute: 30 }, NOON)).toEqual(local(29, 12, 30))
    expect(nextSlot({ every: 'hour', minute: 0 }, NOON)).toEqual(local(29, 13))
    // A schedule with no day it could run on stays where it is.
    expect(nextSlot({ every: 'week', days: [], at: '09:00' }, NOON)).toEqual(NOON)
  })

  it('says when it runs next as a sentence reads it: today, tonight, tomorrow, on a weekday, or on the date', () => {
    expect(nextWords(local(29, 14), NOON)).toBe('today at 14:00')
    expect(nextWords(local(29, 22, 5), NOON)).toBe('tonight at 22:05')
    expect(nextWords(local(30, 2), NOON)).toBe('tonight at 2:00')
    expect(nextWords(local(30, 9), NOON)).toBe('tomorrow at 9:00')
    expect(nextWords(local(32, 16), NOON)).toBe(`on ${weekday(local(32, 16), 'long')} at 16:00`)
    expect(nextWords(local(40, 9), NOON)).toBe(`on ${date(local(40, 9))} at 9:00`)
    expect(nextShort(local(30, 9).toISOString(), NOON)).toBe('Next tomorrow 9:00')
    expect(nextShort(local(32, 16).toISOString(), NOON)).toBe(`Next on ${weekday(local(32, 16), 'long')} 16:00`)
  })

  it('says when a run was: today, yesterday, a weekday this week, or the date', () => {
    expect(runAt(local(29, 9, 2).toISOString(), NOON)).toBe('Today 9:02')
    expect(runAt(local(28, 9).toISOString(), NOON)).toBe('Yesterday 9:00')
    expect(runAt(local(25, 16).toISOString(), NOON)).toBe(`${weekday(local(25, 16), 'short')} 16:00`)
    expect(runAt(local(10, 9).toISOString(), NOON)).toBe(`${date(local(10, 9))} 9:00`)
  })
})

describe('what came of a run', () => {
  it('says what it made, found, or why it was skipped, missed or failed, and its own word where it says nothing', () => {
    expect(runWords(automationRun())).toBe('Review #264')
    expect(runWords(automationRun({ subject: null }))).toBe('Review #264')
    expect(runWords(automationRun({ subject: null, task: null }))).toBe('Made something')
    expect(runWords(automationRun({ subject: null, task: null, reason: 'Found 2 new pull requests; 1 more waits' }))).toBe(
      'Found 2 new pull requests; 1 more waits',
    )
    expect(runWords(automationRun({ state: 'nothing', reason: 'No new pull requests' }))).toBe('No new pull requests')
    expect(runWords(automationRun({ state: 'nothing' }))).toBe('Nothing to do')
    expect(runWords(automationRun({ state: 'failed', reason: 'GitHub didn’t answer' }))).toBe('GitHub didn’t answer')
    expect(runWords(automationRun({ state: 'failed' }))).toBe('Failed')
    expect(runWords(automationRun({ state: 'missed' }))).toBe('Missed while the Mac slept')
    expect(runWords(automationRun({ state: 'missed', reason: 'Althar was closed' }))).toBe('Althar was closed')
    expect(runWords(automationRun({ state: 'skipped' }))).toBe('Skipped')
    expect(runWords(automationRun({ state: 'skipped', reason: 'Its last run was still going' }))).toBe('Its last run was still going')
    expect(runWords(automationRun({ state: 'running' }))).toBe('Running · Review #264')
    expect(runWords(automationRun({ state: 'running', subject: null, task: null }))).toBe('Running')
    expect(runWords(automationRun({ state: 'starting' }))).toBe('Starting')
  })

  it('draws each as the kit’s mark, starting as running', () => {
    expect((['starting', 'running', 'made', 'nothing', 'failed', 'missed', 'skipped'] as const).map((state) => runStateOf(state))).toEqual([
      AutomationRunState.Starting,
      AutomationRunState.Running,
      AutomationRunState.Made,
      AutomationRunState.Nothing,
      AutomationRunState.Failed,
      AutomationRunState.Missed,
      AutomationRunState.Skipped,
    ])
    expect(markOf(automationRun({ at: local(29, 9, 2).toISOString() }), NOON)).toEqual({
      id: 'occ1',
      state: AutomationRunState.Made,
      at: 'Today 9:02',
      words: 'Review #264',
    })
  })
})

describe('where an automation stands', () => {
  const next = local(30, 9).toISOString()
  it('is off until turned on, paused by itself or the person or with every other, running, or on with when it runs next', () => {
    const one = automationSummary({ nextAt: next })
    expect(standingOf({ ...one, state: 'proposed' }, false, NOON)).toEqual({
      tone: 'quiet',
      paused: false,
      words: 'Off until you turn it on',
      status: 'Off until you turn it on',
      dot: 'off',
    })
    expect(standingOf({ ...one, state: 'paused', pausedBy: 'itself' }, false, NOON)).toMatchObject({
      tone: 'yours',
      words: 'Paused itself',
      dot: 'yours',
    })
    expect(standingOf({ ...one, state: 'paused', pausedBy: 'person' }, false, NOON)).toMatchObject({
      tone: 'paused',
      paused: true,
      words: 'Paused',
    })
    expect(standingOf(one, true, NOON)).toMatchObject({ tone: 'paused', words: 'Paused', status: 'All paused' })
    expect(
      standingOf({ ...one, latest: [automationRun({ state: 'running', at: local(29, 9, 21).toISOString() })] }, false, NOON),
    ).toMatchObject({
      tone: 'live',
      words: 'Running since 9:21',
    })
    expect(
      standingOf({ ...one, latest: [automationRun({ state: 'starting', at: local(28, 23).toISOString() })] }, false, NOON),
    ).toMatchObject({
      words: 'Running since Yesterday 23:00',
    })
    expect(standingOf(one, false, NOON)).toMatchObject({
      tone: 'quiet',
      words: 'Next tomorrow 9:00',
      status: 'Runs next tomorrow at 9:00',
      dot: 'on',
    })
    expect(standingOf({ ...one, nextAt: null }, false, NOON)).toMatchObject({ words: 'On', status: 'On' })
  })

  it('lists the one that paused itself first, and none deleted; and says when one waits on the person', () => {
    const itself = automationSummary({ id: 'auto2', state: 'paused', pausedBy: 'itself' })
    const gone = automationSummary({ id: 'auto3', state: 'deleted' })
    expect(inOrder([automationSummary(), gone, itself]).map((one) => one.id)).toEqual(['auto2', 'auto1'])
    expect(needsYou([automationSummary(), itself])).toBe(true)
    expect(needsYou([automationSummary(), { ...itself, pausedBy: 'person' }])).toBe(false)
  })
})

describe('what each run does', () => {
  it('ends as the menu says, keeping a task’s reviewer, and says it in words', () => {
    const reviewer = { agentId: 'codex', model: null, effort: null }
    expect(endsValueOf({ kind: 'review' })).toBe('review')
    expect(endsValueOf({ kind: 'task', review: null, end: null })).toBe('none')
    expect(endsValueOf({ kind: 'task', review: null, end: 'draft' })).toBe('draft')
    expect(workOf('ready', { kind: 'task', review: reviewer, end: null })).toEqual({ kind: 'task', review: reviewer, end: 'ready' })
    expect(workOf('none', { kind: 'review' })).toEqual({ kind: 'task', review: null, end: null })
    expect(workOf('review', { kind: 'task', review: reviewer, end: 'draft' })).toEqual({ kind: 'review' })
    expect(endsWords({ kind: 'task', review: null, end: null })).toBe('Nothing leaves this Mac')
    expect(endsWords({ kind: 'review' })).toBe('Review each new pull request')
    expect(endsInPullRequest({ kind: 'task', review: null, end: 'draft' })).toBe(true)
    expect(endsInPullRequest({ kind: 'task', review: null, end: null })).toBe(false)
    expect(endsInPullRequest({ kind: 'review' })).toBe(false)
  })

  it('tells leads apart by agent, model and effort', () => {
    const lead = { agentId: 'claude-code', model: null, effort: null }
    expect(sameStep(lead, { agentId: 'claude-code', model: null })).toBe(true)
    expect(sameStep(lead, { ...lead, effort: 'high' })).toBe(false)
    expect(sameStep(lead, null)).toBe(false)
    expect(sameStep(null, null)).toBe(true)
  })

  it('says its limits in words, with its pull requests where it opens them', () => {
    expect(limitWords(definition()).map(([name]) => name)).toEqual([
      'Allow everything',
      'Stops after',
      'If the Mac is asleep',
      'Agent places',
      'If it fails',
    ])
    const change = definition({ work: { kind: 'task', review: null, end: 'draft' }, allowEverything: false, minutes: 90, late: 'skip' })
    expect(limitWords(change)).toEqual([
      ['Allow everything', text.allowEverythingOff],
      ['Stops after', '1½ hours'],
      ['If the Mac is asleep', 'Skip it, and wait for the next time'],
      ['Agent places', text.placesWords],
      ['If it fails', text.failsWords],
      ['Open pull requests', 'Five at most'],
    ])
    expect(limitWords(definition())[0]?.[1]).toBe(`On. ${text.allowEverythingNote}`)
  })

  it('offers how long a run may work, with the time it has where it is none of them', () => {
    expect(minuteChoices(45).map((choice) => choice.label)).toEqual(['15 minutes', '30 minutes', '45 minutes', '1½ hours', '2 hours'])
    expect(minuteChoices(60).map((choice) => [choice.value, choice.label])).toContainEqual(['60', '1 hour'])
    expect(minuteChoices(240).at(-1)).toEqual({ value: '240', label: '4 hours' })
  })
})

describe('a new automation', () => {
  it('starts blank, every weekday at 9:00, ending on this Mac with no reviewer, with every limit’s default, in the zone it is made in', () => {
    const lead = { agentId: 'codex', model: 'gpt-5.2-codex', effort: 'high' }
    expect(blankDefinition(lead, 'Europe/Budapest')).toEqual({
      name: '',
      prompt: '',
      schedule: { every: 'week', days: [1, 2, 3, 4, 5], at: '09:00' },
      zone: 'Europe/Budapest',
      lead,
      work: { kind: 'task', review: null, end: null },
      allowEverything: true,
      minutes: 45,
      late: 'once',
    })
    expect(blankDefinition(lead).zone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it('is led by the person’s latest planned task’s lead, while its agent can work; else the first agent’s own', () => {
    const planned = (agentId: string) =>
      items.card(
        card({
          plan: {
            id: 'pln1',
            steps: [{ key: 'implement', agentId, model: 'm', effort: 'low', skipped: false }],
            startsAt: null,
            reason: null,
            end: null,
          },
        }),
      )
    expect(usualLead([planned('claude-code'), planned('codex')], agents)).toEqual({ agentId: 'codex', model: 'm', effort: 'low' })
    expect(usualLead([planned('codex'), planned('gone')], agents)).toEqual({ agentId: 'codex', model: 'm', effort: 'low' })
    expect(usualLead([items.says('Hello')], agents)).toEqual({ agentId: 'claude-code', model: null, effort: null })
    expect(usualLead([], [])).toEqual({ agentId: 'claude-code', model: null, effort: null })
  })
})
