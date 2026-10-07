import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { States, statesOn } from '../../storybook/States'
import { type WorkNeed, WorkStatus } from './WorkStatus'

const needs: WorkNeed[] = [
  { id: 'a1', kind: 'Approval', title: 'Run make deploy', meta: 'Ship the refunds endpoint', at: '4m ago', onOpen: fn() },
  { id: 't4', kind: 'Ready to accept', title: 'Return 409 when a refund idempotency key is reused', meta: 'PR #1191', onOpen: fn() },
  {
    id: 's1',
    kind: 'Implement stopped',
    title: 'Claude Code stopped before the step was done.',
    meta: 'Migrate billing webhooks',
    at: '1h ago',
    onOpen: fn(),
  },
  {
    id: 't7',
    kind: 'Ready to accept',
    title: 'Add a second jump while airborne in the hall',
    meta: 'althar/tea-16-second-jump',
    onOpen: fn(),
  },
]

const meta = {
  title: 'Chrome/WorkStatus',
  component: WorkStatus,
  args: { running: 5, yours: 4, onYours: fn() },
} satisfies Meta<typeof WorkStatus>
export default meta
type Story = StoryObj<typeof meta>

export const RunningAndYours: Story = {}
export const OneNeedsYou: Story = { args: { yours: 1 } }
/** Nothing waits on you: it says so, and isn't a button. */
export const NothingNeedsYou: Story = { args: { yours: 0 } }
export const NothingRunning: Story = { args: { running: 0, yours: 0 } }

/** Pointed at, the count shows what waits on you; each opens its own. */
export const ShowingWhatNeedsYou: Story = {
  args: { needs },
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByRole('button', { name: '4 need you' }))
    const list = await screen.findByRole('list', { name: 'What needs you' })
    await userEvent.click(within(list).getByRole('button', { name: /Return 409/ }))
    await waitFor(() => expect(needs[1]?.onOpen).toHaveBeenCalledOnce())
  },
}

export const OpeningTheFirst: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '4 need you' }))
    await expect(args.onYours).toHaveBeenCalledOnce()
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button', focus: 'button', pressed: 'button' }),
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'running and yours', node: <WorkStatus {...args} /> },
        { state: 'one needs you', node: <WorkStatus {...args} yours={1} /> },
        { state: 'nothing needs you', node: <WorkStatus {...args} yours={0} /> },
        { state: 'nothing running', node: <WorkStatus {...args} running={0} yours={0} /> },
        { state: 'hover', node: <WorkStatus {...args} /> },
        { state: 'focus', node: <WorkStatus {...args} /> },
        { state: 'pressed', node: <WorkStatus {...args} /> },
      ]}
    />
  ),
}
