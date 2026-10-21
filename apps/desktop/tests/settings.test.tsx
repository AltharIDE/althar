import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '@althar/contracts'
import { EdgeSpot } from '@althar/ui'

import { DEFAULT_PREFERENCES } from '../src/main/appPreferences'
import { SYSTEM_SOUND } from '../src/main/notify'
import { soundToPutBack } from '../src/renderer/features/settings/QuickCards'
import { QuickSettings } from '../src/renderer/features/settings/QuickSettings'
import { isSection, type Section, SECTIONS } from '../src/renderer/features/settings/sections'
import { SettingsPage } from '../src/renderer/features/settings/SettingsPage'
import { useStart } from '../src/renderer/features/start/useStart'
import { edgeSpotOf, edgeWords } from '../src/renderer/shared/edge'
import { agents, connectionList, fakeClient, fakeHost, githubConnection, models, withoutOpenCode } from './fixtures'
import { withServices } from './render'

/*
 * Althar's settings: the quick settings, from the gear at the end of the
 * window's bar on every screen, with what is changed often; and the Settings
 * tab, with the same cards down its side over every section, and the section
 * open beside them. The tab itself, beside the home's, is the window's tabs'
 * (tabs.test.tsx).
 */

/* The quick settings, open, as the window's bar has them. */
function Quick({ onSettings = vi.fn() }: { onSettings?: (section: Section | null) => void }) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open again
      </button>
      <QuickSettings open={open} onOpenChange={setOpen} onSettings={onSettings} />
    </>
  )
}

/* The Settings tab on a section, as its route has it: the agents asked again as it opens. */
function Settings({ at = 'agents' }: { at?: Section }) {
  const [section, setSection] = useState<Section>(at)
  return <SettingsPage start={useStart({ recheck: true })} section={section} onSection={setSection} />
}

const quick = () => screen.findByRole('dialog', { name: 'Quick settings' })
const sections = () => within(screen.getByRole('navigation', { name: 'Settings' }))
/** Goes to a section by its name down the side. */
const toSection = (name: string | RegExp) => userEvent.click(sections().getByRole('button', { name }))
const alert = async () => (await screen.findByRole('alert')).textContent

