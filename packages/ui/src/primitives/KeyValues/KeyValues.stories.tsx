import type { Meta, StoryObj } from '@storybook/react-vite'

import { States } from '../../storybook/States'
import { KeyValues } from './KeyValues'

const meta = {
  title: 'Primitives/KeyValues',
  component: KeyValues,
  args: {
    items: [
      ['Needs', 'Deploying to staging, which this run was not given'],
      ['Budget', 'About $3 more, within the project’s monthly limit'],
    ],
  },
} satisfies Meta<typeof KeyValues>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
/** A narrower key column, for short keys. */
export const Narrow: Story = { args: { keyWidth: 64 } }

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'two', node: <KeyValues {...args} /> },
        { state: 'narrow keys', node: <KeyValues {...args} keyWidth={64} /> },
        { state: 'one', node: <KeyValues items={[['Status', '200 OK']]} /> },
        {
          state: 'long value',
          node: (
            <KeyValues items={[['Why', 'A value long enough to wrap onto a second line, which stays in its own column under itself.']]} />
          ),
        },
      ]}
    />
  ),
}
