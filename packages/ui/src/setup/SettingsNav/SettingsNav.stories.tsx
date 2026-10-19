import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { States, statesOn } from '../../storybook/States'
import { type SettingsSection, SettingsNav } from './SettingsNav'

type Id = 'agents' | 'hosts' | 'mac' | 'reviews' | 'notify' | 'look' | 'editor' | 'about'

/* Althar's sections, as the app groups them: what it works with, its own ways, and about it. */
const GROUPS = (yours: boolean): ReadonlyArray<ReadonlyArray<SettingsSection<Id>>> => [
  [
    { id: 'agents', title: 'Agents', icon: 'agents', yours },
    { id: 'hosts', title: 'Code hosts and trackers', icon: 'plug' },
  ],
  [
    { id: 'mac', title: 'Work on this Mac', icon: 'load' },
    { id: 'reviews', title: 'Reviews and pull requests', icon: 'pr' },
    { id: 'notify', title: 'Notifications', icon: 'bell' },
    { id: 'look', title: 'Appearance', icon: 'image' },
    { id: 'editor', title: 'Editor', icon: 'file' },
  ],
  [{ id: 'about', title: 'About Althar', icon: 'down' }],
]

function Side({ start = 'agents', yours = false }: { start?: Id; yours?: boolean }) {
  const [value, setValue] = useState<Id>(start)
  return (
    <div style={{ width: 248 }}>
      <SettingsNav label="Settings" groups={GROUPS(yours)} value={value} onChange={setValue} />
    </div>
  )
}

const meta = {
  title: 'Setup/SettingsNav',
  component: Side,
} satisfies Meta<typeof Side>
export default meta
type Story = StoryObj<typeof meta>

/** The sections down the side of the Settings page, Agents open. */
export const Default: Story = {}

/** An account to sign in again: a dot after Agents. */
export const SomethingNeedsYou: Story = { args: { yours: true } }

export const Choosing: Story = {
  play: async ({ canvasElement }) => {
    const nav = within(within(canvasElement).getByRole('navigation', { name: 'Settings' }))
    await expect(nav.getByRole('button', { name: 'Agents' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(nav.getByRole('button', { name: 'Work on this Mac' }))
    await expect(nav.getByRole('button', { name: 'Work on this Mac' })).toHaveAttribute('aria-current', 'page')
    await expect(nav.getByRole('button', { name: 'Agents' })).not.toHaveAttribute('aria-current')
  },
}

type ProjectId = 'general' | 'code' | 'rules' | 'running' | 'notes'

/** A project's sections, with taking it out of Althar at the foot, in red, apart from them. */
export const WithAction: Story = {
  render: function Render() {
    const [value, setValue] = useState<ProjectId>('general')
    const [removing, setRemoving] = useState(false)
    return (
      <div style={{ width: 248 }}>
        <SettingsNav
          label="Project settings"
          groups={[
            [
              { id: 'general', title: 'General', icon: 'gear' },
              { id: 'code', title: 'Code and issues', icon: 'plug', yours: true },
            ],
            [
              { id: 'rules', title: 'Rules', icon: 'lock' },
              { id: 'running', title: 'Running', icon: 'play' },
            ],
            [{ id: 'notes', title: 'Notes', icon: 'quote' }],
          ]}
          value={value}
          onChange={setValue}
          action={{ title: 'Remove from Althar…', icon: 'close', danger: true, onSelect: () => setRemoving(true) }}
        />
        {removing && <p>Asked first, in a dialog.</p>}
      </div>
    )
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Remove from Althar…' }))
    await expect(c.getByText('Asked first, in a dialog.')).toBeVisible()
    // Doing it opens nothing of its own down the side: General is still the section open.
    await expect(c.getByRole('button', { name: 'General' })).toHaveAttribute('aria-current', 'page')
  },
}

export const AllStates: Story = {
  render: () => (
    <States
      cells={[
        { state: 'agents open', node: <Side /> },
        { state: 'needs you', node: <Side yours /> },
        { state: 'hover', node: <Side start="about" /> },
        { state: 'focus', node: <Side start="about" /> },
        { state: 'pressed', node: <Side start="about" /> },
      ]}
    />
  ),
  // On Work on this Mac, the first of its group, while About is open.
  parameters: statesOn({
    hover: 'nav ul:nth-child(2) li:first-child button',
    focus: 'nav ul:nth-child(2) li:first-child button',
    pressed: 'nav ul:nth-child(2) li:first-child button',
  }),
}
