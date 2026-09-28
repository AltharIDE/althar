import type { Meta, StoryObj } from '@storybook/react-vite'

import { STEPS_418 } from '../../fixtures/chrome'
import { OPUS } from '../../fixtures/models'
import { TaskStatus, TrackStep } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { SettledPeek, WorkPeek } from './WorkPeek'

const HELD = STEPS_418.map((s) => (s.state === TrackStep.Now ? { ...s, meta: 'held on your call on the fallback' } : s))
const SENT_BACK = STEPS_418.map((s, i) =>
  i === 1
    ? { ...s, state: TrackStep.Now }
    : i > 1 && i < 4
      ? { ...s, state: TrackStep.Seen }
      : i >= 4
        ? { ...s, state: TrackStep.Next }
        : s,
)

const meta = {
  title: 'Dock/WorkPeek',
  component: WorkPeek,
  decorators: [(Story) => <div style={{ width: 380 }}>{Story()}</div>],
  args: {
    title: 'Repair token refresh on privilege change',
    note: 'The security review was added after the graph touched authentication files.',
    steps: STEPS_418,
    lead: OPUS,
  },
} satisfies Meta<typeof WorkPeek>
export default meta
type Story = StoryObj<typeof meta>

export const Running: Story = {}
export const WaitingOnYou: Story = { args: { status: TaskStatus.Yours, steps: HELD } }
export const Paused: Story = { args: { status: TaskStatus.Paused } }
/** Sent back from Repair to Implement: what it had reached stays, ringed. */
export const SentBack: Story = { args: { steps: SENT_BACK } }
/** Not started: what it waits for, and no agent yet. */
export const NotStarted: Story = {
  args: {
    title: 'Sign webhook v2 payloads with rotating keys',
    note: undefined,
    steps: undefined,
    lead: undefined,
    waiting: 'Starts when 419 merges',
  },
}
export const Settled: Story = {
  render: () => <SettledPeek title="Add idempotency keys to the refund endpoint" meta="PR 1184 · 2 review rounds" />,
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'running', node: <WorkPeek {...args} /> },
        { state: 'waiting on you', node: <WorkPeek {...args} {...WaitingOnYou.args} /> },
        { state: 'paused', node: <WorkPeek {...args} status={TaskStatus.Paused} /> },
        { state: 'sent back', node: <WorkPeek {...args} steps={SENT_BACK} /> },
        { state: 'not started', node: <WorkPeek {...args} {...NotStarted.args} /> },
        { state: 'settled', node: <SettledPeek title="Add idempotency keys to the refund endpoint" meta="PR 1184 · 2 review rounds" /> },
      ]}
    />
  ),
}
