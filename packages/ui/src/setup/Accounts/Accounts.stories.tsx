import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, within } from 'storybook/test'

import { ACCOUNTS, FOUND } from '../../fixtures/setup'
import { Accounts, type AccountEntry, type AccountsProps } from './Accounts'

const meta = {
  title: 'Setup/Accounts',
  component: Accounts,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 480 }}>{Story()}</div>],
  args: {
    agent: 'Codex',
    accounts: ACCOUNTS,
    found: FOUND,
    onSignIn: fn(),
    onRename: fn(),
    onMove: fn(),
    onRemove: fn(),
    onAdd: fn(),
    onAdding: fn(),
  },
} satisfies Meta<typeof Accounts>
export default meta
type Story = StoryObj<typeof meta>

/** Every state: signed in on a plan, out of usage until its reset, signed out (Sign in opens Codex’s own sign-in, in its folder). */
export const EveryState: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Out of usage until 14:00')).toBeInTheDocument()
    await expect(c.getByText('~/.codex-client · from codex-profiles')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Sign in' }))
    await expect(args.onSignIn).toHaveBeenCalledWith('acc_side')
  },
}

/** The agent’s usual sign-in alone, which its own row already speaks for: only the way to add another shows. */
export const OnlyTheUsual: Story = {
  args: { accounts: ACCOUNTS.slice(0, 1), found: [] },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('list')).toBeNull()
    await expect(c.getByRole('button', { name: 'Add an account' })).toBeInTheDocument()
  },
}

/** Still checking who an account is signed in as. */
export const Checking: Story = {
  args: {
    accounts: [
      { id: 'acc_usual', name: 'main', place: { kind: 'usual' }, state: { kind: 'checking' } },
      { id: 'acc_work', name: 'work', place: { kind: 'own' }, state: { kind: 'ready' } },
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Checking who it is signed in as')).toBeInTheDocument()
  },
}

/** Only shown, nothing to change: no menus, and no way to add one. */
export const JustTheList: Story = {
  args: { onSignIn: undefined, onRename: undefined, onMove: undefined, onRemove: undefined, onAdd: undefined },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('button')).toBeNull()
    await expect(c.getByText('work')).toBeInTheDocument()
  },
}

/** Adding one in a folder the person picks: the name typed stays when a found folder is tried and left. */
export const AddingAnotherFolder: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Add an account' }))
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.type(page.getByRole('textbox', { name: 'Name' }), 'client')
    await userEvent.click(page.getByRole('radio', { name: /~\/\.codex-personal/ }))
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('client')
    await userEvent.click(page.getByRole('radio', { name: /Another folder/ }))
    await userEvent.click(page.getByRole('button', { name: 'Add' }))
    await expect(args.onAdd).toHaveBeenCalledWith({ name: 'client', where: { kind: 'choose' } })
  },
}

/** Adding one a switcher already made: picking its folder names the account after it. */
export const AddingAFoundFolder: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Add an account' }))
    await expect(args.onAdding).toHaveBeenCalled()
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(page.getByRole('radio', { name: /~\/\.codex-personal/ }))
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('personal')
    await userEvent.click(page.getByRole('button', { name: 'Add' }))
    await expect(args.onAdd).toHaveBeenCalledWith({ name: 'personal', where: { kind: 'found', id: 'grant_personal' } })
  },
}

/** A new account needs a name; then it gets a folder of its own. */
export const AddingANewOne: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await userEvent.click(c.getByRole('button', { name: 'Add an account' }))
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(page.getByRole('button', { name: 'Add' }))
    await expect(page.getByRole('alert')).toHaveTextContent('Give it a name')
    await userEvent.type(page.getByRole('textbox', { name: 'Name' }), 'weekend')
    await userEvent.click(page.getByRole('button', { name: 'Add' }))
    await expect(args.onAdd).toHaveBeenCalledWith({ name: 'weekend', where: { kind: 'own' } })
  },
}

/* Renaming, reordering and removing, as the list follows. */
function Editing(args: AccountsProps) {
  const [accounts, setAccounts] = useState<readonly AccountEntry[]>(args.accounts)
  return (
    <Accounts
      {...args}
      accounts={accounts}
      onRename={(id, name) => {
        args.onRename?.(id, name)
        setAccounts((now) => now.map((account) => (account.id === id ? { ...account, name } : account)))
      }}
      onMove={(id, to) => {
        args.onMove?.(id, to)
        setAccounts((now) => {
          const at = now.findIndex((account) => account.id === id)
          const next = [...now]
          const [moved] = next.splice(at, 1)
          if (moved !== undefined) next.splice(to === 'up' ? at - 1 : at + 1, 0, moved)
          return next
        })
      }}
      onRemove={(id) => {
        args.onRemove?.(id)
        setAccounts((now) => now.filter((account) => account.id !== id))
      }}
    />
  )
}

/** Rename from its menu, then move it up; the usual folder’s account can’t be removed. */
export const Renaming: Story = {
  render: (args) => <Editing {...args} />,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(c.getByRole('button', { name: 'More for work' }))
    await userEvent.click(await page.findByRole('menuitem', { name: 'Rename' }))
    const field = c.getByRole('textbox', { name: 'Name' })
    await userEvent.clear(field)
    await userEvent.type(field, 'Work plan{Enter}')
    await expect(args.onRename).toHaveBeenCalledWith('acc_work', 'Work plan')
    // A name can't be emptied, and Escape leaves it as it was.
    await userEvent.click(c.getByRole('button', { name: 'More for Client' }))
    await userEvent.click(await page.findByRole('menuitem', { name: 'Rename' }))
    await userEvent.clear(c.getByRole('textbox', { name: 'Name' }))
    await userEvent.click(c.getByRole('button', { name: 'Save' }))
    await expect(c.getByRole('alert')).toHaveTextContent('Give it a name')
    await userEvent.type(c.getByRole('textbox', { name: 'Name' }), 'x{Escape}')
    await expect(c.getByText('Client')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'More for Work plan' }))
    await userEvent.click(await page.findByRole('menuitem', { name: 'Move up' }))
    await expect(args.onMove).toHaveBeenCalledWith('acc_work', 'up')
    await userEvent.click(c.getByRole('button', { name: 'More for main' }))
    await expect(page.queryByRole('menuitem', { name: /Remove/ })).toBeNull()
  },
}
