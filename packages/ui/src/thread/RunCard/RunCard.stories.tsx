import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { RunCard } from './RunCard'

const meta = {
  title: 'Thread/RunCard',
  component: RunCard,
  decorators: [threadDecorator],
  args: {
    where: 'Add a black cat that wanders the great hall',
    command: 'npm run dev',
    url: 'localhost:5173',
    since: '2m',
    onOpen: fn(),
    onStop: fn(),
    onRunAgain: fn(),
  },
} satisfies Meta<typeof RunCard>
export default meta
type Story = StoryObj<typeof meta>

/** Up: where it answers, to open, how long it has run, and Stop. */
export const Up: Story = {}
/** Before it says where it answers. */
export const Starting: Story = { args: { url: undefined, since: '12s' } }
/** It ended by itself: how, with the last line it printed, and Run again. */
export const Exited: Story = { args: { since: '4m ago', ended: { code: 1, stopped: false, last: 'Error: Port 5173 is already in use' } } }
/** It ended by itself, well. */
export const Finished: Story = {
  args: { command: 'npm run build', since: '1m ago', ended: { code: 0, stopped: false, last: '✓ built in 2.41s' } },
}
/** Stopped, by the person or as Althar quit. */
export const Stopped: Story = { args: { since: '4m ago', ended: { code: null, stopped: true } } }
/** A copy of the default branch, its address with nothing to open it with. */
export const DefaultBranch: Story = { args: { where: 'main', url: 'localhost:5174', onOpen: undefined } }
/** A long command and a long task, each kept to its line. */
export const LongWords: Story = {
  args: {
    where: 'Rate-limit refunds the way charges are, per partner, and say so in the docs',
    command: 'stripe listen --forward-to localhost:5173/webhooks --events charge.refunded,charge.updated',
  },
}

export const Opening: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Open localhost:5173' }))
    await expect(args.onOpen).toHaveBeenCalledOnce()
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Stop npm run dev' }))
    await expect(args.onStop).toHaveBeenCalledOnce()
  },
}

export const RunningAgain: Story = {
  args: { ended: { code: 1, stopped: false } },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('button', { name: /^Stop/ })).toBeNull()
    await userEvent.click(c.getByRole('button', { name: 'Run npm run dev again' }))
    await expect(args.onRunAgain).toHaveBeenCalledOnce()
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'starting', node: <RunCard {...args} url={undefined} since="12s" /> },
        { state: 'up', node: <RunCard {...args} /> },
        {
          state: 'exited',
          node: <RunCard {...args} since="4m ago" ended={{ code: 1, stopped: false, last: 'Error: Port 5173 is already in use' }} />,
        },
        { state: 'stopped', node: <RunCard {...args} since="4m ago" ended={{ code: null, stopped: true }} /> },
      ]}
    />
  ),
}
