import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { States, statesOn } from '../../storybook/States'
import { threadDecorator } from '../../storybook/ThreadFrame'
import { Relayed } from './Relayed'

const BODY =
  'they want to click around it live and compare directions in place, not navigate an index page or read screenshots. So: (1) make one page that shows the directions with a slim switcher bar at the bottom (A, B, C… with short names). Clicking swaps the direction in place; keys 1–9 and ←/→ switch too. (2) Leave the server running when you finish, so it shows in the Running pill. Give the URL in your final message.'

const meta = {
  title: 'Thread/Relayed',
  component: Relayed,
  decorators: [threadDecorator],
  args: { title: 'one more round', body: BODY },
} satisfies Meta<typeof Relayed>
export default meta
type Story = StoryObj<typeof meta>

/** What it is in a line, three lines of the rest, the mark printed faint in its corner. */
export const Passed: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('From the coordinator')).toBeInTheDocument()
    const more = c.getByRole('button', { name: 'Show all' })
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(more)
    await expect(c.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
  },
}

/** Opened: all of it. */
export const Opened: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Show all' }))
  },
}

/** Where it doesn't say what it is: the words alone. */
export const Untitled: Story = { args: { title: null } }

/** A short one. */
export const Short: Story = { args: { title: null, body: 'They’d like the bar hidden by default; H shows it.' } }

export const AllStates: Story = {
  parameters: statesOn({ hover: 'button', focus: 'button', pressed: 'button' }),
  render: (args) => (
    <States
      size="thread"
      cells={[
        { state: 'passed', node: <Relayed {...args} /> },
        { state: 'untitled', node: <Relayed body={BODY} /> },
        { state: 'short', node: <Relayed body="They’d like the bar hidden by default; H shows it." /> },
        { state: 'hover', node: <Relayed {...args} /> },
        { state: 'focus', node: <Relayed {...args} /> },
        { state: 'pressed', node: <Relayed {...args} /> },
        { state: 'dark', node: <Relayed {...args} />, dark: true },
      ]}
    />
  ),
}
