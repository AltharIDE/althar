import type { Meta, StoryObj } from '@storybook/react-vite'

import { threadDecorator } from '../../storybook/ThreadFrame'
import { Turn } from '../Turn/Turn'
import { Streaming } from './Streaming'
import { CODEX } from '../../fixtures/models'
import { States } from '../../storybook/States'

const meta = {
  title: 'Thread/Streaming',
  component: Streaming,
  decorators: [threadDecorator],
  args: {
    loop: true,
    content:
      'All refund tests pass. Running the full suite before I open the PR, since the limiter is shared with charges and a regression there would not show in the refund tests alone.',
  },
  render: (args) => (
    <Turn who={CODEX} at="now">
      <Streaming {...args} />
    </Turn>
  ),
} satisfies Meta<typeof Streaming>
export default meta
type Story = StoryObj<typeof meta>

export const WordByWord: Story = {}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        {
          state: 'arriving',
          node: (
            <Turn who={CODEX} at="now">
              <Streaming {...args} />
            </Turn>
          ),
        },
        {
          state: 'arrived before',
          node: (
            <Turn who={CODEX} at="now">
              <Streaming {...args} loop={false} id="streaming-all-states" />
            </Turn>
          ),
        },
      ]}
    />
  ),
}
