import {
  type AutomationDefinition,
  type AutomationRun,
  type AutomationStep,
  type AutomationSummary,
  type AutomationWork,
  type Schedule,
  scheduleWords,
  type Weekday,
} from '@althar/contracts'
import { AutomationRunState } from '@althar/ui'
import type { AutomationTone } from '@althar/ui/screens'

import { device } from '../../shared/device'

/*
 * What every part says about an automation, the same wherever it shows: when
 * it can run and what it can end in, as the card's menus offer them; when it
 * runs next and when each run was, as the person reads a clock; what came of
 * each run; where it stands; and its limits, in words.
 */

export const text = {
  /* Where it stands. */
  proposed: 'Off until you turn it on',
  pausedItself: 'Paused itself',
  paused: 'Paused',
  allPaused: 'Paused, as every automation is',
  on: 'On',
  next: (when: string) => `Next ${when}`,
  runsNext: (when: string) => `Runs next ${when}`,
  runningSince: (when: string) => `Running since ${when}`,
  /* What came of a run. */
  made: 'Made something',
  nothing: 'Nothing to do',
  failed: 'Failed',
  missed: `Missed while ${device.the} slept`,
  skipped: 'Skipped',
  running: 'Running',
  starting: 'Starting',
  /* What each run ends in. */
  endNone: `Nothing leaves ${device.this}`,
  endDraft: 'Open a draft pull request',
  endReady: 'Open a pull request, ready for review',
  endReview: 'Review each new pull request',
  /* Its limits. */
  allowEverything: 'Allow everything',
  allowEverythingNote: 'No ask stops a run. It never pushes to the default branch, and never merges.',
  allowEverythingOff: 'Off: the project’s rules hold, and an ask waits for you.',
  postsReviews: 'Post its reviews without asking',
  postsReviewsNote: 'Off until you say so on its first review. A pull request from outside the team always waits.',
  stopsAfter: 'Stops after',
  asleep: `If ${device.the} is asleep`,
  asleepNote: 'Or Althar is closed when it’s time.',
  lateOnce: 'Run once when it’s back, if it’s not too late',
  lateSkip: 'Skip it, and wait for the next time',
  places: 'Agent places',
  placesWords: 'One at most, after your own work. If its last run is still going, the next is skipped.',
  fails: 'If it fails',
  failsWords: 'After three failures in a row it pauses itself and says why.',
  pullRequests: 'Open pull requests',
  pullRequestsWords: 'Five at most; past that, a run is skipped.',
  minutes: (n: number) => (n % 60 === 0 ? (n === 60 ? '1 hour' : `${n / 60} hours`) : n === 90 ? '1½ hours' : `${n} minutes`),
}

/* ---- when it runs ------------------------------------------------------------------- */

const WEEKDAYS: ReadonlyArray<Weekday> = [1, 2, 3, 4, 5]
const EVERY_DAY: ReadonlyArray<Weekday> = [1, 2, 3, 4, 5, 6, 7]

/** The times the When menu offers, each by a word of its own and in the words it shows. */
export const PRESETS: ReadonlyArray<{ readonly value: string; readonly label: string; readonly schedule: Schedule }> = [
  { value: 'weekdays', label: 'Every weekday at 9:00', schedule: { every: 'week', days: WEEKDAYS, at: '09:00' } },
  { value: 'daily', label: 'Every day at 9:00', schedule: { every: 'week', days: EVERY_DAY, at: '09:00' } },
  { value: 'monday', label: 'Every Monday at 9:00', schedule: { every: 'week', days: [1], at: '09:00' } },
  { value: 'friday', label: 'Every Friday at 16:00', schedule: { every: 'week', days: [5], at: '16:00' } },
  { value: 'nightly', label: 'Every night at 2:00', schedule: { every: 'week', days: EVERY_DAY, at: '02:00' } },
  { value: 'hourly', label: 'Every hour', schedule: { every: 'hour', minute: 0 } },
]

/** A schedule a new automation starts on: every weekday at 9:00. */
export const FIRST_SCHEDULE: Schedule = { every: 'week', days: WEEKDAYS, at: '09:00' }

