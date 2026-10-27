import { AutomationRunState } from '../foundations/vocabulary'
import type { AutomationRunRow } from '../screens/Automations/AutomationPage'
import type { AutomationTile } from '../screens/Automations/Automations'

/* Meridian's automations, as the Automations tab and their pages show them: a good morning, and one that paused itself. */

const run = (id: string, state: AutomationRunState, at: string, words: string) => ({ id, state, at, words })

export const MORNING_REVIEW: AutomationTile = {
  id: 'auto_review',
  name: 'Morning review',
  when: 'Every weekday at 9:00',
  standing: 'Next tomorrow 9:00',
  tone: 'quiet',
  paused: false,
  prompt: 'Review the pull requests opened since yesterday by anyone but me, and draft a review of each for me to post.',
  runs: [
    run('o1', AutomationRunState.Made, 'Today 9:00', 'Review #264'),
    run('o2', AutomationRunState.Made, 'Mon 9:00', 'Review #262'),
    run('o3', AutomationRunState.Nothing, 'Fri 9:00', 'No new pull requests'),
    run('o4', AutomationRunState.Made, 'Thu 9:00', 'Review #259'),
    run('o5', AutomationRunState.Missed, 'Wed 9:00', 'Missed while the Mac slept'),
    run('o6', AutomationRunState.Made, 'Tue 9:00', 'Review #255'),
    run('o7', AutomationRunState.Nothing, 'Mon 9:00', 'No new pull requests'),
  ],
}

export const NIGHTLY_BUMP: AutomationTile = {
  id: 'auto_bump',
  name: 'Nightly bump',
  when: 'Every night at 2:00',
  standing: 'Running since 9:21',
  tone: 'live',
  paused: false,
  prompt: 'Bump the dependencies that have a patch or minor release, run the tests, and open a draft pull request if they pass.',
  runs: [
    run('b1', AutomationRunState.Running, 'Today 9:21', 'Running · Bump the dependencies'),
    run('b2', AutomationRunState.Made, 'Today 2:00', 'Bump zod to 4.2.1'),
    run('b3', AutomationRunState.Nothing, 'Mon 2:00', 'Nothing to bump'),
  ],
}

export const WEEKLY_E2E: AutomationTile = {
  id: 'auto_e2e',
  name: 'Sunday end-to-end',
  when: 'Every Sunday at 22:00',
  standing: 'Paused itself',
  tone: 'yours',
  paused: true,
  prompt: 'Run the whole end-to-end suite and tell me what failed.',
  why: 'Failed three Sundays running: its end-to-end run stops when the Mac sleeps.',
  runs: [
    run('e1', AutomationRunState.Failed, '19 Oct 22:00', 'Stopped when the Mac slept'),
    run('e2', AutomationRunState.Failed, '12 Oct 22:00', 'Stopped when the Mac slept'),
    run('e3', AutomationRunState.Failed, '5 Oct 22:00', 'Stopped when the Mac slept'),
    run('e4', AutomationRunState.Made, '28 Sep 22:00', 'Two flaky specs'),
  ],
}

export const CHANGELOG: AutomationTile = {
  id: 'auto_changelog',
  name: 'Friday changelog',
  when: 'Every Friday at 16:00',
  standing: 'Paused',
  tone: 'paused',
  paused: true,
  prompt: 'Write up what merged this week as a changelog entry, in our usual voice.',
  runs: [run('c1', AutomationRunState.Skipped, '17 Oct 16:00', 'Skipped: its last run was still going')],
}

export const PROPOSED: AutomationTile = {
  id: 'auto_new',
  name: 'Flaky sweep',
  when: 'Every Monday at 9:00',
  standing: 'Off until you turn it on',
  tone: 'quiet',
  paused: false,
  prompt: 'Find the tests that failed and then passed on main this week, and open a draft pull request that fixes the worst one.',
  runs: [],
}

export const AUTOMATIONS: readonly AutomationTile[] = [WEEKLY_E2E, MORNING_REVIEW, NIGHTLY_BUMP, CHANGELOG, PROPOSED]

/** The morning review's runs, as its page lists them: each with a task opens it. */
export const REVIEW_RUNS: readonly AutomationRunRow[] = [
  ...MORNING_REVIEW.runs.map((one) => ({ ...one, opens: one.state === AutomationRunState.Made })),
  { ...run('o8', AutomationRunState.Failed, '13 Oct 9:00', 'GitHub didn’t answer'), opens: false },
  { ...run('o9', AutomationRunState.Starting, '10 Oct 9:00', 'Starting'), opens: false },
]
