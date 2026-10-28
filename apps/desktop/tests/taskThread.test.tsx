import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ComponentProps, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

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
  at: '5 min ago',
  ack: null,
  work: null,
  result: { id: `${id}-said`, text, handed: { ...NOTHING_HANDED, files } },
  report: null,
  failed: null,
  handed: NOTHING_HANDED,
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
})