/** One schedule is the other: the same days, in any order, at the same time, or the same minute of every hour. */
export const sameSchedule = (a: Schedule, b: Schedule): boolean => {
  if (a.every === 'hour') return b.every === 'hour' && a.minute === b.minute
  if (b.every === 'hour') return false
  const days = (days: ReadonlyArray<Weekday>) => [...new Set(days)].toSorted((x, y) => x - y).join()
  return a.at === b.at && days(a.days) === days(b.days)
}

/** The value of the menu's choice a schedule is: a preset's, or its own. */
export const whenValueOf = (schedule: Schedule): string => PRESETS.find((preset) => sameSchedule(preset.schedule, schedule))?.value ?? 'own'

/** When it runs, in words: as the menu says a preset (Every night at 2:00), or else as the coordinator says it. */
export const whenWords = (schedule: Schedule): string =>
  PRESETS.find((preset) => sameSchedule(preset.schedule, schedule))?.label ?? scheduleWords(schedule)

/** The When menu's choices: the presets, and the one it is on where it is none of them. */
export const whenChoices = (schedule: Schedule): ReadonlyArray<{ readonly value: string; readonly label: string }> => [
  ...PRESETS.map(({ value, label }) => ({ value, label })),
  ...(whenValueOf(schedule) === 'own' ? [{ value: 'own', label: scheduleWords(schedule) }] : []),
]

/** The schedule a choice of the menu is: a preset's, or the one it is on. */
export const scheduleOf = (value: string, current: Schedule): Schedule =>
  PRESETS.find((preset) => preset.value === value)?.schedule ?? current

/** Days and a time to start "Another time…" from: the schedule's own, or every weekday at 9:00 for one that runs every hour. */
export const timeOf = (schedule: Schedule): { readonly days: ReadonlyArray<number>; readonly at: string } =>
  schedule.every === 'week' ? { days: schedule.days, at: schedule.at } : { days: WEEKDAYS, at: '09:00' }

const isWeekday = (day: number): day is Weekday => Number.isInteger(day) && day >= 1 && day <= 7

/** A schedule from days and a time of the person's own. */
export const weeklyOf = (time: { readonly days: ReadonlyArray<number>; readonly at: string }): Schedule => ({
  every: 'week',
  days: time.days.filter(isWeekday),
  at: time.at,
})

/** The ISO day of a date, 1 for Monday. */
const isoDay = (at: Date) => ((at.getDay() + 6) % 7) + 1

/**
 * When a schedule comes next after `now`, in this Mac's zone, as the
 * window works it out where the runtime hasn't said: for a card not turned
 * on yet. The runtime staggers a run a few minutes after it; this is the
 * time its rule says.
 */
export const nextSlot = (schedule: Schedule, now: Date = new Date()): Date => {
  if (schedule.every === 'hour') {
    const at = new Date(now)
    at.setSeconds(0, 0)
    at.setMinutes(schedule.minute)
    if (at <= now) at.setHours(at.getHours() + 1)
    return at
  }
  const [hours = 0, minutes = 0] = schedule.at.split(':').map(Number)
  for (let ahead = 0; ahead <= 7; ahead++) {
    const at = new Date(now)
    at.setDate(at.getDate() + ahead)
    at.setHours(hours, minutes, 0, 0)
    if (at > now && schedule.days.includes(isoDay(at) as Weekday)) return at
  }
  return now
}

/* ---- times, as a clock says them --------------------------------------------------------- */

/** A time on a 24-hour clock, as the schedules say it: 9:00, 22:30. */
const clockOf = (at: Date) => `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`

const DAY = 24 * 60 * 60 * 1000

const startOf = (at: Date) => {
  const day = new Date(at)
  day.setHours(0, 0, 0, 0)
  return day
}

/** How many days `at` is after `now`'s day: 0 today, 1 tomorrow, -1 yesterday. */
const daysFrom = (now: Date, at: Date) => Math.round((startOf(at).getTime() - startOf(now).getTime()) / DAY)

