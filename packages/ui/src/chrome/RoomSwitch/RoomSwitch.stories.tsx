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
/** On the board: the conversation has news. */
export const BoardWithNews: Story = { args: { value: Room.Board, news: true } }
export const Both: Story = { args: { value: Room.Both } }
/** What waits on you is the bar's to say: no view carries a dot for it. */
export const Switching: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('radio', { name: /Board/ }))
    await expect(c.getByRole('radio', { name: 'Board' })).toBeChecked()
  },
}

/** Without shortcuts, as where the window's tabs have ⌘ and a number: pointed at, a view says nothing it doesn't already show. */
export const NoShortcuts: Story = {
  args: { text: { key: () => '' } },
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByRole('radio', { name: 'Board' }))
    await new Promise((resolve) => setTimeout(resolve, 900))
    await expect(within(document.body).queryByRole('tooltip')).toBeNull()
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
        { state: 'board, news', node: <RoomSwitch value={Room.Board} onChange={() => {}} news /> },
        { state: 'both', node: <RoomSwitch value={Room.Both} onChange={() => {}} /> },
        { state: 'hover', node: <RoomSwitch value={Room.Talk} onChange={() => {}} /> },
        { state: 'focus', node: <RoomSwitch value={Room.Talk} onChange={() => {}} /> },
        { state: 'pressed', node: <RoomSwitch value={Room.Talk} onChange={() => {}} /> },
      ]}
    />
  ),
}
