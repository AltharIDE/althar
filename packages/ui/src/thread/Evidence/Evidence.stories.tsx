import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { EvidenceKind } from '../../foundations/vocabulary'
import { SHOT_AFTER, SHOT_BEFORE, SHOT_NOT_KEPT } from '../../fixtures/shots'
import { States, statesOn } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Evidence, type EvidencePiece } from './Evidence'

const TESTS: EvidencePiece = {
  id: 'tests',
  kind: EvidenceKind.TestRun,
  caption: 'The refund tests, with the new refused case',
  form: 'output',
  command: 'bun run test refunds',
  exit: 0,
  lines: [' ✓ refunds a paid order', ' ✓ refuses a refund past 30 days', '', ' Test Files  1 passed (1)', '      Tests  2 passed (2)'],
}
const LINT: EvidencePiece = {
  id: 'lint',
  kind: EvidenceKind.Command,
  caption: 'Lint and types',
  form: 'output',
  command: 'bun run check',
  exit: 0,
  lines: ['Found 0 errors in 118 files'],
}
const FAILED: EvidencePiece = {
  id: 'e2e',
  kind: EvidenceKind.TestRun,
  caption: 'The end-to-end refund flow',
  form: 'output',
  command: 'bun run test:e2e refunds',
  exit: 1,
  lines: [' ✗ refund flow › shows the reason', '   Error: locator resolved to hidden <p>', '', ' 1 failed'],
}
const RESPONSE: EvidencePiece = {
  id: 'response',
  kind: EvidenceKind.Response,
  caption: 'POST /refunds past 30 days answers 422 with the reason',
  form: 'output',
  lines: ['HTTP/1.1 422 Unprocessable Entity', '{ "error": "refund_window_closed", "days": 34 }'],
}
const NOTE: EvidencePiece = {
  id: 'note',
  kind: EvidenceKind.Note,
  caption: 'Nothing else on the page moved',
  form: 'note',
  text: 'Compared the order page before and after at 1440 and 390 wide.',
}
const BUMP: EvidencePiece = { id: 'bump', kind: EvidenceKind.Note, caption: 'A version bump: nothing to show', form: 'note' }
const NOT_KEPT: EvidencePiece = {
  id: 'gone',
  kind: EvidenceKind.Screenshot,
  caption: 'The whole page',
  form: 'picture',
  shot: SHOT_NOT_KEPT,
}
const SHOTS: EvidencePiece[] = [
  { id: 'before', kind: EvidenceKind.Screenshot, caption: 'Before: the refund button with no reason', form: 'picture', shot: SHOT_BEFORE },
  { id: 'after', kind: EvidenceKind.Screenshot, caption: 'After: the reason under the refused refund', form: 'picture', shot: SHOT_AFTER },
]
const UNVERIFIED = ['Not tried against the live payment provider: no sandbox account here', 'Not seen in Safari']

const meta = {
  title: 'Thread/Evidence',
  component: Evidence,
  decorators: [threadDecorator],
  args: { pieces: [...SHOTS, TESTS, LINT, NOTE], unverified: UNVERIFIED },
} satisfies Meta<typeof Evidence>
export default meta
type Story = StoryObj<typeof meta>

/** Screenshots of the states it changed, the tests it ran, a note, and what it couldn't show. */
export const Shown: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('heading', { name: 'Evidence' })).toBeInTheDocument()
    await expect(c.getByRole('heading', { name: 'Unverified' })).toBeInTheDocument()
    const tests = c.getByRole('button', { name: 'What it printed: The refund tests, with the new refused case' })
    await expect(tests).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(tests)
    await expect(tests).toHaveAttribute('aria-expanded', 'true')
    await expect(c.getByText('bun run test refunds')).toBeVisible()
    // A screenshot opens full size, with the other a key away.
    await userEvent.click(c.getByRole('button', { name: /View After: the reason/ }))
    const page = within(canvasElement.ownerDocument.body)
    await expect(await page.findByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('dialog')).not.toBeInTheDocument())
  },
}

/** A run that failed says so on its row, in red. */
export const FailedRun: Story = { args: { pieces: [FAILED, TESTS], unverified: [] } }

/** Behind the screen: a response and a run, no pictures. */
export const NoPictures: Story = { args: { pieces: [RESPONSE, TESTS], unverified: [] } }

/** Where nothing fits, a single note says so. */
export const NothingToShow: Story = { args: { pieces: [BUMP], unverified: [] } }

/** It couldn't show anything working: the list of what is still the person's to check stands alone. */
export const OnlyUnverified: Story = {
  args: { pieces: [], unverified: UNVERIFIED },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('heading', { name: 'Evidence' })).not.toBeInTheDocument()
    await expect(c.getAllByRole('listitem')).toHaveLength(2)
  },
}

/** A screenshot Althar couldn't keep says why, and doesn't open. */
export const PictureNotKept: Story = { args: { pieces: [NOT_KEPT], unverified: [] } }

/** A long run shows its end; what came before is a click away, and what wasn't kept is counted. */
export const LongOutput: Story = {
  args: {
    pieces: [
      {
        id: 'long',
        kind: EvidenceKind.TestRun,
        caption: 'The whole suite',
        form: 'output',
        command: 'bun run test',
        exit: 0,
        lines: [' Test Files  212 passed (212)', '      Tests  1840 passed (1840)'],
        earlier: Array.from({ length: 40 }, (_, index) => ` ✓ case ${index + 1}`),
        omitted: 1200,
      },
    ],
    unverified: [],
  },
}

/** Nothing shown and nothing unverified: nothing is drawn. */
export const Empty: Story = {
  args: { pieces: [], unverified: [] },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('section')).toBeNull()
  },
}

export const AllStates: Story = {
  parameters: statesOn({ hover: 'li:first-child button', focus: 'li:first-child button', pressed: 'li:first-child button' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'shown', node: <Evidence {...args} /> },
        { state: 'failed run', node: <Evidence pieces={[FAILED, TESTS]} /> },
        { state: 'no pictures', node: <Evidence pieces={[RESPONSE, LINT]} /> },
        { state: 'nothing to show', node: <Evidence pieces={[BUMP]} /> },
        { state: 'only unverified', node: <Evidence pieces={[]} unverified={UNVERIFIED} /> },
        { state: 'not kept', node: <Evidence pieces={[NOT_KEPT]} /> },
        { state: 'hover', node: <Evidence pieces={[TESTS, LINT]} /> },
        { state: 'focus', node: <Evidence pieces={[TESTS, LINT]} /> },
        { state: 'pressed', node: <Evidence pieces={[TESTS, LINT]} /> },
        { state: 'dark', node: <Evidence {...args} />, dark: true },
      ]}
    />
  ),
}
