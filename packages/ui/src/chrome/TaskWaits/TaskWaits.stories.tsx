import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { BlockerStands, TaskStatus } from '../../foundations/vocabulary'
import { TaskHeader } from '../TaskHeader/TaskHeader'
import { TaskWaitedBy, TaskWaits } from './TaskWaits'

const meta = {
  title: 'Chrome/TaskWaits',
  component: TaskWaits,
  args: { waitsFor: [], waitedBy: [] },
} satisfies Meta<typeof TaskWaits>
export default meta
type Story = StoryObj<typeof meta>

const stopWaiting = fn()
const startNow = fn()

const WAITS = [
  { id: 'host', title: 'Host service', stands: BlockerStands.Merged, onOpen: fn() },
  { id: 'seal', title: 'Seal secrets at rest', stands: BlockerStands.Stuck, onOpen: fn(), onStopWaiting: stopWaiting },
  { id: 'pair', title: 'Pair a device with the host', stands: BlockerStands.Review, onOpen: fn(), onStopWaiting: fn() },
]
const THEN = [{ id: 'reconnect', title: 'Reconnect after sleep', meta: 'Starts once this merges', onOpen: fn() }]

/** What a waiting task's header opens: what it waits for (a merged one quiet), Stop waiting on hover, Start now; then what waits for it. */
export const WaitsAndThen: Story = {
  args: { waitsFor: WAITS, waitedBy: THEN, onStartNow: startNow },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Stuck')).toBeInTheDocument()
    await expect(c.getByText('Then')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Stop waiting for Seal secrets at rest' }))
    await expect(stopWaiting).toHaveBeenCalled()
    await userEvent.click(c.getByRole('button', { name: 'Start now, without waiting' }))
    await expect(startNow).toHaveBeenCalled()
  },
}

/** One it waits for was abandoned: in red, with Reopen beside Stop waiting. */
export const AnAbandonedOne: Story = {
  args: {
    waitsFor: [{ id: 'seal', title: 'Seal secrets at rest', stands: BlockerStands.Abandoned, onReopen: fn(), onStopWaiting: fn() }],
    waitedBy: [],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: 'Reopen Seal secrets at rest' })).toBeInTheDocument()
  },
}

/** In the header: its words say when it starts, and open the list. */
export const InTheHeader: Story = {
  render: () => (
    <TaskHeader
      title="Set a host up over SSH"
      status={TaskStatus.Queued}
      state="Starts when Seal secrets at rest and Pair a device merge"
      waits={{ waitsFor: WAITS, waitedBy: THEN, onStartNow: fn() }}
    />
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Starts when/ }))
    await expect(await within(document.body).findByText('Pair a device with the host')).toBeInTheDocument()
  },
}

/** On a task others wait for: a part of its chip says what does, and opens them. */
export const WaitedForInTheHeader: Story = {
  render: () => (
    <TaskHeader title="Seal secrets at rest" status={TaskStatus.Running} state="Implementing" beside={<TaskWaitedBy waitedBy={THEN} />} />
  ),
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Reconnect after sleep waits for this/ }))
    await expect(await within(document.body).findByText('Starts once this merges')).toBeInTheDocument()
  },
}
