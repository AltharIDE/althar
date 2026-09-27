import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { NEXT } from '../../fixtures/board'
import { States, statesOn } from '../../storybook/States'
import { BoardList } from '../Board/Board'
import { cardStates, laneDecorator, listDecorator } from '../lane'
import { NextRow } from './NextRow'

const [HELD, AFTER, WORKERS] = NEXT as [(typeof NEXT)[0], (typeof NEXT)[0], (typeof NEXT)[0]]

const meta = {
  title: 'Board/NextRow',
  component: NextRow,
  decorators: [listDecorator, laneDecorator],
  args: { ...AFTER, place: 2, onOpen: fn() },
} satisfies Meta<typeof NextRow>
export default meta
type Story = StoryObj<typeof meta>

/** Starts after another task. */
export const AfterATask: Story = {}
/** Next in line, for a free worker. */
export const ForAWorker: Story = { args: { ...WORKERS, place: 1 } }
/** Held on a call of yours: violet, like the call. */
export const HeldOnYou: Story = { args: { ...HELD, place: 1 } }
export const Current: Story = { args: { current: true } }

/** The queue as it stands, in order. */
export const Queue: Story = {
  render: (args) => (
    <>
      {NEXT.map((n, i) => (
        <NextRow key={n.task} {...args} {...n} place={i + 1} />
      ))}
    </>
  ),
}

export const Opening: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: AFTER.title }))
    await expect(args.onOpen).toHaveBeenCalledOnce()
  },
}

export const AllStates: Story = {
  parameters: statesOn(cardStates),
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'after a task', node: <NextRow {...args} /> },
        { state: 'for a worker', node: <NextRow {...args} {...WORKERS} place={1} /> },
        { state: 'held on you', node: <NextRow {...args} {...HELD} place={1} /> },
        { state: 'current', node: <NextRow {...args} current /> },
        { state: 'hover', node: <NextRow {...args} /> },
        { state: 'focus', node: <NextRow {...args} /> },
      ].map((c) => ({ ...c, node: <BoardList>{c.node}</BoardList> }))}
    />
  ),
}
