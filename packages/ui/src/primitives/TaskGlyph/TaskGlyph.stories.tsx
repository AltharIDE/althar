import type { Meta, StoryObj } from '@storybook/react-vite'

import { TaskStatus } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { TaskGlyph } from './TaskGlyph'

const meta = { title: 'Primitives/TaskGlyph', component: TaskGlyph, args: { status: TaskStatus.Running } } satisfies Meta<typeof TaskGlyph>
export default meta
type Story = StoryObj<typeof meta>

export const Running: Story = {}
export const WaitingOnYou: Story = { args: { status: TaskStatus.Yours } }

export const AllStates: Story = {
  render: () => <States cells={Object.values(TaskStatus).map((status) => ({ state: status, node: <TaskGlyph status={status} /> }))} />,
}
