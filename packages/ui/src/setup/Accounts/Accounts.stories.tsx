import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { ACCOUNTS } from '../../fixtures/setup'
import { States } from '../../storybook/States'
import { AccountSignIn } from './AccountSignIn'
import { Accounts, type AccountEntry, type AccountsProps } from './Accounts'

const meta = {
  title: 'Setup/Accounts',
  component: Accounts,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <div style={{ maxWidth: 560 }}>{Story()}</div>],
  args: {
    agent: 'Codex',
    accounts: ACCOUNTS,
    onSignIn: fn(),
    onRename: fn(),
    onMove: fn(),
    onRemove: fn(),
    onAdd: fn(),
  },
} satisfies Meta<typeof Accounts>
export default meta
type Story = StoryObj<typeof meta>

/** One quiet line each: who it is and the plan that pays, a folder another tool made by where it is, out of usage until its reset, signed out with its way back in, and a key, per use, last. */
export const EveryState: Story = {
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByRole('list', { name: 'Codex accounts' })).toBeInTheDocument()
    await expect(c.getByText('ChatGPT Pro')).toBeInTheDocument()
    await expect(c.getByText('until 14:00')).toBeInTheDocument()
    await expect(c.getByText('~/.codex-client · codex-profiles')).toBeInTheDocument()
    await expect(c.getByText('per use')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'Sign in' }))
    await expect(args.onSignIn).toHaveBeenCalledWith('acc_side')
    await userEvent.click(c.getByRole('button', { name: 'Add an account' }))
    await expect(args.onAdd).toHaveBeenCalled()
  },
}

/** The agent's usual sign-in alone: no word on the order, which only matters with two. */
export const OnlyTheUsual: Story = {
  args: { accounts: ACCOUNTS.slice(0, 1) },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByText('Work starts at the top')).toBeNull()
    await expect(c.getAllByRole('listitem')).toHaveLength(1)
  },
}

/** Still asking the agent who an account is signed in as; a plan the agent doesn't name says only that it is one. */
export const Checking: Story = {
  args: {
    accounts: [
      { id: 'acc_usual', name: 'Personal', place: { kind: 'usual' }, state: { kind: 'checking' } },
      { id: 'acc_work', name: 'work', place: { kind: 'own' }, state: { kind: 'ready', paid: 'plan' } },
      { id: 'acc_quiet', name: 'quiet', place: { kind: 'own' }, state: { kind: 'ready' } },
    ],
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('Checking…')).toBeInTheDocument()
    await expect(c.getByText('on a plan')).toBeInTheDocument()
  },
}

/** A name too long for its line: one line, the whole of it on hover, and the way back in and the menu still at the end. */
export const LongName: Story = {
  args: {
    accounts: [
      { ...ACCOUNTS[0]!, name: 'The account the whole platform team shares for the weekend on-call rotation and its incident reviews' },
      ...ACCOUNTS.slice(1),
    ],
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByTitle(/^The account the whole platform team shares/)).toBeInTheDocument()
    await expect(c.getAllByRole('button', { name: /^More for/ }).length).toBeGreaterThan(0)
  },
}

/** Only shown, nothing to change: no menus, no way in, and no way to add one. */
export const JustTheList: Story = {
  args: { onSignIn: undefined, onRename: undefined, onMove: undefined, onRemove: undefined, onAdd: undefined },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.queryByRole('button')).toBeNull()
    await expect(c.getByText('Signed out')).toBeInTheDocument()
  },
}

