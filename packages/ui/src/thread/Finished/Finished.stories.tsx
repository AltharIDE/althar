import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { EvidenceKind } from '../../foundations/vocabulary'
import { SHOT_AFTER, SHOT_BEFORE } from '../../fixtures/shots'
import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import type { EvidencePiece } from '../Evidence/Evidence'
import { Finished } from './Finished'

const BUILT = [
  'A refused refund now says why, under the refund button: past 30 days, or already refunded.',
  '',
  '- The reason comes from the refunds API, in `api/refunds.ts`, and shows in `OrderPage.tsx`.',
  "- The screenshots aren't in the pull request: they're in Althar, on the task.",
  '- Try a refund on an order older than 30 days, then push.',
].join('\n')
const PIECES: EvidencePiece[] = [
  { id: 'before', kind: EvidenceKind.Screenshot, caption: 'Before: the refund button with no reason', form: 'picture', shot: SHOT_BEFORE },
  { id: 'after', kind: EvidenceKind.Screenshot, caption: 'After: the reason under the refused refund', form: 'picture', shot: SHOT_AFTER },
  {
    id: 'tests',
    kind: EvidenceKind.TestRun,
    caption: 'The refund tests, with the new refused case',
    form: 'output',
    command: 'bun run test refunds',
    exit: 0,
    lines: [' Test Files  1 passed (1)', '      Tests  2 passed (2)'],
  },
]
const UNVERIFIED = ['Not tried against the live payment provider: no sandbox account here']

const meta = {
  title: 'Thread/Finished',
  component: Finished,
  decorators: [threadDecorator],
  args: { built: BUILT, pieces: PIECES, unverified: UNVERIFIED },
} satisfies Meta<typeof Finished>
export default meta
type Story = StoryObj<typeof meta>

/** What the task built, then the proof, then what is still the person's to check: one finished view. */
export const Shown: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    const headings = c.getAllByRole('heading').map((heading) => heading.textContent)
    await expect(headings).toEqual(['What it built', 'Evidence', 'Unverified'])
    await expect(c.getByRole('article', { name: 'What the task built' })).toBeInTheDocument()
  },
}

/** A prototype: what it made and where to see it, with nothing else to show. */
export const Prototype: Story = {
  args: {
    built: 'A clickable prototype of the new onboarding, three screens long. Open http://localhost:5173 to try it.',
    pieces: [],
    unverified: [],
  },
}

export const AllStates: Story = {
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'shown', node: <Finished {...args} /> },
        { state: 'only built', node: <Finished built={args.built} pieces={[]} /> },
        { state: 'dark', node: <Finished {...args} />, dark: true },
      ]}
    />
  ),
}
