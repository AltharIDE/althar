import { act, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { type AccountSignInState, type AgentStatus, ApiError, type Status } from '@althar/contracts'
import { SignInWay } from '@althar/ui'

import type { Client } from '../src/renderer/data/client'
import { type Host, ServicesProvider } from '../src/renderer/data/services'
import { useAccountSignIn } from '../src/renderer/features/accounts/useAccountSignIn'
import type { Section } from '../src/renderer/features/settings/sections'
import { SettingsPage } from '../src/renderer/features/settings/SettingsPage'
import { type StartModel, useStart } from '../src/renderer/features/start/useStart'
import { agents, fakeClient, fakeHost, usual } from './fixtures'
import { servicesFor, withServices } from './render'

/*
 * Signing an agent's account in, as its model walks it: what each way does
 * where the person presses it, what the agent's own login says as it is
 * asked, and what is left alone where nothing is under way, the person left,
 * or the agents aren't read yet.
 */

/** Codex as the runtime reads it, with the ways Althar can run its login and the accounts given. */
const codexWith = (ways: AgentStatus['ways'], ...accounts: AgentStatus['accounts']): Status => ({
  apiVersion: 1,
  appVersion: '0.0.0',
  agents: [{ ...agents[1]!, ways, accounts }],
})

/** The start's model as the accounts read it: the agents as given, read at the time given. */
const startOf = (status: Status | null, checkedAt = 1): StartModel => ({
  status,
  projects: [],
  error: null,
  recheck: vi.fn(async () => {}),
  install: vi.fn(async () => {}),
  installFailed: {},
  checkedAt,
  renameAccount: vi.fn(async () => {}),
  moveAccount: vi.fn(async () => {}),
  removeAccount: vi.fn(async () => {}),
  unremoved: null,
  removeAnyway: vi.fn(async () => {}),
})

/** The accounts' sign-in model, with the runtime and the host answering as the test says. */
const signInOf = (client: Client, start: StartModel, host: Host = fakeHost()) => {
  const services = servicesFor(client, host)
  return renderHook((props: { start: StartModel }) => useAccountSignIn(props.start), {
    initialProps: { start },
    wrapper: ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>,
  })
}

const usualCodex = usual('acc_usual', 'signed_in')

describe('an account’s sign-in, with nothing under way', () => {
  it('takes no way, opens nothing, pastes nothing, adds no folder, and keeps nothing', async () => {
    const { client } = fakeClient()
    const host = fakeHost()
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { result } = signInOf(client, startOf(codexWith(['browser'], usualCodex)), host)
    act(() => {
      result.current.way(SignInWay.Browser)
      result.current.reopen()
      result.current.paste('AB12')
      result.current.adopt('grant_work')
      result.current.chooseFolder()
      result.current.back()
      result.current.done('weekend')
    })
    expect(result.current.signingIn).toBeNull()
    expect(client.addAccount).not.toHaveBeenCalled()
    expect(client.pasteAccountSignInCode).not.toHaveBeenCalled()
    expect(client.renameAccount).not.toHaveBeenCalled()
    expect(host.pickFolder).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('offers no key or console way yet: pressing one stays on the ways in', async () => {
    const { client } = fakeClient()
    const { result } = signInOf(client, startOf(codexWith(['browser'], usualCodex)))
    act(() => result.current.add('codex'))
    act(() => result.current.way(SignInWay.Key))
    act(() => result.current.way(SignInWay.Console))
    expect(result.current.signingIn?.step).toEqual({ kind: 'choose' })
    // Before a way has made the account, there is nothing to open Terminal for again, and no code to paste.
    act(() => result.current.reopen())
    act(() => result.current.paste('AB12'))
    expect(client.addAccount).not.toHaveBeenCalled()
    expect(client.signInAccount).not.toHaveBeenCalled()
    expect(client.pasteAccountSignInCode).not.toHaveBeenCalled()
  })

  it('adds no folder that wasn’t found, and nothing for a picker closed without one or after the sign-in was left', async () => {
    let picked: (grant: string | null) => void = () => undefined
    const host = fakeHost({ pickFolder: vi.fn(() => new Promise<string | null>((resolve) => (picked = resolve))) })
    const { client } = fakeClient()
    const { result } = signInOf(client, startOf(codexWith([], usualCodex)), host)
    act(() => result.current.add('codex'))
    await waitFor(() => expect(result.current.found).toHaveLength(1))
    act(() => result.current.way(SignInWay.Folder))
    act(() => result.current.adopt('grant_elsewhere'))
    expect(result.current.signingIn?.step).toEqual({ kind: 'folders' })

    // The picker closed without a folder.
    act(() => result.current.chooseFolder())
    await act(async () => picked(null))
    expect(result.current.signingIn?.step).toEqual({ kind: 'folders' })

    // A folder picked once the sign-in was left.
    act(() => result.current.chooseFolder())
    act(() => result.current.cancel())
    await act(async () => picked('grant_late'))
    expect(result.current.signingIn).toBeNull()
    expect(client.addAccount).not.toHaveBeenCalled()
  })
})

describe('the agent’s own login, as it is asked', () => {
  it('says what stopped it, in its words', async () => {
    const failed: AccountSignInState = { state: 'failed', message: 'The sign-in page closed before it finished.' }
    const { client } = fakeClient({ getAccountSignIn: vi.fn(async () => failed) })
    const { result } = signInOf(client, startOf(codexWith(['browser', 'device'], usualCodex)))
    act(() => result.current.add('codex'))
    act(() => result.current.way(SignInWay.Browser))
    await waitFor(() =>
      expect(result.current.signingIn?.step).toEqual({ kind: 'failed', said: 'The sign-in page closed before it finished.' }),
    )
    expect(client.startAccountSignIn).toHaveBeenCalledWith('acc_added', 'browser')
  })

  it('waits in the browser without a link where the agent gives none', async () => {
    const browser: AccountSignInState = { state: 'browser', link: null, paste: false, refused: null }
    const { client } = fakeClient({ getAccountSignIn: vi.fn(async () => browser) })
    const { result } = signInOf(client, startOf(codexWith(['browser'], usualCodex)))
    act(() => result.current.add('codex'))
    act(() => result.current.way(SignInWay.Browser))
    await waitFor(() => expect(client.getAccountSignIn).toHaveBeenCalledWith('flow_account'))
    await waitFor(() => expect(result.current.signingIn?.step).toEqual({ kind: 'browser', host: 'chatgpt.com', paste: false }))
  })

  it('keeps a code’s page as opened while the code is asked again', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const device: AccountSignInState = {
      state: 'device',
      code: 'LNBY-V0Q5J',
      page: 'https://auth.openai.com/codex/device',
      expiresAt: new Date(Date.now() + 9 * 60_000).toISOString(),
    }
    const getAccountSignIn = vi.fn(async () => device)
    const { client } = fakeClient({ getAccountSignIn })
    const { result } = signInOf(client, startOf(codexWith(['device'], usualCodex)))
    act(() => result.current.add('codex'))
    act(() => result.current.way(SignInWay.Code))
    await waitFor(() => expect(result.current.signingIn?.step).toMatchObject({ kind: 'code', code: 'LNBY-V0Q5J', lasts: '9 min' }))
    act(() => result.current.reopen())
    expect(open).toHaveBeenCalledWith('https://auth.openai.com/codex/device', '_blank')
    // Asked again a second later, as the window asks while it shows.
    await waitFor(() => expect(getAccountSignIn).toHaveBeenCalledTimes(2), { timeout: 3000 })
    expect(result.current.signingIn?.step).toMatchObject({ kind: 'code', opened: true })
    open.mockRestore()
  })

  it('names a new account without who or what pays where the agent says neither', async () => {
    const done: AccountSignInState = { state: 'done', who: null, plan: null }
    const { client } = fakeClient({ getAccountSignIn: vi.fn(async () => done) })
    const start = startOf(codexWith(['browser'], usualCodex))
    const { result } = signInOf(client, start)
    act(() => result.current.add('codex'))
    act(() => result.current.way(SignInWay.Browser))
    await waitFor(() => expect(result.current.signingIn?.step).toEqual({ kind: 'named', name: 'Account 2' }))
    expect(start.recheck).toHaveBeenCalled()
  })

  it('drops an answer to a sign-in that was left, rather than show it on the next', async () => {
    let answer: (state: AccountSignInState) => void = () => undefined
    const { client } = fakeClient({
      getAccountSignIn: vi.fn(() => new Promise<AccountSignInState>((resolve) => (answer = resolve))),
    })
    const { result } = signInOf(client, startOf(codexWith(['browser'], usualCodex)))
    act(() => result.current.add('codex'))
    act(() => result.current.way(SignInWay.Browser))
    await waitFor(() => expect(client.getAccountSignIn).toHaveBeenCalledWith('flow_account'))
    act(() => result.current.cancel())
    expect(client.cancelAccountSignIn).toHaveBeenCalledWith('flow_account')
    act(() => result.current.add('codex'))
    await act(async () => answer({ state: 'failed', message: 'Too late.' }))
    expect(result.current.signingIn?.step).toEqual({ kind: 'choose' })
  })
})

describe('the account a way signs in', () => {
  it('names one already signed in without what pays where the agent can’t say', async () => {
    const { client } = fakeClient({
      addAccount: vi.fn(async (input: { readonly agentId: string; readonly name: string; readonly grant?: string }) => ({
        ...usual('acc_added', 'signed_in'),
        name: input.name,
        paidBy: 'unknown' as const,
        home: '/Users/me/.codex-work',
        adoptedFrom: 'codex-profiles',
      })),
    })
    const { result } = signInOf(client, startOf(codexWith([], usualCodex)))
    act(() => result.current.add('codex'))
    await waitFor(() => expect(result.current.found).toHaveLength(1))
    act(() => result.current.way(SignInWay.Folder))
    act(() => result.current.adopt('grant_work'))
    await waitFor(() => expect(result.current.signingIn?.step).toEqual({ kind: 'named', name: 'work' }))
    expect(client.addAccount).toHaveBeenCalledWith({ agentId: 'codex', name: 'work', grant: 'grant_work' })
  })

  it('signs in the account one way made when another is taken, rather than making a second', async () => {
    const { client } = fakeClient({
      signInAccount: vi.fn(async () => {
        throw new ApiError({ reason: 'NotInstalled', message: 'codex isn’t installed' })
      }),
    })
    const { result } = signInOf(client, startOf(codexWith(['device'], usualCodex)))
    act(() => result.current.add('codex'))
    act(() => result.current.way(SignInWay.Terminal))
    await waitFor(() => expect(result.current.signingIn?.step).toEqual({ kind: 'failed', said: 'codex isn’t installed' }))
    act(() => result.current.way(SignInWay.Code))
    await waitFor(() => expect(client.startAccountSignIn).toHaveBeenCalledWith('acc_added', 'device'))
    expect(client.addAccount).toHaveBeenCalledTimes(1)
  })

  it('makes the first account, in Terminal at once, for an agent not read yet', async () => {
    const { client } = fakeClient()
    const { result } = signInOf(client, startOf(null))
    act(() => result.current.add('codex'))
    act(() => result.current.way(SignInWay.Terminal))
    await waitFor(() => expect(client.addAccount).toHaveBeenCalledWith({ agentId: 'codex', name: 'Account 1' }))

    // Signing one in again with no ways read: Terminal at once.
    act(() => result.current.again('codex', 'acc_x'))
    await waitFor(() => expect(client.signInAccount).toHaveBeenCalledWith('acc_x'))
    await waitFor(() => expect(result.current.signingIn?.step).toEqual({ kind: 'terminal', line: 'codex login', opened: true }))
  })
})

describe('signing in in Terminal', () => {
  it('says not yet once, however often the agents are read again while it isn’t', async () => {
    const { client } = fakeClient()
    const start = startOf(codexWith([], usualCodex), 1)
    const { result, rerender } = signInOf(client, start)
    act(() => result.current.add('codex'))
    act(() => result.current.way(SignInWay.Terminal))
    await waitFor(() => expect(result.current.signingIn?.step).toEqual({ kind: 'terminal', line: 'codex login', opened: true }))
    const made = { ...usual('acc_added', 'signed_out'), name: 'Account 2', home: '/Users/me/accounts/acc_added' }
    rerender({ start: { ...start, status: codexWith([], usualCodex, made), checkedAt: 2 } })
    expect(result.current.signingIn?.step).toEqual({ kind: 'terminal', line: 'codex login', opened: true, notYet: true })
    const step = result.current.signingIn?.step
    rerender({ start: { ...start, status: codexWith([], usualCodex, made), checkedAt: 3 } })
    expect(result.current.signingIn?.step).toBe(step)
  })

  it('drops what Terminal says, opened or not, once the sign-in was left', async () => {
    const answers: Array<{ resolve: (value: { line: string; opened: boolean }) => void; reject: (failure: unknown) => void }> = []
    const { client } = fakeClient({
      signInAccount: vi.fn(() => new Promise<{ line: string; opened: boolean }>((resolve, reject) => answers.push({ resolve, reject }))),
    })
    const { result } = signInOf(client, startOf(codexWith([], usualCodex, { ...usual('acc_x', 'signed_out'), name: 'x', home: '/x' })))
    act(() => result.current.again('codex', 'acc_x'))
    act(() => result.current.cancel())
    await act(async () => answers[0]!.resolve({ line: 'CODEX_HOME=/x codex login', opened: false }))
    expect(result.current.signingIn).toBeNull()

    act(() => result.current.again('codex', 'acc_x'))
    act(() => result.current.cancel())
    await act(async () => answers[1]!.reject(new ApiError({ reason: 'NotInstalled', message: 'codex isn’t installed' })))
    expect(result.current.signingIn).toBeNull()
  })
})

/* The Settings tab, on the agents. */
function Settings() {
  const [section, setSection] = useState<Section>('agents')
  return <SettingsPage start={useStart()} section={section} onSection={setSection} />
}

describe('an agent’s accounts in Settings', () => {
  const work = { ...usual('acc_work', 'signed_in'), name: 'work', home: '/Users/me/work' }

  it('moves one down, and says why one couldn’t be removed where it isn’t its sign-out', async () => {
    const { client } = fakeClient({
      status: vi.fn(async () => codexWith([], usualCodex, work)),
      removeAccount: vi.fn(async () => {
        throw new ApiError({ reason: 'AccountFailed', message: 'That account is working on a task.' })
      }),
    })
    withServices(<Settings />, client)
    const accounts = await screen.findByRole('list', { name: 'Codex accounts' })
    await userEvent.click(within(accounts).getByRole('button', { name: 'More for main' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move down' }))
    await waitFor(() => expect(client.orderAccounts).toHaveBeenCalledWith('codex', ['acc_work', 'acc_usual']))
    await userEvent.click(within(accounts).getByRole('button', { name: 'More for work' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Remove/ }))
    expect((await screen.findByRole('alert')).textContent).toContain('That account is working on a task.')
    expect(screen.queryByRole('button', { name: 'Remove anyway' })).toBeNull()
  })
})

describe('an agent whose maker warns about signing in from another app', () => {
  it('says so as a new account starts signing in', async () => {
    const antigravity: AgentStatus = {
      ...agents[1]!,
      id: 'antigravity',
      name: 'Antigravity',
      login: 'antigravity login',
      ways: [],
      accounts: [usual('acc_ag', 'signed_in')],
    }
    const { client } = fakeClient({ status: vi.fn(async () => ({ apiVersion: 1, appVersion: '0.0.0', agents: [antigravity] })) })
    withServices(<Settings />, client)
    const accounts = await screen.findByRole('list', { name: 'Antigravity accounts' })
    await userEvent.click(screen.getByRole('button', { name: 'Add an account' }))
    expect(
      within(accounts).getByText(
        'Google’s terms may count signing in to Antigravity from another app as a breach, which can suspend the account.',
      ),
    ).toBeTruthy()
  })
})
