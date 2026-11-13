import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'

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

/** A peek in a cell of the grid as it is in the dock: its parts down a column, as wide as the cell. */
const Peek = ({ children }: { children: ReactNode }) => <div style={{ width: '100%' }}>{children}</div>

export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        {
          state: 'running',
          node: (
            <Peek>
              <WorkPeek {...args} />
            </Peek>
          ),
        },
        {
          state: 'waiting on you',
          node: (
            <Peek>
              <WorkPeek {...args} {...WaitingOnYou.args} />
            </Peek>
          ),
        },
        {
          state: 'paused',
          node: (
            <Peek>
              <WorkPeek {...args} status={TaskStatus.Paused} />
            </Peek>
          ),
        },
        {
          state: 'sent back',
          node: (
            <Peek>
              <WorkPeek {...args} steps={SENT_BACK} />
            </Peek>
          ),
        },
        {
          state: 'not started',
          node: (
            <Peek>
              <WorkPeek {...args} {...NotStarted.args} />
            </Peek>
          ),
        },
        {
          state: 'settled',
          node: (
            <Peek>
              <SettledPeek title="Add idempotency keys to the refund endpoint" meta="PR 1184 · 2 review rounds" />
            </Peek>
          ),
        },
      ]}
    />
  ),
}
