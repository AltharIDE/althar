import { TaskStatus } from '@althar/ui'
import { describe, expect, it } from 'vitest'

import { elapsedOf, sinceOf, statusOf, text } from '../src/renderer/features/task/TaskView'
import { clock } from '../src/renderer/shared/time'
import { items, snapshot } from './fixtures'

/*
 * Where a task stands, as its header says it, in the cases its screen's
 * tests don't reach: a lead following up, a ready task handed back, a stop
 * with nothing said, and what the lead is asked when merging conflicts in
 * several repositories.
 */

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 7, 9, minutes)).toISOString()

describe('where a task stands', () => {
  it('says its lead is following up on a round of work after its plan', () => {
    const base = snapshot()
    const following = {
      ...base,
      task: { ...base.task, step: 'implement', followUp: true },
      session: base.session === null ? null : { ...base.session, turnRunning: true },
    }
    expect(statusOf(following)).toEqual({ status: TaskStatus.Running, state: 'Following up' })
  })

  it('names the agent a held step waits for by its id, where it isn’t told the agent’s name', () => {
    const base = snapshot()
    const until = '2026-10-03T15:40:00.000Z'
    expect(statusOf({ ...base, task: { ...base.task, waits: { agentId: 'codex', until } } }).state).toBe(
      `The work waits: codex is out of usage until ${clock(until)}`,
    )
  })

  it('says no time beside a ready task its lead handed back, nor beside one stopped before it said anything', () => {
    const base = snapshot()
    const reported = { ...items.step(), createdAt: at(0) }
    expect(sinceOf({ ...base, task: { ...base.task, phase: 'ready', handedBack: 'It conflicts.' }, items: [reported] }, at(5))).toBeNull()
    expect(sinceOf({ ...base, task: { ...base.task, phase: 'stopped' }, items: [] }, at(5))).toBeNull()
  })

  it('counts a stopped task with nothing in its thread until now', () => {
    const base = snapshot()
    expect(elapsedOf({ ...base, task: { ...base.task, phase: 'stopped', startedAt: at(0) }, items: [], session: null }, at(12))).toBe('12m')
  })
})

describe('what the lead is asked when merging here conflicts', () => {
  it('says, in each repository, the branch it merges into and where it conflicts; one Althar can’t name is the repository', () => {
    expect(
      text.resolve([
        { name: null, branch: 'main', files: 'README.md' },
        { name: 'web', branch: 'develop', files: 'src/app.ts' },
      ]),
    ).toMatch(
      /^The default branches have moved on, and merging this task's branches into them conflicts: in the repository, main conflicts in README\.md; in web, develop conflicts in src\/app\.ts\. Bring each branch up to date/,
    )
  })
})
