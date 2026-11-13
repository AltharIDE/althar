import type { Meta, StoryObj } from '@storybook/react-vite'

import { LiveDot } from './LiveDot'
import { States } from '../../storybook/States'

const meta = { title: 'Primitives/LiveDot', component: LiveDot } satisfies Meta<typeof LiveDot>
export default meta
type Story = StoryObj<typeof meta>

export const AllStates: Story = {
  render: () => (
    <States
      cells={[
        { state: 'still', node: <LiveDot /> },
        { state: 'listening', node: <LiveDot ping /> },
        { state: 'just arrived', node: <LiveDot ping urgent /> },
      ]}
    />
  ),
}
