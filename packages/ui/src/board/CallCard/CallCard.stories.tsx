import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { CALLS, STUCK_CALL } from '../../fixtures/board'
import { States, statesOn } from '../../storybook/States'
import { cardStates, laneDecorator } from '../lane'
import { CallCard } from './CallCard'

const [DECISION, APPROVAL, CONTRADICTION] = CALLS as [(typeof CALLS)[0], (typeof CALLS)[0], (typeof CALLS)[0]]

const meta = {
  title: 'Board/CallCard',
  component: CallCard,
  decorators: [laneDecorator],
  args: { ...DECISION, onOpen: fn() },
} satisfies Meta<typeof CallCard>
export default meta
type Story = StoryObj<typeof meta>

/** A decision that holds a task until you make it. */
export const Decision: Story = {}
export const Approval: Story = { args: APPROVAL }
/** Holds no task: it says where it came from instead. */
export const Contradiction: Story = { args: CONTRADICTION }
/** A task that couldn't finish: what went wrong, and no choices here; they are in the task. */
export const Stuck: Story = { args: STUCK_CALL }
/** Open beside the board. */
export const Current: Story = { args: { current: true } }

/** The whole card opens it; the title is the button. */
export const Opening: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: DECISION.title }))
    await expect(args.onOpen).toHaveBeenCalledOnce()
  },
}

export const AllStates: Story = {
  parameters: statesOn(cardStates),
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'decision', node: <CallCard {...args} /> },
        { state: 'approval', node: <CallCard {...args} {...APPROVAL} /> },
        { state: 'from, not holding', node: <CallCard {...args} {...CONTRADICTION} /> },
        { state: 'stuck, no choices', node: <CallCard {...args} {...STUCK_CALL} /> },
        { state: 'current', node: <CallCard {...args} current /> },
        { state: 'hover', node: <CallCard {...args} /> },
        { state: 'focus', node: <CallCard {...args} /> },
      ]}
    />
  ),
}
