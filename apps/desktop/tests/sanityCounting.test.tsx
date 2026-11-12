import { describe, expect, it } from 'vitest'

import type { HomeTask } from '@althar/contracts'

import { lanesOf, yoursByProject } from '../src/renderer/features/board/lanes'
import { homeGlanceOf } from '../src/renderer/features/home/glance'
import { card, home } from './fixtures'

/*
 * A sanity pass over what counts as a task in the window: an aside (a chat
 * on Scratch, `scratch` on its card) is kept off the board's lanes, and
 * "never waits in Needs you for being finished" (docs/decisions/tasks.md,
 * "Asides"). Each test names a state the runtime gives an aside, and asserts
 * the home and the edge count it as the board and the tabs do.
 */

/** An aside the person said hi in, on the home, as the runtime gives it: a plain task on Scratch. */
const aside = (overrides: Partial<HomeTask> = {}): HomeTask => ({
  ...card({ taskId: 'aside1', threadId: 'aside-thread', title: 'Hi', slug: 'hi', kind: 'plain', change: null }),
  state: 'open',
  phase: 'ready',
  scratch: true,
  latest: { at: '2026-10-07T09:01:00.000Z', by: 'lead', said: 'Hi! What are we working on?' },
  createdAt: '2026-10-07T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  projectId: 'p1',
  ...overrides,
})

const names = { agentName: () => '', modelName: () => '' }

describe('an aside, as the home and the edge count it, and as the board and the tabs do', () => {
  // Finding (sanity pass): an aside its agent answered is phase `ready`; the board takes it off its lanes (lanesOf's `scratch`),
  // so the project's Needs you and its tab say nothing waits, but the home and the edge count ready tasks with no look at
  // `scratch` (homeGlanceOf: readyOf over every task): the home says 1 thing needs you, and lists the "Hi" in Needs you beside
  // real work. Flips to passing when fixed.
  it.fails('is not in the home’s Needs you, nor counted on the home and the edge, as it isn’t on the board or its tab', () => {
    const hi = aside()
    const snapshot = home({ tasks: [hi] })
    expect(lanesOf({ cursor: 1, tasks: [hi], calls: [], settledTotal: 0 }).ready).toEqual([])
    expect(yoursByProject(snapshot).get('p1')).toBe(0)
    const glance = homeGlanceOf(snapshot, names)
    expect({ waiting: glance.waiting, needs: glance.needs.length, edge: glance.edge.waiting }).toEqual({ waiting: 0, needs: 0, edge: 0 })
  })

  // Finding (sanity pass): an aside whose agent is answering is phase `running`; the board leaves it out of Running and its count
  // (lanesOf's `scratch` comes before `atWork`), but the home's In progress and the edge's count of work in progress take every
  // task that isn't ready (homeGlanceOf's `working`), so a chat with the coordinator shows as work in progress beside the tasks.
  // Flips to passing when fixed.
  it.fails('is not work in progress on the home and the edge, as it isn’t in the board’s Running', () => {
    const answering = aside({ phase: 'running', latest: { at: '2026-10-07T09:00:30.000Z', by: 'person', said: 'Hi' } })
    const lanes = lanesOf({ cursor: 1, tasks: [answering], calls: [], settledTotal: 0 })
    expect({ running: lanes.running.length, atWork: lanes.atWork }).toEqual({ running: 0, atWork: 0 })
    const glance = homeGlanceOf(home({ tasks: [answering] }), names)
    expect({ working: glance.working.length, edge: glance.edge.work.inProgress }).toEqual({ working: 0, edge: 0 })
  })
})
