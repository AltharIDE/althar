import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { OPUS } from '../../fixtures/models'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Markdown } from '../Markdown/Markdown'
import { MergeLine } from '../MergeLine/MergeLine'
import { Round } from '../Round/Round'
import { Thread } from '../Thread/Thread'
import { You } from '../You/You'
import { type MergingRow, MergingLine } from './MergingLine'

/*
 * What is on its way into a branch, as the coordinator's thread shows it at
 * its foot: one line kept current as each pull request moves, opening to a
 * row for each.
 */

const pull = (number: number, title: string, state: MergingRow['state'], reason?: string): MergingRow => ({
  key: `#${number}`,
  label: `#${number}`,
  title,
  url: `https://github.com/meridian/api/pull/${number}`,
  state,
  ...(reason === undefined ? {} : { reason }),
})

/** A merge kept for later, whose pull request isn't open yet: by its task's name. */
const kept = (task: string, once: string): MergingRow => ({ key: task, label: task, title: '', url: null, state: 'waiting', once })

const SENT_BACK = 'The queue’s end-to-end checks failed in homes.spec.ts. Its lead is fixing it.'

const meta = {
  title: 'Thread/MergingLine',
  component: MergingLine,
  decorators: [threadDecorator],
  args: {
    rows: [
      pull(1224, 'Plan card offers Runs on during its countdown too', 'merged'),
      pull(1222, 'A home’s whole experience reviewed and made good', 'queued'),
      pull(1226, 'Keep for later shelves a task without losing it', 'checks'),
      kept('Workers readiness', 'once it’s open, reviewed and green'),
    ],
  },
} satisfies Meta<typeof MergingLine>
export default meta
type Story = StoryObj<typeof meta>

/** Four on their way: one in, one in the queue, one with checks running, one whose pull request isn't open yet. */
export const OnTheirWay: Story = {
  play: async ({ canvasElement }) => {
    const line = within(canvasElement)
    const head = line.getByRole('button', { name: /Merging/ })
    await expect(head).toHaveAttribute('aria-expanded', 'false')
    // Each by its number, and the one with no pull request yet by its task's name, as not in line yet.
    await expect(head).toHaveAccessibleName(
      'Merging: #1224 merged, #1222 in the queue, #1226 checks running, Workers readiness not in line yet',
    )
    await expect(line.queryByRole('list')).toBeNull()
  },
}

/** One sent back by the queue: why stands under the line, in red. */
export const SentBack: Story = {
  args: {
    rows: [
      pull(1224, 'Plan card offers Runs on during its countdown too', 'merged'),
      pull(1222, 'A home’s whole experience reviewed and made good', 'sent_back', SENT_BACK),
      pull(1226, 'Keep for later shelves a task without losing it', 'queued'),
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/#1222 sent back\./)).toBeVisible()
  },
}

/** Opened: a row for each, with its title, what it waits for or why it came back, and where it stands. */
export const Opened: Story = {
  play: async ({ canvasElement }) => {
    const line = within(canvasElement)
    await userEvent.click(line.getByRole('button', { name: /Merging/ }))
    const rows = within(line.getByRole('list'))
    await expect(rows.getByRole('link', { name: /#1222/ })).toHaveAttribute('href', 'https://github.com/meridian/api/pull/1222')
    await expect(rows.getByText('In the queue')).toBeVisible()
    await expect(rows.getByText('Not in line yet')).toBeVisible()
    await expect(rows.getByText('Once it’s open, reviewed and green')).toBeVisible()
  },
}

/** Just one, into a branch of its own. */
export const OneIntoABranch: Story = {
  args: { rows: [pull(1224, 'Plan card offers Runs on during its countdown too', 'checks')], branch: 'release/0.9' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('region', { name: 'Merging into release/0.9' })).toBeVisible()
  },
}

/** The coordinator's thread after "see everything thru to main": the ask, its reply, what was said since, and the line at its foot. */
export const InTheCoordinatorsThread: Story = {
  render: (args) => (
    <Thread label="Thread">
      <You at="16m ago">see everything thru to main</You>
      <Round model={OPUS} at="16m ago">
        <Markdown source="Queuing #1224 and #1222 for merge. The other two get set to merge on their own once they’re ready." />
      </Round>
      <You at="5m ago">anything else waiting on me?</You>
      <Round model={OPUS} at="5m ago">
        <Markdown source="Just the plan for Offline drafts: its countdown ends in 2 minutes unless you hold it." />
      </Round>
      <MergingLine {...args} />
    </Thread>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('region', { name: 'Merging' })).toBeVisible()
  },
}

/** The same, one sent back by the queue: why stands under the line. */
export const SentBackInTheThread: Story = {
  ...InTheCoordinatorsThread,
  args: {
    rows: [
      pull(1224, 'Plan card offers Runs on during its countdown too', 'merged'),
      pull(1222, 'A home’s whole experience reviewed and made good', 'sent_back', SENT_BACK),
      pull(1226, 'Keep for later shelves a task without losing it', 'queued'),
      pull(1231, 'A worker says when it’s ready for work', 'checks'),
    ],
  },
}

/** The same, opened to a row for each. */
export const OpenedInTheThread: Story = { ...InTheCoordinatorsThread, args: { open: true } }

/** All in: no line at the foot, and the reply that asked holds the merge line folded to one line. */
export const AllInTheThread: Story = {
  render: () => (
    <Thread label="Thread">
      <You at="24m ago">see everything thru to main</You>
      <Round model={OPUS} at="24m ago">
        <Markdown source="Queuing #1224 and #1222 for merge. The other two get set to merge on their own once they’re ready." />
      </Round>
      <MergeLine
        rows={[1224, 1222, 1226, 1231].map((number) => ({
          number,
          title: '',
          url: `https://github.com/meridian/api/pull/${number}`,
          state: 'merged' as const,
        }))}
      />
      <You at="13m ago">anything else waiting on me?</You>
      <Round model={OPUS} at="13m ago">
        <Markdown source="Just the plan for Offline drafts: its countdown ends in 2 minutes unless you hold it." />
      </Round>
    </Thread>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('region', { name: 'Merging' })).toBeNull()
  },
}
