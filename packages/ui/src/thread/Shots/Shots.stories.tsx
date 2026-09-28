import type { Meta, StoryObj } from '@storybook/react-vite'

import { Dash } from '../../fixtures/meridian'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Shots } from './Shots'
import { States, statesOn } from '../../storybook/States'

const meta = {
  title: 'Thread/Shots',
  component: Shots,
  decorators: [threadDecorator],
  args: {
    items: [
      { id: 'before', name: 'refund-refused-before.png', label: 'Before', meta: '1440 × 900', view: <Dash /> },
      { id: 'after', name: 'refund-refused-after.png', label: 'After', meta: '1440 × 900', view: <Dash after /> },
    ],
  },
} satisfies Meta<typeof Shots>
export default meta
type Story = StoryObj<typeof meta>

export const BeforeAndAfter: Story = {}
export const One: Story = {
  args: { items: [{ id: 'after', name: 'refund-refused-after.png', label: 'After', meta: '1440 × 900', view: <Dash after /> }] },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'li:first-child button', focus: 'li:first-child button', pressed: 'li:first-child button' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'before and after', node: <Shots {...args} /> },
        { state: 'one', node: <Shots items={args.items.slice(1)} /> },
        { state: 'hover', node: <Shots {...args} /> },
        { state: 'focus', node: <Shots {...args} /> },
        { state: 'pressed', node: <Shots {...args} /> },
      ]}
    />
  ),
}
