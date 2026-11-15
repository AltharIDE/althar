import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { OPUS } from '../../fixtures/models'
import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Markdown } from '../Markdown/Markdown'
import { Round } from '../Round/Round'
import { Thread } from '../Thread/Thread'
import { You } from '../You/You'
import { MergeLine, type MergeLineRow } from './MergeLine'

/*
 * The merge line for a branch, as the coordinator's thread shows it: one card
 * that is drawn again as each pull request moves, and folds to one line once
 * all have merged.
 */

const pull = (number: number, title: string, state: MergeLineRow['state'], reason?: string): MergeLineRow => ({
  number,
  title,
  state,
  url: `https://github.com/meridian/api/pull/${number}`,
  ...(reason === undefined ? {} : { reason }),
})

const meta = {
  title: 'Thread/MergeLine',
  component: MergeLine,
  decorators: [threadDecorator],
  args: {
    rows: [
      pull(778, 'Follow-up PRs say what they do', 'merged'),
      pull(783, 'The model picker shows a change at once', 'queued'),
      pull(773, 'Board cards show handed-back pictures', 'checks'),
      pull(779, 'A queued task can be held', 'waiting'),
    ],
  },
} satisfies Meta<typeof MergeLine>
export default meta
type Story = StoryObj<typeof meta>

/** Four in the line: one landed, one in the host's queue, one with checks running, one behind them. */
export const FourInTheLine: Story = {
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expect(card.getByRole('link', { name: /#778/ })).toHaveAttribute('href', 'https://github.com/meridian/api/pull/778')
    await expect(card.getByText('Merged')).toBeVisible()
    await expect(card.getByText('In the queue')).toBeVisible()
    await expect(card.getByText('Checks running')).toBeVisible()
    await expect(card.getByText('Waiting')).toBeVisible()
  },
}

/** Asked for, and behind the first: nothing is running yet. */
export const Waiting: Story = {
  args: { rows: [pull(779, 'A queued task can be held', 'waiting'), pull(780, 'Plan card loses clutter', 'waiting')] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByText('Waiting')).toHaveLength(2)
  },
}

/** Its checks are running. */
export const ChecksRunning: Story = {
  args: { rows: [pull(773, 'Board cards show handed-back pictures', 'checks')] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Checks running')).toBeVisible()
  },
}

/** In the host's merge queue, which tests and merges each in turn. */
export const InTheQueue: Story = {
  args: {
    rows: [pull(783, 'The model picker shows a change at once', 'queued'), pull(773, 'Board cards show handed-back pictures', 'queued')],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByText('In the queue')).toHaveLength(2)
  },
}

/** Sent back, with what is wrong and who settles it, under its title. */
export const SentBack: Story = {
  args: {
    rows: [
      pull(778, 'Follow-up PRs say what they do', 'merged'),
      pull(773, 'Board cards show handed-back pictures', 'sent_back', 'Checks failed. It goes back in once they pass.'),
      pull(779, 'A queued task can be held', 'waiting'),
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Sent back')).toBeVisible()
    await expect(within(canvasElement).getByText(/Checks failed/)).toBeVisible()
  },
}

/** A conflict with the branch: its task's lead settles it, and the line goes on without it. */
export const Conflict: Story = {
  args: {
    rows: [
      pull(773, 'Board cards show handed-back pictures', 'conflict', 'Conflicts with the branch. Its task’s lead settles it.'),
      pull(779, 'A queued task can be held', 'checks'),
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Conflict')).toBeVisible()
  },
}

/** Every one has landed: the card folds to one line, each number still a link. */
export const AllMerged: Story = {
  args: {
    rows: [
      pull(778, 'Follow-up PRs say what they do', 'merged'),
      pull(783, 'The model picker shows a change at once', 'merged'),
      pull(773, 'Board cards show handed-back pictures', 'merged'),
      pull(779, 'A queued task can be held', 'merged'),
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/Merged/)).toBeVisible()
    await expect(within(canvasElement).getAllByRole('link')).toHaveLength(4)
    await expect(within(canvasElement).queryByText('Waiting')).toBeNull()
  },
}

/** A branch that isn't the repository's default is named. */
export const OnAnotherBranch: Story = {
  args: { branch: 'release/2.4', rows: [pull(802, 'Backport the retry fix', 'checks'), pull(803, 'Backport the picker fix', 'waiting')] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('release/2.4')).toBeVisible()
  },
}

/** The coordinator's thread with four in the line: the person's ask, its reply, and the card, which is not said again as it moves. */
export const InTheCoordinatorsThread: Story = {
  render: (args) => (
    <Thread label="Thread">
      <You at="9m ago">Merge #778, #783, #773 and #779 once they’re green.</You>
      <Round model={OPUS} at="9m ago">
        <Markdown source="Asked for all four. They go in this order, each brought up to date and green first." />
      </Round>
      <MergeLine {...args} />
    </Thread>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('region', { name: 'Merge line' })).toBeVisible()
  },
}

const cells: ReadonlyArray<readonly [string, ReadonlyArray<MergeLineRow>]> = [
  ['waiting', [pull(779, 'A queued task can be held', 'waiting')]],
  ['checks running', [pull(773, 'Board cards show handed-back pictures', 'checks')]],
  ['in the queue', [pull(783, 'The model picker shows a change at once', 'queued')]],
  ['merging', [pull(778, 'Follow-up PRs say what they do', 'merging')]],
  ['sent back', [pull(773, 'Board cards show handed-back pictures', 'sent_back', 'Checks failed. It goes back in once they pass.')]],
  ['conflict', [pull(773, 'Board cards show handed-back pictures', 'conflict', 'Conflicts with the branch. Its task’s lead settles it.')]],
  ['all merged', [pull(778, 'Follow-up PRs say what they do', 'merged'), pull(783, 'The model picker shows a change at once', 'merged')]],
]

/** Each state, in the theme the toolbar picks. */
export const AllStates: Story = {
  render: () => <States size="thread" cells={cells.map(([state, rows]) => ({ state, node: <MergeLine rows={rows} /> }))} />,
}
