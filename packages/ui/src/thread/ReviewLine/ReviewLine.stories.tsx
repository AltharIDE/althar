import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { CODEX } from '../../fixtures/models'
import { Verdict } from '../../foundations/vocabulary'
import { States, statesParameters } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Markdown } from '../Markdown/Markdown'
import { Reviewer, type ReviewerFinding } from '../Reviewer/Reviewer'
import { ReviewLine } from './ReviewLine'

const FINDINGS: ReviewerFinding[] = [
  { id: 'f1', weight: 'major', at: 'src/refunds/router.ts:88', title: 'The refusal gives no reason', claim: 'Read it from the charge.' },
  { id: 'f2', weight: 'minor', at: 'src/refunds/reason.ts:12', title: 'Days round down', claim: '30.5 days reads as 30.' },
  { id: 'f3', weight: 'nit', title: 'The test’s name', claim: 'It says “refused” but checks the allowed case.' },
]

const said = (
  <>
    <Reviewer verdict={Verdict.Changes} findings={FINDINGS} said={false} />
    <Markdown source="The limiter is in the right place. Three things before this goes in, the first the one that matters." />
  </>
)

const meta = {
  title: 'Thread/ReviewLine',
  component: ReviewLine,
  decorators: [threadDecorator],
  args: { model: CODEX, verdict: Verdict.Changes, findings: 3, settled: '2 fixed, 1 declined', children: said },
} satisfies Meta<typeof ReviewLine>
export default meta
type Story = StoryObj<typeof meta>

/** A round of review, one quiet line: who, what it found, what became of it. Opened, its findings and words. */
export const Folded: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const row = c.getByRole('button', { name: /Review.*3 findings.*2 fixed, 1 declined/ })
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(row)
    await waitFor(() => expect(c.getByText('The refusal gives no reason')).toBeVisible())
  },
}
export const Opened: Story = { args: { defaultOpen: true } }
/** Before the lead has settled anything, the findings alone. */
export const Unsettled: Story = { args: { settled: undefined } }
export const Passed: Story = { args: { verdict: Verdict.Pass, findings: 0, settled: undefined } }
export const PassedWithNotes: Story = { args: { verdict: Verdict.Pass, findings: 2, settled: '2 fixed' } }
/** Reviewing now: the line turns, with how long it has been, and nothing of the reviewer's thinking. */
export const Reviewing: Story = { args: { live: true, took: '1m 12s', children: undefined } }

export const AllStates: Story = {
  parameters: statesParameters,
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'reviewing', node: <ReviewLine model={CODEX} live took="1m 12s" /> },
        ...(['folded', 'hover', 'focus'] as const).map((state) => ({
          state,
          force: state === 'folded' ? undefined : state,
          node: <ReviewLine {...args} />,
        })),
        { state: 'unsettled', node: <ReviewLine {...args} settled={undefined} /> },
        { state: 'passed', node: <ReviewLine model={CODEX} verdict={Verdict.Pass} /> },
        { state: 'passed, with notes', node: <ReviewLine model={CODEX} verdict={Verdict.Pass} findings={2} settled="2 fixed" /> },
        { state: 'open', node: <ReviewLine {...args} defaultOpen /> },
      ]}
    />
  ),
}
