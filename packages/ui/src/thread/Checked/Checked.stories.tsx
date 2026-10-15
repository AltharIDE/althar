import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { EvidenceKind } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import type { EvidencePiece } from '../Evidence/Evidence'
import { Checked } from './Checked'

const TESTS: EvidencePiece = {
  id: 'tests',
  kind: EvidenceKind.TestRun,
  caption: 'The refund tests, with the new refused case',
  form: 'output',
  command: 'bun run test refunds',
  exit: 0,
  lines: [' ✓ refunds a paid order', ' ✓ refuses a refund past 30 days', '', '      Tests  2 passed (2)'],
}
const FAILED: EvidencePiece = {
  id: 'e2e',
  kind: EvidenceKind.TestRun,
  caption: 'The end-to-end refund flow',
  form: 'output',
  command: 'bun run test:e2e refunds',
  exit: 1,
  lines: [' ✗ refund flow › shows the reason', ' 1 failed'],
}
const NOTE: EvidencePiece = {
  id: 'note',
  kind: EvidenceKind.Note,
  caption: 'Nothing else on the page moved',
  form: 'note',
  text: 'Compared at 1440 and 390 wide.',
}
const BUMP: EvidencePiece = { id: 'bump', kind: EvidenceKind.Note, caption: 'A version bump: nothing to show', form: 'note' }
const UNVERIFIED = ['Not tried against the live payment provider: no sandbox account here', 'Not seen in Safari']

const meta = {
  title: 'Thread/Checked',
  component: Checked,
  decorators: [threadDecorator],
  args: { pieces: [TESTS, NOTE], unverified: UNVERIFIED },
} satisfies Meta<typeof Checked>
export default meta
type Story = StoryObj<typeof meta>

/** What it checked, a line each opening to what it printed, and what it couldn't. */
export const Shown: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const tests = c.getByRole('button', { name: 'What it printed: The refund tests, with the new refused case' })
    await userEvent.click(tests)
    await waitFor(() => expect(c.getByText(/bun run test refunds/)).toBeVisible())
    await expect(c.getByText('Not checked')).toBeInTheDocument()
  },
}

/** A run that failed is crossed. */
export const Failed: Story = { args: { pieces: [FAILED, TESTS], unverified: [] } }

/** A note with nothing more to say doesn't open. */
export const NothingToOpen: Story = { args: { pieces: [BUMP], unverified: [] } }

/** Only what it couldn't check. */
export const OnlyUnchecked: Story = { args: { pieces: [], unverified: UNVERIFIED } }

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button', focus: 'button', pressed: 'button' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'shown', node: <Checked {...args} /> },
        { state: 'failed', node: <Checked pieces={[FAILED, TESTS]} /> },
        { state: 'nothing to open', node: <Checked pieces={[BUMP]} /> },
        { state: 'only unchecked', node: <Checked pieces={[]} unverified={UNVERIFIED} /> },
        { state: 'hover', node: <Checked pieces={[TESTS]} /> },
        { state: 'focus', node: <Checked pieces={[TESTS]} /> },
        { state: 'pressed', node: <Checked pieces={[TESTS]} /> },
        { state: 'dark', node: <Checked {...args} />, dark: true },
      ]}
    />
  ),
}
