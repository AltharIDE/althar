import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { OPUS, SONNET } from '../../fixtures/models'
import { TaskStatus } from '../../foundations/vocabulary'
import { Markdown } from '../Markdown/Markdown'
import { Round } from '../Round/Round'
import { Thread } from '../Thread/Thread'
import { You } from '../You/You'
import { States } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { StartedTask, type StartedTaskProps } from './StartedTask'

/*
 * A task a lead started (ADR-097), as its parent's thread shows it: one chip
 * that the host keeps current, so planned, working, waiting on the person,
 * merged, done and abandoned are the same chip at different times.
 */

const TITLE = 'Review after merge: major only, or skipped, as a setting'

const meta = {
  title: 'Thread/StartedTask',
  component: StartedTask,
  decorators: [threadDecorator],
  args: { title: TITLE, tone: TaskStatus.Running, word: 'Implementing', model: OPUS, onClick: fn() },
} satisfies Meta<typeof StartedTask>
export default meta
type Story = StoryObj<typeof meta>

/** Planned: its plan counts down to starting on its own, and the person can still hold it. */
export const Planned: Story = {
  args: { tone: TaskStatus.Queued, word: 'Planned', detail: 'Starts in 18s' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: new RegExp(TITLE) })).toBeVisible()
    await expect(within(canvasElement).getByText('Starts in 18s')).toBeVisible()
  },
}

/** At work: its lead's model on the right. */
export const Working: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: new RegExp(TITLE) }))
    await expect(args.onClick).toHaveBeenCalled()
  },
}

/** Something in it waits on the person: violet, like every ask. */
export const NeedsYou: Story = {
  args: { tone: TaskStatus.Yours, word: 'Needs you', detail: 'Permission' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Needs you')).toBeVisible()
  },
}

/** Its pull request is open: its number and what its checks say. */
export const PullRequestOpen: Story = {
  args: { word: 'Ready to accept', tone: TaskStatus.Yours, detail: '#812 · checks pass' },
}

/** Its pull request merged. */
export const Merged: Story = {
  args: { tone: 'merged', word: 'Merged', detail: '#812' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Merged')).toBeVisible()
  },
}

/** Settled with nothing to merge: a prototype, a question. */
export const Done: Story = { args: { tone: TaskStatus.Done, word: 'Done', model: SONNET } }

/** The person abandoned it: the board's word for it, quiet. */
export const Abandoned: Story = {
  args: { tone: 'abandoned', word: 'Abandoned' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Abandoned')).toBeVisible()
  },
}

/** A prototype's thread where its lead drafted and started a task: its words, then the chip, which follows the task. */
export const InAParentsThread: Story = {
  render: (args) => (
    <Thread label="Thread">
      <You at="22m ago">Should a review after a merge only come back for something major? Try it in the prototype.</You>
      <Round model={OPUS} at="21m ago">
        <Markdown source="I’ve made B the default on the prototype page, and started a task to build the review setting for real." />
      </Round>
      <StartedTask {...args} tone={TaskStatus.Running} word="Implementing" />
      <Round model={OPUS} at="21m ago">
        <Markdown source="It drafted and planned itself: Opus 5.5 leads it and GPT-6.1 Sol reviews it. It starts on its own unless you hold it. The page is at the address above, and the real card hasn’t changed yet." />
      </Round>
    </Thread>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: new RegExp(TITLE) })).toBeVisible()
  },
}

const cells: ReadonlyArray<readonly [string, Partial<StartedTaskProps>]> = [
  ['planned', { tone: TaskStatus.Queued, word: 'Planned', detail: 'Starts in 18s' }],
  ['working', {}],
  ['needs you', { tone: TaskStatus.Yours, word: 'Needs you', detail: 'Permission' }],
  ['pull request open', { tone: TaskStatus.Yours, word: 'Ready to accept', detail: '#812 · checks pass' }],
  ['merged', { tone: 'merged', word: 'Merged', detail: '#812' }],
  ['done', { tone: TaskStatus.Done, word: 'Done', model: SONNET }],
  ['abandoned', { tone: 'abandoned', word: 'Abandoned' }],
]

/** Each state the chip is in as the task moves, in the theme the toolbar picks. */
export const AllStates: Story = {
  render: (args) => <States size="thread" cells={cells.map(([state, over]) => ({ state, node: <StartedTask {...args} {...over} /> }))} />,
}
