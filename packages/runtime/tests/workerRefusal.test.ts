import { describe, expect, it } from 'vitest'

import { workerRefusal } from '../src/sessionConnections'

/* Why a lead's run doesn't open on its worker, decided as it starts (ADR-103): fail closed where nothing is known. */

const workerId = 'wrk_' + 'c'.repeat(32)
const ready = {
  sandbox: { starts: true as const },
  tools: [{ name: 'git', version: '2.43.0' }],
  models: [],
  agents: [{ providerId: 'codex', starts: true }],
}
const worker = { workerId, name: 'runner-1', providers: ['codex'], busy: false, readiness: ready }

describe('a run on a worker, as it starts', () => {
  it('opens on a worker whose check found its sandbox starts and the agent started there', () => {
    expect(workerRefusal(worker, workerId, 'codex')).toBeUndefined()
  })

  it('opens nothing on a worker gone from the project between being chosen and its lead starting', () => {
    expect(workerRefusal(undefined, workerId, 'codex')).toBe('Linux worker cccccc isn’t connected to this project now.')
  })

  it('opens nothing where its check is missing, its sandbox can’t start, or the agent couldn’t start there', () => {
    const { readiness: _none, ...unchecked } = worker
    expect(workerRefusal(unchecked, workerId, 'codex')).toMatch(/^runner-1 hasn’t checked it can run a task yet\./u)
    expect(
      workerRefusal({ ...worker, readiness: { ...ready, sandbox: { starts: false, problem: 'NoUserNamespaces' } } }, workerId, 'codex'),
    ).toMatch(/^runner-1 can’t start its agents’ sandbox/u)
    expect(
      workerRefusal(
        { ...worker, readiness: { ...ready, agents: [{ providerId: 'codex', starts: false, problem: 'Not logged in.' }] } },
        workerId,
        'codex',
      ),
    ).toBe('The lead’s agent couldn’t start on runner-1: Not logged in.')
    expect(workerRefusal(worker, workerId, 'claude-code')).toBe(
      'runner-1 hasn’t started the lead’s agent once yet: it does as the agent signs in there.',
    )
  })
})
