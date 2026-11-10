import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { PR_416, GITHUB } from '../../fixtures/outputs'
import { OPUS } from '../../fixtures/models'
import { ChangeState, CheckState } from '../../foundations/vocabulary'
import { Button } from '../../primitives/Button/Button'
import type { ChangeCheck } from '../../primitives/Checks/Checks'
import { ChangeSet } from './ChangeSet'
import { type MergeNeed, MergeNeeds } from './MergeNeeds'

/** As wide as it is beside what a task made. */
const SIDE = 360

const CHECKS: ChangeCheck[] = [
  { id: 'test', name: 'test', state: CheckState.Failed, detail: '2 of 38 failed' },
  { id: 'build', name: 'build', state: CheckState.Running, detail: 'running · 4m' },
  { id: 'lint', name: 'lint', state: CheckState.Failed, detail: 'Prettier found 3 files' },
  { id: 'docs', name: 'docs', state: CheckState.Passed },
]
const PASSED: ChangeCheck[] = [
  { id: 'test', name: 'test', state: CheckState.Passed, detail: '38 passed' },
  { id: 'build', name: 'build', state: CheckState.Passed },
  { id: 'lint', name: 'lint', state: CheckState.Passed },
]

const tail: MergeNeed[] = [
  { kind: 'conflicts', state: 'met' },
  { kind: 'draft', state: 'met' },
  { kind: 'pushed', state: 'met' },
]

/** On GitHub: a required check failed and one still runs, an approval missing, three commits behind main. */
export const BLOCKED: MergeNeed[] = [
  {
    kind: 'checks',
    state: 'unmet',
    have: 0,
    need: 2,
    who: ['test'],
    required: ['test', 'build'],
    apart: { passed: 1, failed: ['lint'], running: 0 },
  },
  { kind: 'approvals', state: 'unmet', have: 0, need: 1, who: [] },
  { kind: 'changes_requested', state: 'met' },
  { kind: 'up_to_date', state: 'unmet', have: 3 },
  ...tail,
]

/** Its checks passed; a review asked of two people, one a code owners' team, and a conversation open. */
export const WAITING: MergeNeed[] = [
  { kind: 'checks', state: 'met', have: 2, need: 2, required: ['test', 'build'], apart: { passed: 1, failed: [], running: 0 } },
  { kind: 'approvals', state: 'waiting', have: 1, need: 2, who: ['ana', 'meridian/payments'] },
  { kind: 'code_owners', state: 'waiting', who: ['meridian/payments'] },
  { kind: 'changes_requested', state: 'met' },
  { kind: 'conversations', state: 'unmet', have: 2, need: 3 },
  ...tail,
  { kind: 'merge_queue', state: 'met' },
]

/** Everything its host needs: one line, opening to them. */
export const MET: MergeNeed[] = [
  { kind: 'checks', state: 'met', have: 3, need: 3, required: ['test', 'build', 'lint'] },
  { kind: 'approvals', state: 'met', have: 1, need: 1, who: ['ana'] },
  { kind: 'changes_requested', state: 'met' },
  { kind: 'conversations', state: 'met', have: 2, need: 2 },
  { kind: 'up_to_date', state: 'met' },
  ...tail,
  { kind: 'signatures', state: 'met' },
]

/** On Bitbucket, whose restrictions only an admin reads: how many approvals and which builds it needs aren't known, never ticked. */
export const UNKNOWN: MergeNeed[] = [
  { kind: 'checks', state: 'met', have: 3, need: 3 },
  { kind: 'approvals', state: 'unknown', have: 1, who: ['ana'] },
  { kind: 'changes_requested', state: 'unmet', who: ['cy'] },
  { kind: 'up_to_date', state: 'unknown' },
  { kind: 'conflicts', state: 'unknown' },
  { kind: 'draft', state: 'met' },
  { kind: 'pushed', state: 'met' },
]

