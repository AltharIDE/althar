import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { type AccountSignInState, type AgentStatus, ApiError, type Status } from '@althar/contracts'
import { RuntimeState } from '@althar/ui'

import { useServices } from '../src/renderer/data/services'
import { accountEntry } from '../src/renderer/features/accounts/AgentAccounts'
import { useAccountSignIn } from '../src/renderer/features/accounts/useAccountSignIn'
import { HomeView } from '../src/renderer/features/home/HomeView'
import { useHome } from '../src/renderer/features/home/useHome'
import { SettingsPanel } from '../src/renderer/features/settings/SettingsPanel'
import { runtimeEntry, StartView } from '../src/renderer/features/start/StartView'
import { type StartModel, useStart } from '../src/renderer/features/start/useStart'
import { shortFolder } from '../src/renderer/shared/folders'
import { agents, changed, fakeClient, fakeHost, home, project, streamed, usual, withoutOpenCode } from './fixtures'
import { withServices } from './render'

function Home({ start, onProject }: { start: StartModel; onProject: (id: string) => void }) {
  return <HomeView model={useHome()} start={start} onProject={onProject} onTalk={vi.fn()} onTask={vi.fn()} />
}

function Start({ onProject }: { onProject: (id: string) => void }) {
  const start = useStart()
  return (
    <StartView
      model={start}
      accounts={useAccountSignIn(start)}
      onProject={onProject}
      home={() => <Home start={start} onProject={onProject} />}
    />
  )
}

/* Settings, open on the agents. */
function Settings() {
  const [open, setOpen] = useState(true)
  return <SettingsPanel start={useStart()} open={open} onOpenChange={setOpen} />
}

/** Codex, with the accounts given, as the runtime reads it: each read can be changed by the test. Here it signs in only in Terminal, unless given its ways. */
const codexWith = (...accounts: AgentStatus['accounts']) => withWays([], ...accounts)

const withWays = (ways: AgentStatus['ways'], ...accounts: AgentStatus['accounts']) => {
  let now: Status = { apiVersion: 1, appVersion: '0.0.0', agents: [{ ...agents[1]!, ways, accounts }] }
  return {
    status: vi.fn(async () => now),
    /** What the next read says. */
    next: (...next: AgentStatus['accounts']) => {
      now = { ...now, agents: [{ ...agents[1]!, ways, accounts: next }] }
    },
  }
}

/** The Codex accounts in the open panel. */
const codexAccounts = async () => {
  const panel = await screen.findByRole('dialog', { name: 'Settings' })
  await userEvent.click(await within(panel).findByRole('button', { name: /^Agents/ }))
  return within(panel).getByRole('list', { name: 'Codex accounts' })
}

const work = { ...usual('acc_work', 'signed_in'), name: 'work', home: '/Users/me/work' }

/** A whole sign-in, step by step, with the window's own polling: more than the usual five seconds where the machine is busy. */
const LONG_FLOW = 15_000