/** A day ahead, read in a sentence: today, tonight, tomorrow, Friday, or the date. */
const dayAhead = (at: Date, now: Date): string => {
  const days = daysFrom(now, at)
  if (days === 0) return at.getHours() >= 18 ? 'tonight' : 'today'
  if (days === 1 && at.getHours() < 5) return 'tonight'
  if (days === 1) return 'tomorrow'
  if (days > 1 && days < 7) return at.toLocaleDateString(undefined, { weekday: 'long' })
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** When it runs next, read in a sentence: tomorrow at 9:00, tonight at 2:00, Friday at 16:00. */
export const nextWords = (iso: string | Date, now: Date = new Date()): string => {
  const at = new Date(iso)
  return `${dayAhead(at, now)} at ${clockOf(at)}`
}

/** When it runs next, as a card says it at its right: Next tomorrow 9:00. */
export const nextShort = (iso: string, now: Date = new Date()): string => {
  const at = new Date(iso)
  return text.next(`${dayAhead(at, now)} ${clockOf(at)}`)
}

/** When a run was: Today 9:00, Yesterday 9:00, Mon 2:00, or the date. */
export const runAt = (iso: string, now: Date = new Date()): string => {
  const at = new Date(iso)
  const days = daysFrom(now, at)
  const day =
    days === 0
      ? 'Today'
      : days === -1
        ? 'Yesterday'
        : days < 0 && days > -7
          ? at.toLocaleDateString(undefined, { weekday: 'short' })
          : at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return `${day} ${clockOf(at)}`
}

/* ---- what came of a run ----------------------------------------------------------------- */

/** A run's state, as the kit's marks take it. */
export const runStateOf = (state: AutomationRun['state']): AutomationRunState => {
  switch (state) {
    case 'starting':
      return AutomationRunState.Starting
    case 'running':
      return AutomationRunState.Running
    case 'made':
      return AutomationRunState.Made
    case 'nothing':
      return AutomationRunState.Nothing
    case 'failed':
      return AutomationRunState.Failed
    case 'missed':
      return AutomationRunState.Missed
    case 'skipped':
      return AutomationRunState.Skipped
  }
}

/** What came of a run, in a line: what it made, what it found, why it was skipped, missed or failed. */
export const runWords = (run: AutomationRun): string => {
  const what = run.subject ?? run.task?.title ?? null
  switch (run.state) {
    case 'made':
      return what ?? text.made
    case 'nothing':
      return run.reason ?? text.nothing
    case 'failed':
      return run.reason ?? text.failed
    case 'missed':
      return run.reason ?? text.missed
    case 'skipped':
      return run.reason ?? text.skipped
    case 'running':
      return what === null ? text.running : `${text.running} · ${what}`
    case 'starting':
      return text.starting
  }
}

/** A run as the kit's marks show it. */
export const markOf = (run: AutomationRun, now: Date = new Date()) => ({
  id: run.id,
  state: runStateOf(run.state),
  at: runAt(run.at, now),
  words: runWords(run),
})

/* ---- where it stands -------------------------------------------------------------------- */

const live = (run: AutomationRun | undefined) => run?.state === 'running' || run?.state === 'starting'

/** When a run under way started: its time today, or its day. */
const since = (run: AutomationRun, now: Date) => (daysFrom(now, new Date(run.at)) === 0 ? clockOf(new Date(run.at)) : runAt(run.at, now))

export interface Standing {
  readonly tone: AutomationTone
  /** Its chip shows the pause. */
  readonly paused: boolean
  /** In a few words, at a card's right. */
  readonly words: string
  /** In a line, under its name on its page, with a dot. */
  readonly status: string
  readonly dot: 'on' | 'off' | 'yours'
}

/** Where an automation stands: proposed, paused by itself or the person, all paused, running, or when it runs next. */
export const standingOf = (one: AutomationSummary, allPaused: boolean, now: Date = new Date()): Standing => {
  if (one.state === 'proposed') return { tone: 'quiet', paused: false, words: text.proposed, status: text.proposed, dot: 'off' }
  if (one.state === 'paused' && one.pausedBy === 'itself')
    return { tone: 'yours', paused: true, words: text.pausedItself, status: text.pausedItself, dot: 'yours' }
  if (one.state !== 'on') return { tone: 'paused', paused: true, words: text.paused, status: text.paused, dot: 'off' }
  if (allPaused) return { tone: 'paused', paused: true, words: text.paused, status: text.allPaused, dot: 'off' }
  const last = one.latest[0]
  if (last !== undefined && live(last)) {
    const words = text.runningSince(since(last, now))
    return { tone: 'live', paused: false, words, status: words, dot: 'on' }
  }
  if (one.nextAt !== null)
    return { tone: 'quiet', paused: false, words: nextShort(one.nextAt, now), status: text.runsNext(nextWords(one.nextAt, now)), dot: 'on' }
  return { tone: 'quiet', paused: false, words: text.on, status: text.on, dot: 'on' }
}

/** The one that paused itself first; the rest as the runtime lists them. */
export const inOrder = (all: ReadonlyArray<AutomationSummary>): ReadonlyArray<AutomationSummary> =>
  all
    .filter((one) => one.state !== 'deleted')
    .toSorted((a, b) => Number(b.pausedBy === 'itself' && b.state === 'paused') - Number(a.pausedBy === 'itself' && a.state === 'paused'))

/** Some automation paused itself, and waits on the person to say what to do. */
export const needsYou = (all: ReadonlyArray<AutomationSummary>): boolean =>
  all.some((one) => one.state === 'paused' && one.pausedBy === 'itself')

/* ---- what each run does and ends in -------------------------------------------------------- */

/** What the Ends in menu offers. */
export const ENDS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: 'none', label: text.endNone },
  { value: 'draft', label: text.endDraft },
  { value: 'ready', label: text.endReady },
  { value: 'review', label: text.endReview },
]

