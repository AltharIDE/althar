import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { Room } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { RoomSwitch, TASK } from './RoomSwitch'

const meta = {
  title: 'Chrome/RoomSwitch',
  component: RoomSwitch,
  args: { value: Room.Talk, onChange: () => {} },
  render: function Render(args) {
    const [room, setRoom] = useState(args.value)
    return <RoomSwitch {...args} value={room} onChange={setRoom} />
  },
} satisfies Meta<typeof RoomSwitch>
export default meta
type Story = StoryObj<typeof meta>

export const Conversation: Story = {}
/** On the board: the conversation has news, and the board has calls for you. */
export const BoardWithNews: Story = { args: { value: Room.Board, news: true, yours: 4 } }
export const Both: Story = { args: { value: Room.Both } }
/** A task of the project has the window: none is on, and choosing one goes back to the project in it. */
export const NoneWhileATaskHasTheWindow: Story = { args: { value: null, yours: 2 } }
/** The task last opened, after the views: on while it has the window, and the way back to it from the board. */
export const WithTheTaskLastOpened: Story = {
  args: { value: TASK, yours: 2, task: { title: 'Make wand spells fire colorful heart particles', onOpen: fn() } },
}

export const BackToTheTask: Story = {
  args: { value: Room.Board, task: { title: 'Add a second jump', onOpen: fn() } },
  play: async ({ canvasElement, args }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('radio', { name: 'Add a second jump' }))
    await expect(args.task?.onOpen).toHaveBeenCalled()
  },
}

export const Switching: Story = {
  args: { yours: 4 },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('radio', { name: /Board/ }))
    await expect(c.getByRole('radio', { name: /^Board\W+4 need you$/ })).toBeChecked()
  },
}

export const AllStates: Story = {
  parameters: statesOn({
    hover: '[role="radio"]:nth-child(2)',
    focus: '[role="radio"][aria-checked="true"]',
    pressed: '[role="radio"]:nth-child(2)',
  }),
  render: () => (
    <States
      size="wide"
      cells={[
        { state: 'conversation', node: <RoomSwitch value={Room.Talk} onChange={() => {}} /> },
        { state: 'board, news and calls', node: <RoomSwitch value={Room.Board} onChange={() => {}} news yours={4} /> },
        { state: 'both', node: <RoomSwitch value={Room.Both} onChange={() => {}} yours={1} /> },
        { state: 'none, a task has the window', node: <RoomSwitch value={null} onChange={() => {}} yours={2} /> },
        {
          state: 'the task last opened, on',
          node: (
            <RoomSwitch
              value={TASK}
              onChange={() => {}}
              task={{ title: 'Make wand spells fire colorful heart particles', onOpen: () => {} }}
            />
          ),
        },
        {
          state: 'the task last opened, from the board',
          node: <RoomSwitch value={Room.Board} onChange={() => {}} task={{ title: 'Add a second jump', onOpen: () => {} }} yours={1} />,
        },
        { state: 'hover', node: <RoomSwitch value={Room.Talk} onChange={() => {}} /> },
        { state: 'focus', node: <RoomSwitch value={Room.Talk} onChange={() => {}} /> },
        { state: 'pressed', node: <RoomSwitch value={Room.Talk} onChange={() => {}} /> },
      ]}
    />
  ),
}
