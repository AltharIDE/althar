import type { Meta, StoryObj } from '@storybook/react-vite'

import { TaskStatus } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { WorkTicks } from './WorkTicks'

const meta = {
  title: 'Home/WorkTicks',
  component: WorkTicks,
  args: { tasks: [{}, {}, { status: TaskStatus.Paused }, {}] },
} satisfies Meta<typeof WorkTicks>
export default meta
type Story = StoryObj<typeof meta>

/** Four tasks, one held for a reset. */
export const Default: Story = {}

export const AllStates: Story = {
  render: () => (
    <States
      cells={[
        { state: 'one running', node: <WorkTicks tasks={[{}]} /> },
        { state: 'held and stopped', node: <WorkTicks tasks={[{}, { status: TaskStatus.Paused }, { status: TaskStatus.Stopped }]} /> },
        { state: 'more than fit', node: <WorkTicks tasks={Array.from({ length: 11 }, () => ({}))} /> },
      ]}
    />
  ),
}
