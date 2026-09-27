import type { Meta, StoryObj } from '@storybook/react-vite'

import { OPUS } from '../../fixtures/models'
import { States } from '../../storybook/States'
import { Prose, Turn } from '../Turn/Turn'
import { You } from '../You/You'
import { Measure, Thread } from './Thread'

const meta = {
  title: 'Thread/Thread',
  component: Thread,
  parameters: { layout: 'fullscreen' },
  args: { label: 'Task 431, with the lead', children: null },
} satisfies Meta<typeof Thread>
export default meta
type Story = StoryObj<typeof meta>

const turns = (
  <>
    <You at="2h ago">Refunds should rate-limit like charges do. Match the headers exactly.</You>
    <Turn who={OPUS} at="2h ago">
      <Prose>
        Charges apply the limit in the partner middleware; the refund router was added after and never wrapped. Wrapping it now.
      </Prose>
    </Turn>
  </>
)

/** A feed of turns, 30px apart, in the reading measure. */
export const Conversation: Story = {
  render: (args) => (
    <Measure>
      <Thread {...args}>{turns}</Thread>
    </Measure>
  ),
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'settled', node: <Thread {...args}>{turns}</Thread> },
        {
          state: 'busy',
          node: (
            <Thread {...args} busy>
              {turns}
            </Thread>
          ),
        },
        { state: 'empty', node: <Thread {...args} /> },
        {
          state: 'wide measure',
          node: (
            <Measure wide>
              <span style={{ fontSize: 12, color: 'var(--t-3)' }}>measure + 140px, for sheets beside the thread</span>
            </Measure>
          ),
        },
      ]}
    />
  ),
}
