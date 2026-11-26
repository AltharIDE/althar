import { render, screen } from '@testing-library/react'
import { userEvent } from 'storybook/test'
import { describe, expect, it, vi } from 'vitest'

import { ACCOUNTS } from '../src/fixtures/setup'
import { Accounts } from '../src/setup/Accounts/Accounts'

/*
 * The agent's usual folder's account can't be removed, as the agent's own command reads its sign-in there too: it is
 * signed out, and stays, or signed in again as someone else, each saying the agent's own command follows.
 */

describe('the usual folder’s account', () => {
  it('is signed out or signed in again from its menu, each saying the agent’s own command follows', async () => {
    const onSignOut = vi.fn()
    const onSignIn = vi.fn()
    render(<Accounts agent="Codex" accounts={ACCOUNTS} onSignIn={onSignIn} onRemove={vi.fn()} onSignOut={onSignOut} />)
    await userEvent.click(screen.getByRole('button', { name: 'More for Personal' }))
    expect(screen.queryByRole('menuitem', { name: /Remove/ })).not.toBeInTheDocument()
    expect(await screen.findByRole('menuitem', { name: 'Sign in again' })).toHaveAccessibleDescription("Codex's own command switches too")
    const signOut = screen.getByRole('menuitem', { name: 'Sign out' })
    expect(signOut).toHaveAccessibleDescription("Signs out Codex's own command too")
    await userEvent.click(signOut)
    expect(onSignOut).toHaveBeenCalledWith('acc_usual')
  })

  it('leaves any other account to be removed, as before', async () => {
    render(<Accounts agent="Codex" accounts={ACCOUNTS} onSignIn={vi.fn()} onRemove={vi.fn()} onSignOut={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'More for Northwind' }))
    expect(await screen.findByRole('menuitem', { name: /Remove/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Sign in again' })).not.toHaveAccessibleDescription()
  })

  it('offers no sign-out where the agent has no command that signs out, nor once it is signed out', async () => {
    const { rerender } = render(<Accounts agent="Codex" accounts={ACCOUNTS} onSignIn={vi.fn()} onRemove={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'More for Personal' }))
    expect(await screen.findByRole('menuitem', { name: 'Sign in again' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    const signedOut = ACCOUNTS.map((account) =>
      account.id === 'acc_usual' ? { ...account, state: { kind: 'signedOut' as const } } : account,
    )
    // Signed out, its line signs it in, and with nothing else to do it has no menu.
    rerender(<Accounts agent="Codex" accounts={signedOut} onSignIn={vi.fn()} onRemove={vi.fn()} onSignOut={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: 'Sign in' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'More for Personal' })).not.toBeInTheDocument()
  })
})
