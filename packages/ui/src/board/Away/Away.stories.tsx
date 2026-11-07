import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Away, type AwayAct } from './Away'

const ACTS: ReadonlyArray<AwayAct> = [
  { id: 'merge2', kind: 'merge', what: 'Merged #634 into main', task: 'Tabs keep their order', at: '13:10', undo: 'Revert it' },
  { id: 'post', kind: 'post', what: 'Posted a review on dana’s #612', task: 'Design review of #612', at: '12:52', cant: 'dana replied' },
  { id: 'move', kind: 'issue', what: 'Moved DEV-188 to In Review', task: 'Design review of #612', at: '12:52', undo: 'Undo' },
  { id: 'start', kind: 'start', what: 'Started 2 tasks', task: 'ADR: agents work as yours', at: '12:40' },
  {
    id: 'merge',
    kind: 'merge',
    what: 'Merged #633 into main',
    task: 'Plan usage in the bar',
    at: '12:20',
    cant: 'Released in 0.8.4',
    undo: 'Revert it',
  },
]

const meta = {
  title: 'Board/Away',
  component: Away,
  decorators: [(Story) => <div style={{ width: 960 }}>{Story()}</div>],
  args: { since: '11:40', acts: ACTS, onUndo: fn(), onOpen: fn(), onClear: fn() },
} satisfies Meta<typeof Away>
export default meta
type Story = StoryObj<typeof meta>

/** What agents did outside their worktrees since 11:40: what can be taken back says how, what can't says why. */
export const Shown: Story = {
  play: async ({ canvasElement, args }) => {
    const away = within(canvasElement)
    await expect(away.getByText('dana replied')).toBeInTheDocument()
    await userEvent.click(away.getAllByRole('button', { name: 'Revert it' })[0]!)
    await expect(args.onUndo).toHaveBeenCalledWith('merge2')
  },
}

/** Taken back: the revert's task is under way, the issue moved back. */
export const TakenBack: Story = {
  args: {
    acts: ACTS.map((act) =>
      act.id === 'merge2' ? { ...act, undoing: 'Reverting' } : act.id === 'move' ? { ...act, undone: true, undoing: 'Undone' } : act,
    ),
  },
}

/** Taking one back failed: why, in its row. */
export const Failed: Story = {
  args: {
    acts: ACTS.map((act) => (act.id === 'move' ? { ...act, failed: 'Linear refused: DEV-188 was moved since.' } : act)),
  },
}

/** Beside the conversation, the board is narrow: each task and time go under what was done. */
export const Narrow: Story = { decorators: [(Story) => <div style={{ width: 440 }}>{Story()}</div>] }

/** × clears it. */
export const Clears: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Clear' }))
    await expect(args.onClear).toHaveBeenCalled()
  },
}
