import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@althar/contracts'

import { AutomationsView } from '../src/renderer/features/automations/AutomationsView'
import { DEFAULT_PREFERENCES } from '../src/main/appPreferences'
import {
  agents,
  automationRun,
  automationsSnapshot,
  automationSummary,
  automationView,
  changed,
  definition,
  fakeClient,
  fakeHost,
} from './fixtures'
import { withServices } from './render'

/* On this Mac's clock: Tuesday 29 September 2026, at noon. */
const local = (day: number, hours: number, minutes = 0) => new Date(2026, 8, day, hours, minutes).toISOString()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 8, 29, 12, 0) })
})
afterEach(() => {
  vi.useRealTimers()
})

const signedIn = agents.slice(0, 2)
const lead = { agentId: 'claude-code', model: null, effort: null }

/** The Automations room, as a project's view gives it: what is open, kept as the address would keep it. */
function Room({ opening = null, onTask = vi.fn() }: { opening?: string | null; onTask?: (threadId: string) => void }) {
  const [open, setOpen] = useState<string | null>(opening)
  return (
    <>
      <AutomationsView projectId="p1" project="meridian" agents={signedIn} lead={lead} open={open} onOpen={setOpen} onTask={onTask} />
      <output aria-label="Open">{open ?? 'the tab'}</output>
    </>
  )
}

const opened = () => screen.getByRole('status', { name: 'Open' }).textContent

