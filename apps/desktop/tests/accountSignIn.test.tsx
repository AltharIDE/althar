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
import { agents, fakeClient, fakeHost, usual, withoutOpenCode } from './fixtures'
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

const copilotStatus = (installed = true): Status => ({
  ...codexWith(['browser'], usual('acc_copilot', 'signed_out')),
  agents: [
    {
      ...agents[1]!,
      id: 'copilot-direct',
      name: 'GitHub Copilot',
      login: '',
      installed,
      ways: ['browser'],
      accounts: [usual('acc_copilot', 'signed_out')],
    },
  ],
})

describe('Copilot sign-in without a terminal', () => {
  it('keeps the enterprise address when retrying a failed sign-in', async () => {
    const { client } = fakeClient()
    vi.spyOn(client, 'startAccountSignIn').mockRejectedValue(
      new ApiError({ reason: 'SignInFailed', message: 'GitHub could not be reached.' }),
    )
    const { result } = signInOf(client, startOf(copilotStatus()))
    act(() => result.current.again('copilot-direct', 'acc_copilot'))
    act(() => result.current.enterprise('company.ghe.com'))
    await waitFor(() => expect(result.current.signingIn?.step.kind).toBe('failed'))
    act(() => result.current.back())
    expect(result.current.signingIn?.step).toEqual({ kind: 'choose', enterprise: 'company.ghe.com' })
  })
  it('uses the selected enterprise hostname and never opens Terminal', async () => {
    const { client } = fakeClient()
    const { result } = signInOf(client, startOf(copilotStatus()))
    act(() => result.current.again('copilot-direct', 'acc_copilot'))
    act(() => result.current.enterprise('https://Company.GHE.com/'))
    await waitFor(() => expect(client.startAccountSignIn).toHaveBeenCalledWith('acc_copilot', 'browser', 'company.ghe.com'))
    expect(client.signInAccount).not.toHaveBeenCalled()
  })

  it('puts an invalid enterprise address back at its field', () => {
    const { client } = fakeClient()
    const { result } = signInOf(client, startOf(copilotStatus()))
    act(() => result.current.again('copilot-direct', 'acc_copilot'))
    act(() => result.current.enterprise('https://user:password@company.ghe.com'))
    expect(result.current.signingIn?.step).toMatchObject({
      kind: 'choose',
      enterprise: 'https://user:password@company.ghe.com',
      error: expect.any(String),
    })
    expect(client.startAccountSignIn).not.toHaveBeenCalled()
  })

  it('starts native sign-in without downloading an engine and cancels a late flow', async () => {
    const { client } = fakeClient()
    let finish: (value: { flowId: string; state: { state: 'starting' } }) => void = () => {}
    const starting = new Promise<{ flowId: string; state: { state: 'starting' } }>((resolve) => {
      finish = resolve
    })
    const install = vi.spyOn(client, 'installAgent')
    const cancel = vi.spyOn(client, 'cancelAccountSignIn')
    vi.spyOn(client, 'startAccountSignIn').mockReturnValue(starting)
    const { result } = signInOf(client, startOf(copilotStatus(false)))
    act(() => result.current.again('copilot-direct', 'acc_copilot'))
    act(() => result.current.way(SignInWay.Browser))
    expect(result.current.signingIn?.step.kind).toBe('checking')
    expect(install).not.toHaveBeenCalled()
    await waitFor(() => expect(client.startAccountSignIn).toHaveBeenCalled())
    act(() => result.current.cancel())
    await act(async () => {
      finish({ flowId: 'late-native-flow', state: { state: 'starting' } })
      await starting
    })
    expect(cancel).toHaveBeenCalledWith('late-native-flow')
    expect(result.current.signingIn).toBeNull()
  })

  it('explains a native sign-in failure and returns to a usable sign-in', async () => {
    const { client } = fakeClient()
    vi.spyOn(client, 'startAccountSignIn').mockRejectedValue(
      new ApiError({ reason: 'CopilotFailed', message: 'GitHub did not approve this application.' }),
    )
    const { result } = signInOf(client, startOf(copilotStatus(false)))
    act(() => result.current.again('copilot-direct', 'acc_copilot'))
    act(() => result.current.way(SignInWay.Browser))
    await waitFor(() =>
      expect(result.current.signingIn?.step).toEqual({ kind: 'failed', said: 'GitHub did not approve this application.' }),
    )
    act(() => result.current.back())
    expect(result.current.signingIn?.step.kind).toBe('choose')
  })
})

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
    await waitFor(() => expect(getAccountSignIn).toHaveBeenCalledTimes(2))
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

  it('says it couldn’t tell where the agent answered something unreadable, and shows it is checking again', async () => {
    const { client } = fakeClient()
    const start = startOf(codexWith([], usualCodex), 1)
    let done = () => {}
    const recheck = vi.fn(() => new Promise<void>((resolve) => (done = resolve)))
    const { result, rerender } = signInOf(client, { ...start, recheck })
    act(() => result.current.add('codex'))
    act(() => result.current.way(SignInWay.Terminal))
    await waitFor(() => expect(result.current.signingIn?.step).toEqual({ kind: 'terminal', line: 'codex login', opened: true }))
    act(() => result.current.check())
    expect(result.current.signingIn?.step).toMatchObject({ kind: 'terminal', checking: true })
    const made = { ...usual('acc_added', 'unknown'), name: 'Account 2', home: '/Users/me/accounts/acc_added' }
    rerender({ start: { ...start, recheck, status: codexWith([], usualCodex, made), checkedAt: 2 } })
    await act(async () => done())
    expect(result.current.signingIn?.step).toMatchObject({ notYet: true, unclear: true, checking: false })
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

describe('Settings opened to sign an agent in again, from its error', () => {
  it('opens that agent, its signed-out account’s sign-in started and focused, once', async () => {
    const out = usual('acc_out', 'signed_out')
    const { client } = fakeClient({ status: vi.fn(async () => codexWith(['browser'], usualCodex, out)) })
    function Asked() {
      const [section, setSection] = useState<Section>('agents')
      return <SettingsPage start={useStart()} section={section} onSection={setSection} signIn="codex" />
    }
    withServices(<Asked />, client)
    // The ways to sign in again, in the line of the account that is signed out, with focus in them.
    const again = await screen.findByRole('button', { name: 'Sign in again' })
    await waitFor(() => expect(document.activeElement?.contains(again)).toBe(true))
    expect(screen.getByRole('tab', { name: /Codex/, selected: true })).toBeTruthy()
    expect(client.addAccount).not.toHaveBeenCalled()
  })

  it('signs in again the account whose provider refused its sign-in, not the first, where none is signed out', async () => {
    // Go's key refused on the second account (OpenCode Go from the popover's row); the first signed in and fine.
    const refused = {
      ...usual('acc_work', 'signed_in'),
      name: 'work',
      providers: [{ id: 'opencode-go', name: 'OpenCode Go', refusedAt: '2026-11-02T20:43:44.187Z', pays: 'plan' as const }],
    }
    const { client } = fakeClient({ status: vi.fn(async () => codexWith([], usualCodex, refused)) })
    function Asked() {
      return <SettingsPage start={useStart()} section="agents" onSection={() => {}} signIn="codex" />
    }
    withServices(<Asked />, client)
    await waitFor(() => expect(client.signInAccount).toHaveBeenCalledWith('acc_work'))
    expect(client.signInAccount).toHaveBeenCalledTimes(1)
  })
})

describe('Settings opened on an agent that isn’t installed, from a step that couldn’t start', () => {
  it('opens that agent’s tab, nothing started', async () => {
    const { client } = fakeClient({ status: vi.fn(async () => ({ apiVersion: 1, appVersion: '0.0.0', agents: withoutOpenCode })) })
    function Asked() {
      return <SettingsPage start={useStart()} section="agents" onSection={() => {}} agent="opencode" />
    }
    withServices(<Asked />, client)
    await waitFor(() => expect(screen.getByRole('tab', { name: /OpenCode/, selected: true })).toBeTruthy())
    expect(client.signInAccount).not.toHaveBeenCalled()
    expect(client.addAccount).not.toHaveBeenCalled()
  })
})

describe('Settings opened to sign in again an account whose sign-in ends soon', () => {
  it('starts the next account’s sign-in too, where it is another account of the same agent', async () => {
    // Claude Code (work) handled from the bar; Claude Code (personal) the next to end, while Settings is still open on the agent.
    const work = { ...usual('acc_work', 'signed_in'), name: 'work', home: '/Users/me/work' }
    const { client } = fakeClient({ status: vi.fn(async () => codexWith([], usualCodex, work)) })
    function Asked() {
      const [meant, setMeant] = useState('acc_work')
      return (
        <>
          <button type="button" onClick={() => setMeant('acc_usual')}>
            Next ending
          </button>
          <SettingsPage start={useStart()} section="agents" onSection={() => {}} signIn="codex" account={meant} />
        </>
      )
    }
    withServices(<Asked />, client)
    await waitFor(() => expect(client.signInAccount).toHaveBeenCalledWith('acc_work'))
    await userEvent.click(screen.getByRole('button', { name: 'Next ending' }))
    await waitFor(() => expect(client.signInAccount).toHaveBeenCalledWith('acc_usual'))
    expect(client.signInAccount).toHaveBeenCalledTimes(2)
  })
})

describe('a new OpenCode account, signed in', () => {
  it('says the providers it signed in to, as Settings does, not the account’s one word', async () => {
    const opencode = (...accounts: AgentStatus['accounts']): Status => ({
      apiVersion: 1,
      appVersion: '0.0.0',
      agents: [{ ...agents[1]!, id: 'opencode', name: 'OpenCode', ways: [], accounts }],
    })
    const { client } = fakeClient()
    const start = startOf(opencode(usualCodex), 1)
    const { result, rerender } = signInOf(client, start)
    act(() => result.current.add('opencode'))
    act(() => result.current.way(SignInWay.Terminal))
    await waitFor(() => expect(result.current.signingIn?.step).toMatchObject({ kind: 'terminal' }))
    // Read again, the new account is signed in to Go: named with Go on its plan, not as its keys are paid, per use.
    const made = {
      ...usual('acc_added', 'signed_in'),
      name: 'Account 2',
      paidBy: 'key' as const,
      providers: [{ id: 'opencode-go', name: 'OpenCode Go', refusedAt: null, pays: 'plan' as const }],
    }
    rerender({ start: { ...start, status: opencode(usualCodex, made), checkedAt: 2 } })
    await waitFor(() => expect(result.current.signingIn?.step).toEqual({ kind: 'named', name: 'Account 2', paid: 'OpenCode Go on a plan' }))
  })
})
