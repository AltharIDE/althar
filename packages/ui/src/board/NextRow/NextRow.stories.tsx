import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Menu, MenuItem } from '../../primitives/Menu/Menu'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { NEXT } from '../../fixtures/board'
import { States, statesOn } from '../../storybook/States'
import { BoardList } from '../Board/Board'
import { cardStates, laneDecorator, listDecorator } from '../../storybook/lane'
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
/** Under way already, waiting for a free worker to go on with its review: it continues, ahead of the line. */
export const Continuing: Story = {
  args: { ...WORKERS, place: 1, kind: 'Change', continues: 'Review', reason: '6 of 6 agents busy on this Mac' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Continues · Review')).toBeInTheDocument()
  },
}
export const Current: Story = { args: { current: true } }

/** A plan held for you: its line turns into Start, and its menu shows, as you point at it or tab to it. */
export const Startable: Story = {
  args: {
    ...HELD,
    place: 3,
    kind: 'Change',
    reason: 'Held. Starts when you say',
    onStart: fn(),
    menu: (
      <Menu
        trigger={<IconButton icon="more" size="small" label="The team" />}
        label="This task"
        align="end"
        note="Opus 5.5 · High, GPT-6.1 Sol reviews"
      >
        <MenuItem icon="play" onSelect={fn()}>
          Start
        </MenuItem>
        <MenuItem icon="agents" onSelect={fn()}>
          Change the team…
        </MenuItem>
      </Menu>
    ),
  },
  play: async ({ args, canvasElement }) => {
    const row = within(canvasElement)
    await userEvent.tab()
    await userEvent.tab()
    await userEvent.click(row.getByRole('button', { name: 'Start' }))
    await expect(args.onStart).toHaveBeenCalledOnce()
  },
}

/** Waiting for a free worker: Hold, in place of the line as you point at it, takes it out of the line until you start it. */
export const Holdable: Story = {
  args: {
    ...WORKERS,
    place: 2,
    kind: 'Change',
    reason: 'Next in line',
    onHold: fn(),
    menu: (
      <Menu
        trigger={<IconButton icon="more" size="small" label="The team" />}
        label="This task"
        align="end"
        note="Opus 5.5 · High, GPT-6.1 Sol reviews"
      >
        <MenuItem icon="hold" onSelect={fn()}>
          Hold
        </MenuItem>
        <MenuItem icon="agents" onSelect={fn()}>
          Change the team…
        </MenuItem>
      </Menu>
    ),
  },
  play: async ({ args, canvasElement }) => {
    const row = within(canvasElement)
    await userEvent.tab()
    await userEvent.tab()
    await userEvent.click(row.getByRole('button', { name: 'Hold' }))
    await expect(args.onHold).toHaveBeenCalledOnce()
  },
}

/** On its countdown: Start now, or Hold, as you point at it. */
export const CountingDown: Story = {
  args: { ...WORKERS, place: 3, kind: 'Change', reason: 'Starts in 14s', onStart: fn(), onHold: fn() },
}

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
        {
          state: 'continues',
          node: <NextRow {...args} {...WORKERS} place={1} continues="Follow-up" reason="6 of 6 agents busy on this Mac" />,
        },
        { state: 'current', node: <NextRow {...args} current /> },
        { state: 'hover', node: <NextRow {...args} /> },
        { state: 'focus', node: <NextRow {...args} /> },
      ].map((c) => ({ ...c, node: <BoardList>{c.node}</BoardList> }))}
    />
  ),
}
