import { describe, expect, it } from 'vitest'

import type { HomeTask } from '@althar/contracts'
import { TaskStatus } from '@althar/ui'

import { lanesOf, yoursByProject } from '../src/renderer/features/board/lanes'
import { needsOf as barNeedsOf } from '../src/renderer/features/board/needs'
import { homeGlanceOf, refOf } from '../src/renderer/features/home/glance'
import { needsOf } from '../src/renderer/features/home/needs'
import { shownQueued } from '../src/renderer/data/merges'
import { statusOf } from '../src/renderer/features/task/TaskView'
import { readyWordOf } from '../src/renderer/shared/standing'
import { card, change, home, project, snapshot } from './fixtures'

/*
 * A sanity pass over what each surface says of one task: its board card and
 * header (`readyWordOf`), the home's Needs you, the edge and the bar's preview
 * (`readyKindOf`), and the counts on the tabs, the home and the edge. Each
 * test names a state the runtime gives, and asserts the surfaces agree.
 */

const task = (overrides: Partial<HomeTask> = {}): HomeTask => ({
  ...card(),
  state: 'open',
  phase: 'ready',
  createdAt: '2026-10-07T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  projectId: 'p1',
  ...overrides,
})

const refs = new Map([['p1', refOf(project)]])
const agentName = () => ''

/** What the home's Needs you line (and the edge's, which is the same) says the task is, in its kind. */
const homeKindOf = (one: HomeTask) => needsOf({ calls: [], ready: [one], refs, agentName })[0]?.kind
/** What the bar's preview of a project's Needs you says the task is. */
const barKindOf = (one: HomeTask) =>
  barNeedsOf(lanesOf({ cursor: 1, tasks: [one], calls: [], settledTotal: 0 }), agentName, () => undefined)[0]?.kind

const passed = { outcome: 'passed' as const, passed: 2, failed: 0, running: 0, total: 2, failing: [], list: [] }

describe('a ready change, as the board card and header say it, and as the home, the edge and the bar say it', () => {
  // Finding (sanity pass): a ready change whose check failed is "Not ready to accept" on its board card and header, but
  // "Ready to accept" on the home's Needs you, the edge and the bar's preview (readyKindOf never looks at the pull request).
  // Fixed: every place says a ready task in its card's word (readyWordOf, in contracts).
  it('does not say Ready to accept on the home where its card says Not ready to accept: a check failed', () => {
    const failed = task({ change: change({ draft: false }) })
    expect(readyWordOf(failed)).toBe('Not ready to accept')
    expect(homeKindOf(failed)).toBe(readyWordOf(failed))
    expect(barKindOf(failed)).toBe(readyWordOf(failed))
  })

  // Finding (sanity pass): a conflict Althar didn't ask of its lead (the project's "Resolve merge conflicts automatically" off)
  // is "Merge conflict" on its board card and header, with Resolve now, but "Ready to accept" on the home, the edge and the bar.
  // Fixed: every place says a ready task in its card's word (readyWordOf, in contracts).
  it('does not say Ready to accept on the home where its card says Merge conflict: a conflict not sent to its lead', () => {
    const unsent = task({
      change: change({ draft: false, checks: passed, conflicts: true, target: 'main' }),
      conflictUnsent: 'Resolving merge conflicts automatically is off.',
    })
    expect(readyWordOf(unsent)).toBe('Merge conflict')
    expect(homeKindOf(unsent)).toBe(readyWordOf(unsent))
    expect(barKindOf(unsent)).toBe(readyWordOf(unsent))
  })

  // Finding (sanity pass): a ready change whose checks still run (as where the person pushes the lead's commits, so nothing goes
  // on by itself) is "Checks running" on its card and header, but "Ready to accept" on the home, the edge and the bar: the
  // sibling of "Ready to accept · No checks ran" while checks ran. Fixed: every place says it in its card's word.
  it('does not say Ready to accept on the home where its card says Checks running', () => {
    const running = task({
      change: change({
        draft: false,
        localHead: 'def456',
        unpushed: 2,
        checks: { ...passed, outcome: 'running', passed: 3, running: 9, total: 12 },
      }),
    })
    expect(readyWordOf(running)).toBe('Checks running')
    expect(homeKindOf(running)).toBe(readyWordOf(running))
    expect(barKindOf(running)).toBe(readyWordOf(running))
  })
})

describe('a task with a pull request in each of two repositories, the first in its merge queue', () => {
  // Finding (sanity pass): accepted, the first pull request waits in its branch's merge queue and the second waits for it to land
  // (nothing to press meanwhile). The board and the home go by the card's one pull request (asMerging: `task.change`, queued) and
  // put the task in Running, "In the merge queue"; its header goes by all of them (inMergeQueue over `task.changes`, the second
  // not queued) and says it needs the person, "Ready to accept".
  // Fixed: the board, the header and the change card all go by the pull request the card shows (queuedToMerge, shownQueued).
  it('says it is in the merge queue in its header, as the board does', () => {
    const queued = change({ draft: false, checks: passed, queued: true })
    const waits = change({
      draft: false,
      checks: passed,
      number: 7,
      url: 'https://github.com/meridian/web/pull/7',
      repository: 'meridian/web',
    })
    const lanes = lanesOf({ cursor: 1, tasks: [task({ change: queued, earlier: [waits] })], calls: [], settledTotal: 0 })
    expect(lanes.running.map((one) => one.taskId)).toEqual(['t1'])
    expect(lanes.ready).toEqual([])
    const base = snapshot()
    const header = statusOf({ ...base, task: { ...base.task, phase: 'ready', changes: [queued, waits] } })
    expect(header.status).toBe(TaskStatus.Running)
    // Its change card says Queued too, by the same pull request.
    expect(shownQueued([queued, waits])).toBe(true)
  })
})

describe('a task its lead stopped, with no agent on it, as each count says it', () => {
  // Finding (sanity pass): a stopped task is in the board's Needs you, and counted on its project's tab and the home's tab
  // (yoursByProject), but the home's own heading, its project rows and the edge leave it out (homeGlanceOf counts calls and ready
  // tasks only): the home tab says 1 and the home it opens says nothing needs you.
  // Fixed: the home and the edge go by the board's lanes (waitsOf).
  it('is counted the same on the tabs as on the home and the edge', () => {
    const stopped = task({ phase: 'stopped', stopped: { by: 'interrupted', at: '2026-10-07T09:30:00.000Z' } })
    const snapshot = home({ tasks: [stopped] })
    expect(yoursByProject(snapshot).get('p1')).toBe(1)
    const glance = homeGlanceOf(snapshot, { agentName, modelName: () => '' })
    expect(glance.waiting).toBe(yoursByProject(snapshot).get('p1'))
  })
})