/** A new account signing in, in the line it will take, after the plans and before the key: the lines under it count on past it, and nothing else starts a sign-in meanwhile. */
export const AddingInPlace: Story = {
  args: {
    signIn: {
      account: null,
      at: 4,
      node: (
        <AccountSignIn
          agent="Codex"
          position={5}
          step={{ kind: 'browser', host: 'chatgpt.com' }}
          ways={{ browser: 'ChatGPT' }}
          onWay={fn()}
          onDone={fn()}
          onCancel={fn()}
        />
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getByText('New account')).toBeInTheDocument()
    await expect(c.getByText('Approve on chatgpt.com in your browser')).toBeInTheDocument()
    await expect(c.getByRole('button', { name: 'Add an account' })).toBeDisabled()
    await expect(c.queryByRole('button', { name: 'Sign in' })).toBeNull()
    await expect(c.getByText('Signed out')).toBeInTheDocument()
  },
}

/** Signing one in again takes its own line. */
export const SigningInAgain: Story = {
  args: {
    signIn: {
      account: 'acc_side',
      node: (
        <AccountSignIn
          agent="Codex"
          position={4}
          account={{ name: 'side' }}
          step={{ kind: 'choose' }}
          ways={{ browser: 'ChatGPT', code: true }}
          onWay={fn()}
          onDone={fn()}
          onCancel={fn()}
        />
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement)
    await expect(c.getAllByText('side')).toHaveLength(1)
    await expect(c.getByRole('button', { name: 'Sign in again' })).toBeInTheDocument()
  },
}

/** A new one at the end, where a list with no key puts it. */
export const AddingAtTheEnd: Story = {
  args: {
    accounts: ACCOUNTS.slice(0, 2),
    signIn: {
      account: null,
      node: <AccountSignIn agent="Codex" position={3} step={{ kind: 'checking' }} ways={{}} onWay={fn()} onDone={fn()} onCancel={fn()} />,
    },
  },
  play: async ({ canvasElement }) => {
    const items = within(canvasElement).getAllByRole('listitem')
    await expect(items).toHaveLength(3)
    await expect(items[2]).toHaveTextContent('Checking who Codex signed in as…')
  },
}

/* Renaming, reordering and removing, as the list follows. */
function Editable(args: AccountsProps) {
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

/** Rename in its line from its menu, then move it up; the usual folder's account can't be removed, and what removing does depends on whose folder it is. */
export const Editing: Story = {
  render: (args) => <Editable {...args} />,
  play: async ({ args, canvasElement }) => {
    const c = within(canvasElement)
    const page = within(canvasElement.ownerDocument.body)
    await userEvent.click(c.getByRole('button', { name: 'More for Northwind' }))
    await userEvent.click(await page.findByRole('menuitem', { name: 'Rename' }))
    const field = c.getByRole('textbox', { name: 'Name' })
    // Chosen from the menu, typing goes straight into the name.
    await waitFor(() => expect(field).toHaveFocus())
    await userEvent.keyboard('Work{Enter}')
    await expect(args.onRename).toHaveBeenCalledWith('acc_work', 'Work')
    // A name can't be emptied, and Escape leaves it as it was.
    await userEvent.click(c.getByRole('button', { name: 'More for Client' }))
    await userEvent.click(await page.findByRole('menuitem', { name: 'Rename' }))
    await userEvent.clear(c.getByRole('textbox', { name: 'Name' }))
    await userEvent.keyboard('{Enter}')
    await expect(c.getByRole('alert')).toHaveTextContent('Give it a name')
    await userEvent.type(c.getByRole('textbox', { name: 'Name' }), 'x{Escape}')
    await expect(c.getByText('Client')).toBeInTheDocument()
    await userEvent.click(c.getByRole('button', { name: 'More for Work' }))
    await userEvent.click(await page.findByRole('menuitem', { name: 'Move up' }))
    await expect(args.onMove).toHaveBeenCalledWith('acc_work', 'up')
    await userEvent.click(c.getByRole('button', { name: 'More for Personal' }))
    await expect(page.queryByRole('menuitem', { name: /Remove/ })).toBeNull()
    await userEvent.click(page.getByRole('menuitem', { name: 'Sign in again' }))
    await expect(args.onSignIn).toHaveBeenCalledWith('acc_usual')
    // One in a folder of its own is signed out and its folder deleted; one a switcher made stays as it is.
    await userEvent.click(c.getByRole('button', { name: 'More for side' }))
    await expect(await page.findByRole('menuitem', { name: /Remove/ })).toHaveTextContent('Signs it out and deletes its folder.')
    await userEvent.keyboard('{Escape}')
    await userEvent.click(c.getByRole('button', { name: 'More for Client' }))
    await userEvent.click(await page.findByRole('menuitem', { name: /Remove/ }))
    await expect(args.onRemove).toHaveBeenCalledWith('acc_client')
    await expect(c.queryByText('Client')).toBeNull()
  },
}

/** Every state, and the list where it is narrow: who moves under the name. */
export const AllStates: Story = {
  render: (args) => (
    <States
      size="wide"
      cells={[
        { state: 'every state', node: <Accounts {...args} /> },
        { state: 'one', node: <Accounts {...args} accounts={ACCOUNTS.slice(0, 1)} /> },
        {
          state: 'just the list',
          node: <Accounts {...args} onSignIn={undefined} onRename={undefined} onMove={undefined} onRemove={undefined} onAdd={undefined} />,
        },
        {
          state: 'adding',
          node: (
            <Accounts
              {...args}
              signIn={{
                account: null,
                at: 4,
                node: (
                  <AccountSignIn
                    agent="Codex"
                    position={5}
                    step={{ kind: 'choose' }}
                    ways={{ browser: 'ChatGPT', code: true, key: 'OpenAI API key' }}
                    onWay={fn()}
                    onDone={fn()}
                    onCancel={fn()}
                  />
                ),
              }}
            />
          ),
        },
        {
          state: 'narrow',
          node: (
            <div style={{ width: 340 }}>
              <Accounts {...args} />
            </div>
          ),
        },
      ]}
    />
  ),
}
