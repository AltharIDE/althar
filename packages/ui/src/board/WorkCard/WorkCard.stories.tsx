import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { RUNNING } from '../../fixtures/board'
import { TaskStatus } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { cardStates, laneDecorator } from '../lane'
import { WorkCard } from './WorkCard'

const [REVIEWING, IMPLEMENTING, PAUSED] = RUNNING as [(typeof RUNNING)[0], (typeof RUNNING)[0], (typeof RUNNING)[0]]

const meta = {
  title: 'Board/WorkCard',
  component: WorkCard,
  decorators: [laneDecorator],
  args: { ...IMPLEMENTING, onOpen: fn() },
} satisfies Meta<typeof WorkCard>
export default meta
type Story = StoryObj<typeof meta>

/** The lead on its own step. */
export const Running: Story = {}
/** Someone else's step, a review a rule added: the card says who is on it, and counts the added step. */
export const OnAReview: Story = { args: REVIEWING }
/** Out of usage: it says when it resumes. */
export const Paused: Story = { args: PAUSED }
export const WaitingOnYou: Story = { args: { status: TaskStatus.Yours, note: 'Your call on the fallback' } }
/** Sent back from Verify to Implement. */
export const SentBack: Story = { args: { at: 1, seen: 3 } }
export const Stopped: Story = { args: { status: TaskStatus.Stopped } }
export const Current: Story = { args: { current: true } }

export const Opening: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: IMPLEMENTING.title }))
    await expect(args.onOpen).toHaveBeenCalledOnce()
  },
}

export const AllStates: Story = {
  parameters: statesOn(cardStates),
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'running', node: <WorkCard {...args} /> },
        { state: 'on a review', node: <WorkCard {...args} {...REVIEWING} /> },
        { state: 'paused', node: <WorkCard {...args} {...PAUSED} /> },
        { state: 'waiting on you', node: <WorkCard {...args} {...WaitingOnYou.args} /> },
        { state: 'sent back', node: <WorkCard {...args} {...SentBack.args} /> },
        { state: 'stopped', node: <WorkCard {...args} {...Stopped.args} /> },
        { state: 'current', node: <WorkCard {...args} current /> },
        { state: 'hover', node: <WorkCard {...args} /> },
        { state: 'focus', node: <WorkCard {...args} /> },
      ]}
    />
  ),
}