describe('accounts in settings', () => {
  it('says where each account signs in and how it stands', () => {
    const now = new Date('2026-10-03T12:00:00')
    expect(shortFolder('/Users/me/.codex-work')).toBe('~/.codex-work')
    expect(shortFolder('/opt/homes/work')).toBe('/opt/homes/work')
    expect(accountEntry(usual('acc_1', 'signed_in'), now)).toEqual({
      id: 'acc_1',
      name: 'main',
      place: { kind: 'usual' },
      state: { kind: 'ready', paid: 'plan' },
    })
    const adopted = { ...usual('acc_2', 'signed_out'), name: 'Client', home: '/Users/me/.codex-client', adoptedFrom: 'codex-profiles' }
    expect(accountEntry(adopted, now)).toMatchObject({
      place: { kind: 'adopted', folder: '~/.codex-client', from: 'codex-profiles' },
      state: { kind: 'signedOut' },
    })
    const own = { ...usual('acc_3', 'signed_in'), home: '/Users/me/profile/accounts/acc_3', outUntil: '2026-10-03T14:00:00' }
    expect(accountEntry(own, now)).toMatchObject({ place: { kind: 'own' }, state: { kind: 'out' } })
    expect(accountEntry({ ...usual('acc_4', 'unknown') }, now).state).toEqual({ kind: 'ready' })
  })

  it(
    'signs a new account in in Terminal, in its line, says when it isn’t yet, and names it once it is',
    async () => {
      const codex = codexWith(usual('acc_usual', 'signed_in'), work)
      const { client } = fakeClient({ status: codex.status })
      withServices(<Settings />, client)
      const accounts = await codexAccounts()
      await userEvent.click(screen.getByRole('button', { name: 'Add an account' }))
      expect(within(accounts).getByText('New account')).toBeTruthy()
      await userEvent.click(screen.getByRole('button', { name: 'Sign in in Terminal' }))
      await waitFor(() => expect(client.addAccount).toHaveBeenCalledWith({ agentId: 'codex', name: 'Account 3' }))
      await waitFor(() => expect(client.signInAccount).toHaveBeenCalledWith('acc_added'))
      expect(await within(accounts).findByText('Finish signing in in Terminal')).toBeTruthy()
      // While it signs in, a press outside leaves the panel open, and the list starts no other.
      expect(screen.getByRole('button', { name: 'Add an account' }).hasAttribute('disabled')).toBe(true)

      // Back from Terminal, not signed in yet.
      const made = { ...usual('acc_added', 'signed_out'), name: 'Account 3', home: '/Users/me/accounts/acc_added' }
      codex.next(usual('acc_usual', 'signed_in'), work, made)
      act(() => void window.dispatchEvent(new Event('focus')))
      expect(await within(accounts).findByText(/Not signed in yet\./)).toBeTruthy()
      // It is the sign-in's line, not one of its own.
      expect(within(accounts).getAllByText(/Account 3|New account/)).toHaveLength(1)

      // Signed in now: named in its line, Return keeps it.
      codex.next(usual('acc_usual', 'signed_in'), work, { ...made, signIn: 'signed_in', paidBy: 'plan' })
      await userEvent.click(within(accounts).getByRole('button', { name: 'Check again' }))
      const name = await within(accounts).findByRole('textbox', { name: 'Name this account' })
      expect((name as HTMLInputElement).value).toBe('Account 3')
      expect(within(screen.getByRole('group', { name: 'New account' })).getByText('on a plan')).toBeTruthy()
      await userEvent.clear(name)
      await userEvent.type(name, 'weekend{Enter}')
      await waitFor(() => expect(client.renameAccount).toHaveBeenCalledWith('acc_added', 'weekend'))
      await waitFor(() => expect(within(accounts).queryByRole('textbox', { name: 'Name this account' })).toBeNull())
    },
    LONG_FLOW,
  )

  it('stops a sign-in in the browser that was left while it started', async () => {
    const codex = withWays(['browser', 'device'], usual('acc_usual', 'signed_in'))
    let started: (value: { flowId: string; state: AccountSignInState }) => void = () => undefined
    const { client } = fakeClient({
      status: codex.status,
      startAccountSignIn: vi.fn(() => new Promise<{ flowId: string; state: AccountSignInState }>((resolve) => (started = resolve))),
    })
    withServices(<Settings />, client)
    const accounts = await codexAccounts()
    await userEvent.click(screen.getByRole('button', { name: 'Add an account' }))
    await userEvent.click(within(accounts).getByRole('button', { name: 'Continue with ChatGPT' }))
    await waitFor(() => expect(client.startAccountSignIn).toHaveBeenCalledWith('acc_added', 'browser'))
    // Left before the agent's login says it started: once it does, it is stopped.
    await userEvent.keyboard('{Escape}')
    started({ flowId: 'flow_late', state: { state: 'starting' } })
    await waitFor(() => expect(client.cancelAccountSignIn).toHaveBeenCalledWith('flow_late'))
  })

  it('stops a sign-in the screen was closed on, under way or still starting', async () => {
    const codex = withWays(['browser', 'device'], usual('acc_usual', 'signed_in'))
    let started: (value: { flowId: string; state: AccountSignInState }) => void = () => undefined
    const { client } = fakeClient({
      status: codex.status,
      startAccountSignIn: vi.fn(() => new Promise<{ flowId: string; state: AccountSignInState }>((resolve) => (started = resolve))),
    })
    const screenOne = withServices(<Settings />, client)
    let accounts = await codexAccounts()
    await userEvent.click(screen.getByRole('button', { name: 'Add an account' }))
    await userEvent.click(within(accounts).getByRole('button', { name: 'Continue with ChatGPT' }))
    await waitFor(() => expect(client.startAccountSignIn).toHaveBeenCalledWith('acc_added', 'browser'))
    // Closed before the agent's login says it started: once it does, it is stopped, and the account made for it goes.
    screenOne.unmount()
    await waitFor(() => expect(client.removeAccount).toHaveBeenCalledWith('acc_added'))
    started({ flowId: 'flow_closed', state: { state: 'starting' } })
    await waitFor(() => expect(client.cancelAccountSignIn).toHaveBeenCalledWith('flow_closed'))

    // Closed while it waits in the browser: stopped at once.
    const screenTwo = withServices(<Settings />, client)
    accounts = await codexAccounts()
    await userEvent.click(screen.getByRole('button', { name: 'Add an account' }))
    await userEvent.click(within(accounts).getByRole('button', { name: 'Continue with ChatGPT' }))
    started({ flowId: 'flow_open', state: { state: 'starting' } })
    await waitFor(() => expect(client.getAccountSignIn).toHaveBeenCalledWith('flow_open'))
    expect(client.cancelAccountSignIn).not.toHaveBeenCalledWith('flow_open')
    screenTwo.unmount()
    expect(client.cancelAccountSignIn).toHaveBeenCalledWith('flow_open')
  })

  it(
    'signs a new account in in the browser, takes a pasted code, and names it as who signed in',
    async () => {
      const codex = withWays(['browser', 'device'], usual('acc_usual', 'signed_in'))
      const states: AccountSignInState[] = [
        { state: 'browser', link: 'https://auth.openai.com/oauth/authorize?x=1', paste: true, refused: null },
        { state: 'browser', link: 'https://auth.openai.com/oauth/authorize?x=1', paste: true, refused: 'Invalid code.' },
        { state: 'done', who: 'dana@northwind.io', plan: 'ChatGPT Team' },
      ]
      let at = 0
      const { client } = fakeClient({ status: codex.status, getAccountSignIn: vi.fn(async () => states[Math.min(at, states.length - 1)]!) })
      withServices(<Settings />, client)
      const accounts = await codexAccounts()
      await userEvent.click(screen.getByRole('button', { name: 'Add an account' }))
      await userEvent.click(within(accounts).getByRole('button', { name: 'Continue with ChatGPT' }))
      await waitFor(() => expect(client.startAccountSignIn).toHaveBeenCalledWith('acc_added', 'browser'))
      expect(await within(accounts).findByText('Approve on chatgpt.com in your browser')).toBeTruthy()
      // A code the page showed goes to the agent; one it turns down says so.
      await userEvent.click(await within(accounts).findByRole('button', { name: 'Paste a code' }))
      await userEvent.type(within(accounts).getByRole('textbox', { name: 'The code chatgpt.com showed' }), 'AB12{Enter}')
      expect(client.pasteAccountSignInCode).toHaveBeenCalledWith('flow_account', 'AB12')
      at = 1
      expect(await within(accounts).findByText('Invalid code.', {}, { timeout: 3000 })).toBeTruthy()
      at = 2
      const name = await within(accounts).findByRole('textbox', { name: 'Name this account' }, { timeout: 3000 })
      expect((name as HTMLInputElement).value).toBe('Account 2')
      expect(within(accounts).getByText('dana@northwind.io')).toBeTruthy()
      expect(within(accounts).getByText('ChatGPT Team')).toBeTruthy()
      await userEvent.click(within(accounts).getByRole('button', { name: 'Add account' }))
      await waitFor(() => expect(within(accounts).queryByRole('textbox', { name: 'Name this account' })).toBeNull())
    },
    LONG_FLOW,
  )

  it('gives a one-time code with its page, signs one in again by its ways, and leaves the agent’s login when left', async () => {
    const codex = withWays(['browser', 'device'], usual('acc_usual', 'signed_in'), {
      ...usual('acc_x', 'signed_out'),
      name: 'x',
      home: '/x',
    })
    let finished = false
    const getAccountSignIn = vi.fn(async (): Promise<AccountSignInState> =>
      finished
        ? { state: 'done', who: null, plan: null }
        : {
            state: 'device',
            code: 'LNBY-V0Q5J',
            page: 'https://auth.openai.com/codex/device',
            expiresAt: new Date(Date.now() + 14 * 60_000).toISOString(),
          },
    )
    const { client } = fakeClient({ status: codex.status, getAccountSignIn })
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    withServices(<Settings />, client)
    const accounts = await codexAccounts()
    await userEvent.click(within(accounts).getByRole('button', { name: 'Sign in' }))
    expect(within(accounts).getByRole('button', { name: 'Sign in again' })).toBeTruthy()
    await userEvent.click(within(accounts).getByRole('button', { name: 'A code' }))
    await waitFor(() => expect(client.startAccountSignIn).toHaveBeenCalledWith('acc_x', 'device'))
    expect(await within(accounts).findByText('LNBY-V0Q5J')).toBeTruthy()
    expect(within(accounts).getByText('Enter the code at auth.openai.com/codex/device')).toBeTruthy()
    expect(within(accounts).getByText('lasts 14 min')).toBeTruthy()
    await userEvent.click(within(accounts).getByRole('button', { name: 'Open the page' }))
    expect(open).toHaveBeenCalledWith('https://auth.openai.com/codex/device', '_blank')
    expect(await within(accounts).findByText('Waiting for the code')).toBeTruthy()
    // Another way stops the agent's login, and offers the ways again.
    await userEvent.click(within(accounts).getByRole('button', { name: 'Another way' }))
    expect(client.cancelAccountSignIn).toHaveBeenCalledWith('flow_account')
    expect(within(accounts).getByRole('button', { name: 'In Terminal' })).toBeTruthy()
    // Signed in again: back to its line, nothing to name.
    await userEvent.click(within(accounts).getByRole('button', { name: 'Sign in again' }))
    finished = true
    await waitFor(() => expect(within(accounts).queryByRole('group', { name: 'Signing x in' })).toBeNull(), { timeout: 3000 })
    open.mockRestore()
  })

  it('removes the account made for a sign-in that is left, by Cancel or Escape', async () => {
    const codex = codexWith(usual('acc_usual', 'signed_in'))
    const { client } = fakeClient({ status: codex.status })
    withServices(<Settings />, client)
    const accounts = await codexAccounts()
    await userEvent.click(screen.getByRole('button', { name: 'Add an account' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sign in in Terminal' }))
    await within(accounts).findByText('Finish signing in in Terminal')
    await userEvent.click(within(accounts).getByRole('button', { name: 'Cancel signing in' }))
    await waitFor(() => expect(client.removeAccount).toHaveBeenCalledWith('acc_added'))
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()

    // Escape in the sign-in leaves it, not the panel; nothing was made yet, so nothing is removed.
    await userEvent.click(screen.getByRole('button', { name: 'Add an account' }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(within(accounts).queryByText('New account')).toBeNull())
    expect(client.removeAccount).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy()
  })

  it('opens Terminal again, and goes back to the ways in, removing the account made, signed out or not', async () => {
    const codex = codexWith(usual('acc_usual', 'signed_in'))
    const removeAccount = vi.fn(async (_accountId: string, anyway?: boolean) => {
      if (anyway !== true) throw new ApiError({ reason: 'SignOutFailed', message: 'Althar couldn’t sign this account out.' })
    })
    const { client } = fakeClient({ status: codex.status, removeAccount })
    withServices(<Settings />, client)
    const accounts = await codexAccounts()
    await userEvent.click(screen.getByRole('button', { name: 'Add an account' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sign in in Terminal' }))
    await waitFor(() => expect(client.signInAccount).toHaveBeenCalledTimes(1))
    await userEvent.click(await within(accounts).findByRole('button', { name: 'Open Terminal again' }))
    await waitFor(() => expect(client.signInAccount).toHaveBeenCalledTimes(2))

    // Another way: the account made goes, signed out or not.
    await userEvent.click(within(accounts).getByRole('button', { name: 'Another way' }))
    await waitFor(() => expect(removeAccount).toHaveBeenLastCalledWith('acc_added', true))
    expect(within(accounts).getByRole('button', { name: 'Sign in in Terminal' })).toBeTruthy()
  })

  it('says what stopped a new account, and removes one made after the sign-in was left', async () => {
    const codex = codexWith(usual('acc_usual', 'signed_in'))
    const { client } = fakeClient({ status: codex.status })
    withServices(<Settings />, client)
    const accounts = await codexAccounts()
    await userEvent.click(screen.getByRole('button', { name: 'Add an account' }))

    // The runtime turning the new account down says why, and goes back to the ways in.
    vi.mocked(client.addAccount).mockRejectedValueOnce(new ApiError({ reason: 'AccountFailed', message: 'No room for another folder.' }))
    await userEvent.click(within(accounts).getByRole('button', { name: 'Sign in in Terminal' }))
    expect(await within(accounts).findByText('No room for another folder.')).toBeTruthy()
    await userEvent.click(within(accounts).getByRole('button', { name: 'Try again' }))
    expect(within(accounts).getByRole('button', { name: 'Sign in in Terminal' })).toBeTruthy()

    // Left while the account was being made: it goes once it is.
    let made: (account: Awaited<ReturnType<typeof client.addAccount>>) => void = () => {}
    vi.mocked(client.addAccount).mockImplementationOnce(() => new Promise((resolve) => void (made = resolve)))
    await userEvent.click(within(accounts).getByRole('button', { name: 'Sign in in Terminal' }))
    await userEvent.click(within(accounts).getByRole('button', { name: 'Cancel signing in' }))
    await act(async () => made({ ...usual('acc_late', 'signed_out'), name: 'Account 2', home: '/late' }))
    await waitFor(() => expect(client.removeAccount).toHaveBeenCalledWith('acc_late'))
    expect(client.signInAccount).not.toHaveBeenCalled()
  })

  it('says a key is paid per use when it is named', async () => {
    const codex = codexWith(usual('acc_usual', 'signed_in'))
    const { client } = fakeClient({
      status: codex.status,
      addAccount: vi.fn(async () => ({ ...usual('acc_key', 'signed_in'), name: 'Account 2', home: '/key', paidBy: 'key' as const })),
    })
    withServices(<Settings />, client)
    await codexAccounts()
    await userEvent.click(screen.getByRole('button', { name: 'Add an account' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sign in in Terminal' }))
    expect(await within(screen.getByRole('group', { name: 'New account' })).findByText('per use')).toBeTruthy()
  })

  it('adds a folder a switcher made, or one the person picks, and goes back to the ways in, removing what a way made', async () => {
    const codex = codexWith(usual('acc_usual', 'signed_in'))
    const { client } = fakeClient({
      status: codex.status,
      addAccount: vi.fn(async (input: { readonly agentId: string; readonly name: string; readonly grant?: string }) => ({
        ...usual('acc_added', 'signed_in'),
        name: input.name,
        home: '/Users/me/.codex-work',
        adoptedFrom: 'codex-profiles',
      })),
    })
    const host = fakeHost({ pickFolder: vi.fn(async () => 'grant_chosen') })
    withServices(<Settings />, client, host)
    const accounts = await codexAccounts()
    await userEvent.click(screen.getByRole('button', { name: 'Add an account' }))
    await waitFor(() => expect(client.findAccounts).toHaveBeenCalledWith('codex'))
    await userEvent.click(within(accounts).getByRole('button', { name: 'A folder on this Mac' }))
    expect(within(accounts).getByText('~/.codex-work · codex-profiles')).toBeTruthy()
    await userEvent.click(within(accounts).getByRole('button', { name: 'Add it' }))
    await waitFor(() => expect(client.addAccount).toHaveBeenCalledWith({ agentId: 'codex', name: 'work', grant: 'grant_work' }))
    // Already signed in there: straight to its name.
    expect(((await within(accounts).findByRole('textbox', { name: 'Name this account' })) as HTMLInputElement).value).toBe('work')
    await userEvent.click(within(accounts).getByRole('button', { name: 'Add account' }))
    await waitFor(() => expect(within(accounts).queryByRole('textbox', { name: 'Name this account' })).toBeNull())
    expect(client.renameAccount).not.toHaveBeenCalled()

    // A folder the person picks, then back to the ways in: what it made goes.
    await userEvent.click(screen.getByRole('button', { name: 'Add an account' }))
    await userEvent.click(within(accounts).getByRole('button', { name: 'A folder on this Mac' }))
    await userEvent.click(within(accounts).getByRole('button', { name: 'Another folder…' }))
    expect(host.pickFolder).toHaveBeenCalledWith('account')
    await waitFor(() => expect(client.addAccount).toHaveBeenLastCalledWith({ agentId: 'codex', name: 'Account 2', grant: 'grant_chosen' }))
    await within(accounts).findByRole('textbox', { name: 'Name this account' })
    await userEvent.click(within(accounts).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(client.removeAccount).toHaveBeenCalledWith('acc_added'))
  })

  it('signs an account in again in Terminal, or says the line to run where Terminal can’t open, and says what stopped it', async () => {
    const codex = codexWith(usual('acc_usual', 'signed_in'), { ...usual('acc_x', 'signed_out'), name: 'x', home: '/x' })
    const signInAccount = vi.fn(async () => ({ line: 'CODEX_HOME=/x codex login', opened: false }))
    const { client } = fakeClient({ status: codex.status, signInAccount })
    withServices(<Settings />, client)
    const accounts = await codexAccounts()
    await userEvent.click(within(accounts).getByRole('button', { name: 'Sign in' }))
    expect(signInAccount).toHaveBeenCalledWith('acc_x')
    expect(await within(accounts).findByText('Run this in a terminal to sign in')).toBeTruthy()
    expect(within(accounts).getByText('CODEX_HOME=/x codex login')).toBeTruthy()
    // Another way goes back to its ways in, here only Terminal.
    expect(within(accounts).getByRole('button', { name: 'Another way' })).toBeTruthy()

    // Signed in, it goes back to its line.
    codex.next(usual('acc_usual', 'signed_in'), { ...usual('acc_x', 'signed_in'), name: 'x', home: '/x' })
    await userEvent.click(within(accounts).getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(within(accounts).queryByText('Run this in a terminal to sign in')).toBeNull())

    // The agent's sign-in failing to start says so, and tries again.
    signInAccount.mockRejectedValueOnce(new ApiError({ reason: 'NotInstalled', message: 'codex isn’t installed' }))
    await userEvent.click(within(accounts).getByRole('button', { name: 'More for x' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign in again' }))
    expect(await within(accounts).findByText('codex isn’t installed')).toBeTruthy()
    // Try again goes back to its ways in.
    await userEvent.click(within(accounts).getByRole('button', { name: 'Try again' }))
    await userEvent.click(within(accounts).getByRole('button', { name: 'Sign in in Terminal' }))
    await waitFor(() => expect(signInAccount).toHaveBeenCalledTimes(3))
  })

  it('renames, moves and removes accounts', async () => {
    const codex = codexWith(usual('acc_usual', 'signed_in'), work)
    const { client } = fakeClient({ status: codex.status })
    withServices(<Settings />, client)
    const accounts = await codexAccounts()
    await userEvent.click(within(accounts).getByRole('button', { name: 'More for work' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    await userEvent.clear(within(accounts).getByRole('textbox', { name: 'Name' }))
    await userEvent.type(within(accounts).getByRole('textbox', { name: 'Name' }), 'work plan{Enter}')
    await waitFor(() => expect(client.renameAccount).toHaveBeenCalledWith('acc_work', 'work plan'))
    await userEvent.click(within(accounts).getByRole('button', { name: 'More for work' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move up' }))
    await waitFor(() => expect(client.orderAccounts).toHaveBeenCalledWith('codex', ['acc_work', 'acc_usual']))
    await userEvent.click(within(accounts).getByRole('button', { name: 'More for work' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Remove/ }))
    await waitFor(() => expect(client.removeAccount).toHaveBeenCalledWith('acc_work'))
  })

  it('offers to remove an account anyway when its sign-out didn’t work', async () => {
    const codex = codexWith(usual('acc_usual', 'signed_in'), { ...usual('acc_x', 'signed_in'), name: 'x', home: '/x' })
    const { client } = fakeClient({
      removeAccount: vi.fn(async (_accountId: string, anyway?: boolean) => {
        if (anyway !== true) throw new ApiError({ reason: 'SignOutFailed', message: 'Althar couldn’t sign this account out.' })
      }),
      status: codex.status,
    })
    withServices(<Settings />, client)
    const accounts = await codexAccounts()
    await userEvent.click(within(accounts).getByRole('button', { name: 'More for x' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Remove/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('couldn’t sign this account out')
    await userEvent.click(screen.getByRole('button', { name: 'Remove anyway' }))
    await waitFor(() => expect(client.removeAccount).toHaveBeenLastCalledWith('acc_x', true))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove anyway' })).toBeNull())
  })
})

describe('the start', () => {
  it('shows the home once there are projects, and opens one', async () => {
    const onProject = vi.fn()
    const { client, emit, watching } = fakeClient()
    withServices(<Start onProject={onProject} />, client)
    const projects = await screen.findByRole('complementary', { name: 'Projects' })
    await userEvent.click(await within(projects).findByRole('button', { name: /meridian/ }))
    expect(onProject).toHaveBeenCalledWith('p1')

    // A change to a project reads the list again; a change to anything else doesn't.
    // The home shows the agents as the runtime last checked them: they are asked again once a launch, and when the window comes back.
    expect(client.status).not.toHaveBeenCalledWith({ recheck: true })
    emit(changed('task', 't1'))
    emit(changed('thread_item', 'i1'))
    emit(streamed('i1', 'Hi'))
    await waitFor(() => expect(client.listProjects).toHaveBeenCalledTimes(2))
    // The window watches once, for the projects and the home alike.
    expect(watching).toHaveLength(1)
  })

  it('opens a folder as a project: from the button, from ⌘N, and dropped on the window', async () => {
    const onProject = vi.fn()
    const { client } = fakeClient({ getHome: vi.fn(async () => home({ projects: [{ ...project, running: 0, waiting: 2 }] })) })
    const host = fakeHost()
    const view = withServices(<Start onProject={onProject} />, client, host)
    await screen.findByRole('complementary', { name: 'Projects' })
    await userEvent.click(screen.getByRole('button', { name: 'Open a folder' }))
    await waitFor(() => expect(onProject).toHaveBeenCalledTimes(1))
    expect(client.openProject).toHaveBeenCalledWith('grant_picked')

    fireEvent.keyDown(window, { key: 'n', metaKey: true })
    fireEvent.keyDown(window, { key: 'n', metaKey: true, shiftKey: true })
    fireEvent.keyDown(window, { key: 'm', metaKey: true })
    await waitFor(() => expect(onProject).toHaveBeenCalledTimes(2))

    const root = view.container.firstElementChild as Element
    const folder = new File([], 'meridian')
    fireEvent.dragOver(root)
    fireEvent.drop(root, { dataTransfer: { files: [folder] } })
    await waitFor(() => expect(client.openProject).toHaveBeenCalledWith('grant_dropped'))
    expect(host.grantDropped).toHaveBeenCalledWith(folder)
    fireEvent.drop(root, { dataTransfer: { files: [] } })
    expect(host.grantDropped).toHaveBeenCalledTimes(1)
  })

  it('opens a folder of several repositories with the ones the person keeps, and others they add', async () => {
    const onProject = vi.fn()
    const found = (name: string, at: string) => ({ path: `${at}/${name}`, folder: null, name, branch: 'main', remote: null })
    const readFolder = vi.fn(async (grant: string) =>
      grant === 'grant_picked'
        ? {
            kind: 'folder' as const,
            name: 'meridian',
            repositories: [found('api', '/code/meridian'), found('docs', '/code/meridian'), found('web', '/code/meridian')],
            project: null,
          }
        : { kind: 'repository' as const, name: 'tools', repositories: [found('tools', '/code')], project: null },
    )
    const { client } = fakeClient({ readFolder })
    const pickFolder = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce('grant_picked').mockResolvedValueOnce('grant_more')
    withServices(<Start onProject={onProject} />, client, fakeHost({ pickFolder }))
    await userEvent.click(await screen.findByRole('button', { name: 'Open a folder' }))
    expect(await screen.findByText('Althar found 3 git repositories in meridian. Leave out any its tasks shouldn’t change.')).toBeTruthy()
    expect(client.openProject).not.toHaveBeenCalled()
    // Left out, and one added from elsewhere.
    await userEvent.click(screen.getByRole('button', { name: 'Remove docs' }))
    await userEvent.click(screen.getByRole('button', { name: /Choose folders/ }))
    expect(await screen.findByText('tools')).toBeTruthy()
    await userEvent.click(screen.getByRole('radio', { name: /Ask me/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(onProject).toHaveBeenCalledTimes(1))
    expect(client.openProject).toHaveBeenCalledWith('grant_picked', {
      name: 'meridian',
      repositories: [
        { grant: 'grant_picked', path: '/code/meridian/api' },
        { grant: 'grant_picked', path: '/code/meridian/web' },
        { grant: 'grant_more', path: '/code/tools' },
      ],
    })
    expect(client.setProjectRules).toHaveBeenCalledWith({ projectId: 'p1', permissions: 'ask' })
  })

  it('says what went wrong forming a project, keeps at least one repository, and goes back when cancelled', async () => {
    const found = (name: string) => ({ path: `/code/meridian/${name}`, folder: null, name, branch: null, remote: 'git@github.com:m/a.git' })
    const readFolder = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'folder' as const, name: 'meridian', repositories: [found('api'), found('web')], project: null })
      .mockRejectedValueOnce(new ApiError({ reason: 'NotFound', message: 'That folder isn’t there any more.' }))
      .mockResolvedValueOnce({
        kind: 'inside' as const,
        name: 'web',
        repositories: [{ path: '/code/monorepo', folder: 'packages/web', name: 'monorepo', branch: 'main', remote: null }],
        project: null,
      })
    const openProject = vi.fn(async () => Promise.reject(new ApiError({ reason: 'GitFailed', message: 'Git couldn’t read it.' })))
    const { client } = fakeClient({ readFolder, openProject })
    const pickFolder = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce('grant_picked')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('grant_gone')
      .mockResolvedValueOnce('grant_inside')
    withServices(<Start onProject={vi.fn()} />, client, fakeHost({ pickFolder }))
    await userEvent.click(await screen.findByRole('button', { name: 'Open a folder' }))
    await screen.findByText('Althar found 2 git repositories in meridian. Leave out any its tasks shouldn’t change.')
    // Choosing no folder adds nothing; one that's gone says so.
    await userEvent.click(screen.getByRole('button', { name: /Choose folders/ }))
    await userEvent.click(screen.getByRole('button', { name: /Choose folders/ }))
    expect(await screen.findByText('That folder isn’t there any more.')).toBeTruthy()
    // A folder inside a repository isn't one of several: the repository itself is what's added.
    await userEvent.click(screen.getByRole('button', { name: /Choose folders/ }))
    expect(await screen.findByText('That’s a folder inside monorepo. Add monorepo itself.')).toBeTruthy()
    expect(screen.queryByText('monorepo', { exact: true })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByText('Git couldn’t read it.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Remove api' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove web' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByText('Keep at least one repository.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeTruthy()
  })

  it('makes a project of the repositories kept, with the rules as they are by default', async () => {
    const onProject = vi.fn()
    const found = (name: string) => ({ path: `/code/meridian/${name}`, folder: null, name, branch: 'main', remote: null })
    const readFolder = vi.fn(async () => ({
      kind: 'folder' as const,
      name: 'meridian',
      repositories: [found('api'), found('web')],
      project: null,
    }))
    const { client } = fakeClient({ readFolder })
    withServices(<Start onProject={onProject} />, client, fakeHost())
    await userEvent.click(await screen.findByRole('button', { name: 'Open a folder' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Create project' }))
    await waitFor(() => expect(onProject).toHaveBeenCalledTimes(1))
    expect(client.setProjectRules).not.toHaveBeenCalled()
  })

  it('opens a folder it read at once when it is a project already, or holds one repository', async () => {
    const onProject = vi.fn()
    const readFolder = vi.fn(async () => ({
      kind: 'folder' as const,
      name: 'meridian',
      repositories: [{ path: '/code/meridian/api', folder: null, name: 'api', branch: 'main', remote: null }],
      project: null,
    }))
    const { client } = fakeClient({ readFolder })
    withServices(<Start onProject={onProject} />, client, fakeHost())
    await userEvent.click(await screen.findByRole('button', { name: 'Open a folder' }))
    await waitFor(() => expect(onProject).toHaveBeenCalledTimes(1))
    expect(client.openProject).toHaveBeenCalledWith('grant_picked')
  })

  it('offers to download an agent that isn’t on this Mac, says it downloads, and why it didn’t finish', async () => {
    let installing = false
    let finish: () => void = () => {}
    const { client } = fakeClient({
      listProjects: vi.fn(async () => ({ cursor: 0, projects: [] })),
      status: vi.fn(async () => ({
        apiVersion: 1,
        appVersion: '0.0.0',
        agents: withoutOpenCode.map((agent) => (agent.id === 'opencode' ? { ...agent, download: { size: '45 MB', installing } } : agent)),
      })),
      // The download runs until the test lets it end, so its row is seen downloading however slow the machine.
      installAgent: vi.fn(async () => {
        installing = true
        await new Promise<void>((resolve) => (finish = resolve))
        installing = false
        throw new ApiError({ reason: 'InstallFailed', message: 'GitHub couldn’t be reached to find OpenCode.' })
      }),
    })
    withServices(<Start onProject={vi.fn()} />, client, fakeHost())
    expect(await screen.findByText('Not installed on this Mac')).toBeTruthy()
    expect(screen.getByText(/latest release from GitHub, about 45 MB/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(client.installAgent).toHaveBeenCalledWith('opencode')
    expect(await screen.findByText('Downloading OpenCode, about 45 MB, and checking it')).toBeTruthy()
    finish()
    expect((await screen.findByRole('alert')).textContent).toBe('GitHub couldn’t be reached to find OpenCode.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('offers the repositories found where people keep code, and makes the first project of those ticked', async () => {
    const onProject = vi.fn()
    const findRepositories = vi.fn(async () => ({
      lookedIn: ['~/Projects', '~/code'],
      repositories: [
        { id: 'r1', name: 'meridian', where: '~/Projects/meridian', branch: 'main', worked: Date.now() - 2 * 3600_000 },
        { id: 'r2', name: 'halyard', where: '~/code/halyard', branch: null, worked: 0 },
      ],
    }))
    const root = (grant: string) => (grant === 'grant_r1' ? '/Users/me/Projects/meridian' : '/Users/me/code/halyard')
    const readFolder = vi.fn(async (grant: string) => ({
      kind: 'repository' as const,
      name: grant,
      repositories: [{ path: root(grant), folder: null, name: grant, branch: 'main', remote: null }],
      project: null,
    }))
    const { client } = fakeClient({ listProjects: vi.fn(async () => ({ cursor: 0, projects: [] })), readFolder })
    const host = fakeHost({ findRepositories })
    withServices(<Start onProject={onProject} />, client, host)
    const found = await screen.findByRole('list', { name: 'Repositories for the project' })
    expect(screen.getByText('in ~/Projects, ~/code')).toBeTruthy()
    expect(
      within(found)
        .getByRole('checkbox', { name: /meridian/ })
        .closest('label')?.textContent,
    ).toBe('meridian~/Projects/meridianmain · 2h ago')
    expect(
      within(found)
        .getByRole('checkbox', { name: /halyard/ })
        .closest('label')?.textContent,
    ).toBe('halyard~/code/halyard')
    // Nothing is granted until the project is made.
    await userEvent.click(within(found).getByRole('checkbox', { name: /halyard/ }))
    await userEvent.click(within(found).getByRole('checkbox', { name: /meridian/ }))
    const name = screen.getByRole('textbox', { name: 'Project name' })
    expect((name as HTMLInputElement).value).toBe('halyard')
    expect(host.grantFound).not.toHaveBeenCalled()
    await userEvent.clear(name)
    await userEvent.type(name, 'Halyard')
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(onProject).toHaveBeenCalledWith('p1'))
    expect(host.grantFound).toHaveBeenCalledWith('r2')
    expect(host.grantFound).toHaveBeenCalledWith('r1')
    expect(client.openProject).toHaveBeenCalledWith('grant_r2', {
      name: 'Halyard',
      repositories: [
        { grant: 'grant_r2', path: '/Users/me/code/halyard' },
        { grant: 'grant_r1', path: '/Users/me/Projects/meridian' },
      ],
    })
  })

  it('adds a folder from anywhere, picked, by ⌘N or dropped, each of several repositories ticked, and opens one alone as itself', async () => {
    const onProject = vi.fn()
    const found = (name: string, at: string) => ({ path: `${at}/${name}`, folder: null, name, branch: 'main', remote: null })
    const readFolder = vi.fn(async (grant: string) =>
      grant === 'grant_picked'
        ? { kind: 'folder' as const, name: 'work', repositories: [found('api', '/w'), found('web', '/w')], project: null }
        : {
            kind: 'inside' as const,
            name: 'docs',
            repositories: [{ path: '/m/mono', folder: 'docs', name: 'mono', branch: 'main', remote: null }],
            project: null,
          },
    )
    const { client } = fakeClient({ listProjects: vi.fn(async () => ({ cursor: 0, projects: [] })), readFolder })
    const host = fakeHost()
    withServices(<Start onProject={onProject} />, client, host)
    await userEvent.click(await screen.findByRole('button', { name: /Add a folder/ }))
    const list = screen.getByRole('list', { name: 'Repositories for the project' })
    expect(within(list).getByRole('checkbox', { name: /api/ }).getAttribute('aria-checked')).toBe('true')
    expect(within(list).getByRole('checkbox', { name: /web/ }).getAttribute('aria-checked')).toBe('true')
    expect((screen.getByRole('textbox', { name: 'Project name' }) as HTMLInputElement).value).toBe('api')
    // Picked again, nothing new is listed twice.
    fireEvent.keyDown(window, { key: 'n', metaKey: true })
    await waitFor(() => expect(host.pickFolder).toHaveBeenCalledTimes(2))
    expect(within(list).getAllByRole('checkbox', { name: /api/ })).toHaveLength(1)
    await userEvent.click(within(list).getByRole('checkbox', { name: /api/ }))
    await userEvent.click(within(list).getByRole('checkbox', { name: /web/ }))

    // A folder inside a repository, dropped: alone, it opens as the folder it is.
    // Dropped anywhere on the screen: on the list, here.
    fireEvent.drop(list, { dataTransfer: { types: ['Files'], files: [new File([], 'docs')] } })
    expect(await within(list).findByRole('checkbox', { name: /docs.*~?\/m\/mono\/docs/ })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Make the project/ }))
    await waitFor(() => expect(onProject).toHaveBeenCalledWith('p1'))
    expect(client.openProject).toHaveBeenCalledWith('grant_dropped', { name: 'docs' })
  })

  it('says what went wrong making the first project, and when nothing was found or the runtime can’t answer', async () => {
    const readFolder = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'folder' as const, name: 'empty', repositories: [], project: null })
      .mockRejectedValueOnce(new ApiError({ reason: 'NotFound', message: 'That folder isn’t there any more.' }))
    const failure = new ApiError({ reason: 'GitFailed', message: 'Git couldn’t read it.' })
    const { client } = fakeClient({
      listProjects: vi.fn(async () => ({ cursor: 0, projects: [] })),
      readFolder,
      openProject: vi.fn(async () => Promise.reject(failure)),
    })
    const host = fakeHost({
      findRepositories: vi.fn(async () => ({
        lookedIn: [],
        repositories: [{ id: 'r1', name: 'gone', where: '~/gone', branch: null, worked: 0 }],
      })),
      grantFound: vi.fn(async () => null),
      grantDropped: vi.fn(async () => null),
    })
    const onProject = vi.fn()
    withServices(<Start onProject={onProject} />, client, host)
    await screen.findByRole('heading', { name: 'Where should they work?' })
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    expect(await screen.findByText('Tick a repository for the project first.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Add a folder/ }))
    expect(await screen.findByText('There’s no git repository in empty.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Add a folder/ }))
    expect(await screen.findByText('That folder isn’t there any more.')).toBeTruthy()
    const list = screen.getByRole('list', { name: 'Repositories for the project' })
    fireEvent.drop(list, { dataTransfer: { types: ['Files'], files: [new File([], 'notes.txt')] } })
    expect(await screen.findByText('notes.txt isn’t a folder on this computer.')).toBeTruthy()
    // One found but no longer granted says so.
    await userEvent.click(screen.getByRole('checkbox', { name: /gone/ }))
    await userEvent.click(screen.getByRole('button', { name: /Make the project/ }))
    expect(await screen.findByText('Althar couldn’t open gone. Add it with Add a folder.')).toBeTruthy()
    expect(client.openProject).not.toHaveBeenCalled()
    expect(onProject).not.toHaveBeenCalled()
  })

  it('offers no repositories when none were found or the look failed, and says when the runtime cannot answer', async () => {
    const { client } = fakeClient({
      listProjects: vi.fn(async () => Promise.reject(new Error('The runtime stopped'))),
      status: vi.fn(async () => Promise.reject(new Error('The runtime stopped'))),
    })
    const host = fakeHost({ pickFolder: vi.fn(async () => null), findRepositories: vi.fn(async () => Promise.reject(new Error('EACCES'))) })
    withServices(<Start onProject={vi.fn()} />, client, host)
    await screen.findAllByText("Althar's runtime didn't answer. If it keeps happening, restart Althar.")
    expect(await screen.findByRole('heading', { name: 'Where is your code?' })).toBeTruthy()
    expect(screen.getByText('None found in the usual places.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Add a folder/ }))
    expect(client.readFolder).not.toHaveBeenCalled()
  })

  it('says how each agent is signed in', () => {
    expect(agents.map((agent) => runtimeEntry(agent)).map((entry) => [entry.state, 'account' in entry])).toEqual([
      [RuntimeState.Ready, false],
      [RuntimeState.Ready, true],
      [RuntimeState.SignedOut, false],
    ])
  })

  it('needs its services', () => {
    function Bare() {
      useServices()
      return null
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Bare />)).toThrow('useServices needs a ServicesProvider')
  })
})
