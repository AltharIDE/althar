import type { Meta, StoryObj } from '@storybook/react-vite'

import { PlanState } from '../../foundations/vocabulary'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Plan } from './Plan'
import { States } from '../../storybook/States'

const meta = {
  title: 'Thread/Plan',
  component: Plan,
  decorators: [threadDecorator],
  args: {
    updated: 'just now',
    steps: [
      { label: 'Find how charges apply the partner limit', state: PlanState.Done },
      { label: 'Wrap the refund router in the same limiter', state: PlanState.Done },
      { label: 'Test 429 and Retry-After on refunds', state: PlanState.Running },
      { label: 'Update the API reference', state: PlanState.Queued },
    ],
  },
} satisfies Meta<typeof Plan>
export default meta
type Story = StoryObj<typeof meta>

export const InProgress: Story = {}
export const NotStarted: Story = {
  args: {
    updated: undefined,
    steps: [
      { label: 'Read the refund router', state: PlanState.Queued },
      { label: 'Write the test', state: PlanState.Queued },
    ],
  },
}
export const Finished: Story = {
  args: {
    steps: [
      { label: 'Read the refund router', state: PlanState.Done },
      { label: 'Write the test', state: PlanState.Done },
    ],
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'in progress', node: <Plan {...args} /> },
        { state: 'not started', node: <Plan updated={undefined} steps={args.steps.map((x) => ({ ...x, state: PlanState.Queued }))} /> },
        { state: 'finished', node: <Plan {...args} steps={args.steps.map((x) => ({ ...x, state: PlanState.Done }))} /> },
        { state: 'one step', node: <Plan steps={[{ label: 'Read the refund router', state: PlanState.Running }]} /> },
      ]}
    />
  ),
}
