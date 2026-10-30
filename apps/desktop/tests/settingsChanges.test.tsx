import { act, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type ReactNode, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { HomeCall } from '@althar/contracts'

import type { Client } from '../src/renderer/data/client'
import { type Host, ServicesProvider } from '../src/renderer/data/services'
import type { Section } from '../src/renderer/features/settings/sections'
import { SettingsPage } from '../src/renderer/features/settings/SettingsPage'
import { text } from '../src/renderer/features/settings/text'
import { useAgentsAtOnce } from '../src/renderer/features/settings/useAgentsAtOnce'
import { useAppIcon } from '../src/renderer/features/settings/useAppIcon'
import { useCoAuthor } from '../src/renderer/features/settings/useCoAuthor'
import { useEdgePlace } from '../src/renderer/features/settings/useEdgePlace'
import { usePostTeamReviews } from '../src/renderer/features/settings/usePostTeamReviews'
import { useStart } from '../src/renderer/features/start/useStart'
import { fakeClient, fakeHost, home, withoutOpenCode } from './fixtures'
import { servicesFor, withServices } from './render'

/*
 * Althar's settings where the rest of their tests don't go: changes made
 * quickly, one after another, where an older one fails after a newer one
 * was made, or is kept after it; what the main process says that isn't a
 * place; how many agents at once, said for each count; and the Settings
 * tab's agents, sounds, edge, editors and update in the states left.
 */

const hookOf = <T,>(use: () => T, client: Client = fakeClient().client, host: Host = fakeHost()) => {
  const services = servicesFor(client, host)
  return renderHook(use, {
    wrapper: ({ children }: { children: ReactNode }) => <ServicesProvider value={services}>{children}</ServicesProvider>,
  })
}

/** A change that waits until the test settles it, each in the order made. */
const settled = () => {
  const waiting: Array<{ resolve: () => void; reject: (failure: unknown) => void }> = []
  return {
    change: vi.fn(() => new Promise<void>((resolve, reject) => waiting.push({ resolve, reject }))),
    at: (n: number) => waiting[n]!,
  }
}

describe('a setting changed twice quickly', () => {
  it.each([
    ['the co-author line', 'setCoAuthor', () => useCoAuthor(), (model: ReturnType<typeof useCoAuthor>, n: number) => model?.set(n === 0)],
    [
      'posting team reviews',
      'setPostTeamReviews',
      () => usePostTeamReviews(),
      (model: ReturnType<typeof usePostTeamReviews>, n: number) => model?.set(n === 0),
    ],
    [
      'how many agents run at once',
      'setAgentsAtOnce',
      () => useAgentsAtOnce(),
      (model: ReturnType<typeof useAgentsAtOnce>, n: number) => model?.set(n === 0 ? 2 : 6),
    ],
  ] as const)('says nothing failed where only the older change of %s did', async (_, method, use, set) => {
    const { change, at } = settled()
    const { client } = fakeClient({ [method]: change })
    const { result } = hookOf(use as () => unknown, client)
    await waitFor(() => expect(result.current).not.toBeNull())
    act(() => (set as (model: unknown, n: number) => void)(result.current, 0))
    act(() => (set as (model: unknown, n: number) => void)(result.current, 1))
    await act(async () => at(1).resolve())
    await act(async () => at(0).reject(new Error('disk full')))
    expect((result.current as { failed: boolean }).failed).toBe(false)
    expect(client.getSettings).toHaveBeenCalledTimes(1)
  })

  it('keeps the newest icon kept, when an older one is kept after it', async () => {
    const { change, at } = settled()
    const host = fakeHost({ setAppIcon: change })
    const { result } = hookOf(() => useAppIcon(), fakeClient().client, host)
    await waitFor(() => expect(result.current.icon).toBe('cobalt'))
    act(() => result.current.choose('paper'))
    act(() => result.current.choose('ink'))
    await act(async () => at(1).resolve())
    await act(async () => at(0).resolve())
    // The next choice failing goes back to the newest kept, not the older one kept last.
    act(() => result.current.choose('solid'))
    await act(async () => at(2).reject(new Error('disk full')))
    expect(result.current.icon).toBe('ink')
    expect(result.current.failed).toBe(true)
  })

  it('keeps the newest place for the edge, saying nothing of an older one that failed after it', async () => {
    const { change, at } = settled()
    const host = fakeHost({ setEdge: change })
    const { result } = hookOf(() => useEdgePlace(), fakeClient().client, host)
    await waitFor(() => expect(result.current.place).toBe('island'))
    act(() => result.current.choose('menu'))
    act(() => result.current.choose('island'))
    await act(async () => at(1).resolve())
    await act(async () => at(0).reject(new Error('disk full')))
    expect(result.current.place).toBe('island')
    expect(result.current.failed).toBe(false)
    // One kept after a newer one was made isn't what a later failure goes back to.
    act(() => result.current.choose('menu'))
    act(() => result.current.choose('island'))
    await act(async () => at(2).resolve())
    await act(async () => at(3).reject(new Error('disk full')))
    expect(result.current.place).toBe('island')
    expect(result.current.failed).toBe(true)
  })
})

describe('where the edge is, as the main process says', () => {
  it('stays as it was where main says nothing, and is the island where main names no place it knows', async () => {
    const quiet = hookOf(() => useEdgePlace(), fakeClient().client, fakeHost({ edge: vi.fn(async () => null) }))
    await waitFor(() => expect(quiet.result.current.spot).toBeNull())
    quiet.unmount()
    const odd = hookOf(
      () => useEdgePlace(),
      fakeClient().client,
      fakeHost({ edge: vi.fn(async () => ({ place: 'dock', notch: true, platform: 'darwin', tray: true })) }),
    )
    await waitFor(() => expect(odd.result.current.spot).not.toBeNull())
    expect(odd.result.current.place).toBe('island')
  })
})

describe('how many agents run at once, in words', () => {
  const machine = { count: 4, memory: 16, cores: 10 }

  it('says what the default comes from, and what going past it does', () => {
    expect(text.atOnceNote(4, machine)).toBe('Default for 16 GB and 10 cores')
    expect(text.atOnceNote(1, machine)).toBe('Below the default')
    expect(text.atOnceNote(9, machine)).toBe('May run hot')
  })
})

/* The Settings tab on a section. */
function Settings({ at = 'agents' }: { at?: Section }) {
  const [section, setSection] = useState<Section>(at)
  return <SettingsPage start={useStart()} section={section} onSection={setSection} />
}

describe('the Settings tab', () => {
  it('says which version of an agent not on this Mac it downloads, and from whom', async () => {
    const pinned = withoutOpenCode.map((agent) =>
      agent.id === 'opencode' ? { ...agent, download: { size: '45 MB', installing: false, pinned: '1.3.0' } } : agent,
    )
    const { client } = fakeClient({ status: vi.fn(async () => ({ apiVersion: 1, appVersion: '0.0.0', agents: pinned })) })
    withServices(<Settings />, client)
    await userEvent.click(await screen.findByRole('tab', { name: /OpenCode/ }))
    expect(within(screen.getByRole('region', { name: 'OpenCode isn’t on this Mac' })).getByText(/1\.3\.0/)).toBeTruthy()
  })

  it('silences notifications without forgetting the sound to put back', async () => {
    const host = fakeHost()
    withServices(<Settings at="notifications" />, fakeClient().client, host)
    await userEvent.click(await screen.findByRole('combobox', { name: 'Sound' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Glass' }))
    await userEvent.click(await screen.findByRole('combobox', { name: 'Sound' }))
    await userEvent.click(await screen.findByRole('option', { name: 'None' }))
    expect(host.setPreference).toHaveBeenLastCalledWith('sound', null)
    expect(host.setPreference).not.toHaveBeenCalledWith('lastSound', null)
    // Its card down the side says it is silent, and would put Glass back.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Sound\s*Silent/ })).toBeTruthy())
  })

  it('says where the edge shows from what waits now, once the home is read, naming an agent not on this Mac by its id', async () => {
    const stuck: HomeCall = {
      id: 'a2',
      kind: 'stuck',
      title: '',
      reason: '',
      command: null,
      stuck: { step: 'implement', why: 'session_ended', detail: null, agentId: 'grok', round: 0, open: 0 },
      createdAt: '2026-10-07T09:10:00.000Z',
      projectId: 'p1',
      taskId: 't4',
      threadId: 'th4',
      taskTitle: 'Spike the cache',
      taskSlug: 'spike-the-cache',
    }
    const { client } = fakeClient({
      getHome: vi.fn(async () => home({ calls: [stuck, { ...stuck, id: 'a3', stuck: { ...stuck.stuck!, agentId: null } }] })),
    })
    withServices(<Settings at="appearance" />, client)
    const places = await screen.findByRole('radiogroup', { name: 'In other apps' })
    await waitFor(() => expect(screen.queryByText('An example, until work is under way')).toBeNull())
    expect(screen.getByText(text.edgeNote)).toBeTruthy()
    expect(places.textContent).toContain('Spike the cache')
  })

  it('says a newer Althar is ready in About', async () => {
    const host = fakeHost({
      update: {
        glance: vi.fn(async () => ({ ready: '0.4.2', working: false, restarting: false, failed: null })),
        restart: vi.fn(async () => true),
        onChange: () => () => undefined,
      },
    })
    withServices(<Settings at="about" />, fakeClient().client, host)
    expect(await screen.findByText('Althar 0.4.2 is ready')).toBeTruthy()
  })
})