/** The Ends in menu's value for what each run does. */
export const endsValueOf = (work: AutomationWork): string => (work.kind === 'review' ? 'review' : (work.end ?? 'none'))

/** What each run does, from a choice of the menu: a review of each new pull request, or a task ending as chosen, its reviewer kept. */
export const workOf = (value: string, work: AutomationWork): AutomationWork =>
  value === 'review'
    ? { kind: 'review' }
    : { kind: 'task', review: work.kind === 'task' ? work.review : null, end: value === 'draft' || value === 'ready' ? value : null }

/** What a run ends in, in words. */
export const endsWords = (work: AutomationWork): string => ENDS.find((end) => end.value === endsValueOf(work))?.label ?? text.endNone

/** The same agent, model and effort. */
export const sameStep = (a: AutomationStep | null, b: AutomationStep | null): boolean =>
  a === null || b === null ? a === b : a.agentId === b.agentId && a.model === b.model && (a.effort ?? null) === (b.effort ?? null)

/* ---- its limits ------------------------------------------------------------------------- */

/** How long a run may work, as Stops after offers it, in minutes. */
export const MINUTES = [15, 30, 45, 90, 120] as const

/** Stops after's choices, with the one it is on where it is none of them. */
export const minuteChoices = (minutes: number) =>
  [...new Set([...MINUTES, minutes])].toSorted((a, b) => a - b).map((n) => ({ value: String(n), label: text.minutes(n) }))

/** If the Mac is asleep's choices. */
export const LATE = [
  { value: 'once', label: text.lateOnce },
  { value: 'skip', label: text.lateSkip },
] as const

/** A run that makes a change ends in a pull request: at most five of them open. */
export const endsInPullRequest = (work: AutomationWork) => work.kind === 'task' && work.end !== null

/** Its limits, each named, then said, as the card's "Its limits" folds them out. */
export const limitWords = (definition: AutomationDefinition): ReadonlyArray<readonly [string, string]> => [
  [text.allowEverything, definition.allowEverything ? `On. ${text.allowEverythingNote}` : text.allowEverythingOff],
  [text.stopsAfter, text.minutes(definition.minutes)],
  [text.asleep, definition.late === 'once' ? text.lateOnce : text.lateSkip],
  [text.places, text.placesWords],
  [text.fails, text.failsWords],
  ...(endsInPullRequest(definition.work) ? [[text.pullRequests, text.pullRequestsWords] as const] : []),
]
