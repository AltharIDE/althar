import { AgentStartFailed } from '@althar/provider-adapters'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import type { EnrolledWorkerState, WorkerExecutionPlatform } from '../src/workerExecution'
import { holdOn, holdWords } from '../src/workerWait'

/*
 * What keeps a worker from a lead's run (workerWait.ts): the home's own list of the workers it enrolled where it has
 * one, else the project's; and what the thread says while the lead waits.
 */

const open: WorkerExecutionPlatform['open'] = () => Effect.fail(new AgentStartFailed({ command: 'codex', reason: 'Not in this test.' }))
const enrolledAs = (state: Partial<EnrolledWorkerState>): WorkerExecutionPlatform => ({
  list: () => [],
  open,
  enrolled: () => [{ workerId: 'worker', connected: true, busy: false, providers: [], projectIds: [], ...state }],
})
const listedAs = (busy: boolean): WorkerExecutionPlatform => ({
  list: () => [{ workerId: 'worker', providers: [], busy }],
  open,
})

describe('a worker’s hold', () => {
  it('is the home’s own word where it enrolled the worker, the workspace its run holds with it', () => {
    expect(holdOn(enrolledAs({}), 'project', 'worker')).toBeUndefined()
    expect(holdOn(enrolledAs({ busy: true }), 'project', 'worker')).toEqual({ kind: 'busy' })
    expect(holdOn(enrolledAs({ connected: false, workspaceId: 'ws' }), 'project', 'worker')).toEqual({ kind: 'away', workspaceId: 'ws' })
    expect(holdOn(enrolledAs({ busy: true, workspaceId: 'ws' }), 'project', 'worker')).toEqual({ kind: 'busy', workspaceId: 'ws' })
  })

  it('is the project’s list otherwise, where a worker it doesn’t list is away', () => {
    expect(holdOn(listedAs(false), 'project', 'worker')).toBeUndefined()
    expect(holdOn(listedAs(true), 'project', 'worker')).toEqual({ kind: 'busy' })
    expect(holdOn(listedAs(false), 'project', 'another')).toEqual({ kind: 'away' })
  })
})

describe('what the thread says while its lead waits', () => {
  it('names what holds the worker, and who', () => {
    expect(holdWords('hermes', { kind: 'away' }, undefined)).toEqual({ title: 'Waiting for hermes to connect again.', description: null })
    expect(holdWords('hermes', { kind: 'busy' }, { own: true }).title).toBe('Waiting for hermes to stop this task’s last run there.')
    expect(holdWords('hermes', { kind: 'busy' }, undefined).title).toBe('Waiting for hermes: another run holds it.')
    const other = holdWords('hermes', { kind: 'busy' }, { own: false, title: 'Retry uploads' })
    expect(other.title).toBe('Waiting for hermes: “Retry uploads” runs there.')
    expect(other.description).toContain('one agent at a time')
  })
})
