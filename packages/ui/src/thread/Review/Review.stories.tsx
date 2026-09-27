import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { FINDINGS, FINDINGS_SETTLED, FINDINGS_SEVERAL_YOURS, FINDINGS_YOURS, PROJECT, reviewDoc, STEPS } from '../../fixtures/meridian'
import { GEMINI_PRO, SONNET } from '../../fixtures/models'
import { FindingState, FindingsReach, StepState, ToolState, Verdict } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Review, type Finding } from './Review'

const INSTRUCTIONS = { path: '.charrette/review.md', ...reviewDoc }
const TWO = [{ model: SONNET }, { model: GEMINI_PRO }]
const ONE_REVIEWER: Finding[] = FINDINGS.filter((f) => f.by.includes(SONNET)).map((f) => ({ ...f, by: [SONNET], against: undefined }))

const meta = {
  title: 'Thread/Review',
  component: Review,
  decorators: [threadDecorator],
  args: {
    n: 3,
    of: 6,
    reviewers: TWO,
    verdict: Verdict.Changes,
    took: '4m 20s',
    thread: STEPS.review,
    project: PROJECT,
    instructions: INSTRUCTIONS,
    onFindingsChange: fn(),
    onReachChange: fn(),
  },
} satisfies Meta<typeof Review>
export default meta
type Story = StoryObj<typeof meta>

/** The usual case: the lead fixed two and set one aside, and nothing waited on you. It opens if you want to check. */
export const Settled: Story = { args: { defaultFindings: FINDINGS_SETTLED } }

/** Opened, to how each finding was settled. */
export const SettledOpen: Story = { args: { defaultFindings: FINDINGS_SETTLED, defaultOpen: true } }

/** The reviewers disagree and nothing settles it, so one finding is yours. The review opens by itself. */
export const OneForYou: Story = {
  args: { defaultFindings: FINDINGS_YOURS },
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Have it fixed' }))
    await waitFor(() => expect(c.getByText('You asked the lead to fix it')).toBeInTheDocument())
    await expect(args.onFindingsChange).toHaveBeenCalled()
    await userEvent.click(c.getByRole('button', { name: 'Undo' }))
    await expect(c.getByText('Needs your call')).toBeInTheDocument()
  },
}

/** More than one call waits on you; each is settled on its own. */
export const SeveralForYou: Story = { args: { defaultFindings: FINDINGS_SEVERAL_YOURS } }

/** Settling one of several leaves the other waiting. */
export const SettlingOneOfSeveral: Story = {
  args: { defaultFindings: FINDINGS_SEVERAL_YOURS },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getAllByText('Needs your call')).toHaveLength(2)
    const [first] = c.getAllByRole('button', { name: 'Have it fixed' })
    if (first) await userEvent.click(first)
    await waitFor(() => expect(c.getAllByText('Needs your call')).toHaveLength(1))
  },
}

/** The project says every finding waits for your pass: each can be fixed, redirected or dismissed, or left to the lead together. */
export const EveryFinding: Story = {
  args: { reviewers: [{ model: SONNET }], took: '4m', thread: STEPS.security, reach: FindingsReach.All, defaultFindings: ONE_REVIEWER },
}

/** Leaving every finding to the lead at once. */
export const LeavingThemToTheLead: Story = {
  args: { reviewers: [{ model: SONNET }], took: '4m', thread: STEPS.security, reach: FindingsReach.All, defaultFindings: ONE_REVIEWER },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Leave them to the lead' }))
    await waitFor(() => expect(c.getAllByText('Left to the lead')).toHaveLength(2))
  },
}

/** Dismissing asks for a reason, which later reviews are told. */
export const Dismissing: Story = {
  args: { defaultFindings: FINDINGS, defaultOpen: true },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const [dismiss] = c.getAllByRole('button', { name: 'Dismiss' })
    if (!dismiss) throw new Error('no Dismiss')
    await userEvent.click(dismiss)
    await userEvent.click(c.getByRole('button', { name: 'Add a reason' }))
    await userEvent.type(c.getByRole('textbox'), 'Replays are rare enough')
    await userEvent.click(c.getByRole('button', { name: 'Save' }))
    await expect(c.getByText('Replays are rare enough')).toBeInTheDocument()
  },
}

/** Both reviewers at work, then combining. */
export const Running: Story = {
  args: {
    state: StepState.Running,
    verdict: undefined,
    reviewers: [
      { model: SONNET, state: ToolState.Done, meta: 'done · 2 findings · 3m 50s' },
      { model: GEMINI_PRO, state: ToolState.Running, meta: 'reading src/refunds/router.ts · 2m 10s' },
    ],
  },
}

/** A second round, after the lead's fixes: it passed. */
export const Passed: Story = { args: { verdict: Verdict.Pass, round: 2, defaultFindings: [], reviewers: [{ model: SONNET }], took: '2m' } }

/** Every way a finding can stand, in one list. */
const EVERY: Finding[] = [
  { ...FINDINGS[0]!, id: 'a', state: FindingState.Lead, was: FindingState.Open },
  { ...FINDINGS[1]!, id: 'b', state: FindingState.ToFix, was: FindingState.Yours },
  { ...FINDINGS[2]!, id: 'c', state: FindingState.Told, told: 'Keep the shared bucket; add a note to the partner docs.' },
  { ...FINDINGS[0]!, id: 'd', state: FindingState.Fixed, round: 2 },
  { ...FINDINGS[1]!, id: 'e', state: FindingState.Aside, reason: 'The spec says one budget per partner.' },
  { ...FINDINGS[2]!, id: 'f', state: FindingState.Dismissed },
  { ...FINDINGS[2]!, id: 'g', state: FindingState.Dismissed, reason: 'Fake timers are already on for this suite.' },
]

export const AllStates: Story = {
  parameters: statesOn({
    hover: 'li:first-child',
    focus: 'li:first-child button:first-of-type',
    pressed: 'li:first-child button:first-of-type',
  }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'settled', node: <Review {...args} defaultFindings={FINDINGS_SETTLED} /> },
        { state: 'settled, open', node: <Review {...args} defaultFindings={FINDINGS_SETTLED} defaultOpen /> },
        { state: 'one for you', node: <Review {...args} defaultFindings={FINDINGS_YOURS} /> },
        { state: 'several for you', node: <Review {...args} {...SeveralForYou.args} /> },
        { state: 'every finding waits', node: <Review {...args} {...EveryFinding.args} /> },
        { state: 'running', node: <Review {...args} {...Running.args} /> },
        { state: 'passed, round 2', node: <Review {...args} {...Passed.args} /> },
        { state: 'each finding state', node: <Review {...args} defaultFindings={EVERY} defaultOpen /> },
        { state: 'finding, hover', force: 'hover', node: <Review {...args} defaultFindings={FINDINGS} defaultOpen /> },
        {
          state: 'no instructions, no thread',
          node: <Review {...args} defaultFindings={FINDINGS} defaultOpen instructions={undefined} thread={undefined} />,
        },
      ]}
    />
  ),
}
