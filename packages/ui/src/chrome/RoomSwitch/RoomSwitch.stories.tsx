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
/** The project's settings in place of its work. */
export const Settings: Story = { args: { value: Room.Settings } }
/** A connection to sign in again: Settings carries the violet dot, and says so to a screen reader. */
export const SettingsNeedYou: Story = {
  args: { needsYou: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('radio', { name: 'Settings, needs you' })).toBeVisible()
  },
}
/** The project's automations, each opening as its own page. */
export const Automations: Story = { args: { value: Room.Automations } }
/** An automation paused itself after failing: Automations carries the violet dot, and says so to a screen reader. */
export const AutomationsNeedYou: Story = {
  args: { automationsNeedYou: true },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('radio', { name: 'Automations, needs you' })).toBeVisible()
    await expect(c.getByRole('radio', { name: 'Settings' })).toBeVisible()
  },
}
/** Its views in order, its automations between the work and its settings. */
export const InOrder: Story = {
  play: async ({ canvasElement }) => {
    const names = within(canvasElement)
      .getAllByRole('radio')
      .map((radio) => radio.textContent)
    await expect(names).toEqual(['Conversation', 'Board', 'Both', 'Automations', 'Settings'])
  },
}
/** What waits on you in the work is the bar's to say: no view carries a dot for it. */
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
        { state: 'automations, needs you', node: <RoomSwitch value={Room.Automations} onChange={() => {}} automationsNeedYou /> },
        { state: 'settings, needs you', node: <RoomSwitch value={Room.Settings} onChange={() => {}} needsYou /> },
        { state: 'hover', node: <RoomSwitch value={Room.Talk} onChange={() => {}} /> },
        { state: 'focus', node: <RoomSwitch value={Room.Talk} onChange={() => {}} /> },
        { state: 'pressed', node: <RoomSwitch value={Room.Talk} onChange={() => {}} /> },
      ]}
    />
  ),
}
