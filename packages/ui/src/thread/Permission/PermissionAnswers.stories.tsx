import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { PROJECT, STAGING } from '../../fixtures/meridian'
import { Decision, PermissionScope } from '../../foundations/vocabulary'
import { States, statesOn } from '../../storybook/States'
import { PermissionAnswers } from './PermissionAnswers'

const meta = {
  title: 'Thread/Permission/In small',
  component: PermissionAnswers,
  args: {
    request: { ...STAGING, offers: [Decision.AllowOnce, Decision.AllowAlways, Decision.Deny, Decision.DenyAlways] },
    project: PROJECT,
    onAnswer: fn(),
  },
} satisfies Meta<typeof PermissionAnswers>
export default meta
type Story = StoryObj<typeof meta>

export const Asks: Story = {}

/** Allow once and Deny are a press away; the rest is in the menu beside them, the same set the card offers. */
export const AllowOnce: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Allow once' }))
    await expect(args.onAnswer).toHaveBeenCalledWith({ decision: Decision.AllowOnce, cmd: STAGING.cmd })
  },
}

/** Always allow, by how the command starts, from the menu. */
export const AlwaysAllow: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'More answers' }))
    const menu = within(await within(document.body).findByRole('menu'))
    await expect(menu.getByText(`An always or a never is kept in ${PROJECT}’s rules`)).toBeInTheDocument()
    await userEvent.click(menu.getByRole('menuitem', { name: 'Always allow commands starting “pnpm replay”' }))
    await expect(args.onAnswer).toHaveBeenCalledWith({ decision: Decision.AllowAlways, cmd: STAGING.cmd, scope: PermissionScope.Prefix })
  },
}

/** Deny with what to do instead: a note in place of the buttons, which takes focus; Escape puts it away and focus comes back. */
export const DenyWithNote: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'More answers' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Deny, and say what to do instead' }))
    const note = await c.findByRole('textbox', { name: 'Say what to do instead' })
    await waitFor(() => expect(note).toHaveFocus())
    await userEvent.type(note, 'Use the fixture log{Enter}')
    await expect(args.onAnswer).toHaveBeenCalledWith({ decision: Decision.Deny, cmd: STAGING.cmd, note: 'Use the fixture log' })
  },
}

export const PuttingTheNoteAway: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'More answers' }))
    await userEvent.click(await within(document.body).findByRole('menuitem', { name: 'Deny, and say what to do instead' }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(c.getByRole('button', { name: 'More answers' })).toHaveFocus())
  },
}

/** Kept for you by the always-ask list: no always allow, so the menu holds the note and never allow alone. */
export const HeldForYou: Story = {
  args: {
    request: {
      ...STAGING,
      offers: [Decision.AllowOnce, Decision.AllowAlways, Decision.Deny, Decision.DenyAlways],
      scopes: { [Decision.AllowAlways]: [], [Decision.DenyAlways]: [PermissionScope.Exact, PermissionScope.Kind] },
    },
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'More answers' }))
    const menu = within(await within(document.body).findByRole('menu'))
    await expect(menu.queryByRole('menuitem', { name: /Always allow/ })).toBeNull()
    await expect(menu.getByRole('menuitem', { name: 'Never allow anything that reaches staging' })).toBeInTheDocument()
  },
}

/** An agent that offers no always: the menu holds the note alone, and says nothing about rules. */
export const OnceOnly: Story = {
  args: { request: { ...STAGING, offers: [Decision.AllowOnce, Decision.Deny] } },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'More answers' }))
    const menu = within(await within(document.body).findByRole('menu'))
    await expect(menu.getAllByRole('menuitem')).toHaveLength(1)
    await expect(menu.queryByText(/kept in/)).toBeNull()
  },
}

/* At rest, a button hovered, focused and pressed, and the note open. */
export const AllStates: Story = {
  parameters: statesOn({ hover: 'button:nth-of-type(2)', focus: 'button:nth-of-type(2)', pressed: 'button:nth-of-type(2)' }),
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'rest', node: <PermissionAnswers {...args} /> },
        { state: 'hover', node: <PermissionAnswers {...args} /> },
        { state: 'focus', node: <PermissionAnswers {...args} /> },
        { state: 'pressed', node: <PermissionAnswers {...args} /> },
        { state: 'held for you', node: <PermissionAnswers {...args} {...HeldForYou.args} /> },
        { state: 'once only', node: <PermissionAnswers {...args} {...OnceOnly.args} /> },
      ]}
    />
  ),
}
