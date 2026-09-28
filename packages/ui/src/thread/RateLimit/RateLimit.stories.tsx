import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { LIMIT_OPTIONS } from '../../fixtures/meridian'
import { OPUS, SONNET } from '../../fixtures/models'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { RateLimit } from './RateLimit'
import { States, statesOn } from '../../storybook/States'

const meta = {
  title: 'Thread/RateLimit',
  component: RateLimit,
  decorators: [threadDecorator],
  args: {
    runtime: 'Claude Code',
    resets: '14:00, in 2h 10m',
    options: LIMIT_OPTIONS,
    affects: [
      { id: 'lead', label: 'the lead', model: OPUS },
      { id: 'sec', label: 'Security review', model: SONNET },
    ],
    onSwap: fn(),
  },
} satisfies Meta<typeof RateLimit>
export default meta
type Story = StoryObj<typeof meta>

export const PausedSeveral: Story = {}
export const PausedTheTask: Story = { args: { affects: [] } }
/** No other agent is free: it can only wait. */
export const NoneFree: Story = { args: { options: LIMIT_OPTIONS.map((o) => ({ ...o, busy: true })) } }
/** Nowhere to move it: the consumer gives no onSwap, so the card only says when work resumes. */
export const OnlyWaits: Story = { args: { onSwap: undefined } }

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:first-of-type', focus: 'button:first-of-type', pressed: 'button:first-of-type' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'several paused', node: <RateLimit {...args} /> },
        { state: 'the task paused', node: <RateLimit {...args} affects={[]} /> },
        { state: 'none free', node: <RateLimit {...args} options={LIMIT_OPTIONS.map((o) => ({ ...o, busy: true }))} /> },
        { state: 'only waits', node: <RateLimit {...args} onSwap={undefined} /> },
        { state: 'hover', node: <RateLimit {...args} /> },
        { state: 'focus', node: <RateLimit {...args} /> },
        { state: 'pressed', node: <RateLimit {...args} /> },
      ]}
    />
  ),
}
