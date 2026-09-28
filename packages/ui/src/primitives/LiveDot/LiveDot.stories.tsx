import type { Meta, StoryObj } from '@storybook/react-vite'

import { LiveDot } from './LiveDot'
import { States } from '../../storybook/States'

const meta = { title: 'Primitives/LiveDot', component: LiveDot } satisfies Meta<typeof LiveDot>
export default meta
type Story = StoryObj<typeof meta>

export const Still: Story = {}
export const Listening: Story = { args: { ping: true } }
export const JustArrived: Story = { args: { ping: true, urgent: true } }

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