/** A draft, with commits not pushed, a conflict, unsigned commits, and a rule only its host can read. */
export const ITS_OWN: MergeNeed[] = [
  { kind: 'checks', state: 'waiting', have: 1, need: 3, who: ['build', 'e2e'] },
  { kind: 'conflicts', state: 'unmet' },
  { kind: 'draft', state: 'unmet' },
  { kind: 'pushed', state: 'unmet', have: 2 },
  { kind: 'signatures', state: 'unmet', have: 1 },
  { kind: 'linear_history', state: 'met' },
  { kind: 'other', state: 'unmet' },
]

const meta = {
  title: 'Outputs/MergeNeeds',
  component: MergeNeeds,
  decorators: [(Story) => <div style={{ maxWidth: SIDE }}>{Story()}</div>],
  args: { needs: BLOCKED, host: 'GitHub', target: 'main', checks: CHECKS },
} satisfies Meta<typeof MergeNeeds>
export default meta
type Story = StoryObj<typeof meta>

/** Blocked by a required check, a missing approval and being behind: each crossed, with what to do; the rest one line. */
export const Blocked: Story = {
  play: async ({ canvasElement }) => {
    const list = within(canvasElement)
    await expect(list.getByText('test failed')).toBeVisible()
    await expect(list.getByText('Needs an approval')).toBeVisible()
    await expect(list.getByText('Ask for a review')).toBeVisible()
    await expect(list.getByText('3 commits behind main')).toBeVisible()
    await expect(list.getByText('Update the branch')).toBeVisible()
    await expect(list.getByText('optional lint failed')).toBeVisible()
    await expect(list.getByText('4 more met')).toBeVisible()
  },
}

/** Its checks opened: the required ones first, the optional ones apart. */
export const ChecksOpened: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /test failed/ }))
    await expect(within(canvasElement).getByText('Optional')).toBeVisible()
  },
}

/** Waiting on reviewers, a code owner among them; a conversation open, crossed. */
export const Waiting: Story = { args: { needs: WAITING, checks: PASSED } }

/** All met: one line, which opens to each. */
export const AllMet: Story = {
  args: { needs: MET, checks: PASSED },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /Everything GitHub needs is met/ }))
    await expect(within(canvasElement).getByText('Approved by ana')).toBeVisible()
    await expect(within(canvasElement).getByText('Up to date with main')).toBeVisible()
  },
}

/** What its host doesn't say is not known, never ticked. */
export const NotKnown: Story = {
  args: { needs: UNKNOWN, host: 'Bitbucket', checks: PASSED },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/how many it needs, Bitbucket doesn’t say/)).toBeVisible()
  },
}

/** What Althar knows of it itself: a draft, commits to push, a conflict; and a rule its host holds it to that Althar can't read. */
export const ItsOwn: Story = { args: { needs: ITS_OWN, checks: undefined } }

/** On the change's card, in place of its checks' line, over its review. */
export const OnTheCard: StoryObj<typeof ChangeSet> = {
  render: () => (
    <ChangeSet
      state={ChangeState.Ready}
      host={GITHUB}
      prs={PR_416}
      checks={CHECKS}
      needs={BLOCKED}
      target="main"
      review={{ state: CheckState.Passed, by: [OPUS] }}
      actions={
        <Button variant="signal" onClick={fn()}>
          Accept and merge
        </Button>
      }
      onReviewDiff={fn()}
    />
  ),
}

/** Alone on the page, wide. */
export const OnTheCardAlone: StoryObj<typeof ChangeSet> = {
  decorators: [(Story) => <div style={{ width: 700 }}>{Story()}</div>],
  render: () => (
    <ChangeSet
      state={ChangeState.Ready}
      host={GITHUB}
      prs={PR_416}
      checks={PASSED}
      needs={WAITING}
      target="main"
      review={{ state: CheckState.Passed, by: [OPUS] }}
      actions={
        <Button variant="signal" onClick={fn()}>
          Accept and merge
        </Button>
      }
      onReviewDiff={fn()}
    />
  ),
}
