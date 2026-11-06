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
  report: null,
  failed: null,
  handed: NOTHING_HANDED,
  shown: { before: [], after: [] },
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

  it('shows what the lead thinks under its line while it works, but not while it settles a review', async () => {
    const thinking: Round = {
      ...round('r3', 'unused'),
      result: null,
      live: true,
      work: {
        id: 'work:r3',
        steps: [{ kind: 'thought', id: 't1', text: 'Where does the poll start?', took: null, live: true }],
        took: '12s',
        live: true,
        counts: '',
        now: null,
      },
    }
    const show = shown({ threadId: 'th1', versionOf: () => '', rounds: [thinking] })
    expect(screen.getByRole('button', { name: /^Thinking/ })).toBeTruthy()
    expect(screen.getByText('Where does the poll start?')).toBeTruthy()
    show({ threadId: 'th1', versionOf: () => '', rounds: [thinking], settling: true })
    // Folded away under the line: the person sees the work line alone.
    expect(screen.getByRole('button', { name: /^Thinking/ }).closest('[data-state="closed"]')).not.toBeNull()
    // Its work opened, the thought in it is a line still, streaming folded, until it is opened itself.
    await userEvent.click(screen.getByRole('button', { name: /^Working/ }))
    const [thought, ...more] = screen.getAllByRole('button', { name: /^Thinking/ }).filter((button) => button.closest('[inert]') === null)
    expect(more).toEqual([])
    expect(thought?.getAttribute('aria-expanded')).toBe('false')
    if (thought === undefined) return
    await userEvent.click(thought)
    expect(thought.getAttribute('aria-expanded')).toBe('true')
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
