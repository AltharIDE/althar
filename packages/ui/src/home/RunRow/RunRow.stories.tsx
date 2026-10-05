import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'

import { MERIDIAN, RUNNING } from '../../fixtures/home'
import { TaskStatus } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { RunRow } from './RunRow'
import s from './RunRow.stories.module.css'

const [M418, H207, , H209] = RUNNING
if (!M418 || !H207 || !H209) throw new Error('The demo needs its running tasks')
const { id: _418, ...ON_REVIEW } = M418
const { id: _207, ...RUNNING_207 } = H207
const { id: _209, ...HELD } = H209

const meta = {
  title: 'Home/RunRow',
  component: RunRow,
  decorators: [(Story) => <div className={s.width}>{Story()}</div>],
  args: { ...RUNNING_207, onOpen: fn() },
} satisfies Meta<typeof RunRow>
export default meta
type Story = StoryObj<typeof meta>

export const Running: Story = {}

/** On a step someone else holds: the reviewer is named beside the step. */
export const OnAReview: Story = { args: ON_REVIEW }

/** Held for a usage limit: it says what it waits for, and its track stands still. */
export const Held: Story = { args: HELD }

/** Stuck on something only you can answer. */
export const WaitsOnYou: Story = { args: { ...RUNNING_207, status: TaskStatus.Yours, note: 'Stuck: waits on you' } }

/** Open in the dock. */
export const Current: Story = { args: { current: true } }

/** A long title stays on one line. */
export const LongTitle: Story = {
  args: {
    project: MERIDIAN,
    title: 'Backfill idempotency keys on every refund created before PR 1184, in batches the read replicas can take',
  },
}

/** Nowhere to open it: the row is words. */
export const WithoutOpening: Story = { args: { onOpen: undefined } }

export const AllStates: Story = {
  parameters: statesOn({ hover: '> div', focus: 'button', pressed: 'button' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'running', node: <RunRow {...args} /> },
        { state: 'on a review', node: <RunRow {...args} {...ON_REVIEW} /> },
        { state: 'held', node: <RunRow {...args} {...HELD} /> },
        { state: 'waits on you', node: <RunRow {...args} {...WaitsOnYou.args} /> },
        { state: 'current', node: <RunRow {...args} current /> },
        { state: 'hover', node: <RunRow {...args} /> },
        { state: 'focus', node: <RunRow {...args} /> },
        { state: 'long title', node: <RunRow {...args} {...LongTitle.args} /> },
      ]}
    />
  ),
}
