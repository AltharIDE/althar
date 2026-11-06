import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { threadDecorator } from '../../storybook/ThreadFrame'
import { TaskAsk, type TaskAskProps, type TaskMove } from './TaskAsk'

const meta = {
  title: 'Coordinator/TaskAsk',
  component: TaskAsk,
  decorators: [threadDecorator],
  args: {
    title: 'Review the importer',
    move: 'stop',
    why: 'Its pull request was closed on GitHub, so its work won’t go anywhere.',
    onAnswer: fn(),
  },
} satisfies Meta<typeof TaskAsk>
export default meta
type Story = StoryObj<typeof meta>

/** Answered here: it folds to a line, and focus goes there. */
function Answering(props: Omit<TaskAskProps, 'state' | 'onAnswer'>) {
  const [state, setState] = useState<TaskAskProps['state']>('open')
  return <TaskAsk {...props} state={state} onAnswer={(yes) => setState(yes ? 'done' : 'declined')} />
}

/** News made the coordinator think a task should stop: one button does it, as the task's own Stop would. */
export const AsksToStop: Story = {
  render: (args) => <Answering title={args.title} move="stop" {...(args.why === undefined ? {} : { why: args.why })} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText(/Stop/, { selector: 'p' })).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Stop' }))
    await expect(c.getByText('Stopped.')).toBeInTheDocument()
    await waitFor(() => expect(c.getByText('Stopped.').parentElement).toHaveFocus())
    await expect(c.getByText('Review the importer')).toBeInTheDocument()
  },
}

/** Not now leaves the task as it is, and says so in a line. */
export const NotNow: Story = {
  render: (args) => <Answering title={args.title} move="discard" why="Nobody has touched it in two weeks." />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Not now' }))
    await expect(c.getByText('Not now.')).toBeInTheDocument()
  },
}

/** The title opens the task, to look before answering. */
export const OpensTheTask: Story = {
  args: { onOpen: fn() },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Open Review the importer' }))
    await expect(args.onOpen).toHaveBeenCalled()
  },
}

const MOVES: ReadonlyArray<TaskMove> = [
  'stop',
  'stop_turn',
  'hold',
  'restart',
  'done',
  'keep',
  'discard',
  'merge_here',
  'push_here',
  'as_is',
  'skip_review',
  'again',
  'hand_on',
]

/** Where a move goes, for those that name it. */
const TO: Partial<Record<TaskMove, string>> = { merge_here: 'main', hand_on: 'GPT-6.1 Sol' }

/** Every move it can ask, and each way it ends: done, not now, or nothing to do any more. */
export const Every: Story = {
  render: () => (
    <>
      {MOVES.map((move) => (
        <TaskAsk
          key={move}
          title="Sketch the settings"
          move={move}
          {...(TO[move] === undefined ? {} : { to: TO[move] })}
          onAnswer={() => undefined}
        />
      ))}
      <TaskAsk title="Sketch the settings" move="keep" state="done" />
      <TaskAsk title="Sketch the settings" move="discard" state="declined" />
      <TaskAsk title="Sketch the settings" move="stop" state="moot" said="sketch-the-settings isn’t running: there is nothing to stop." />
    </>
  ),
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Kept for later.')).toBeInTheDocument()
    await expect(c.getByText('Nothing to do.')).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Stop the turn' })).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Accept and merge' })).toBeInTheDocument()
    await expect(c.getByText(/merging it into main on this Mac/)).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Accept it as it is' })).toBeInTheDocument()
  },
}
