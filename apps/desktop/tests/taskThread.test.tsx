import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TaskThread } from '../src/renderer/features/task/TaskThread'
import { type HandedFile, NOTHING_HANDED } from '../src/renderer/shared/handed'
import type { Round } from '../src/renderer/shared/rounds'
import { fakeClient } from './fixtures'
import { withServices } from './render'

// What the thread's words were drawn from, each time they were drawn.
const drawn = vi.hoisted(() => [] as string[])
vi.mock('@althar/ui', async (actual) => {
  const ui = await actual<typeof import('@althar/ui')>()
  return {
    ...ui,
    Markdown: (props: ComponentProps<typeof ui.Markdown>) => {
      drawn.push(props.source)
      return <ui.Markdown {...props} />
    },
  }
})

const notes: HandedFile = {
  id: 'f1',
  path: 'notes.csv',
  shown: 'notes.csv',
  whole: '/work/notes.csv',
  local: '/work/notes.csv',
  kind: 'CSV',
  size: null,
}

const round = (id: string, text: string, files: ReadonlyArray<HandedFile> = []): Round => ({
  kind: 'round',
  id,
  agentId: 'claude-code',
  model: null,
  at: '5 min ago',
  ack: null,
  work: null,
  result: { id: `${id}-said`, text, handed: { ...NOTHING_HANDED, files } },
  writing: null,
  answered: false,
  report: null,
  failed: null,
  handed: NOTHING_HANDED,
  shown: { before: [], after: [] },
  drawn: [],
  live: false,
  parts: [],
})

type Props = ComponentProps<typeof TaskThread>

/** The thread, drawn again with whatever props a test gives it next. */
const shown = (first: Props) => {
  let show: (next: Props) => void = () => undefined
  function Harness() {
    const [props, set] = useState(first)
    show = set
    return <TaskThread {...props} />
  }
  withServices(<Harness />, fakeClient().client)
  return (next: Props) => act(() => show(next))
}

