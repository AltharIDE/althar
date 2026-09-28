import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { Room } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { RoomSwitch } from './RoomSwitch'

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
        { state: 'hover', node: <RoomSwitch value={Room.Talk} onChange={() => {}} /> },
        { state: 'focus', node: <RoomSwitch value={Room.Talk} onChange={() => {}} /> },
        { state: 'pressed', node: <RoomSwitch value={Room.Talk} onChange={() => {}} /> },
      ]}
    />
  ),
}
