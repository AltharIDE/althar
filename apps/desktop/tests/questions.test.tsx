import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type BoardCall, type HomeCall, type QuestionField, type ThreadSnapshot } from '@althar/contracts'
import { ProjectInk, type ProjectRef } from '@althar/ui'

import { callCardOf } from '../src/renderer/features/board/BoardView'
import { needLineOf, needsOf } from '../src/renderer/features/home/needs'
import { TaskView } from '../src/renderer/features/task/TaskView'
import { useTask } from '../src/renderer/features/task/useTask'
import { answersOf, moreOf, partsOf, pickedOf } from '../src/renderer/shared/questions'
import { blocksOf } from '../src/renderer/shared/thread'
import { fakeClient, items, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * An agent's question (DEV-13): answered in the thread where it was asked,
 * listed on the home and the board with what it asks, and opened there.
 */

function Task() {
  return <TaskView model={useTask('th1')} onBack={vi.fn()} />
}

const database: QuestionField = {
  id: 'database',
  question: 'Which database should the cache use?',
  type: 'choice',
  options: [
    { value: 'postgres', label: 'Postgres', note: 'what production runs' },
    { value: 'sqlite', label: 'SQLite' },
  ],
  multiple: false,
  wordsField: 'database_custom',
  required: false,
}
const checks: QuestionField = {
  id: 'checks',
  question: 'Which checks should run?',
  header: 'Checks',
  type: 'choice',
  options: [
    { value: 'unit', label: 'Unit tests' },
    { value: 'lint', label: 'Lint' },
  ],
  multiple: true,
  required: false,
}

const file = { path: 'src/cache.ts', from: null, status: 'modified' as const, add: 4, del: 1, binary: false, uncommitted: false }

const call = {
  id: 'q1',
  kind: 'question' as const,
  stuck: null,
  title: database.question,
  reason: '',
  command: null,
  question: { message: 'Which database?', fields: [database] },
  createdAt: '2026-10-10T12:00:00.000Z',
}

const asking = (overrides: Partial<ThreadSnapshot> = {}) =>
  snapshot({ items: [items.you('Add a cache'), items.says('One thing first.'), items.question()], attention: [call], ...overrides })

describe('an agent’s question', () => {
  it('is asked in the kit’s terms, and answered in the runtime’s', () => {
    expect(partsOf([database, checks, { ...database, id: 'name', type: 'text', options: [], wordsField: undefined }])).toEqual([
      {
        id: 'database',
        question: database.question,
        options: [
          { id: 'postgres', label: 'Postgres', note: 'what production runs' },
          { id: 'sqlite', label: 'SQLite' },
        ],
        words: true,
      },
      {
        id: 'checks',
        question: 'Which checks should run?',
        header: 'Checks',
        options: [
          { id: 'unit', label: 'Unit tests' },
          { id: 'lint', label: 'Lint' },
        ],
        multiple: true,
        words: false,
      },
      { id: 'name', question: database.question, options: [], words: true },
    ])
    expect(answersOf({ database: { optionIds: [], words: ' DuckDB ' }, checks: { optionIds: ['unit'], words: ' ' } })).toEqual({
      database: { values: [], words: 'DuckDB' },
      checks: { values: ['unit'] },
    })
    expect(pickedOf({ database: { values: ['sqlite'] }, checks: { values: [], words: 'all' } })).toEqual({
      database: { optionIds: ['sqlite'] },
      checks: { optionIds: [], words: 'all' },
    })
    expect(moreOf({ fields: [database] })).toBeUndefined()
    expect(moreOf({ fields: [database, checks] })).toBe('and 1 more question')
    expect(moreOf({ fields: [database, checks, checks] })).toBe('and 2 more questions')
  })

  it('stands on its own in the thread, between the turns before and after it', () => {
    const blocks = blocksOf(
      { items: [items.says('One thing first.'), items.question(), items.says('Going with SQLite.')], turnRunning: false, worktree: null },
      new Map(),
      () => 'now',
    )
    expect(blocks.map((block) => block.kind)).toEqual(['turn', 'question', 'turn'])
  })

  it('opens its task on the conversation, with the question to hand, though the task is ready with outputs', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => {
        const base = asking()
        return { ...base, task: { ...base.task, phase: 'ready' as const, files: [file], commits: 1 } }
      }),
    })
    withServices(<Task />, client)
    const postgres = await screen.findByRole('radio', { name: 'Postgres' })
    await waitFor(() => expect(document.activeElement).toBe(postgres))
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Conversation/ }).getAttribute('aria-checked') ?? 'true').toBe('true')
  })

  it('is answered where it was asked, and not as a permission', async () => {
    const { client } = fakeClient({ getThread: vi.fn(async () => asking()) })
    withServices(<Task />, client)
    await screen.findByText('Needs your answer')
    expect(screen.queryByText('Needs your permission')).toBeNull()
    await userEvent.click(screen.getByRole('radio', { name: /SQLite/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Answer/ }))
    await waitFor(() =>
      expect(client.answerQuestion).toHaveBeenCalledWith({ attentionId: 'q1', answers: { database: { values: ['sqlite'] } } }),
    )
    // Said at once, before the runtime's read catches up.
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Answer/ })).toBeNull())
    expect(screen.getByText('SQLite')).toBeTruthy()
  })

  it('says why an answer didn’t go through, and keeps what was picked', async () => {
    const { client } = fakeClient({
      getThread: vi.fn(async () => asking()),
      answerQuestion: vi.fn(async () => {
        throw new ApiError({ reason: 'AttentionClosed', message: 'That call was already answered, or the agent took it back.' })
      }),
    })
    withServices(<Task />, client)
    await userEvent.click(await screen.findByRole('radio', { name: /Postgres/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Answer/ }))
    expect(await screen.findByText('That call was already answered, or the agent took it back.')).toBeTruthy()
    expect(screen.getByRole<HTMLInputElement>('radio', { name: /Postgres/ }).checked).toBe(true)
  })

  it('shows what was said once answered, and why it waits no longer once withdrawn', async () => {
    const answered = fakeClient({
      getThread: vi.fn(async () =>
        asking({ items: [items.question({ state: 'answered', answers: { database: { values: [], words: 'DuckDB' } } })], attention: [] }),
      ),
    })
    const view = withServices(<Task />, answered.client)
    expect(await screen.findByText('DuckDB')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Answer/ })).toBeNull()
    view.unmount()
    const withdrawn = fakeClient({
      getThread: vi.fn(async () => asking({ items: [items.question({ state: 'withdrawn', withdrawn: 'turn' })], attention: [] })),
    })
    withServices(<Task />, withdrawn.client)
    expect(await screen.findByText(/The agent went on without an answer/)).toBeTruthy()
    expect(screen.getByText('Not answered')).toBeTruthy()
  })

  it('is listed on the home and the board by what it asks, and opens where it was asked', async () => {
    const project: ProjectRef = { seed: 'p1', name: 'Meridian', ink: ProjectInk.Rose }
    const home: HomeCall = { ...call, projectId: 'p1', taskId: 't1', threadId: 'th1', taskTitle: 'Add a cache', taskSlug: 'add-a-cache' }
    const [need] = needsOf({ calls: [home], ready: [], refs: new Map([['p1', project]]), agentName: (id) => id ?? '' })
    // Calm: what it asks, and Answer; its options are where it is answered. Said nothing first, nor who asks: nothing under it.
    expect(need).toEqual({ id: 'q1', threadId: 'th1', kind: 'Question', project, title: database.question })
    // Why it asks, where the agent said; else who asks, and where.
    const said = (question: HomeCall['question']) =>
      needsOf({
        calls: [{ ...home, question }],
        ready: [],
        refs: new Map([['p1', project]]),
        agentName: (id) => id ?? '',
        modelName: (agentId, model) => `${model ?? agentId}!`,
      })[0]?.brief
    expect(
      said({ message: 'Which?', fields: [database], why: 'The rates change hourly.', askedBy: { agentId: 'claude-code', model: 'opus' } }),
    ).toBe('The rates change hourly.')
    expect(said({ message: 'Which?', fields: [database], askedBy: { agentId: 'claude-code', model: 'opus' } })).toBe(
      'opus! asks, in Add a cache',
    )
    expect(
      needsOf({
        calls: [
          {
            ...home,
            taskId: null,
            taskTitle: null,
            taskSlug: null,
            question: { message: 'Which?', fields: [database], askedBy: { agentId: 'codex', model: null } },
          },
        ],
        ready: [],
        refs: new Map([['p1', project]]),
        agentName: (id) => `${id ?? ''}?`,
      })[0]?.brief,
    ).toBe('codex? asks, as the coordinator')
    const [several] = needsOf({
      calls: [{ ...home, question: { message: 'A few things.', fields: [database, checks] } }],
      ready: [],
      refs: new Map([['p1', project]]),
      agentName: (id) => id ?? '',
    })
    expect(several?.brief).toBe('and 1 more question')
    const onOpen = vi.fn()
    if (need === undefined) throw new Error('no line')
    render(<>{needLineOf(need, { onOpen, onAnswer: vi.fn() })}</>)
    await userEvent.click(screen.getByRole('button', { name: 'Answer' }))
    expect(onOpen).toHaveBeenCalledWith('th1')

    const board: BoardCall = { ...home }
    expect(callCardOf(board, () => '')).toMatchObject({
      kind: 'Question',
      title: database.question,
      options: ['Postgres', 'SQLite'],
      text: { decide: 'Answer' },
    })
    // Several at once: the first's options, and how many more wait in the task.
    expect(callCardOf({ ...board, question: { message: 'A few things.', fields: [database, checks] } }, () => '')).toMatchObject({
      options: ['Postgres', 'SQLite'],
      because: 'and 1 more question',
    })
    expect(
      callCardOf({ ...board, question: { message: 'Which?', fields: [database], why: 'The rates change hourly.' } }, () => '').because,
    ).toBe('The rates change hourly.')
  })
})
