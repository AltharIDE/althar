import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { SETTLED } from '../../fixtures/board'
import { Outcome } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { BoardList } from '../Board/Board'
import { cardStates, laneDecorator, listDecorator } from '../../storybook/lane'
import { SettledRow } from './SettledRow'

const of = (outcome: Outcome) => SETTLED.find((x) => x.outcome === outcome) ?? SETTLED[0]!

const meta = {
  title: 'Board/SettledRow',
  component: SettledRow,
  decorators: [listDecorator, laneDecorator],
  args: { ...of(Outcome.Merged), onOpen: fn() },
} satisfies Meta<typeof SettledRow>
export default meta
type Story = StoryObj<typeof meta>

export const Merged: Story = {}
/** Finished without a merge: a conversation that ended, a change taken some other way. In ink, not green. */
export const Done: Story = { args: of(Outcome.Done) }
export const Answered: Story = { args: of(Outcome.Answered) }
export const Artifact: Story = { args: of(Outcome.Artifact) }
export const Knowledge: Story = { args: of(Outcome.Knowledge) }
/** Given up on: quieter, with the reasoning kept. */
export const Abandoned: Story = { args: of(Outcome.Abandoned) }
export const Current: Story = { args: { current: true } }
/** Abandoned with its pull request still open on its host: it says so, and offers to close it there. */
export const AbandonedPullRequestOpen: Story = {
  args: {
    ...of(Outcome.Abandoned),
    kind: 'Change',
    title: 'Prototype the board’s settled lane',
    meta: 'PR #145 still open',
    action: { label: 'Close PR #145', onAction: fn() },
  },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Close PR #145' }))
    await expect(args.action?.onAction).toHaveBeenCalledOnce()
    // Pressing it doesn't open the task.
    await expect(args.onOpen).not.toHaveBeenCalled()
  },
}
/** Closing it. */
export const ClosingPullRequest: Story = {
  args: { ...AbandonedPullRequestOpen.args, action: { label: 'Close PR #145', onAction: fn(), busy: true } },
}
/** The host said no: it stays open, and says why. */
export const CloseFailed: Story = {
  args: {
    ...AbandonedPullRequestOpen.args,
    error: 'GitHub won’t let this account do that: Resource not accessible by integration.',
  },
}
/** Closed on its host: said, with nothing left to do. */
export const AbandonedPullRequestClosed: Story = {
  args: { ...AbandonedPullRequestOpen.args, meta: 'PR #145 closed', action: undefined },
}

/** The ledger, newest first. */
export const Ledger: Story = {
  render: (args) => (
    <>
      {SETTLED.map((x) => (
        <SettledRow key={x.task} {...args} {...x} />
      ))}
    </>
  ),
}

export const Opening: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: of(Outcome.Merged).title }))
    await expect(args.onOpen).toHaveBeenCalledOnce()
  },
}

export const AllStates: Story = {
  parameters: statesOn(cardStates),
  render: (args) => (
    <States
      size="wide"
      cells={[
        ...Object.values(Outcome).map((o) => ({ state: o, node: <SettledRow {...args} {...of(o)} /> })),
        { state: 'current', node: <SettledRow {...args} current /> },
        { state: 'hover', node: <SettledRow {...args} /> },
        { state: 'focus', node: <SettledRow {...args} /> },
      ].map((c) => ({ ...c, node: <BoardList>{c.node}</BoardList> }))}
    />
  ),
}
