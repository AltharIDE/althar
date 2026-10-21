import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { TaskKind, TaskStatus } from '../../foundations/vocabulary'
import {
  CHANGE_CONFLICT,
  CHANGE_PERMISSION,
  CHANGE_QUESTION,
  CHANGE_QUEUED,
  CHANGE_QUEUED_MIDWAY,
  CHANGE_READY,
  CHANGE_RUNNING,
  CHANGE_RUNNING_PR,
  CHANGE_STOPPED,
  CHANGE_STUCK,
  KIND_CARDS,
  PLAIN_FILES,
  PLAIN_FINISHED,
  PLAIN_PICTURES,
  PLAIN_PICTURES_MAKING,
  PLAIN_WORKING,
  REVIEW_DRAFTED,
  REVIEW_RUNNING,
} from '../../fixtures/kinds'
import { States, statesOn } from '../../storybook/States'
import { cardStates, laneDecorator } from '../../storybook/lane'
import { BoardCard } from './BoardCard'

const meta = {
  title: 'Board/BoardCard',
  component: BoardCard,
  decorators: [laneDecorator],
  // What every card has; the rest is each story's own, so none carries another's track or chip.
  args: {
    status: TaskStatus.Running,
    word: CHANGE_RUNNING.word,
    kind: TaskKind.Change,
    at: '9m',
    title: CHANGE_RUNNING.title,
    onOpen: fn(),
  },
} satisfies Meta<typeof BoardCard>
export default meta
type Story = StoryObj<typeof meta>

/** A change at work: its step in cobalt, its kind, its steps, and its branch with how big it is so far. */
export const ChangeRunning: Story = {
  args: CHANGE_RUNNING,
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    // Its step's word, on top and under its bar.
    await expect(card.getAllByText('Implement')).toHaveLength(2)
    await expect(card.getByText('Change')).toBeInTheDocument()
    await expect(card.getByRole('list', { name: 'Steps' })).toBeInTheDocument()
    await expect(card.getByText('meridian/return-409-on-reused-idempotency-key')).toBeInTheDocument()
    // Nothing on it is pressed but the card itself.
    await expect(card.getAllByRole('button')).toHaveLength(1)
  },
}
/** A follow-up on a change whose pull request is open: the pull request, and its checks so far. */
export const ChangeRunningWithItsPullRequest: Story = { args: CHANGE_RUNNING_PR }
export const ReadyToAccept: Story = {
  args: CHANGE_READY,
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expect(card.getByText('Ready to accept')).toBeInTheDocument()
    await expect(card.getByText('#1187')).toBeInTheDocument()
    await expect(card.getByText('All 8 checks passed')).toBeInTheDocument()
    await expect(card.queryByText(/Review/)).not.toBeInTheDocument()
  },
}
/** A conflict its lead couldn't resolve: warm, with a glyph, and why under the title. */
export const MergeConflict: Story = { args: CHANGE_CONFLICT }
export const Permission: Story = {
  args: CHANGE_PERMISSION,
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expect(card.getByText(/staging database/)).toBeInTheDocument()
    await expect(card.getByText(/backfill-idempotency/)).toBeInTheDocument()
    // Answered in its task: no Allow here.
    await expect(card.queryByText('Allow')).not.toBeInTheDocument()
  },
}
export const Question: Story = { args: CHANGE_QUESTION }
export const Stuck: Story = { args: CHANGE_STUCK }
export const ReviewRunning: Story = {
  args: REVIEW_RUNNING,
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    // Someone else's pull request: its number whole, and whose it is.
    await expect(card.getByText('#1202')).toBeInTheDocument()
    await expect(card.getByText('okafor-dev')).toBeInTheDocument()
    await expect(card.getByText('Review')).toBeInTheDocument()
  },
}
export const ReviewDrafted: Story = {
  args: REVIEW_DRAFTED,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('3 findings')).toBeInTheDocument()
  },
}
/** A plain task says where it stands and nothing of its kind. */
export const PlainWorking: Story = {
  args: PLAIN_WORKING,
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expect(card.getByText('Working')).toBeInTheDocument()
    await expect(card.queryByText('Change')).not.toBeInTheDocument()
    await expect(card.queryByRole('list', { name: 'Steps' })).not.toBeInTheDocument()
  },
}
export const PlainFinished: Story = { args: PLAIN_FINISHED }
export const PlainWithPictures: Story = {
  args: PLAIN_PICTURES,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByRole('img')).toHaveLength(3)
  },
}
/** One of its pictures still being made, in its place. */
export const PlainWithAPictureBeingMade: Story = {
  args: PLAIN_PICTURES_MAKING,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Being made')).toBeInTheDocument()
  },
}
export const PlainWithFiles: Story = {
  args: PLAIN_FILES,
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    // The name whole, and the folder before it, which gives way first.
    await expect(card.getByText('release-notes-0.4.md')).toBeInTheDocument()
    await expect(card.getByText('docs/releases/partners/')).toBeInTheDocument()
  },
}
/** Waiting for a free agent before any work: only its title, its status and why. */
export const WaitingForAnAgent: Story = { args: CHANGE_QUEUED }
/** Waiting for a free agent after real work: its done steps and branch stay, and the step it waits for is empty and still. */
export const WaitingForAnAgentMidway: Story = { args: CHANGE_QUEUED_MIDWAY }
export const Stopped: Story = { args: CHANGE_STOPPED }
export const Current: Story = { args: { current: true } }
export const LongTitle: Story = {
  args: {
    title: 'Return 409 when a refund idempotency key is reused across partners, and say which partner reused it first in the response body',
  },
}
/** The kinds' words, in another language. */
export const Translated: Story = {
  args: {
    ...REVIEW_RUNNING,
    kind: TaskKind.Review,
    text: { kind: { [TaskKind.Change]: 'Änderung', [TaskKind.Review]: 'Prüfung', [TaskKind.Plain]: '' } },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Prüfung')).toBeInTheDocument()
  },
}

export const Opening: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: CHANGE_RUNNING.title }))
    await expect(args.onOpen).toHaveBeenCalledOnce()
  },
}

/** Without a way to open it, its title is words, and nothing on it is a button. */
export const NothingOpensIt: Story = {
  args: { onOpen: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button')).not.toBeInTheDocument()
  },
}

/** A task an automation's run started: which one, quietly, at its foot. Still nothing to press but the card. */
export const FromAnAutomation: Story = {
  args: { ...REVIEW_RUNNING, from: 'Morning review' },
  play: async ({ canvasElement }) => {
    const card = within(canvasElement)
    await expect(card.getByText('From Morning review')).toBeInTheDocument()
    await expect(card.getAllByRole('button')).toHaveLength(1)
  },
}

export const AllStates: Story = {
  parameters: statesOn(cardStates),
  render: (args) => (
    <States
      size="wide"
      cells={[
        ...KIND_CARDS.map(({ id, card }) => ({ state: id, node: <BoardCard {...card} onOpen={args.onOpen} /> })),
        { state: 'done', node: <BoardCard {...args} status={TaskStatus.Done} word="Done" /> },
        { state: 'current', node: <BoardCard {...args} current /> },
        { state: 'from an automation', node: <BoardCard {...args} from="Nightly bump" /> },
        { state: 'nothing opens it', node: <BoardCard {...args} onOpen={undefined} /> },
        { state: 'hover', node: <BoardCard {...args} /> },
        { state: 'focus', node: <BoardCard {...args} /> },
        { state: 'pressed', node: <BoardCard {...args} /> },
      ]}
    />
  ),
}