describe('a task’s thread', () => {
  beforeEach(() => {
    drawn.length = 0
  })

  it('refreshes Try again from the runtime’s rule even when the failed round stays the same', async () => {
    const failed = {
      ...round('r1', ''),
      result: null,
      failed: {
        kind: 'notice' as const,
        id: 'failure1',
        text: 'The connection to Claude was lost.',
        failure: 'transient',
        tone: 'error' as const,
      },
    }
    const onTryAgain = vi.fn()
    const props = { threadId: 'th1', rounds: [failed], versionOf: () => '', onTryAgain }
    const show = shown({ ...props, retryable: false })
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    show({ ...props, retryable: true })
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onTryAgain).toHaveBeenCalledOnce()
    show({ ...props, retryable: false })
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('draws a finished round again only when what it shows changed, and opens its files as the person now does', async () => {
    const before = vi.fn()
    const now = vi.fn()
    const versionOf = () => ''
    const show = shown({
      threadId: 'th1',
      versionOf,
      openFile: before,
      rounds: [round('r1', 'Wrote the notes.', [notes]), round('r2', 'Checking the totals')],
    })
    expect(drawn).toEqual(['Wrote the notes.', 'Checking the totals'])
    drawn.length = 0

    // Read again, the same rounds as new objects, and the last one goes on: only it is drawn again.
    show({
      threadId: 'th1',
      versionOf: () => '',
      openFile: now,
      rounds: [round('r1', 'Wrote the notes.', [notes]), round('r2', 'Checking the totals, all match.')],
    })
    expect(drawn).toEqual(['Checking the totals, all match.'])

    // The round drawn before opens its file as the person opens files now.
    await userEvent.click(screen.getByRole('button', { name: /Open/ }))
    expect(now).toHaveBeenCalledWith('/work/notes.csv')
    expect(before).not.toHaveBeenCalled()
  })

  it('links the line saying its lead started a task to that task (ADR-097)', async () => {
    const open = vi.fn()
    shown({
      threadId: 'th1',
      versionOf: () => '',
      onOpenTask: open,
      rounds: [
        {
          kind: 'althar',
          id: 'n1',
          text: 'Started “Built-in browser beside the conversation”',
          tone: 'info',
          task: { threadId: 'th2', title: 'Built-in browser beside the conversation' },
        },
      ],
    })
    expect(screen.getByText(/^Started/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Built-in browser beside the conversation' }))
    expect(open).toHaveBeenCalledWith('th2')
  })

  it('shows a round at work as Codex does: how long, what it said on the way, one line for what it does now; its thinking only opened', async () => {
    const work: NonNullable<Round['work']> = {
      id: 'work:r3',
      steps: [{ kind: 'thought', id: 't1', text: 'Where does the poll start?', took: null, live: true }],
      took: '12s',
      live: true,
      counts: '',
      doing: { tool: null, text: 'Thinking' },
    }
    const working: Round = {
      ...round('r3', 'unused'),
      result: null,
      live: true,
      ack: { id: 'a1', text: 'I’ll find where the poll starts.', handed: NOTHING_HANDED },
      work,
    }
    const show = shown({ threadId: 'th1', versionOf: () => '', rounds: [working] })
    const head = screen.getByRole('button', { name: /^Working for 12s/ })
    expect(head.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByText('I’ll find where the poll starts.')).toBeTruthy()
    expect(screen.getByText('Thinking')).toBeTruthy()
    // Nothing of its thinking shows, nor a line for it, until its work is opened.
    expect(screen.queryByText('Where does the poll start?')).toBeNull()
    expect(screen.queryByRole('button', { name: /^Thinking/ })).toBeNull()
    // Opened, the thought is a line in it, which opens itself when asked.
    await userEvent.click(head)
    const [thought, ...more] = screen.getAllByRole('button', { name: /^Thinking/ }).filter((button) => button.closest('[inert]') === null)
    expect(more).toEqual([])
    expect(thought?.getAttribute('aria-expanded')).toBe('false')
    if (thought === undefined) return
    await userEvent.click(thought)
    expect(thought.getAttribute('aria-expanded')).toBe('true')
    // What it writes now stands where its answer will, and the same words stay put as its round ends.
    const writing: Round = { ...working, writing: { id: 'w1', text: 'It starts in Follow.ts.', handed: NOTHING_HANDED, live: true } }
    show({ threadId: 'th1', versionOf: () => '', rounds: [writing] })
    const words = screen.getByText('It starts in Follow.ts.')
    show({
      threadId: 'th1',
      versionOf: () => '',
      rounds: [
        {
          ...writing,
          live: false,
          writing: null,
          result: { id: 'w1', text: 'It starts in Follow.ts.', handed: NOTHING_HANDED },
          work: { ...work, live: false, doing: null },
        },
      ],
    })
    expect(screen.getByText('It starts in Follow.ts.')).toBe(words)
    // Opened to watch it, its work folds as its round ends all the same, and opens again on a click.
    const worked = screen.getByRole('button', { name: /^Worked for 12s/ })
    expect(worked.getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(worked)
    expect(worked.getAttribute('aria-expanded')).toBe('true')
  })

  it('draws a review as one line, what became of its findings in it, and a review running as a line at the end', async () => {
    const review = {
      kind: 'verdict' as const,
      id: 'v1',
      at: '5 min ago',
      model: null,
      settle: null,
      result: {
        step: 'review' as const,
        round: 0,
        summary: 'Three things.',
        change: null,
        verdict: 'changes_requested' as const,
        findings: [{ severity: 'major' as const, file: null, line: null, claim: 'The retry never stops.' }],
        built: null,
        evidence: [],
        unverified: null,
        agentId: 'codex',
      },
    }
    shown({
      threadId: 'th1',
      versionOf: () => '',
      rounds: [review],
      settledOf: (id) => (id === 'v1' ? '1 fixed' : undefined),
      reviewing: { model: { id: 'gpt', name: 'GPT-5.2', short: 'GPT-5.2', runtime: 'codex', efforts: [] }, took: '1m 4s' },
    })
    const line = screen.getByRole('button', { name: /^Review.*1 finding.*1 fixed/ })
    expect(screen.queryByText('Three things.')).toBeNull()
    await userEvent.click(line)
    expect(screen.getByText('Three things.')).toBeTruthy()
    expect(screen.getByText('1m 4s').closest('[data-review]')?.querySelector('[aria-busy="true"]')).not.toBeNull()
  })
})