describe('the quick settings', () => {
  it('hold only what is changed often, one press each, with which Althar this is, and go to the Settings tab', async () => {
    const onSettings = vi.fn()
    const { client } = fakeClient()
    withServices(<Quick onSettings={onSettings} />, client)
    const panel = await quick()
    // Four round switches: keeping the Mac awake, notifications, their sound, and how hard it works in the bar.
    expect(await within(panel).findByRole('button', { name: /^Keep awake\s*While work runs/ })).toBeTruthy()
    expect(within(panel).getByRole('button', { name: /^Notifications\s*When you’re away/ })).toBeTruthy()
    expect(within(panel).getByRole('button', { name: /^Sound\s*Silent/ })).toBeTruthy()
    expect(within(panel).getByRole('button', { name: /^CPU and memory\s*In the bar/ })).toBeTruthy()
    expect(
      within(panel)
        .getAllByRole('switch')
        .map((one) => [one.getAttribute('aria-label'), one.getAttribute('aria-checked')]),
    ).toEqual([
      ['Keep awake', 'true'],
      ['Notifications', 'true'],
      ['Sound', 'false'],
      ['CPU and memory', 'true'],
    ])
    // Agents at once in one plain line, whatever the number, its default said.
    const count = await within(panel).findByRole('slider', { name: 'Agents at once' })
    expect(count.getAttribute('aria-valuetext')).toBe('4, this Mac’s default')
    expect(within(panel).getByText('More tasks than this wait their turn.')).toBeTruthy()
    expect(within(panel).queryByText(/16 GB/)).toBeNull()
    // Nothing else: not the agents, the code hosts, reviews, co-author, the icon. Nor what is running: settings are calm.
    expect(within(panel).queryByText(/Agents\b(?! at once)|Code hosts|Post reviews|Co-author|App icon|In other apps|busy/)).toBeNull()
    expect(within(panel).getByText('Althar 0.0.0')).toBeTruthy()
    expect(
      within(panel)
        .getByRole('link', { name: /What’s new/ })
        .getAttribute('href'),
    ).toBe('https://github.com/AltharIDE/althar/releases/tag/v0.0.0')

    // All settings goes to the Settings tab, where it was last, and leaves the panel.
    await userEvent.click(within(panel).getByRole('button', { name: /^All settings/ }))
    expect(onSettings).toHaveBeenCalledWith(null)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Quick settings' })).toBeNull())
  })

  it('report a problem from the foot: the panel closes and the dialog is asked for, only where the app can report', async () => {
    const reportProblem = vi.fn()
    const view = withServices(<Quick />, fakeClient().client, fakeHost({ reportProblem }))
    await userEvent.click(within(await quick()).getByRole('button', { name: 'Report a problem' }))
    expect(reportProblem).toHaveBeenCalledWith({ kind: 'asked', from: 'settings' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Quick settings' })).toBeNull())
    view.unmount()
    withServices(<Quick />, fakeClient().client)
    expect(within(await quick()).queryByRole('button', { name: 'Report a problem' })).toBeNull()
  })

  it('open the section a card is in by its name', async () => {
    const onSettings = vi.fn()
    withServices(<Quick onSettings={onSettings} />, fakeClient().client)
    const cards: ReadonlyArray<readonly [RegExp, Section]> = [
      [/^Keep awake/, 'this-mac'],
      [/^Notifications/, 'notifications'],
      [/^Sound/, 'notifications'],
      [/^CPU and memory/, 'this-mac'],
    ]
    for (const [name, section] of cards) {
      await userEvent.click(within(await quick()).getByRole('button', { name }))
      expect(onSettings).toHaveBeenLastCalledWith(section)
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Quick settings' })).toBeNull())
      await userEvent.click(screen.getByRole('button', { name: 'Open again' }))
    }
  })

  it('keep the Mac awake, turn every kind of notification off and on at once, and take the load from the bar', async () => {
    const host = fakeHost()
    withServices(<Quick />, fakeClient().client, host)
    const panel = await quick()
    const awake = await within(panel).findByRole('switch', { name: 'Keep awake' })
    await userEvent.click(awake)
    expect(host.setPreference).toHaveBeenCalledWith('keepAwake', false)
    expect(within(panel).getByRole('button', { name: /^Keep awake\s*Off/ })).toBeTruthy()

    await userEvent.click(within(panel).getByRole('switch', { name: 'Notifications' }))
    for (const key of ['notifyCalls', 'notifyReady', 'notifyStopped']) expect(host.setPreference).toHaveBeenCalledWith(key, false)
    expect(within(panel).getByRole('button', { name: /^Notifications\s*Off/ })).toBeTruthy()
    await userEvent.click(within(panel).getByRole('switch', { name: 'Notifications' }))
    for (const key of ['notifyCalls', 'notifyReady', 'notifyStopped']) expect(host.setPreference).toHaveBeenCalledWith(key, true)
    expect(within(panel).getByRole('button', { name: /^Notifications\s*When you’re away/ })).toBeTruthy()

    await userEvent.click(within(panel).getByRole('switch', { name: 'CPU and memory' }))
    expect(host.setPreference).toHaveBeenLastCalledWith('showLoad', false)
    await waitFor(() => expect(within(panel).getByRole('button', { name: /^CPU and memory\s*Off/ })).toBeTruthy())
  })

  it('silence the notifications, and put back the sound there was', async () => {
    const host = fakeHost({ preferences: vi.fn(async () => ({ ...DEFAULT_PREFERENCES, sound: 'Purr' })) })
    withServices(<Quick />, fakeClient().client, host)
    const panel = await quick()
    const sound = within(panel).getByRole('switch', { name: 'Sound' })
    await waitFor(() => expect(sound.getAttribute('aria-checked')).toBe('true'))
    expect(within(panel).getByRole('button', { name: /^Sound\s*Purr/ })).toBeTruthy()
    await userEvent.click(sound)
    expect(host.setPreference).toHaveBeenCalledWith('lastSound', 'Purr')
    expect(host.setPreference).toHaveBeenLastCalledWith('sound', null)
    await waitFor(() => expect(within(panel).getByRole('button', { name: /^Sound\s*Silent/ })).toBeTruthy())
    await userEvent.click(sound)
    expect(host.setPreference).toHaveBeenLastCalledWith('sound', 'Purr')
    await waitFor(() => expect(within(panel).getByRole('button', { name: /^Sound\s*Purr/ })).toBeTruthy())
  })

  it('put back Glass before there was any sound, else this Mac’s first, and off a Mac the system’s', () => {
    expect(soundToPutBack('Ping', ['Glass', 'Ping'], 'darwin')).toBe('Ping')
    expect(soundToPutBack(null, ['Basso', 'Glass'], 'darwin')).toBe('Glass')
    expect(soundToPutBack(null, ['Basso', 'Ping'], 'darwin')).toBe('Basso')
    expect(soundToPutBack(null, [], 'darwin')).toBe(SYSTEM_SOUND)
    expect(soundToPutBack(null, [], 'linux')).toBe(SYSTEM_SOUND)
  })

  it('take another number of agents at once, step by step, and say when it can’t be kept', async () => {
    const { client } = fakeClient()
    withServices(<Quick />, client)
    const panel = await quick()
    const count = await within(panel).findByRole('slider', { name: 'Agents at once' })
    count.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(client.setAgentsAtOnce).toHaveBeenLastCalledWith(6)
    await waitFor(() => expect(count.getAttribute('aria-valuetext')).toBe('6'))

    vi.mocked(client.setAgentsAtOnce).mockRejectedValue(new Error('disk full'))
    const reads = vi.mocked(client.getSettings).mock.calls.length
    await userEvent.keyboard('{ArrowLeft}')
    expect(await alert()).toBe('That couldn’t be kept. Try again.')
    await waitFor(() => expect(vi.mocked(client.getSettings).mock.calls.length).toBeGreaterThan(reads))
  })

  it('show what was kept, and go back to it when a change can’t be kept', async () => {
    const host = fakeHost({
      preferences: vi.fn(async () => ({ ...DEFAULT_PREFERENCES, keepAwake: false })),
      setPreference: vi.fn(async () => {
        throw new Error('disk full')
      }),
    })
    withServices(<Quick />, fakeClient().client, host)
    const panel = await quick()
    await waitFor(() => expect(within(panel).getByRole('switch', { name: 'Keep awake' }).getAttribute('aria-checked')).toBe('false'))
    await userEvent.click(within(panel).getByRole('switch', { name: 'Keep awake' }))
    expect(await alert()).toBe('That couldn’t be kept. Try again.')
    await waitFor(() => expect(within(panel).getByRole('switch', { name: 'Keep awake' }).getAttribute('aria-checked')).toBe('false'))
  })

  it('keep a change made before the first read came, and show only the latest answer of several', async () => {
    let answer: (preferences: typeof DEFAULT_PREFERENCES) => void = () => {}
    const answers: Array<() => void> = []
    let kept = DEFAULT_PREFERENCES
    const host = fakeHost({
      preferences: vi.fn(() => new Promise<typeof DEFAULT_PREFERENCES>((resolve) => void (answer = resolve))),
      setPreference: vi.fn(
        (key, value) =>
          new Promise<typeof DEFAULT_PREFERENCES>((resolve) => {
            kept = { ...kept, [key]: value }
            const now = kept
            answers.push(() => resolve(now))
          }),
      ),
    })
    withServices(<Quick />, fakeClient().client, host)
    const awake = within(await quick()).getByRole('switch', { name: 'Keep awake' })
    await userEvent.click(awake)
    await waitFor(() => expect(awake.getAttribute('aria-checked')).toBe('false'))
    // The read that was on its way answers late, with what was there before: the change stands.
    act(() => answer(DEFAULT_PREFERENCES))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(awake.getAttribute('aria-checked')).toBe('false')
    // Two changes; the first answers last: the switch shows the second.
    await userEvent.click(awake)
    await waitFor(() => expect(awake.getAttribute('aria-checked')).toBe('true'))
    await act(async () => {
      answers[2]?.()
      answers[1]?.()
      answers[0]?.()
    })
    expect(awake.getAttribute('aria-checked')).toBe('true')
  })

  it('say a change that can’t be kept among several, even when those after it were kept, and read again what was', async () => {
    const host = fakeHost({
      setPreference: vi.fn(async (key, value) => {
        if (key === 'notifyCalls') throw new Error('disk full')
        return { ...DEFAULT_PREFERENCES, notifyCalls: true, [key]: value }
      }),
    })
    withServices(<Quick />, fakeClient().client, host)
    await userEvent.click(await within(await quick()).findByRole('switch', { name: 'Notifications' }))
    expect(await alert()).toBe('That couldn’t be kept. Try again.')
    await waitFor(() => expect(vi.mocked(host.preferences).mock.calls.length).toBeGreaterThan(1))
  })
})

describe('the Settings tab', () => {
  it('lists its sections down the side under the quick cards, opens each, and asks the agents how they stand once', async () => {
    const { client } = fakeClient()
    withServices(<Settings />, client)
    // OpenCode's only account is signed out: only the person can sign it in, so the agents say they need them.
    await waitFor(() =>
      expect(
        sections()
          .getAllByRole('button')
          .map((one) => one.textContent),
      ).toEqual([
        'Agents, needs you',
        'Code hosts and trackers',
        'Work on this Mac',
        'Reviews and pull requests',
        'Notifications',
        'Appearance',
        'Editor',
        'About Althar',
      ]),
    )
    expect(
      sections()
        .getByRole('button', { name: /^Agents/ })
        .getAttribute('aria-current'),
    ).toBe('page')
    expect(screen.getByRole('heading', { name: 'Agents', level: 1 })).toBeTruthy()
    expect(screen.getByText('The agents on this Mac, the accounts each signs in with, and the models their work may use.')).toBeTruthy()
    // The quick cards are here too, a press away.
    expect(screen.getByRole('switch', { name: 'Keep awake' })).toBeTruthy()
    // Opened, it asks the agents how they stand once, not again and again.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(vi.mocked(client.status).mock.calls.filter(([input]) => input?.recheck === true)).toHaveLength(1)

    await toSection('Reviews and pull requests')
    expect(screen.getByRole('heading', { name: 'Reviews and pull requests', level: 1 })).toBeTruthy()
    expect(sections().getByRole('button', { name: 'Reviews and pull requests' }).getAttribute('aria-current')).toBe('page')
    // A card's name goes to the section it is in.
    await userEvent.click(screen.getByRole('button', { name: /^Notifications\s*When you’re away/ }))
    expect(screen.getByRole('heading', { name: 'Notifications', level: 1 })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /^CPU and memory/ }))
    expect(screen.getByRole('heading', { name: 'Work on this Mac', level: 1 })).toBeTruthy()
  })

  it('names its sections as the address does, and takes nothing else for one', () => {
    expect(SECTIONS).toEqual(['agents', 'code-hosts', 'this-mac', 'reviews', 'notifications', 'appearance', 'editor', 'about'])
    expect(isSection('this-mac')).toBe(true)
    expect(isSection('mac')).toBe(false)
    expect(isSection(undefined)).toBe(false)
  })

  it('opens the agents on the one that needs the person, each with its accounts and who makes it', async () => {
    withServices(<Settings />, fakeClient().client)
    expect((await screen.findByRole('tab', { name: 'OpenCode, needs you' })).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('list', { name: 'OpenCode accounts' })).toBeTruthy()
    await userEvent.click(screen.getByRole('tab', { name: 'Codex' }))
    expect(screen.getByRole('list', { name: 'Codex accounts' })).toBeTruthy()
    // Beside its name, who makes it and its version.
    expect(screen.getByRole('heading', { name: 'Codex', level: 2 })).toBeTruthy()
    expect(screen.getByText('OpenAI · 0.159.3')).toBeTruthy()
  })

  it('switches each agent’s models on and off beside its accounts, named as people know them', async () => {
    // The runtime keeps what was switched off, and says so when read again.
    const off = new Set<string>()
    const said = () =>
      models.map((offered) => ({ ...offered, blocked: offered.models.filter((model) => off.has(model.id)).map((model) => model.id) }))
    const { client } = fakeClient({
      getModels: vi.fn(async () => said()),
      setModelBlocked: vi.fn(async ({ model, blocked }: { agentId: string; model: string; blocked: boolean }) => {
        if (blocked) off.add(model)
        else off.delete(model)
      }),
    })
    withServices(<Settings />, client)
    // Claude Code's models with their family, its own default not among them.
    await userEvent.click(await screen.findByRole('tab', { name: 'Claude Code' }))
    const claude = await screen.findByRole('group', { name: 'Claude Code models' })
    expect(within(claude).getAllByRole('checkbox')).toHaveLength(2)
    expect(within(claude).getByRole('checkbox', { name: 'Claude Opus' })).toBeTruthy()
    expect(screen.getByText('all 2 used')).toBeTruthy()
    await userEvent.click(within(claude).getByRole('checkbox', { name: 'Claude Sonnet' }))
    expect(client.setModelBlocked).toHaveBeenCalledWith({ agentId: 'claude-code', model: 'sonnet', blocked: true })
    expect(within(claude).getByRole('checkbox', { name: 'Claude Sonnet' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('1 of 2 used')).toBeTruthy()
    // Once the runtime has answered and been read again, it says the same: still off.
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(within(claude).getByRole('checkbox', { name: 'Claude Sonnet' }).getAttribute('aria-checked')).toBe('false')
    // Read again slowly: until the runtime's answer arrives, the switch stays as it was set, not as it was read last.
    let answer: () => void = () => undefined
    vi.mocked(client.getModels).mockImplementationOnce(() => new Promise((resolve) => (answer = () => resolve(said()))))
    await userEvent.click(within(claude).getByRole('checkbox', { name: 'Claude Sonnet' }))
    expect(client.setModelBlocked).toHaveBeenLastCalledWith({ agentId: 'claude-code', model: 'sonnet', blocked: false })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(within(claude).getByRole('checkbox', { name: 'Claude Sonnet' }).getAttribute('aria-checked')).toBe('true')
    act(() => answer())
    await waitFor(() => expect(screen.getByText('all 2 used')).toBeTruthy())
    expect(within(claude).getByRole('checkbox', { name: 'Claude Sonnet' }).getAttribute('aria-checked')).toBe('true')
    // One the runtime didn't switch goes back to how it was.
    vi.mocked(client.setModelBlocked).mockRejectedValueOnce(new Error('No'))
    await userEvent.click(within(claude).getByRole('checkbox', { name: 'Claude Opus' }))
    await waitFor(() => expect(within(claude).getByRole('checkbox', { name: 'Claude Opus' }).getAttribute('aria-checked')).toBe('true'))
  })

  it('offers to download an agent that isn’t on this Mac, in its tab', async () => {
    const { client } = fakeClient({ status: vi.fn(async () => ({ apiVersion: 1, appVersion: '0.0.0', agents: withoutOpenCode })) })
    withServices(<Settings />, client, fakeHost())
    await userEvent.click(await screen.findByRole('tab', { name: /OpenCode/ }))
    const install = screen.getByRole('region', { name: 'OpenCode isn’t on this Mac' })
    expect(within(install).getByText(/from GitHub, about 45 MB, check it against the release/)).toBeTruthy()
    await userEvent.click(within(install).getByRole('button', { name: 'Download OpenCode' }))
    expect(client.installAgent).toHaveBeenCalledWith('opencode')
  })

  it('downloads an agent in its tab, says why a download stopped, and opens the page of one only its maker installs', async () => {
    let installing = false
    let finish: () => void = () => {}
    const codex = agents.find((agent) => agent.id === 'codex')
    if (codex === undefined) throw new Error('No Codex in the fixtures')
    const aider = {
      ...codex,
      id: 'aider',
      name: 'Aider',
      installed: false,
      accounts: [],
      download: null,
      guide: 'https://aider.chat/docs/install.html',
    }
    const { client } = fakeClient({
      status: vi.fn(async () => ({
        apiVersion: 1,
        appVersion: '0.0.0',
        agents: [
          ...withoutOpenCode.map((agent) =>
            agent.id === 'opencode' ? { ...agent, download: { size: '45 MB', installing, pinned: null } } : agent,
          ),
          aider,
        ],
      })),
      // The download runs until the test lets it end, so its tab is seen downloading however slow the machine.
      installAgent: vi.fn(async () => {
        installing = true
        await new Promise<void>((resolve) => (finish = resolve))
        installing = false
        throw new ApiError({ reason: 'InstallFailed', message: 'GitHub couldn’t be reached to find OpenCode.' })
      }),
    })
    withServices(<Settings />, client, fakeHost())
    await userEvent.click(await screen.findByRole('tab', { name: /OpenCode/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Download OpenCode' }))
    expect(await screen.findByText('Downloading OpenCode, about 45 MB, and checking it…')).toBeTruthy()
    finish()
    expect(await alert()).toBe('GitHub couldn’t be reached to find OpenCode.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    // One with no mark and nothing to download: only its maker's page.
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    await userEvent.click(screen.getByRole('tab', { name: /Aider/ }))
    expect(screen.queryByRole('button', { name: 'Download Aider' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Install it yourself' }))
    expect(open).toHaveBeenCalledWith('https://aider.chat/docs/install.html', '_blank')
    open.mockRestore()
  })

  it('says on its tab alone why an agent couldn’t be checked, the others as they are, and checks again', async () => {
    const problem = "Althar couldn't check OpenCode. Its log has the details."
    const unchecked = agents.map((agent) =>
      agent.id === 'opencode' ? { ...agent, signIn: 'unknown' as const, accounts: [], version: null, download: null, problem } : agent,
    )
    const statusOf = vi.fn(async ({ recheck }: { recheck?: boolean } = {}) => ({
      apiVersion: 1,
      appVersion: '0.0.0',
      agents: recheck === true ? agents : unchecked,
    }))
    const { client } = fakeClient({ status: statusOf })
    withServices(<Settings />, client, fakeHost())
    await userEvent.click(await screen.findByRole('tab', { name: /OpenCode/ }))
    expect(await alert()).toBe(problem)
    // The others stand as they are.
    await userEvent.click(screen.getByRole('tab', { name: /Claude Code/ }))
    expect(screen.queryByRole('alert')).toBeNull()
    await userEvent.click(screen.getByRole('tab', { name: /OpenCode/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(statusOf).toHaveBeenCalledWith({ recheck: true })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('has the code hosts beside the trackers, and connects one in place of the list', async () => {
    withServices(<Settings at="code-hosts" />, fakeClient().client)
    expect(screen.getByRole('heading', { name: 'Code hosts and trackers', level: 1 })).toBeTruthy()
    // Each kind says what it is for, so its services don't.
    const hosts = await screen.findByRole('region', { name: 'Code hosts' })
    expect(within(hosts).getByRole('list', { name: 'Code hosts' })).toBeTruthy()
    expect(within(hosts).getByText('Pull requests, their checks and review comments')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Trackers' })).getByRole('list', { name: 'Trackers' })).toBeTruthy()
    // Where the projects' code is, said once each kind is said.
    expect(within(hosts).getByText('Not connected · meridian’s code is here')).toBeTruthy()
    // Connect walks in here, in place of the list, with its way back to it.
    await userEvent.click(within(hosts).getByRole('button', { name: 'Connect' }))
    expect(await screen.findByRole('group', { name: 'Ways to connect GitHub' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Code hosts' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Make a token/ }))
    expect(screen.getByRole('heading', { name: 'Make a token on GitHub' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Back to code hosts and trackers' }))
    expect(await screen.findByRole('region', { name: 'Code hosts' })).toBeTruthy()
  })

  it('says beside Code hosts and trackers when one asks to be signed in again', async () => {
    const { client } = fakeClient({
      listConnections: vi.fn(async () => ({
        ...connectionList,
        connections: [{ ...githubConnection, state: 'reauth_required' as const }],
      })),
    })
    withServices(<Settings />, client)
    expect(await sections().findByRole('button', { name: 'Code hosts and trackers, needs you' })).toBeTruthy()
  })

  it('keeps the Mac awake, on battery too, takes another number of agents at once and says why, and shows the load in the bar', async () => {
    const host = fakeHost({ preferences: vi.fn(async () => ({ ...DEFAULT_PREFERENCES, keepAwake: false })) })
    const { client } = fakeClient()
    withServices(<Settings at="this-mac" />, client, host)
    const page = screen.getByRole('main')
    const battery = await within(page).findByRole('switch', { name: 'On battery too' })
    // Nothing to add to while it is off.
    await waitFor(() => expect((battery as HTMLButtonElement).disabled).toBe(true))
    await userEvent.click(within(page).getByRole('switch', { name: 'Keep this Mac awake while work runs' }))
    expect(host.setPreference).toHaveBeenLastCalledWith('keepAwake', true)
    await userEvent.click(battery)
    expect(host.setPreference).toHaveBeenLastCalledWith('awakeOnBattery', true)

    // How many agents at once, and why: this Mac's memory and cores.
    const count = await within(page).findByRole('slider', { name: 'Agents at once' })
    expect(count.getAttribute('aria-valuenow')).toBe('4')
    expect(within(page).getByText('4: this Mac has 16 GB and 10 cores. More tasks than that wait their turn.')).toBeTruthy()
    expect(within(page).queryByText(/busy/)).toBeNull()
    expect(within(page).queryByRole('button', { name: 'Use the default' })).toBeNull()
    count.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(client.setAgentsAtOnce).toHaveBeenLastCalledWith(6)
    await waitFor(() => expect(count.getAttribute('aria-valuenow')).toBe('6'))
    expect(within(page).getByText(/^6: a little more than this Mac’s 16 GB suggests\. Tests may slow down\./)).toBeTruthy()
    await userEvent.click(within(page).getByRole('button', { name: 'Use the default' }))
    expect(client.setAgentsAtOnce).toHaveBeenLastCalledWith(null)
    await waitFor(() => expect(count.getAttribute('aria-valuenow')).toBe('4'))

    // How hard the Mac works shows in the bar until it is turned off, for every window.
    const load = within(page).getByRole('switch', { name: 'Show how hard this Mac works' })
    expect(load.getAttribute('aria-checked')).toBe('true')
    await userEvent.click(load)
    expect(host.setPreference).toHaveBeenLastCalledWith('showLoad', false)
    await waitFor(() => expect(load.getAttribute('aria-checked')).toBe('false'))
  })

  it('opens Althar at login, in the background, and pauses every automation, saying when that can’t be kept', async () => {
    const host = fakeHost()
    const { client } = fakeClient()
    withServices(<Settings at="this-mac" />, client, host)
    const page = screen.getByRole('main')
    const login = await within(page).findByRole('switch', { name: 'Open Althar at login, in the background' })
    expect(login.getAttribute('aria-checked')).toBe('false')
    await userEvent.click(login)
    expect(host.setPreference).toHaveBeenLastCalledWith('openAtLogin', true)
    await waitFor(() => expect(login.getAttribute('aria-checked')).toBe('true'))
    const paused = await within(page).findByRole('switch', { name: 'Pause all automations' })
    expect(paused.getAttribute('aria-checked')).toBe('false')
    await userEvent.click(paused)
    expect(client.setAutomationsPaused).toHaveBeenLastCalledWith(true)
    await waitFor(() => expect(paused.getAttribute('aria-checked')).toBe('true'))
    // One the runtime couldn't keep says so, and shows what it kept.
    vi.mocked(client.setAutomationsPaused).mockRejectedValueOnce(new Error('disk full'))
    const reads = vi.mocked(client.getSettings).mock.calls.length
    await userEvent.click(paused)
    expect(await alert()).toBe('That couldn’t be kept. Try again.')
    await waitFor(() => expect(vi.mocked(client.getSettings).mock.calls.length).toBeGreaterThan(reads))
    await waitFor(() => expect(paused.getAttribute('aria-checked')).toBe('false'))
  })

  it('says when a number of agents at once can’t be kept, and shows what was kept', async () => {
    const { client } = fakeClient()
    vi.mocked(client.setAgentsAtOnce).mockRejectedValue(new Error('disk full'))
    withServices(<Settings at="this-mac" />, client)
    const count = await within(screen.getByRole('main')).findByRole('slider', { name: 'Agents at once' })
    const reads = vi.mocked(client.getSettings).mock.calls.length
    count.focus()
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(await alert()).toBe('That couldn’t be kept. Try again.')
    await waitFor(() => expect(vi.mocked(client.getSettings).mock.calls.length).toBeGreaterThan(reads))
    await waitFor(() => expect(count.getAttribute('aria-valuenow')).toBe('4'))
  })

  it('posts the team’s reviews without asking only once the person turns it on, and says when that can’t be kept', async () => {
    const { client } = fakeClient()
    withServices(<Settings at="reviews" />, client)
    const posts = await screen.findByRole('switch', { name: 'Post reviews of my team’s pull requests without asking' })
    expect(posts.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText(/A review of a pull request from outside the team always waits for you to post it\./)).toBeTruthy()
    await userEvent.click(posts)
    expect(client.setPostTeamReviews).toHaveBeenLastCalledWith(true)
    await waitFor(() => expect(posts.getAttribute('aria-checked')).toBe('true'))
    vi.mocked(client.setPostTeamReviews).mockRejectedValue(new Error('disk full'))
    const reads = vi.mocked(client.getSettings).mock.calls.length
    await userEvent.click(posts)
    expect(await alert()).toBe('That couldn’t be kept. Try again.')
    await waitFor(() => expect(vi.mocked(client.getSettings).mock.calls.length).toBeGreaterThan(reads))
    await waitFor(() => expect(posts.getAttribute('aria-checked')).toBe('false'))
  })

  it('has Althar as co-author of what it sends until the person turns it off, and then asks once, large, why it would stay', async () => {
    const { client } = fakeClient({ listConnections: vi.fn(async () => ({ ...connectionList, connections: [githubConnection] })) })
    withServices(<Settings at="reviews" />, client)
    const credit = await screen.findByRole('switch', { name: 'Althar as co-author' })
    expect(credit.getAttribute('aria-checked')).toBe('true')
    // The line on a commit as GitHub shows it, under the person's own name there.
    const commit = screen.getByRole('figure', { name: 'A commit as GitHub shows it' })
    expect(within(commit).getByText('Co-authored-by: Althar <337922799+AltharAi@users.noreply.github.com>')).toBeTruthy()
    await waitFor(() => expect(commit.textContent).toContain('you and Althar committed'))
    expect(screen.queryByText(/no marketing budget/)).toBeNull()

    // Turned off: the ask, on a card of its own, which puts it back in one press.
    await userEvent.click(credit)
    expect(client.setCoAuthor).toHaveBeenCalledWith(false)
    expect(credit.getAttribute('aria-checked')).toBe('false')
    const ask = screen.getByRole('region', { name: 'Althar is free, and we have no marketing budget.' })
    expect(within(ask).getByText(/how most developers hear about it/)).toBeTruthy()
    await userEvent.click(within(ask).getByRole('button', { name: 'Put Althar back on your commits' }))
    expect(client.setCoAuthor).toHaveBeenLastCalledWith(true)
    expect(credit.getAttribute('aria-checked')).toBe('true')
    expect(screen.queryByRole('region', { name: /no marketing budget/ })).toBeNull()

    // Or left off in another: the card goes, and it says what goes out now, where the focus lands.
    await userEvent.click(credit)
    await userEvent.click(screen.getByRole('button', { name: 'Leave it off' }))
    expect(screen.queryByRole('region', { name: /no marketing budget/ })).toBeNull()
    expect(credit.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Your commits and pull requests go out with only your name.')).toBeTruthy()

    // Opened again while off, it doesn't ask again.
    await toSection('Notifications')
    await toSection('Reviews and pull requests')
    expect(await screen.findByRole('switch', { name: 'Althar as co-author' })).toBeTruthy()
    expect(screen.queryByText(/no marketing budget/)).toBeNull()
  })

  it('turns co-authoring back when the change can’t be kept, and says so', async () => {
    const { client } = fakeClient()
    vi.mocked(client.setCoAuthor).mockRejectedValue(new Error('disk full'))
    withServices(<Settings at="reviews" />, client)
    const credit = await screen.findByRole('switch', { name: 'Althar as co-author' })
    await userEvent.click(credit)
    expect(await alert()).toBe('That couldn’t be kept. Try again.')
    await waitFor(() => expect(credit.getAttribute('aria-checked')).toBe('true'))
    // Off and on again, both lost: it shows what the runtime kept, not the opposite of the last try.
    const reads = vi.mocked(client.getSettings).mock.calls.length
    await userEvent.click(credit)
    await userEvent.click(credit)
    await waitFor(() => expect(vi.mocked(client.getSettings).mock.calls.length).toBeGreaterThan(reads))
    expect(credit.getAttribute('aria-checked')).toBe('true')
  })

  it('turns each kind of notification on and off, with the count and a sound heard as it is chosen', async () => {
    const host = fakeHost()
    withServices(<Settings at="notifications" />, fakeClient().client, host)
    const page = screen.getByRole('main')
    expect(within(page).getByText('Only while Althar isn’t in front. Never for progress.')).toBeTruthy()
    await userEvent.click(await within(page).findByRole('switch', { name: 'A task is ready for you' }))
    expect(host.setPreference).toHaveBeenLastCalledWith('notifyReady', false)
    await userEvent.click(within(page).getByRole('switch', { name: 'Count them on the Dock icon' }))
    expect(host.setPreference).toHaveBeenLastCalledWith('badge', false)
    // The sound is one of the Mac's, heard as it is chosen, and again by its play button; the one Sound's card puts back.
    await userEvent.click(await within(page).findByRole('combobox', { name: 'Sound' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Glass' }))
    expect(host.setPreference).toHaveBeenCalledWith('lastSound', 'Glass')
    expect(host.setPreference).toHaveBeenLastCalledWith('sound', 'Glass')
    expect(host.playSound).toHaveBeenCalledWith('Glass')
    await userEvent.click(within(page).getByRole('button', { name: 'Play Glass' }))
    expect(host.playSound).toHaveBeenCalledTimes(2)
    // Its card down the side says it.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Sound\s*Glass/ })).toBeTruthy())
  })

  it('opens files in the editor chosen, the first found until one is', async () => {
    const host = fakeHost()
    const { client } = fakeClient({
      listEditors: vi.fn(async () => [
        { id: 'cursor', name: 'Cursor' },
        { id: 'zed', name: 'Zed' },
        { id: 'finder', name: 'Finder' },
      ]),
    })
    withServices(<Settings at="editor" />, client, host)
    // Each editor by its own icon.
    const editors = await screen.findByRole('radiogroup', { name: 'Open files in' })
    expect(within(editors).getByRole('radio', { name: 'Cursor' }).getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(editors.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,cursor'))
    await userEvent.click(within(editors).getByRole('radio', { name: 'Zed' }))
    expect(host.setPreference).toHaveBeenLastCalledWith('editor', 'zed')
    await waitFor(() => expect(within(editors).getByRole('radio', { name: 'Zed' }).getAttribute('aria-checked')).toBe('true'))
  })

  it('says where files open when there is no editor to choose', async () => {
    withServices(<Settings at="editor" />, fakeClient({ listEditors: vi.fn(async () => []) }).client)
    expect(await screen.findByText('No editor found on this Mac. Files open in Finder.')).toBeTruthy()
  })

  it('says which Althar this is, with its release’s notes', async () => {
    withServices(<Settings at="about" />, fakeClient().client)
    const page = screen.getByRole('main')
    expect(await within(page).findByText('Althar 0.0.0')).toBeTruthy()
    expect(
      within(page)
        .getByRole('link', { name: /What’s new/ })
        .getAttribute('href'),
    ).toBe('https://github.com/AltharIDE/althar/releases/tag/v0.0.0')
  })

  it('reports a problem from About Althar, only where the app can report', async () => {
    const reportProblem = vi.fn()
    const view = withServices(<Settings at="about" />, fakeClient().client, fakeHost({ reportProblem }))
    await userEvent.click(await within(screen.getByRole('main')).findByRole('button', { name: 'Report a problem' }))
    expect(reportProblem).toHaveBeenCalledWith({ kind: 'asked', from: 'settings' })
    view.unmount()
    withServices(<Settings at="about" />, fakeClient().client)
    expect(await within(screen.getByRole('main')).findByText('Althar 0.0.0')).toBeTruthy()
    expect(within(screen.getByRole('main')).queryByRole('button', { name: 'Report a problem' })).toBeNull()
  })

  it('sends anonymous usage data until the person turns it off under About Althar, with one line on what it sends', async () => {
    const host = fakeHost()
    withServices(<Settings at="about" />, fakeClient().client, host)
    const usage = await screen.findByRole('switch', { name: 'Usage data' })
    await waitFor(() => expect(usage.getAttribute('aria-checked')).toBe('true'))
    expect(document.getElementById(usage.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Anonymous: steps such as a project made or a task settled. Never your code, what is written, or any name.',
    )
    await userEvent.click(usage)
    expect(host.setPreference).toHaveBeenLastCalledWith('usageData', false)
    await waitFor(() => expect(usage.getAttribute('aria-checked')).toBe('false'))
    // Not among what is changed often.
    expect(screen.queryByRole('button', { name: /^Usage data/ })).toBeNull()
  })

  it('keeps usage data off, and can’t turn it on, while DO_NOT_TRACK is set', async () => {
    withServices(<Settings at="about" />, fakeClient().client, fakeHost({ doNotTrack: true }))
    const usage = await screen.findByRole('switch', { name: 'Usage data' })
    expect(usage.getAttribute('aria-checked')).toBe('false')
    expect((usage as HTMLButtonElement).disabled).toBe(true)
    expect(document.getElementById(usage.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Off while DO_NOT_TRACK is set.')
  })

  it('sends crash reports until the person turns them off beside usage data, a switch of their own', async () => {
    const host = fakeHost()
    withServices(<Settings at="about" />, fakeClient().client, host)
    const crashes = await screen.findByRole('switch', { name: 'Crash reports' })
    await waitFor(() => expect(crashes.getAttribute('aria-checked')).toBe('true'))
    expect(document.getElementById(crashes.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'What failed and where in Althar’s code, when it crashes or hits an error. Never your code, what is written, or any name.',
    )
    await userEvent.click(crashes)
    expect(host.setPreference).toHaveBeenLastCalledWith('crashReports', false)
    await waitFor(() => expect(crashes.getAttribute('aria-checked')).toBe('false'))
    // Usage data is its own.
    expect(screen.getByRole('switch', { name: 'Usage data' }).getAttribute('aria-checked')).toBe('true')
  })

  it('keeps crash reports off, and can’t turn them on, while DO_NOT_TRACK is set', async () => {
    withServices(<Settings at="about" />, fakeClient().client, fakeHost({ doNotTrack: true }))
    const crashes = await screen.findByRole('switch', { name: 'Crash reports' })
    expect(crashes.getAttribute('aria-checked')).toBe('false')
    expect((crashes as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('how Althar looks, on the Settings tab', () => {
  it('shows Althar somewhere on every system: by the notch where there is one, else wherever the system has room', () => {
    const at = (platform: string, notch: boolean, tray: boolean, place: 'island' | 'menu' = 'island') =>
      edgeSpotOf({ platform, notch, tray }, place)
    expect(at('darwin', true, true)).toBe(EdgeSpot.Island)
    expect(at('darwin', true, true, 'menu')).toBe(EdgeSpot.MenuBesideNotch)
    expect(at('darwin', false, true)).toBe(EdgeSpot.MenuBar)
    expect(at('win32', false, true)).toBe(EdgeSpot.WindowsTray)
    expect(at('linux', false, true)).toBe(EdgeSpot.LinuxTray)
    expect(at('linux', false, false)).toBe(EdgeSpot.WindowOnly)
    expect(Object.values(EdgeSpot).map((spot) => edgeWords(spot).word)).toEqual([
      'Round the notch',
      'Menu bar',
      'Menu bar',
      'System tray',
      'System tray',
      'No tray',
    ])
  })

  it('offers light, dark or as the Mac is, as the Mac is to begin with, and keeps a choice', async () => {
    const host = fakeHost()
    withServices(<Settings at="appearance" />, fakeClient().client, host)
    const choice = await screen.findByRole('radiogroup', { name: 'Light or dark' })
    const checked = () =>
      within(choice)
        .getAllByRole('radio')
        .filter((radio) => radio.getAttribute('aria-checked') === 'true')
        .map((radio) => radio.textContent)
    expect(
      within(choice)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Light', 'Dark', 'Match the Mac'])
    expect(checked()).toEqual(['Match the Mac'])
    expect(screen.getByText('Match the Mac turns dark when the Mac does.')).toBeTruthy()
    await userEvent.click(within(choice).getByRole('radio', { name: 'Dark' }))
    await waitFor(() => expect(host.setPreference).toHaveBeenCalledWith('appearance', 'dark'))
    await waitFor(() => expect(checked()).toEqual(['Dark']))
  })

  it('offers where Althar shows in another app, on a Mac with a notch, and keeps a choice', async () => {
    const host = fakeHost()
    withServices(<Settings at="appearance" />, fakeClient().client, host)
    const places = await screen.findByRole('radiogroup', { name: 'In other apps' })
    const radios = () => within(places).getAllByRole<HTMLInputElement>('radio')
    expect(radios().map((radio) => radio.checked)).toEqual([true, false])
    // Each place as the screen would look; with nothing under way, a busy moment, said as such.
    expect(screen.getByText('With nothing under way yet, here is how a busy moment would look.')).toBeTruthy()
    expect(places.textContent).toContain('Publish the SDK to npm')
    // The pictures sit beside the radios, so the island's own count is never a button inside one.
    expect(radios().every((radio) => radio.closest('label')?.querySelector('button') === null)).toBe(true)
    await userEvent.click(within(places).getByRole('radio', { name: /In the menu bar/ }))
    expect(host.setEdge).toHaveBeenCalledWith('menu')
    expect(radios().map((radio) => radio.checked)).toEqual([false, true])
  })

  it('says where it shows on a Mac without a notch, with nothing to choose', async () => {
    const edge = vi.fn(async () => ({ place: 'island', notch: false, platform: 'darwin', tray: true }))
    withServices(<Settings at="appearance" />, fakeClient().client, fakeHost({ edge }))
    expect(await screen.findByText('This Mac’s screen has no notch, so Althar shows in the menu bar.')).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'In other apps' })).toBeNull()
    expect(screen.getByText('In the menu bar')).toBeTruthy()
  })

  it('asks the main process again each time the section opens, as a screen with a notch comes and goes', async () => {
    let notch = true
    const edge = vi.fn(async () => ({ place: 'island', notch, platform: 'darwin', tray: true }))
    withServices(<Settings at="appearance" />, fakeClient().client, fakeHost({ edge }))
    expect(await screen.findByRole('radiogroup', { name: 'In other apps' })).toBeTruthy()
    notch = false
    await toSection('Editor')
    await toSection('Appearance')
    expect(await screen.findByText('This Mac’s screen has no notch, so Althar shows in the menu bar.')).toBeTruthy()
  })

  it('keeps a choice still being kept when the section opens again and reads what was there before', async () => {
    let kept = 'island'
    let keep: () => void = () => undefined
    const host = fakeHost({
      edge: vi.fn(async () => ({ place: kept, notch: true, platform: 'darwin', tray: true })),
      setEdge: vi.fn((place: string) => new Promise<void>((resolve) => (keep = () => ((kept = place), resolve())))),
    })
    withServices(<Settings at="appearance" />, fakeClient().client, host)
    await userEvent.click(
      within(await screen.findByRole('radiogroup', { name: 'In other apps' })).getByRole('radio', { name: /In the menu bar/ }),
    )
    // Left and opened again before the main process has kept it: what it reads is from before, and the choice stands.
    await toSection('Editor')
    await toSection('Appearance')
    await waitFor(() => expect(host.edge).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 20))
    const checked = () =>
      within(screen.getByRole('radiogroup', { name: 'In other apps' }))
        .getAllByRole<HTMLInputElement>('radio')
        .map((radio) => radio.checked)
    expect(checked()).toEqual([false, true])
    act(() => keep())
    expect(kept).toBe('menu')
    expect(checked()).toEqual([false, true])
  })

  it('goes back to where it was when a choice can’t be kept', async () => {
    const host = fakeHost({
      edge: vi.fn(async () => ({ place: 'menu', notch: true, platform: 'darwin', tray: true })),
      setEdge: vi.fn(async () => {
        throw new Error('disk full')
      }),
    })
    withServices(<Settings at="appearance" />, fakeClient().client, host)
    const places = await screen.findByRole('radiogroup', { name: 'In other apps' })
    await userEvent.click(within(places).getByRole('radio', { name: /Round the notch/ }))
    expect(await alert()).toBe('That couldn’t be kept. Try again.')
    expect(within(places).getByRole<HTMLInputElement>('radio', { name: /In the menu bar/ }).checked).toBe(true)
  })

  it('shows the icon the app has, and gives it another', async () => {
    const host = fakeHost({ appIcon: vi.fn(async () => 'paper') })
    withServices(<Settings at="appearance" />, fakeClient().client, host)
    const icons = await screen.findByRole('radiogroup', { name: 'App icon' })
    expect(
      within(icons)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Cobalt', 'Lapis', 'Paper', 'Ink', 'Keystone', 'Monolith'])
    expect(within(icons).getByRole('radio', { name: 'Paper' }).getAttribute('aria-checked')).toBe('true')
    await userEvent.click(within(icons).getByRole('radio', { name: 'Ink' }))
    expect(host.setAppIcon).toHaveBeenCalledWith('ink')
    expect(within(icons).getByRole('radio', { name: 'Ink' }).getAttribute('aria-checked')).toBe('true')
  })

  it('starts on cobalt when the app has no icon it knows, or the main process can’t say, and goes back when one can’t be kept', async () => {
    const host = fakeHost({
      appIcon: vi.fn(async () => 'neon'),
      setAppIcon: vi.fn(async () => {
        throw new Error('disk full')
      }),
    })
    const view = withServices(<Settings at="appearance" />, fakeClient().client, host)
    const icons = await screen.findByRole('radiogroup', { name: 'App icon' })
    expect(within(icons).getByRole('radio', { name: 'Cobalt' }).getAttribute('aria-checked')).toBe('true')
    await userEvent.click(within(icons).getByRole('radio', { name: 'Keystone' }))
    expect(await alert()).toBe('That icon couldn’t be kept. Try again.')
    expect(within(icons).getByRole('radio', { name: 'Cobalt' }).getAttribute('aria-checked')).toBe('true')
    view.unmount()

    withServices(
      <Settings at="appearance" />,
      fakeClient().client,
      fakeHost({ appIcon: vi.fn(async () => Promise.reject(new Error('gone'))) }),
    )
    expect(
      within(await screen.findByRole('radiogroup', { name: 'App icon' }))
        .getByRole('radio', { name: 'Cobalt' })
        .getAttribute('aria-checked'),
    ).toBe('true')
  })

  it('lets only the latest choice of icon go back, to the last one kept', async () => {
    const answers: Array<{ resolve: () => void; reject: (error: Error) => void }> = []
    const host = fakeHost({
      setAppIcon: vi.fn(() => new Promise<void>((resolve, reject) => void answers.push({ resolve, reject }))),
    })
    withServices(<Settings at="appearance" />, fakeClient().client, host)
    const icons = await screen.findByRole('radiogroup', { name: 'App icon' })
    const checked = () =>
      within(icons)
        .getAllByRole('radio')
        .find((radio) => radio.getAttribute('aria-checked') === 'true')?.textContent

    // Ink, then Paper before Ink is kept: Paper is kept, and Ink failing after says nothing.
    await userEvent.click(within(icons).getByRole('radio', { name: 'Ink' }))
    await userEvent.click(within(icons).getByRole('radio', { name: 'Paper' }))
    await act(async () => answers[1]!.resolve())
    await act(async () => answers[0]!.reject(new Error('late')))
    expect(checked()).toBe('Paper')
    expect(screen.queryByRole('alert')).toBeNull()

    // Keystone, which can't be kept: Paper, the last kept, comes back.
    await userEvent.click(within(icons).getByRole('radio', { name: 'Keystone' }))
    await act(async () => answers[2]!.reject(new Error('no picture')))
    expect(checked()).toBe('Paper')
    expect(await alert()).toBe('That icon couldn’t be kept. Try again.')
  })

  it('offers no icon where there is no Dock to show one', async () => {
    withServices(<Settings at="appearance" />, fakeClient().client, fakeHost({ appIcon: vi.fn(async () => null) }))
    expect(await screen.findByRole('radiogroup', { name: 'In other apps' })).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'App icon' })).toBeNull()
  })
})
