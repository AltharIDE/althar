import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { CODEX } from '../../fixtures/models'
import { Verdict } from '../../foundations/vocabulary'
import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Round } from '../Round/Round'
import { Reviewer, type ReviewerFinding } from './Reviewer'

const FINDINGS: ReviewerFinding[] = [
  {
    id: 'f1',
    weight: 'major',
    at: 'src/refunds/router.ts:88',
    claim: 'The refusal still answers `422` with no reason when the order has no `paidAt`; read it from the charge instead.',
  },
  {
    id: 'f2',
    weight: 'minor',
    at: 'src/refunds/reason.ts:12',
    claim: 'The days are rounded down, so 30.5 days reads as 30 and the refund looks allowed.',
  },
  { id: 'f3', weight: 'nit', claim: 'The test name says “refused” but checks the allowed case.' },
]

const meta = {
  title: 'Thread/Reviewer',
  component: Reviewer,
  decorators: [threadDecorator],
  args: { verdict: Verdict.Changes, findings: FINDINGS },
  render: (args) => (
    <Round model={CODEX} part="Review" at="3m ago">
      <Reviewer {...args} />
    </Round>
  ),
} satisfies Meta<typeof Reviewer>
export default meta
type Story = StoryObj<typeof meta>

/** Asked for changes: its verdict in a sentence, each finding how much it matters, where, and what. */
export const Changes: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Needs changes: 3 findings.')).toBeInTheDocument()
    await expect(c.getAllByRole('listitem')).toHaveLength(3)
  },
}

/** Passed. */
export const Passed: Story = { args: { verdict: Verdict.Pass, findings: [] } }

/** Passed, with a note. */
export const PassedWithNotes: Story = { args: { verdict: Verdict.Pass, findings: [FINDINGS[2] as ReviewerFinding] } }

export const AllStates: Story = {
  render: () => (
    <States
      size="thread"
      cells={[
        { state: 'changes', node: <Reviewer verdict={Verdict.Changes} findings={FINDINGS} /> },
        { state: 'one finding', node: <Reviewer verdict={Verdict.Changes} findings={[FINDINGS[0] as ReviewerFinding]} /> },
        { state: 'passed', node: <Reviewer verdict={Verdict.Pass} findings={[]} /> },
        { state: 'passed with notes', node: <Reviewer verdict={Verdict.Pass} findings={[FINDINGS[2] as ReviewerFinding]} /> },
        { state: 'dark', node: <Reviewer verdict={Verdict.Changes} findings={FINDINGS} />, dark: true },
      ]}
    />
  ),
}
