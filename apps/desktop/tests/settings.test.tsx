import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ApiError, type HomeWorker } from '@althar/contracts'
import { EdgeSpot } from '@althar/ui'

import { DEFAULT_PREFERENCES } from '../src/main/appPreferences'
import type { WorkersHost, WorkerSetup } from '../src/workers'
import { SYSTEM_SOUND } from '../src/main/notify'
import { soundToPutBack } from '../src/renderer/features/settings/QuickCards'
import { keys } from '../src/renderer/data/reads'
import { ServicesProvider } from '../src/renderer/data/services'
import { QuickSettings } from '../src/renderer/features/settings/QuickSettings'
import { isSection, type Section, SECTIONS, sectionOf, type SettingsFocus } from '../src/renderer/features/settings/sections'
import { SettingsPage } from '../src/renderer/features/settings/SettingsPage'
import { reviewOf } from '../src/renderer/features/settings/useSkills'
import { useStart } from '../src/renderer/features/start/useStart'
import { edgeSpotOf, edgeWords } from '../src/renderer/shared/edge'
import {
  agents,
  connectionList,
  fakeClient,
  fakeHost,
  onLinuxHome,
  fakePagesHost,
  githubConnection,
  project,
  models,
  skillCard,
  withoutOpenCode,
} from './fixtures'
import { servicesFor, withServices } from './render'

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
function Settings({ at = 'agents', onSection }: { at?: Section; onSection?: (section: Section, focus?: SettingsFocus) => void }) {
  const [place, setPlace] = useState<{ section: Section; focus?: SettingsFocus; worker?: string }>({ section: at })
  return (
    <SettingsPage
      start={useStart({ recheck: true })}
      section={place.section}
      {...(place.focus === undefined ? {} : { focus: place.focus })}
      {...(place.worker === undefined ? {} : { worker: place.worker })}
      onComputer={(worker) => setPlace(worker === null ? { section: 'computers' } : { section: 'computers', worker })}
      onSection={(section, focus) => {
        onSection?.(section, focus)
        setPlace(focus === undefined ? { section } : { section, focus })
      }}
    />
  )
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
    expect(within(panel).getByText('The rest wait their turn')).toBeTruthy()
    expect(within(panel).queryByText(/16 GB/)).toBeNull()
    // Nothing else: not the agents, the code hosts, reviews, co-author, the icon. Nor what is running: settings are calm.
    expect(within(panel).queryByText(/Agents\b(?! at once)|Code hosts|Post reviews|Co-author|App icon|In other apps|busy/)).toBeNull()
    expect(within(panel).getByText('Althar 0.0.0')).toBeTruthy()
    // What's new is Althar's own page, in the window, not the notes in the browser.
    expect(within(panel).getByRole('button', { name: 'What’s new' })).toBeTruthy()
    expect(within(panel).queryByRole('link', { name: /What’s new/ })).toBeNull()

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

  it('say at the number when fewer agents may work for now, and why, and move the load popover’s number with it', async () => {
    const { client } = fakeClient({
      getPlaces: vi.fn(async () => ({ busy: 1, configured: 4, atOnce: 1, why: 'memory' as const, waiting: 2 })),
    })
    const services = servicesFor(client)
    render(<ServicesProvider value={services}>{<Quick />}</ServicesProvider>)
    const panel = await quick()
    expect(await within(panel).findByText('1 at a time until memory frees up')).toBeTruthy()
    const count = within(panel).getByRole('slider', { name: 'Agents at once' })
    count.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(services.cache.getQueryData(keys.places)).toMatchObject({ configured: 5, atOnce: 1, why: 'memory' })
    // At the lowered number, nothing is fewer: the note is the number's own again.
    await userEvent.keyboard('{Home}')
    expect(within(panel).queryByText(/at a time until/)).toBeNull()
    expect(services.cache.getQueryData(keys.places)).toMatchObject({ configured: 1, atOnce: 1, why: null })
  })

  it('put the load popover’s agents back as they were, fewer for now and why, when a change can’t be kept', async () => {
    const lowered = { busy: 1, configured: 4, atOnce: 1, why: 'memory' as const, waiting: 2 }
    const { client } = fakeClient({ getPlaces: vi.fn(async () => lowered) })
    const services = servicesFor(client)
    render(<ServicesProvider value={services}>{<Quick />}</ServicesProvider>)
    const panel = await quick()
    expect(await within(panel).findByText('1 at a time until memory frees up')).toBeTruthy()
    // Hold the runtime's next reading back, so what shows is what the change put back, not a fresh read.
    vi.mocked(client.getPlaces).mockImplementation(() => new Promise(() => undefined))
    vi.mocked(client.setAgentsAtOnce).mockRejectedValue(new Error('disk full'))
    const count = within(panel).getByRole('slider', { name: 'Agents at once' })
    count.focus()
    await userEvent.keyboard('{Home}')
    expect(await alert()).toBe('That couldn’t be kept. Try again.')
    expect(services.cache.getQueryData(keys.places)).toEqual(lowered)
    expect(within(panel).getByText('1 at a time until memory frees up')).toBeTruthy()
  })

  it('put the popover’s agents back to what was last kept when several changes on their way can’t be', async () => {
    const lowered = { busy: 1, configured: 4, atOnce: 1, why: 'memory' as const, waiting: 2 }
    const { client } = fakeClient({ getPlaces: vi.fn(async () => lowered) })
    const services = servicesFor(client)
    render(<ServicesProvider value={services}>{<Quick />}</ServicesProvider>)
    const panel = await quick()
    expect(await within(panel).findByText('1 at a time until memory frees up')).toBeTruthy()
    vi.mocked(client.getPlaces).mockImplementation(() => new Promise(() => undefined))
    // Two changes, to 3 and then 2, both still on their way.
    const refusals: Array<() => void> = []
    vi.mocked(client.setAgentsAtOnce).mockImplementation(
      () => new Promise<void>((_, reject) => void refusals.push(() => reject(new Error('disk full')))),
    )
    const count = within(panel).getByRole('slider', { name: 'Agents at once' })
    count.focus()
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(vi.mocked(client.setAgentsAtOnce).mock.calls.map(([n]) => n)).toEqual([3, 2])
    expect(services.cache.getQueryData(keys.places)).toMatchObject({ configured: 2 })
    // Both refused, in order: the popover goes back to what was kept, not to the first change's 3.
    for (const refuse of refusals) refuse()
    expect(await alert()).toBe('That couldn’t be kept. Try again.')
    expect(services.cache.getQueryData(keys.places)).toEqual(lowered)
    expect(within(panel).getByText('1 at a time until memory frees up')).toBeTruthy()
  })

  it('put the popover’s agents at the number kept when a later change on its way can’t be', async () => {
    const lowered = { busy: 1, configured: 4, atOnce: 1, why: 'memory' as const, waiting: 2 }
    const { client } = fakeClient({ getPlaces: vi.fn(async () => lowered) })
    const services = servicesFor(client)
    render(<ServicesProvider value={services}>{<Quick />}</ServicesProvider>)
    const panel = await quick()
    expect(await within(panel).findByText('1 at a time until memory frees up')).toBeTruthy()
    vi.mocked(client.getPlaces).mockImplementation(() => new Promise(() => undefined))
    const answers: Array<{ keep: () => void; refuse: () => void }> = []
    vi.mocked(client.setAgentsAtOnce).mockImplementation(
      () =>
        new Promise<void>((resolve, reject) => void answers.push({ keep: () => resolve(), refuse: () => reject(new Error('disk full')) })),
    )
    const count = within(panel).getByRole('slider', { name: 'Agents at once' })
    count.focus()
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    // The change to 3 is kept, the one to 2 isn't: 3 it is, still fewer for now and why.
    answers[0]?.keep()
    await Promise.resolve()
    answers[1]?.refuse()
    expect(await alert()).toBe('That couldn’t be kept. Try again.')
    expect(services.cache.getQueryData(keys.places)).toEqual({ ...lowered, configured: 3 })
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
        'MCP servers',
        'Skills',
        'Code hosts and trackers',
        'Tasks',
        'Pull requests',
        'Computers',
        'Work on this Mac',
        'Notifications',
        'Appearance',
        'Editor and browser',
        'About Althar',
      ]),
    )
    expect(
      sections()
        .getByRole('button', { name: /^Agents/ })
        .getAttribute('aria-current'),
    ).toBe('page')
    expect(screen.getByRole('heading', { name: 'Agents', level: 1 })).toBeTruthy()
    // The quick cards are here too, a press away.
    expect(screen.getByRole('switch', { name: 'Keep awake' })).toBeTruthy()
    // Opened, it asks the agents how they stand once, not again and again.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(vi.mocked(client.status).mock.calls.filter(([input]) => input?.recheck === true)).toHaveLength(1)

    await toSection('Pull requests')
    expect(screen.getByRole('heading', { name: 'Pull requests', level: 1 })).toBeTruthy()
    expect(sections().getByRole('button', { name: 'Pull requests' }).getAttribute('aria-current')).toBe('page')
    // A card's name goes to the section it is in.
    await userEvent.click(screen.getByRole('button', { name: /^Notifications\s*When you’re away/ }))
    expect(screen.getByRole('heading', { name: 'Notifications', level: 1 })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /^CPU and memory/ }))
    expect(screen.getByRole('heading', { name: 'Work on this Mac', level: 1 })).toBeTruthy()
  })

  it('names its sections as the address does, and takes nothing else for one', () => {
    expect(SECTIONS).toEqual([
      'agents',
      'mcp-servers',
      'skills',
      'code-hosts',
      'tasks',
      'pull-requests',
      'computers',
      'this-mac',
      'notifications',
      'appearance',
      'editor-and-browser',
      'about',
    ])
    expect(isSection('this-mac')).toBe(true)
    expect(isSection('mac')).toBe(false)
    expect(isSection(undefined)).toBe(false)
  })

  it('opens an old address where its settings went', () => {
    for (const [old, now] of [
      ['plans-and-reviews', 'tasks'],
      ['new-projects', 'tasks'],
      ['reviews', 'pull-requests'],
      ['editor', 'editor-and-browser'],
      ['browser', 'editor-and-browser'],
      ['dictation', 'this-mac'],
      ['agents', 'agents'],
    ] as const)
      expect(sectionOf(old)).toBe(now)
    expect(sectionOf('nowhere')).toBeUndefined()
    expect(sectionOf(undefined)).toBeUndefined()
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
    expect(within(install).getByText(/from GitHub, about 45 MB/)).toBeTruthy()
    await userEvent.click(within(install).getByRole('button', { name: 'Download OpenCode' }))
    expect(client.installAgent).toHaveBeenCalledWith('opencode')
  })

  it('looks again at once for an agent the person installed themselves', async () => {
    let installed = false
    const status = vi.fn(async () => ({
      apiVersion: 1,
      appVersion: '0.0.0',
      agents: installed ? agents : withoutOpenCode,
    }))
    const { client } = fakeClient({ status })
    withServices(<Settings />, client, fakeHost())
    await userEvent.click(await screen.findByRole('tab', { name: /OpenCode/ }))
    const install = screen.getByRole('region', { name: 'OpenCode isn’t on this Mac' })
    // Installed in Terminal meanwhile: Check again finds it without the window going away and back.
    installed = true
    await userEvent.click(within(install).getByRole('button', { name: 'Check again' }))
    expect(status).toHaveBeenLastCalledWith({ recheck: true })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'OpenCode isn’t on this Mac' })).toBeNull())
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
    expect(within(page).getByText('Default for 16 GB and 10 cores')).toBeTruthy()
    expect(within(page).queryByText(/busy/)).toBeNull()
    expect(within(page).queryByRole('button', { name: 'Use the default' })).toBeNull()
    count.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(client.setAgentsAtOnce).toHaveBeenLastCalledWith(6)
    await waitFor(() => expect(count.getAttribute('aria-valuenow')).toBe('6'))
    expect(within(page).getByText(/^Tests may slow down/)).toBeTruthy()
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

  it('lists the home and its workers, opens one out, and takes one out at once once the person says so', async () => {
    const capacity = { platform: 'linux', architecture: 'arm64', cpuCores: 8, freeMemoryMib: 12_697, freeDiskMib: 90_000 } as const
    const free = {
      workerId: `wrk_${'1'.repeat(32)}`,
      connected: true,
      busy: false,
      capacity,
      providers: ['codex'],
      projects: [{ id: 'p1', name: 'Meridian' }],
      task: null,
    }
    const working = {
      ...free,
      workerId: `wrk_${'2'.repeat(32)}`,
      busy: true,
      task: { taskId: 't1', threadId: 'thr_1', title: 'Fix the login redirect', project: 'Meridian' },
    }
    const away = { workerId: `wrk_${'3'.repeat(32)}`, connected: false, busy: false, providers: [], projects: [], task: null }
    let workers = [free, working, away]
    const { client } = fakeClient({
      getWorkers: vi.fn(async () => ({ enabled: true, workers })),
      removeWorker: vi.fn(async (id: string) => {
        workers = workers.filter((one) => one.workerId !== id)
      }),
    })
    withServices(<Settings at="computers" />, client)
    const page = screen.getByRole('main')
    // The home, with its agents as its popover has them, and each worker where it stands.
    expect(await within(page).findByText('Keeps your projects')).toBeTruthy()
    const tile = await within(page).findByRole('button', { name: /Linux worker 111111/ })
    expect(tile.textContent).toContain('Linux · arm64 · 8 cores')
    expect(tile.textContent).toContain('Free')
    expect(tile.textContent).toContain('12.4 GB')
    expect(within(page).getByRole('button', { name: /Linux worker 222222/ }).textContent).toContain('Fix the login redirect · Meridian')
    expect(within(page).getByRole('button', { name: /Linux worker 333333/ }).textContent).toContain('Offline')

    // Opened out: what it is, the agents it can run and its projects; taken out once the person says so, off the list at once.
    await userEvent.click(tile)
    expect(await within(page).findByRole('heading', { name: 'Linux worker 111111' })).toBeTruthy()
    expect(within(page).getByText('Meridian')).toBeTruthy()
    await userEvent.click(within(page).getByRole('button', { name: 'Remove Linux worker 111111' }))
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Remove Linux worker 111111?' })).getByRole('button', { name: 'Remove' }),
    )
    expect(client.removeWorker).toHaveBeenCalledWith(free.workerId)
    expect(within(page).queryByRole('button', { name: /Linux worker 111111/ })).toBeNull()
    expect(within(page).getByRole('button', { name: /Linux worker 222222/ })).toBeTruthy()

    // One at work keeps its task: its Remove waits for it.
    await userEvent.click(within(page).getByRole('button', { name: /Linux worker 222222/ }))
    expect((within(page).getByRole('button', { name: 'Remove Linux worker 222222' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('in a window on a Linux home over SSH, name that home, take workers out as its operator, and give its own commands', async () => {
    const studio = onLinuxHome('studio')
    const worker = {
      workerId: `wrk_${'6'.repeat(32)}`,
      connected: true,
      busy: false,
      capacity: { platform: 'linux', architecture: 'x64', cpuCores: 4, freeMemoryMib: 8_000, freeDiskMib: 50_000 },
      providers: ['codex'],
      projects: [],
      task: null,
    } as const
    const { client } = fakeClient({ connection: studio.connection, getWorkers: vi.fn(async () => ({ enabled: true, workers: [worker] })) })
    withServices(<Settings at="computers" />, client, fakeHost({ homes: studio.homes }))
    const page = screen.getByRole('main')
    // Its load, agents and workers are studio's: it goes by that name, never This Mac.
    expect(await within(page).findByRole('button', { name: /^studio/ })).toBeTruthy()
    expect(within(page).queryByText('This Mac')).toBeNull()
    await userEvent.click(within(page).getByRole('button', { name: /Linux worker 666666/ }))
    // Over SSH it reaches the home as its operator, as the host's console does: it may take workers out.
    expect((within(page).getByRole('button', { name: 'Remove Linux worker 666666' }) as HTMLButtonElement).disabled).toBe(false)
    await userEvent.click(within(page).getByRole('button', { name: 'Computers' }))
    await userEvent.click(within(page).getByRole('button', { name: 'Add a worker' }))
    const adding = screen.getByRole('dialog', { name: 'Add a worker to studio' })
    expect(within(adding).getByText(/althar-host enroll-worker .* && althar-host status --wait --json$/)).toBeTruthy()
    expect(within(adding).queryByText(/althar workers enroll/)).toBeNull()
    expect(within(adding).getByText(/--agent-config ~\/althar-worker\/agents\.conf --watch$/)).toBeTruthy()
  })

  it('on an older Linux home over SSH, leaves Remove off and says to update it', async () => {
    const studio = onLinuxHome('studio')
    const worker = { workerId: `wrk_${'6'.repeat(32)}`, connected: true, busy: false, providers: ['codex'], projects: [], task: null }
    const { client } = fakeClient({
      connection: { ...studio.connection, calls: studio.connection.calls.filter((call) => call !== 'RemoveWorker') },
      getWorkers: vi.fn(async () => ({ enabled: true, workers: [worker] })),
    })
    withServices(<Settings at="computers" />, client, fakeHost({ homes: studio.homes }))
    const page = screen.getByRole('main')
    await userEvent.click(await within(page).findByRole('button', { name: /Linux worker 666666/ }))
    expect((within(page).getByRole('button', { name: 'Remove Linux worker 666666' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(page).getByText('studio runs an older Althar: update it to remove its workers from here.')).toBeTruthy()
  })

  it('on a home paired over the network, offers no sign-in over SSH for its workers', async () => {
    const studio = onLinuxHome('studio')
    const paired = {
      ...studio.homes,
      state: vi.fn(async () => ({
        ...(await studio.homes.state()),
        current: {
          kind: 'https' as const,
          home: { ...(await studio.homes.list())[0]!, ssh: undefined, https: { origin: 'https://studio:6769' } },
        },
      })),
    }
    const worker: HomeWorker = {
      workerId: `wrk_${'6'.repeat(32)}`,
      name: 'box',
      ssh: 'root@box',
      anyProject: true,
      signedIn: [],
      connected: true,
      busy: false,
      providers: ['codex'],
      projects: [],
      task: null,
    }
    const signIn = vi.fn(async () => undefined)
    const { client } = fakeClient({ connection: studio.connection, getWorkers: vi.fn(async () => ({ enabled: true, workers: [worker] })) })
    withServices(
      <Settings at="computers" />,
      client,
      fakeHost({
        homes: paired as never,
        workers: {
          setup: vi.fn(async () => null),
          setUp: vi.fn(async () => undefined),
          act: vi.fn(async () => undefined),
          onSetup: vi.fn(() => () => undefined),
          agents: vi.fn(async () => []),
          signIn,
          signInAct: vi.fn(async () => undefined),
          onSignIn: vi.fn(() => () => undefined),
        },
      }),
    )
    const page = screen.getByRole('main')
    await userEvent.click(await within(page).findByRole('button', { name: /^box/ }))
    expect(within(page).getByText('Not signed in')).toBeTruthy()
    expect(within(page).queryByRole('button', { name: 'Sign in' })).toBeNull()
  })

  it('put a worker back with why when it can’t be taken out, and say what adding one takes', async () => {
    const worker = { workerId: `wrk_${'4'.repeat(32)}`, connected: false, busy: false, providers: [], projects: [], task: null }
    const { client } = fakeClient({
      getWorkers: vi.fn(async () => ({ enabled: true, workers: [worker] })),
      removeWorker: vi.fn(async () => {
        throw new ApiError({ reason: 'WorkerNotRemoved', message: 'The worker ledger is busy.' })
      }),
    })
    withServices(<Settings at="computers" />, client)
    const page = screen.getByRole('main')
    await userEvent.click(await within(page).findByRole('button', { name: /Linux worker 444444/ }))
    await userEvent.click(within(page).getByRole('button', { name: 'Remove Linux worker 444444' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))
    expect(await alert()).toBe('The worker ledger is busy.')
    expect(await within(page).findByRole('button', { name: /Linux worker 444444/ })).toBeTruthy()

    // The home takes workers already: adding one is enrolling it, then starting it.
    await userEvent.click(within(page).getByRole('button', { name: 'Add a worker' }))
    const adding = screen.getByRole('dialog', { name: 'Add a worker to This Mac' })
    expect(within(adding).queryByText(/althar workers configure/)).toBeNull()
    expect(within(adding).getByText(/althar workers enroll/)).toBeTruthy()
  })

  it('adds a worker over SSH: its first step at once, its key signed by the home, then its sheet to pick its projects', async () => {
    const workerId = `wrk_${'7'.repeat(32)}`
    const grant = {
      homeId: `home_${'1'.repeat(32)}`,
      workerId,
      authority: 'CA',
      certificate: 'CERT',
      serverName: 'home.althar.invalid',
      port: 6770,
      addresses: ['192.168.1.2:6770'],
    }
    let listening: ((setup: WorkerSetup | null) => void) | undefined
    const bridge: WorkersHost = {
      setup: vi.fn(async () => null),
      setUp: vi.fn(async () => undefined),
      act: vi.fn(async () => undefined),
      onSetup: vi.fn((listener) => {
        listening = listener
        return () => undefined
      }),
      agents: vi.fn(async () => []),
      signIn: vi.fn(async () => undefined),
      signInAct: vi.fn(async () => undefined),
      onSignIn: vi.fn(() => () => undefined),
    }
    let workers: HomeWorker[] = []
    const { client } = fakeClient({
      getWorkers: vi.fn(async () => ({ enabled: true, adds: true, workers })),
      addWorker: vi.fn(async () => grant),
      listProjects: vi.fn(async () => ({ cursor: 0, projects: [{ ...project, id: 'proj_m', name: 'Meridian' }] })),
    })
    withServices(<Settings at="computers" />, client, fakeHost({ workers: bridge }))
    const page = screen.getByRole('main')
    await userEvent.click(await within(page).findByRole('button', { name: /^Add a worker/ }))
    const adding = screen.getByRole('dialog', { name: 'Add a worker to This Mac' })
    // A line that isn't an address is said at its field.
    await userEvent.type(within(adding).getByLabelText('SSH address'), 'not an address')
    await userEvent.click(within(adding).getByRole('button', { name: 'Add worker' }))
    expect(within(adding).getByText(/That isn’t an SSH address/)).toBeTruthy()
    await userEvent.clear(within(adding).getByLabelText('SSH address'))
    await userEvent.type(within(adding).getByLabelText('SSH address'), 'build@box:2222')
    await userEvent.click(within(adding).getByRole('button', { name: 'Add worker' }))
    // Its first step shows at once; main goes on behind.
    expect(within(screen.getByRole('dialog', { name: 'Add a worker to This Mac' })).getByText('Reach the machine')).toBeTruthy()
    expect(bridge.setUp).toHaveBeenCalledWith({ target: 'build@box', port: 2222 }, true)
    // Its key made: the window's own home signs it, and main hands that to the worker.
    const base = { target: { target: 'althar@box', port: 2222 }, name: 'box', log: [] }
    act(() => listening?.({ ...base, phase: 'enroll', at: 3, publicKey: 'KEY' }))
    await waitFor(() => expect(client.addWorker).toHaveBeenCalledWith({ publicKey: 'KEY', name: 'box', ssh: 'althar@box:2222' }))
    await waitFor(() => expect(bridge.act).toHaveBeenCalledWith({ kind: 'enroll', grant }))
    // Started and connected: the dialog gives way to its sheet, where its projects are picked.
    workers = [
      {
        workerId,
        name: 'box',
        ssh: 'althar@box:2222',
        anyProject: true,
        signedIn: ['codex'],
        connected: true,
        busy: false,
        providers: ['codex'],
        projects: [],
        task: null,
      },
    ]
    act(() => listening?.({ ...base, phase: 'done', at: 5, workerId }))
    expect(await within(page).findByRole('heading', { name: 'box' }, { timeout: 8_000 })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Add a worker to This Mac' })).toBeNull()
    expect(bridge.act).toHaveBeenCalledWith({ kind: 'dismiss' })
    await userEvent.click(await within(page).findByRole('checkbox', { name: 'Meridian' }))
    expect(client.setWorkerProjects).toHaveBeenCalledWith(workerId, ['proj_m'])
    expect(within(page).getByText('Signed in')).toBeTruthy()
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
    withServices(<Settings at="pull-requests" />, client)
    const posts = await screen.findByRole('switch', { name: 'Post reviews of my team’s pull requests without asking' })
    expect(posts.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Pull requests from outside the team still wait for you.')).toBeTruthy()
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
    withServices(<Settings at="pull-requests" />, client)
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
    expect(screen.getByText('Only your name goes out.')).toBeTruthy()

    // Opened again while off, it doesn't ask again.
    await toSection('Notifications')
    await toSection('Pull requests')
    expect(await screen.findByRole('switch', { name: 'Althar as co-author' })).toBeTruthy()
    expect(screen.queryByText(/no marketing budget/)).toBeNull()
  })

  it('turns co-authoring back when the change can’t be kept, and says so', async () => {
    const { client } = fakeClient()
    vi.mocked(client.setCoAuthor).mockRejectedValue(new Error('disk full'))
    withServices(<Settings at="pull-requests" />, client)
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

  it('puts the review seal on pull requests until the person turns it off, with its look to pick while it is on', async () => {
    const { client } = fakeClient()
    withServices(<Settings at="pull-requests" />, client)
    const seal = await screen.findByRole('switch', { name: 'Review seal on pull requests' })
    expect(seal.getAttribute('aria-checked')).toBe('true')
    // A pull request as GitHub shows it: the ring in its corner, the review folded under it; never how many findings.
    const pr = screen.getByRole('figure', { name: 'A pull request as GitHub shows it' })
    expect(within(pr).getByRole('img', { name: 'Reviewed by GPT-6.1 Sol in 2 passes, at 4e1c07a' })).toBeTruthy()
    expect(pr.textContent).not.toMatch(/finding/i)
    expect(screen.getByRole('radio', { name: 'Ring' }).getAttribute('aria-checked')).toBe('true')

    await userEvent.click(screen.getByRole('radio', { name: 'Colophon' }))
    expect(client.setReviewSealStyle).toHaveBeenCalledWith('colophon')
    expect(screen.getByRole('radio', { name: 'Colophon' }).getAttribute('aria-checked')).toBe('true')

    // Off: no seal and no looks, and what goes out instead.
    await userEvent.click(seal)
    expect(client.setReviewSeal).toHaveBeenCalledWith(false)
    expect(within(screen.getByRole('figure', { name: 'A pull request as GitHub shows it' })).queryByRole('img')).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Colophon' })).toBeNull()
    expect(screen.getByText('Pull requests go out with only their description.')).toBeTruthy()

    // On again, as it was picked.
    await userEvent.click(seal)
    expect(client.setReviewSeal).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('radio', { name: 'Colophon' }).getAttribute('aria-checked')).toBe('true')
  })

  it('turns the review seal back when the change can’t be kept, and says so', async () => {
    const { client } = fakeClient()
    vi.mocked(client.setReviewSeal).mockRejectedValue(new Error('disk full'))
    withServices(<Settings at="pull-requests" />, client)
    const seal = await screen.findByRole('switch', { name: 'Review seal on pull requests' })
    await userEvent.click(seal)
    expect(await alert()).toBe('That couldn’t be kept. Try again.')
    await waitFor(() => expect(seal.getAttribute('aria-checked')).toBe('true'))
  })

  it('turns each kind of notification on and off, with the count and a sound heard as it is chosen', async () => {
    const host = fakeHost()
    withServices(<Settings at="notifications" />, fakeClient().client, host)
    const page = screen.getByRole('main')
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
    withServices(<Settings at="editor-and-browser" />, client, host)
    // Each editor by its own icon.
    const editors = await screen.findByRole('radiogroup', { name: 'Open files in' })
    expect(within(editors).getByRole('radio', { name: 'Cursor' }).getAttribute('aria-checked')).toBe('true')
    await waitFor(() => expect(editors.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,cursor'))
    await userEvent.click(within(editors).getByRole('radio', { name: 'Zed' }))
    expect(host.setPreference).toHaveBeenLastCalledWith('editor', 'zed')
    await waitFor(() => expect(within(editors).getByRole('radio', { name: 'Zed' }).getAttribute('aria-checked')).toBe('true'))
  })

  it('says where files open when there is no editor to choose', async () => {
    withServices(<Settings at="editor-and-browser" />, fakeClient({ listEditors: vi.fn(async () => []) }).client)
    // A designed empty state: what will be here, where files open meanwhile, and a way to look again.
    expect(await screen.findByRole('heading', { name: 'No editor found' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Look again' })).toBeTruthy()
  })

  it('says which Althar this is, in early access, with the website, what’s new there and the Discord server', async () => {
    withServices(<Settings at="about" />, fakeClient().client)
    const page = screen.getByRole('main')
    expect(await within(page).findByText('Althar 0.0.0')).toBeTruthy()
    expect(within(page).getByText('Early access')).toBeTruthy()
    const href = (name: RegExp) => within(page).getByRole('link', { name }).getAttribute('href')
    expect(href(/What’s new/)).toBe('https://althar.ai/changelog')
    expect(href(/Website/)).toBe('https://althar.ai/')
    expect(href(/Discord/)).toBe('https://discord.gg/QA2g8MwKda')
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

  it('shows where Althar keeps its data under About Althar, with sizes and shares, and opens a place in the file manager', async () => {
    const host = fakeHost()
    const { client } = fakeClient()
    withServices(<Settings at="about" />, client, host)
    const main = screen.getByRole('main')
    expect((await within(main).findAllByText('3.0 GB')).length).toBe(3)
    expect(within(main).getAllByText('33%').length).toBe(3)
    const tasks = within(main).getByRole('button', { name: /^Show in (Finder|Explorer|Files), Task folders$/ })
    // The path is Show's tooltip.
    expect(tasks.getAttribute('title')).toMatch(/: \/home\/me\/Althar$/)
    expect(
      within(main)
        .getByRole('button', { name: /^Show in (Finder|Explorer|Files), Logs$/ })
        .getAttribute('title'),
    ).toMatch(/: \/home\/me\/\.local\/share\/althar\/logs$/)
    await userEvent.click(tasks)
    expect(host.storage.show).toHaveBeenCalledWith('worktrees')
    await userEvent.click(within(main).getByRole('button', { name: 'Measure again' }))
    await waitFor(() => expect(client.getStorageSize).toHaveBeenCalledWith('profile', true, expect.anything()))
  })

  it('says why a place could not be opened in the file manager, at its row', async () => {
    const host = fakeHost()
    vi.mocked(host.storage.show).mockRejectedValueOnce(
      new Error("Error invoking remote method 'althar:storage-show': Error: No application can open folders"),
    )
    withServices(<Settings at="about" />, fakeClient().client, host)
    const main = screen.getByRole('main')
    await userEvent.click(await within(main).findByRole('button', { name: /^Show in (Finder|Explorer|Files), Logs$/ }))
    expect((await within(main).findByRole('alert')).textContent).toBe('Couldn’t open it: No application can open folders')
    // The path, to copy instead.
    expect(within(main).getByText('/home/me/.local/share/althar/logs')).toBeTruthy()
  })

  it('checks for updates from About Althar, as the app menu does, only where the app updates', async () => {
    let checked: () => void = () => undefined
    const check = vi.fn(() => new Promise<void>((done) => (checked = done)))
    const update = {
      glance: vi.fn(async () => ({ ready: null, working: false, restarting: false, failed: null })),
      restart: vi.fn(async () => false),
      check,
      onChange: () => () => undefined,
    }
    withServices(<Settings at="about" />, fakeClient().client, fakeHost({ update }))
    const main = screen.getByRole('main')
    await userEvent.click(await within(main).findByRole('button', { name: 'Check for updates' }))
    expect(check).toHaveBeenCalledOnce()
    expect(within(main).getByRole('button', { name: 'Checking…' })).toHaveProperty('disabled', true)
    checked()
    expect(await within(main).findByRole('button', { name: 'Check for updates' })).toBeTruthy()
  })

  it('offers no check where the app doesn’t update', async () => {
    withServices(<Settings at="about" />, fakeClient().client)
    expect(await within(screen.getByRole('main')).findByText('Althar 0.0.0')).toBeTruthy()
    expect(within(screen.getByRole('main')).queryByRole('button', { name: 'Check for updates' })).toBeNull()
  })

  it('takes Free up space to the task folders under Work on this computer', async () => {
    const onSection = vi.fn()
    withServices(<Settings at="about" onSection={onSection} />, fakeClient().client)
    await userEvent.click(await within(screen.getByRole('main')).findByRole('button', { name: 'Free up space' }))
    expect(onSection).toHaveBeenCalledWith('this-mac', 'task-folders')
  })

  it('sends anonymous usage data until the person turns it off under About Althar, with one line on what it sends', async () => {
    const host = fakeHost()
    withServices(<Settings at="about" />, fakeClient().client, host)
    const usage = await screen.findByRole('switch', { name: 'Usage data' })
    await waitFor(() => expect(usage.getAttribute('aria-checked')).toBe('true'))
    expect(document.getElementById(usage.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Anonymous. Never your code or any name.',
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
      'Anonymous. Never your code or any name.',
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

  it('offers light, dark or as the Mac is, light to begin with, and keeps a choice', async () => {
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
    expect(checked()).toEqual(['Light'])
    await userEvent.click(within(choice).getByRole('radio', { name: 'Match the Mac' }))
    await waitFor(() => expect(host.setPreference).toHaveBeenCalledWith('appearance', 'system'))
    await userEvent.click(within(choice).getByRole('radio', { name: 'Dark' }))
    await waitFor(() => expect(host.setPreference).toHaveBeenCalledWith('appearance', 'dark'))
    await waitFor(() => expect(checked()).toEqual(['Dark']))
  })

  it('offers Althar’s accent or the system’s, Althar’s to begin with, and says when the system’s can’t be used', async () => {
    // GNOME's yellow: too light to read on Althar's paper, kept as the system's only in name.
    const chrome = { kind: 'mac', family: 'mac', layout: { start: [], end: [] }, accent: { r: 245, g: 194, b: 17 } } as const
    const host = fakeHost({ chrome: () => chrome, onChrome: () => () => undefined })
    withServices(<Settings at="appearance" />, fakeClient().client, host)
    const choice = await screen.findByRole('radiogroup', { name: 'Accent colour' })
    expect(
      within(choice)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Althar’s', 'The Mac’s'])
    expect(screen.queryByText(/wouldn’t be readable here/)).toBeNull()
    await userEvent.click(within(choice).getByRole('radio', { name: 'The Mac’s' }))
    await waitFor(() => expect(host.setPreference).toHaveBeenCalledWith('accent', 'system'))
    expect(await screen.findByText('The Mac’s accent colour wouldn’t be readable here, so Althar keeps its own.')).toBeTruthy()
  })

  it('offers where Althar shows in another app, on a Mac with a notch, and keeps a choice', async () => {
    const host = fakeHost()
    withServices(<Settings at="appearance" />, fakeClient().client, host)
    const places = await screen.findByRole('radiogroup', { name: 'In other apps' })
    const radios = () => within(places).getAllByRole<HTMLInputElement>('radio')
    expect(radios().map((radio) => radio.checked)).toEqual([true, false])
    // Each place as the screen would look; with nothing under way, a busy moment, said as such.
    expect(screen.getByText('An example, until work is under way')).toBeTruthy()
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
    expect(await screen.findByText('This screen has no notch.')).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'In other apps' })).toBeNull()
    expect(screen.getByText('In the menu bar')).toBeTruthy()
  })

  it('asks the main process again each time the section opens, as a screen with a notch comes and goes', async () => {
    let notch = true
    const edge = vi.fn(async () => ({ place: 'island', notch, platform: 'darwin', tray: true }))
    withServices(<Settings at="appearance" />, fakeClient().client, fakeHost({ edge }))
    expect(await screen.findByRole('radiogroup', { name: 'In other apps' })).toBeTruthy()
    notch = false
    await toSection('Editor and browser')
    await toSection('Appearance')
    expect(await screen.findByText('This screen has no notch.')).toBeTruthy()
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
    await toSection('Editor and browser')
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
    const answer = (at: number) => {
      const one = answers[at]
      if (one === undefined) throw new Error(`No icon choice ${at} was asked for`)
      return one
    }
    withServices(<Settings at="appearance" />, fakeClient().client, host)
    const icons = await screen.findByRole('radiogroup', { name: 'App icon' })
    const checked = () =>
      within(icons)
        .getAllByRole('radio')
        .find((radio) => radio.getAttribute('aria-checked') === 'true')?.textContent

    // Ink, then Paper before Ink is kept: Paper is kept, and Ink failing after says nothing.
    await userEvent.click(within(icons).getByRole('radio', { name: 'Ink' }))
    await userEvent.click(within(icons).getByRole('radio', { name: 'Paper' }))
    await act(async () => answer(1).resolve())
    await act(async () => answer(0).reject(new Error('late')))
    expect(checked()).toBe('Paper')
    expect(screen.queryByRole('alert')).toBeNull()

    // Keystone, which can't be kept: Paper, the last kept, comes back.
    await userEvent.click(within(icons).getByRole('radio', { name: 'Keystone' }))
    await act(async () => answer(2).reject(new Error('no picture')))
    expect(checked()).toBe('Paper')
    expect(await alert()).toBe('That icon couldn’t be kept. Try again.')
  })

  it('offers no icon where there is no Dock to show one', async () => {
    withServices(<Settings at="appearance" />, fakeClient().client, fakeHost({ appIcon: vi.fn(async () => null) }))
    expect(await screen.findByRole('radiogroup', { name: 'In other apps' })).toBeTruthy()
    expect(screen.queryByRole('radiogroup', { name: 'App icon' })).toBeNull()
  })
})

describe('the skills’ view model', () => {
  const installed = { treeHash: 'b'.repeat(64), review: 'reviewed' as const, active: true }

  it('takes a card from the folder installed as an update, and one from anywhere else as replacing it, saying from where', () => {
    expect(reviewOf(skillCard)).toMatchObject({ id: 'release-notes', repo: 'acme/agent-skills', update: false, replaces: null })
    const same = { ...installed, source: 'github' as const, repo: 'acme/agent-skills', subpath: 'skills/release-notes' }
    expect(reviewOf({ ...skillCard, installed: same })).toMatchObject({ update: true, replaces: null })
    expect(reviewOf({ ...skillCard, installed: { ...same, subpath: 'old/release-notes' } })).toMatchObject({
      update: false,
      replaces: 'acme/agent-skills',
    })
    expect(reviewOf({ ...skillCard, installed: { ...same, repo: 'other/skills' } })).toMatchObject({
      update: false,
      replaces: 'other/skills',
    })
    expect(reviewOf({ ...skillCard, installed: { ...installed, source: 'local' as const } })).toMatchObject({
      update: false,
      replaces: 'A folder you imported',
    })
  })
})

describe('Settings › Browser', () => {
  it('keeps where a thread’s links open and how long pages keep cookies, and clears every page’s at once', async () => {
    const clearAll = vi.fn(async () => {})
    const host = fakeHost({ pages: fakePagesHost({ clearAll }) })
    withServices(<Settings at="editor-and-browser" />, fakeClient().client, host)
    expect(await screen.findByRole('heading', { name: 'Editor and browser', level: 1 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Pages beside conversations', level: 2 })).toBeTruthy()
    const links = screen.getByRole('radiogroup', { name: 'Links from threads' })
    expect(within(links).getByRole('radio', { name: 'Beside the conversation' }).getAttribute('aria-checked')).toBe('true')
    await userEvent.click(within(links).getByRole('radio', { name: 'In your browser' }))
    await waitFor(() => expect(host.setPreference).toHaveBeenLastCalledWith('browserLinks', 'outside'))
    await userEvent.click(screen.getByRole('combobox', { name: 'Keep cookies' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Until Althar quits' }))
    await waitFor(() => expect(host.setPreference).toHaveBeenLastCalledWith('browserCookies', 'quit'))
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(clearAll).toHaveBeenCalled()
    expect(await screen.findByText('None kept.')).toBeTruthy()
  })
})