describe('the Automations tab', () => {
  it('lists the one that paused itself first, saying why, then the rest, each saying where it stands; a card opens its page', async () => {
    const { client } = fakeClient({
      getAutomations: vi.fn(async () =>
        automationsSnapshot({
          automations: [
            automationSummary({ nextAt: local(30, 9), latest: [automationRun({ at: local(29, 9, 2) })] }),
            automationSummary({
              id: 'auto2',
              name: 'Nightly bump',
              schedule: { every: 'week', days: [1, 2, 3, 4, 5, 6, 7], at: '02:00' },
              latest: [automationRun({ id: 'occ2', state: 'running', at: local(29, 9, 21), subject: null, task: null })],
            }),
            automationSummary({
              id: 'auto3',
              name: 'Sunday end-to-end',
              state: 'paused',
              pausedBy: 'itself',
              pauseReason: 'Failed three Sundays running.',
              latest: [],
            }),
            automationSummary({ id: 'auto4', name: 'Changelog', state: 'paused', pausedBy: 'person', latest: [] }),
            automationSummary({ id: 'auto5', name: 'Gone', state: 'deleted' }),
          ],
        }),
      ),
    })
    withServices(<Room />, client)
    await screen.findByRole('heading', { name: 'Automations' })
    const group = screen.getByRole('region', { name: 'On a schedule' })
    expect(
      within(group)
        .getAllByRole('article')
        .map((card) => within(card).getAllByRole('button')[0]?.textContent),
    ).toEqual(['Sunday end-to-end', 'Morning review', 'Nightly bump', 'Changelog'])
    expect(within(group).getByText('Failed three Sundays running.')).toBeTruthy()
    expect(within(group).getByText('Paused itself')).toBeTruthy()
    expect(within(group).getByText('Next tomorrow 9:00')).toBeTruthy()
    expect(within(group).getByText('Running since 9:21')).toBeTruthy()
    expect(within(group).getByText('Every night at 2:00')).toBeTruthy()
    expect(within(group).getByText('Paused')).toBeTruthy()
    expect(within(group).getAllByText('Hasn’t run yet')).toHaveLength(2)
    // Its last run's words, after when it was.
    expect(within(group).getByRole('listitem', { name: 'Today 9:02 · Review #264' })).toBeTruthy()
    await userEvent.click(within(group).getByRole('button', { name: 'Morning review' }))
    expect(opened()).toBe('auto1')
  })

  it('pauses every automation from its menu, says so in one line, and resumes them', async () => {
    const { client } = fakeClient({ getAutomations: vi.fn(async () => automationsSnapshot()) })
    withServices(<Room />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Pause all automations' }))
    expect(client.setAutomationsPaused).toHaveBeenCalledWith(true)
    expect(await screen.findByText(/Every automation is paused/)).toBeTruthy()
    // Every one of them stands paused, at once.
    expect(screen.getByText('Paused')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(client.setAutomationsPaused).toHaveBeenLastCalledWith(false)
    await waitFor(() => expect(screen.queryByText(/Every automation is paused/)).toBeNull())
  })

  it('says when pausing them couldn’t be done, and reads again what holds', async () => {
    const getAutomations = vi.fn(async () => automationsSnapshot())
    const { client } = fakeClient({
      getAutomations,
      setAutomationsPaused: vi.fn(async () => {
        throw new ApiError({ reason: 'Busy', message: 'Althar couldn’t pause them.' })
      }),
    })
    withServices(<Room />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Pause all automations' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Althar couldn’t pause them.')
    await waitFor(() => expect(getAutomations.mock.calls.length).toBeGreaterThan(1))
    await waitFor(() => expect(screen.queryByText(/Every automation is paused/)).toBeNull())
  })

  it('says where they run while Althar doesn’t open at login, and opens it at login', async () => {
    const host = fakeHost()
    const { client } = fakeClient({ getAutomations: vi.fn(async () => automationsSnapshot()) })
    withServices(<Room />, client, host)
    expect(await screen.findByText(/They run on this Mac while Althar is open\./)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open Althar at login' }))
    expect(host.setPreference).toHaveBeenCalledWith('openAtLogin', true)
    await waitFor(() => expect(screen.queryByText(/They run on this Mac/)).toBeNull())
  })

  it('says nothing of it once Althar opens at login', async () => {
    const host = fakeHost({ preferences: vi.fn(async () => ({ ...DEFAULT_PREFERENCES, openAtLogin: true })) })
    const { client } = fakeClient({ getAutomations: vi.fn(async () => automationsSnapshot()) })
    withServices(<Room />, client, host)
    await screen.findByRole('button', { name: 'Morning review' })
    await waitFor(() => expect(host.preferences).toHaveBeenCalled())
    expect(screen.queryByText(/They run on this Mac/)).toBeNull()
  })

  it('has none yet: what to say to the coordinator, or New automation, which opens a blank page', async () => {
    const { client } = fakeClient()
    withServices(<Room />, client)
    expect(await screen.findByText(/None yet\. Ask the coordinator/)).toBeTruthy()
    expect(screen.getByText('“every weekday at 9, review the new pull requests”')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'New automation' }))
    expect(opened()).toBe('new')
    expect(await screen.findByRole('textbox', { name: 'Name' })).toBeTruthy()
  })

  it('says so where they can’t be read', async () => {
    const { client } = fakeClient({
      getAutomations: vi.fn(async () => {
        throw new ApiError({ reason: 'Gone', message: 'That project isn’t there any more.' })
      }),
    })
    withServices(<Room />, client)
    expect((await screen.findByRole('alert')).textContent).toBe('That project isn’t there any more.')
  })
})

describe('an automation’s page', () => {
  it('says where it stands, runs it now, turns it off and on, and opens a run’s task', async () => {
    const onTask = vi.fn()
    const { client } = fakeClient({
      getAutomation: vi.fn(async () => ({
        cursor: 6,
        automation: automationView({
          nextAt: local(30, 9),
          runs: [
            automationRun({ at: local(29, 9, 2) }),
            automationRun({ id: 'occ2', state: 'nothing', reason: 'No new pull requests', task: null, at: local(28, 9) }),
          ],
        }),
      })),
    })
    withServices(<Room opening="auto1" onTask={onTask} />, client)
    expect(await screen.findByRole('heading', { name: 'Morning review' })).toBeTruthy()
    expect(screen.getByText('Runs next tomorrow at 9:00')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'What it does' })).toBeTruthy()
    // Its card, kept: its prompt the head, its rows.
    expect(screen.getByText(/Review the pull requests opened since yesterday/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Every weekday at 9:00/ })).toBeTruthy()
    expect(screen.queryByText('Automation · meridian')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Run now' }))
    expect(client.runAutomationNow).toHaveBeenCalledWith('auto1')
    const on = screen.getByRole('switch', { name: 'On' })
    await userEvent.click(on)
    expect(client.pauseAutomation).toHaveBeenCalledWith('auto1')
    await waitFor(() => expect(screen.getByText('Paused')).toBeTruthy())
    await userEvent.click(screen.getByRole('switch', { name: 'On' }))
    expect(client.turnOnAutomation).toHaveBeenCalledWith('auto1')
    // A run with a task opens it; one that found nothing is its line alone.
    await userEvent.click(screen.getByRole('button', { name: /Review #264/ }))
    expect(onTask).toHaveBeenCalledWith('th9')
    expect(screen.getByText('No new pull requests')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /No new pull requests/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Automations' }))
    expect(opened()).toBe('the tab')
  })

  it('changes what it does, each time the whole of it: when, its prompt, its name, and its limits', async () => {
    const { client } = fakeClient()
    withServices(<Room opening="auto1" />, client)
    await screen.findByRole('heading', { name: 'Morning review' })
    await userEvent.click(screen.getByRole('button', { name: /Every weekday at 9:00/ }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Every Friday at 16:00' }))
    expect(client.changeAutomation).toHaveBeenLastCalledWith('auto1', definition({ schedule: { every: 'week', days: [5], at: '16:00' } }))
    // Shown at once, before it is read back.
    expect(await screen.findByRole('button', { name: /Every Friday at 16:00/ })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const prompt = screen.getByRole('textbox', { name: 'What each run is asked' })
    await userEvent.clear(prompt)
    await userEvent.type(prompt, 'Review the new ones.')
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(client.changeAutomation).toHaveBeenLastCalledWith('auto1', expect.objectContaining({ prompt: 'Review the new ones.' }))

    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    const name = await screen.findByRole('textbox', { name: 'Name' })
    await userEvent.clear(name)
    await userEvent.type(name, 'Review of the morning{Enter}')
    expect(client.changeAutomation).toHaveBeenLastCalledWith('auto1', expect.objectContaining({ name: 'Review of the morning' }))

    await userEvent.click(screen.getByRole('switch', { name: 'Allow everything' }))
    expect(client.changeAutomation).toHaveBeenLastCalledWith('auto1', expect.objectContaining({ allowEverything: false }))
    await userEvent.click(screen.getByRole('switch', { name: 'Post its reviews without asking' }))
    expect(client.setAutomationPostsReviews).toHaveBeenCalledWith('auto1', true)
    expect(screen.getByText(/One at most, after your own work/)).toBeTruthy()
    expect(screen.getByText(/After three failures in a row/)).toBeTruthy()
    // A review ends in no pull request of its own: no limit on them.
    expect(screen.queryByText('Open pull requests')).toBeNull()
  })

  it('changes its lead, adds a reviewer and how its task ends, and how long a run may work', async () => {
    const { client } = fakeClient({
      getAutomation: vi.fn(async () => ({
        cursor: 6,
        automation: automationView({ work: 'task', definition: definition({ work: { kind: 'task', review: null, end: 'draft' } }) }),
      })),
    })
    withServices(<Room opening="auto1" />, client)
    await screen.findByRole('heading', { name: 'Morning review' })
    expect(screen.getByText('Open pull requests')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Add a reviewer' }))
    expect(client.changeAutomation).toHaveBeenLastCalledWith(
      'auto1',
      expect.objectContaining({ work: { kind: 'task', review: { agentId: 'codex', model: null, effort: null }, end: 'draft' } }),
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Skip' }))
    expect(client.changeAutomation).toHaveBeenLastCalledWith(
      'auto1',
      expect.objectContaining({ work: { kind: 'task', review: null, end: 'draft' } }),
    )
    await userEvent.click(screen.getByRole('button', { name: /Open a draft pull request/ }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Review each new pull request' }))
    expect(client.changeAutomation).toHaveBeenLastCalledWith('auto1', expect.objectContaining({ work: { kind: 'review' } }))
    await userEvent.click(screen.getByRole('combobox', { name: 'Stops after' }))
    await userEvent.click(await screen.findByRole('option', { name: '1½ hours' }))
    expect(client.changeAutomation).toHaveBeenLastCalledWith('auto1', expect.objectContaining({ minutes: 90 }))
    await userEvent.click(screen.getByRole('combobox', { name: 'If the Mac is asleep' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Skip it, and wait for the next time' }))
    expect(client.changeAutomation).toHaveBeenLastCalledWith('auto1', expect.objectContaining({ late: 'skip' }))
    await userEvent.click(screen.getByRole('combobox', { name: 'If the Mac is asleep' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Run once when it’s back, if it’s not too late' }))
    expect(client.changeAutomation).toHaveBeenLastCalledWith('auto1', expect.objectContaining({ late: 'once' }))
  })

  it('changes who leads each run and who reviews it in the window’s model picker', async () => {
    const { client } = fakeClient({
      getAutomation: vi.fn(async () => ({
        cursor: 6,
        automation: automationView({
          work: 'task',
          definition: definition({ work: { kind: 'task', review: { agentId: 'codex', model: null, effort: null }, end: null } }),
        }),
      })),
    })
    withServices(<Room opening="auto1" />, client)
    await userEvent.click(await screen.findByRole('button', { name: /^Lead for each run/ }))
    await userEvent.click(await screen.findByRole('radio', { name: 'High' }))
    await waitFor(() =>
      expect(client.changeAutomation).toHaveBeenLastCalledWith(
        'auto1',
        expect.objectContaining({ lead: expect.objectContaining({ effort: 'high' }) }),
      ),
    )
    await userEvent.keyboard('{Escape}')
    await userEvent.click(await screen.findByRole('button', { name: /^Reviewer for each run/ }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Low' }))
    await waitFor(() =>
      expect(client.changeAutomation).toHaveBeenLastCalledWith(
        'auto1',
        expect.objectContaining({
          work: { kind: 'task', review: expect.objectContaining({ agentId: 'codex', effort: 'low' }), end: null },
        }),
      ),
    )
  })

  it('says it paused itself, where the runtime didn’t say why, and no runs where it has none', async () => {
    const { client } = fakeClient({
      getAutomations: vi.fn(async () =>
        automationsSnapshot({ automations: [automationSummary({ state: 'paused', pausedBy: 'itself', pauseReason: null, latest: [] })] }),
      ),
      getAutomation: vi.fn(async () => ({
        cursor: 6,
        automation: automationView({ state: 'paused', pausedBy: 'itself', pauseReason: null, runs: [] }),
      })),
    })
    withServices(<Room />, client)
    expect(await screen.findByText('Its last runs failed.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Morning review' }))
    expect(await screen.findByText('It paused itself.')).toBeTruthy()
    expect(screen.getAllByText('Its last runs failed.')).toHaveLength(1)
    expect(screen.getByText('No runs yet.')).toBeTruthy()
  })

  it('sets days and a time of the person’s own', async () => {
    const { client } = fakeClient()
    withServices(<Room opening="auto1" />, client)
    await userEvent.click(await screen.findByRole('button', { name: /Every weekday at 9:00/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Another time…' }))
    const days = await screen.findByRole('group', { name: 'Days' })
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday']) await userEvent.click(within(days).getByRole('button', { name: day }))
    await userEvent.clear(screen.getByLabelText('Time'))
    await userEvent.type(screen.getByLabelText('Time'), '07:30')
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(client.changeAutomation).toHaveBeenLastCalledWith(
      'auto1',
      expect.objectContaining({ schedule: { every: 'week', days: [5], at: '07:30' } }),
    )
    expect(await screen.findByRole('button', { name: /Every Friday at 7:30/ })).toBeTruthy()
  })

  it('says what it can’t do, keeping what the runtime kept', async () => {
    const getAutomation = vi.fn(async () => ({ cursor: 6, automation: automationView() }))
    const { client } = fakeClient({
      getAutomation,
      pauseAutomation: vi.fn(async () => {
        throw new ApiError({ reason: 'Busy', message: 'Althar couldn’t pause it.' })
      }),
    })
    withServices(<Room opening="auto1" />, client)
    await userEvent.click(await screen.findByRole('switch', { name: 'On' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Althar couldn’t pause it.')
    await waitFor(() => expect(getAutomation.mock.calls.length).toBeGreaterThan(1))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'On' }).getAttribute('aria-checked')).toBe('true'))
  })

  it('paused itself: says why, and runs it now or turns it back on from there', async () => {
    const { client } = fakeClient({
      getAutomation: vi.fn(async () => ({
        cursor: 6,
        automation: automationView({ state: 'paused', pausedBy: 'itself', pauseReason: 'Failed three times in a row.', nextAt: null }),
      })),
    })
    withServices(<Room opening="auto1" />, client)
    expect(await screen.findByText('It paused itself.')).toBeTruthy()
    expect(screen.getByText('Failed three times in a row.')).toBeTruthy()
    expect(screen.getAllByText('Paused itself').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: 'Run it now' }))
    expect(client.runAutomationNow).toHaveBeenCalledWith('auto1')
    await userEvent.click(screen.getByRole('button', { name: 'Turn it back on' }))
    expect(client.turnOnAutomation).toHaveBeenCalledWith('auto1')
  })

  it('not turned on yet: tries it once now, or turns it on', async () => {
    const { client } = fakeClient({
      getAutomation: vi.fn(async () => ({ cursor: 6, automation: automationView({ state: 'proposed', nextAt: null, runs: [] }) })),
    })
    withServices(<Room opening="auto1" />, client)
    expect(await screen.findByText('Off until you turn it on')).toBeTruthy()
    expect(screen.getByText('No runs yet.')).toBeTruthy()
    // It runs next as its schedule says, though the runtime hasn't said.
    expect(screen.getByText('next tomorrow at 9:00')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Try it once now' }))
    expect(client.runAutomationNow).toHaveBeenCalledWith('auto1')
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    expect(client.turnOnAutomation).toHaveBeenCalledWith('auto1')
  })

  it('is deleted, asked first, and goes back to the tab', async () => {
    const { client } = fakeClient()
    withServices(<Room opening="auto1" />, client)
    await userEvent.click(await screen.findByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete Morning review?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(client.deleteAutomation).toHaveBeenCalledWith('auto1')
    await waitFor(() => expect(opened()).toBe('the tab'))
  })

  it('goes back to the tab once the coordinator deletes it', async () => {
    const getAutomation = vi.fn(async () => ({ cursor: 6, automation: automationView() }))
    const { client, emit } = fakeClient({ getAutomation })
    withServices(<Room opening="auto1" />, client)
    await screen.findByRole('heading', { name: 'Morning review' })
    getAutomation.mockResolvedValue({ cursor: 7, automation: automationView({ state: 'deleted' }) })
    act(() => emit(changed('automation', 'auto1', null)))
    await waitFor(() => expect(opened()).toBe('the tab'))
  })

  it('says so where it can’t be read', async () => {
    const { client } = fakeClient({
      getAutomation: vi.fn(async () => {
        throw new ApiError({ reason: 'Gone', message: 'That automation isn’t there any more.' })
      }),
    })
    withServices(<Room opening="auto1" />, client)
    expect((await screen.findByRole('alert')).textContent).toBe('That automation isn’t there any more.')
  })
})

describe('a new automation', () => {
  it('opens blank, its prompt ready to type, and asks for its prompt and name before it is made', async () => {
    const { client } = fakeClient()
    withServices(<Room opening="new" />, client)
    const prompt = await screen.findByRole('textbox', { name: 'What each run is asked' })
    await waitFor(() => expect(document.activeElement).toBe(prompt))
    expect(screen.getByText('Say it as you would to the coordinator.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Every weekday at 9:00/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Nothing leaves this Mac/ })).toBeTruthy()
    expect(screen.getByText('None')).toBeTruthy()
    // No runs, and nothing to rename or delete yet.
    expect(screen.queryByRole('heading', { name: 'Runs' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
    // Its name first, beside its field, which takes focus; then its prompt.
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    expect(await screen.findByText('Give it a name first')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), ' Weekly polish ')
    await waitFor(() => expect(screen.queryByText('Give it a name first')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Say what each run should do first.')
    await userEvent.type(prompt, 'Tidy the changelog.')
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(client.makeAutomation).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('switch', { name: 'Allow everything' }))
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    expect(client.makeAutomation).toHaveBeenCalledWith({
      projectId: 'p1',
      definition: {
        name: 'Weekly polish',
        prompt: 'Tidy the changelog.',
        schedule: { every: 'week', days: [1, 2, 3, 4, 5], at: '09:00' },
        zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        lead,
        work: { kind: 'task', review: null, end: null },
        allowEverything: false,
        minutes: 45,
        late: 'once',
      },
      on: true,
    })
    // Made, its own page is open.
    await waitFor(() => expect(opened()).toBe('auto2'))
  })

  it('tries it once now: made, not on, and run once', async () => {
    const { client } = fakeClient()
    withServices(<Room opening="new" />, client)
    await userEvent.type(await screen.findByRole('textbox', { name: 'What each run is asked' }), 'Sweep the flaky tests.')
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Flaky sweep')
    await userEvent.click(screen.getByRole('button', { name: 'Try it once now' }))
    await waitFor(() => expect(client.runAutomationNow).toHaveBeenCalledWith('auto2'))
    expect(client.makeAutomation).toHaveBeenCalledWith(expect.objectContaining({ on: false }))
    await waitFor(() => expect(opened()).toBe('auto2'))
  })

  it('says why it couldn’t be made, and stays to try again', async () => {
    const { client } = fakeClient({
      makeAutomation: vi.fn(async () => {
        throw new ApiError({ reason: 'Invalid', message: 'An automation runs an hour apart at most.' })
      }),
    })
    withServices(<Room opening="new" />, client)
    await userEvent.type(await screen.findByRole('textbox', { name: 'What each run is asked' }), 'Bump.')
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Bump')
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    expect((await screen.findByRole('alert')).textContent).toBe('An automation runs an hour apart at most.')
    expect(opened()).toBe('new')
    await userEvent.click(screen.getByRole('button', { name: 'Automations' }))
    expect(opened()).toBe('the tab')
  })
})
