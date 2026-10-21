import { assert, describe, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'

import { NotFound } from '../src/errors'
import { itemOf, Queries, stuckOf } from '../src/Queries'
import { runtime } from './support'

/*
 * What a screen reads of a thread's items and calls as the store keeps them:
 * a repository's setup, how it ended or that it still runs, and makes do
 * with what an older or odd item lacks.
 */

const row = (kind: string, content: unknown) => ({
  id: 'i1',
  sequence: 1,
  kind,
  content: JSON.stringify(content),
  agentId: null,
  inputState: null,
  disposition: null,
  decision: null,
  createdAt: '2026-10-01T10:00:00.000Z',
})

const contentOf = (kind: string, content: unknown) => {
  const item = itemOf(row(kind, content))
  return item?.kind === kind ? (item.content as unknown as Record<string, unknown>) : undefined
}

describe('a repository’s setup, as its thread shows it', () => {
  it('says how it ended: when, its code, whether it ran out of time or was stopped, and its last line', () => {
    assert.deepStrictEqual(
      contentOf('setup', {
        repository: 'api',
        command: 'bun install',
        kept: true,
        startedAt: '2026-10-01T10:00:00.000Z',
        ended: { at: '2026-10-01T10:01:00.000Z', code: 1, timedOut: true, stopped: false, last: 'error: lockfile had changes' },
      }),
      {
        repository: 'api',
        command: 'bun install',
        kept: true,
        startedAt: '2026-10-01T10:00:00.000Z',
        ended: { at: '2026-10-01T10:01:00.000Z', code: 1, timedOut: true, stopped: false, last: 'error: lockfile had changes' },
      },
    )
  })

  it('says one still running has not ended, and makes do with an end that says little', () => {
    assert.deepInclude(contentOf('setup', { repository: 'web', command: 'make', startedAt: 't' }), { kept: false, ended: null })
    assert.deepInclude(contentOf('setup', { repository: 'web', command: 'make', startedAt: 't', ended: { at: 'u', code: 'odd' } }), {
      ended: { at: 'u', code: null, timedOut: false, stopped: false, last: null },
    })
    assert.deepInclude(contentOf('setup', {}), { repository: '', command: '', startedAt: '', ended: null })
  })
})

describe('a run’s card, as its thread shows it', () => {
  it('runs the project’s default where it names no runnable, and nowhere of a task where it names none', () => {
    assert.deepInclude(contentOf('run', { launchId: 'proc_1', where: 'main', command: 'bun dev' }), {
      launchId: 'proc_1',
      taskId: null,
      runnableId: null,
      url: null,
    })
  })
})

describe('a tool call, as its thread shows it', () => {
  it('reads its command, and says it at a glance where that is shorter', () => {
    assert.deepInclude(
      contentOf('tool_call', { title: 'Run tests', kind: 'execute', rawInput: { command: 'cd web && npm test 2>&1 | tail -5' } }),
      {
        command: 'cd web && npm test 2>&1 | tail -5',
        label: 'npm test',
        status: 'pending',
      },
    )
    assert.notProperty(contentOf('tool_call', { title: 'Run tests', kind: 'execute', rawInput: { command: 'npm test' } }), 'label')
    assert.deepInclude(contentOf('tool_call', { title: 'Think' }), { toolKind: 'other', command: null })
  })
})

describe('a question, as its thread shows it', () => {
  it('reads one whose call has gone as taken back with its task, and one answered with what was said', () => {
    assert.deepInclude(contentOf('question', { attentionId: 'att_1', message: 'Which?', fields: [] }), {
      state: 'withdrawn',
      withdrawn: 'task',
      toolCallId: null,
      answers: null,
    })
    const answered = itemOf({
      ...row('question', { attentionId: 'att_2', message: 'Which?', fields: [], toolCallId: 'ask-1' }),
      questionState: 'answered',
      questionPayload: JSON.stringify({ answers: { database: { values: ['redis'] } } }),
    })
    assert.deepInclude(answered?.kind === 'question' ? answered.content : undefined, {
      state: 'answered',
      toolCallId: 'ask-1',
      answers: { database: { values: ['redis'] } },
      withdrawn: null,
    })
  })
})

describe('a call for a step that needs the person', () => {
  it('keeps only the ways it was tried that it knows', () => {
    assert.deepInclude(stuckOf({ step: 'implement', why: 'stalled', tried: ['carried_on', 'restarted', 'redirected', 'shouted', 3] }), {
      tried: ['carried_on', 'restarted', 'redirected'],
    })
    assert.notProperty(stuckOf({ step: 'implement', why: 'stalled', tried: 'carried_on' }), 'tried')
  })
})

describe('a task a screen asks for that isn’t there', () => {
  it.live('is not found, as a summary, as a card, or by a file it changed', () =>
    Effect.gen(function* () {
      const queries = yield* Queries
      assert.instanceOf(yield* Effect.flip(queries.task('task_gone')), NotFound)
      assert.instanceOf(yield* Effect.flip(queries.card('task_gone')), NotFound)
      // Nor is a file it changed, with no worktree to read it in.
      assert.instanceOf(yield* Effect.flip(queries.fileDiff('task_gone', 'README.md')), NotFound)
    }).pipe(Effect.provide(Queries.layer.pipe(Layer.provideMerge(runtime())))),
  )
})
