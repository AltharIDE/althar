import type { Meta, StoryObj } from '@storybook/react-vite'

import { ROUTER_DIFF } from '../../fixtures/meridian'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Diff } from './Diff'
import { States } from '../../storybook/States'

const meta = {
  title: 'Thread/Diff',
  component: Diff,
  decorators: [threadDecorator],
  args: { lines: ROUTER_DIFF, label: 'src/refunds/router.ts' },
} satisfies Meta<typeof Diff>
export default meta
type Story = StoryObj<typeof meta>

export const Changes: Story = {}
export const OnlyAdded: Story = { args: { lines: ROUTER_DIFF.filter(([sign]) => sign !== '-') } }

export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'changes', node: <Diff {...args} /> },
        { state: 'only added', node: <Diff {...args} lines={ROUTER_DIFF.filter(([sign]) => sign !== '-')} /> },
        { state: 'only removed', node: <Diff {...args} lines={ROUTER_DIFF.filter(([sign]) => sign !== '+')} /> },
        { state: 'no label', node: <Diff lines={ROUTER_DIFF.slice(0, 4)} /> },
      ]}
    />
  ),
}
