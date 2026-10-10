import { act, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { HomeCall, HomeTask, ProjectSummary } from '@althar/contracts'

import { QueryClient } from '@tanstack/react-query'
import type { WatchEvent } from '@althar/contracts'

import type { Feed } from '../src/renderer/data/feed'
import { EdgeView, type EdgePlaceShown } from '../src/renderer/features/edge/EdgeView'
import { edgeKey, followEdge, useEdge } from '../src/renderer/features/edge/useEdge'
import { card, change, changed, fakeClient, fakeHost, home, project } from './fixtures'
import { render } from '@testing-library/react'

import type { Client } from '../src/renderer/data/client'
import { type Host, ServicesProvider } from '../src/renderer/data/services'
import { servicesFor } from './render'

/** The edge as its entry starts it: the window's services, and its own reads followed from the start. */
const withServices = (node: ReactNode, client: Client, host: Host = fakeHost()) => {
  const services = servicesFor(client, host)
  followEdge(services.feed, services.cache)
  return render(<ServicesProvider value={services}>{node}</ServicesProvider>)
}

/*
 * Althar at the edge of the screen: round the notch, or under the menu bar's
 * mark. Only what waits on the person, answered in place or opened in the
 * window; the work in progress, counted in one line; a call that comes in
 * said for a moment.
 */

const halyard: ProjectSummary = { ...project, id: 'p2', name: 'halyard', slug: 'halyard', ink: 'rose', lastWorkAt: null }

const task = (overrides: Partial<HomeTask> = {}): HomeTask => ({
  ...card(),
  state: 'open',
  createdAt: '2026-10-07T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  projectId: 'p1',
  ...overrides,
})

const permission: HomeCall = {
  id: 'a1',
  kind: 'permission',
  title: 'Run npm publish',
  reason: 'Deploying or publishing always asks.',
  command: 'npm publish',
  stuck: null,
  createdAt: new Date(Date.now() - 4 * 60_000).toISOString(),
  projectId: 'p2',
  taskId: 't3',
  threadId: 'th3',
  taskTitle: 'Ship it',
  taskSlug: 'ship-it',
}

const running = task({ phase: 'running', step: 'implement', startedAt: new Date(Date.now() - 41 * 60_000).toISOString() })
const ready = task({
  taskId: 't2',
  threadId: 'th2',
  title: 'Name the limits better',
  phase: 'ready',
  projectId: 'p2',
  changed: { files: 1, add: 1, del: 0 },
})

const island: EdgePlaceShown = { place: 'island', notch: { width: 179, height: 32 } }

function Edge({ shown = island }: { shown?: EdgePlaceShown }) {
  return <EdgeView model={useEdge()} shown={shown} />
}

describe('the edge', () => {
  it('lists what waits on you, answered in place, and counts what is in progress in a line', async () => {
    const { client } = fakeClient({
      getHome: vi.fn(async () => home({ tasks: [running, ready], calls: [permission], projects: [project, halyard] })),
    })
    withServices(<Edge />, client)
    // At rest the island says how many wait; pressed, it opens.
    const count = await screen.findByRole('button', { name: '2 need you' })
    await userEvent.click(count)
    expect(count.getAttribute('aria-expanded')).toBe('true')

    const asks = screen.getByRole('article', { name: 'Run npm publish' })
    expect(within(asks).getByText('npm publish')).toBeTruthy()
    const done = screen.getByRole('article', { name: 'Name the limits better' })
    expect(within(done).getByText('Ready to accept')).toBeTruthy()
    expect(within(done).getByText('On its branch: 1 file, +1 −0')).toBeTruthy()
    // What runs doesn't need you: it isn't listed, only counted.
    expect(screen.getByText('1 in progress')).toBeTruthy()
    expect(screen.queryByText(running.title)).toBeNull()

    await userEvent.click(within(asks).getByRole('button', { name: 'Allow once' }))
    expect(client.answer).toHaveBeenCalledWith(expect.objectContaining({ attentionId: 'a1', decision: 'allow' }))
    expect(await screen.findByText('Allowed npm publish')).toBeTruthy()
  })

  it('says why a stuck task waits and what a change is, and counts the work held and stopped', async () => {
    const host = fakeHost()
    const stuck: HomeCall = {
      ...permission,
      id: 'a2',
      kind: 'stuck',
      title: '',
      command: null,
      stuck: { step: 'implement', why: 'session_ended', detail: null, agentId: 'claude-code', round: 0, open: 0 },
      projectId: 'p1',
      threadId: 'th4',
      taskTitle: 'Spike the cache',
    }
    const tasks = [
      task({ taskId: 't5', title: 'Held a while', phase: 'running', waits: { agentId: 'codex', until: '2026-10-07T14:50:00.000Z' } }),
      task({ taskId: 't6', title: 'Left alone', phase: 'stopped' }),
      task({ taskId: 't7', title: 'Asks you', phase: 'waiting' }),
      { ...ready, change: change({ number: 1191, additions: 212, deletions: 41 }) },
    ]
    const { client } = fakeClient({ getHome: vi.fn(async () => home({ tasks, calls: [stuck], projects: [project, halyard] })) })
    withServices(<Edge shown={{ place: 'menu' }} />, client, host)
    const stalled = await screen.findByRole('article', { name: 'Spike the cache' })
    expect(within(stalled).getByText('Claude Code stopped before the step was done.')).toBeTruthy()
    expect(within(screen.getByRole('article', { name: 'Name the limits better' })).getByText(/#1191 · .+ · \+212 −41$/)).toBeTruthy()
    await userEvent.click(within(stalled).getByRole('button', { name: 'Open' }))
    expect(host.openInWindow).toHaveBeenCalledWith('th4')
    expect(screen.getByText('3 in progress · 1 held · 1 stopped')).toBeTruthy()
  })

  it('brings back a call whose answer didn’t go through, and says why', async () => {
    const { client } = fakeClient({
      getHome: vi.fn(async () => home({ calls: [permission], projects: [project, halyard] })),
      answer: vi.fn(async () => {
        throw new Error('gone')
      }),
    })
    withServices(<Edge shown={{ place: 'menu' }} />, client)
    await userEvent.click(
      within(await screen.findByRole('article', { name: 'Run npm publish' })).getByRole('button', { name: 'Allow once' }),
    )
    expect((await screen.findByRole('alert')).textContent).toMatch(/runtime didn.t answer/)
    expect(within(screen.getByRole('article', { name: 'Run npm publish' })).getByRole('button', { name: 'Allow once' })).toBeTruthy()
    expect(screen.queryByText('Allowed npm publish')).toBeNull()
  })

  it('keeps a call answered here as a line, with focus on it, until the island closes', async () => {
    const pointed: Array<(on: boolean) => void> = []
    const host = fakeHost({ onEdgePointed: vi.fn((listener) => (pointed.push(listener), () => {})) })
    const { client } = fakeClient({ getHome: vi.fn(async () => home({ calls: [permission], projects: [project, halyard] })) })
    withServices(<Edge />, client, host)
    await userEvent.click(await screen.findByRole('button', { name: '1 needs you' }))
    await userEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    const line = await screen.findByText('Allowed npm publish')
    expect(line.closest('[tabindex]')).toBe(document.activeElement)
    act(() => pointed.forEach((listener) => listener(false)))
    await waitFor(() => expect(screen.queryByText('Allowed npm publish')).toBeNull())
  })

  it('opens a task in Althar’s window by its title or its review, and Althar by its mark', async () => {
    const host = fakeHost()
    const { client } = fakeClient({ getHome: vi.fn(async () => home({ tasks: [ready], projects: [project, halyard] })) })
    withServices(<Edge />, client, host)
    await userEvent.click(await screen.findByRole('button', { name: '1 needs you' }))
    await userEvent.click(screen.getByRole('button', { name: 'Name the limits better' }))
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(host.openInWindow).toHaveBeenCalledWith('th2')
    expect(host.openInWindow).toHaveBeenCalledTimes(2)
    await userEvent.click(screen.getAllByRole('button', { name: 'Open Althar' })[0] as HTMLElement)
    expect(host.openInWindow).toHaveBeenLastCalledWith()
  })

  it('says a call that comes in, not the ones there when it opened', async () => {
    let calls: ReadonlyArray<HomeCall> = []
    const { client, emit } = fakeClient({
      getHome: vi.fn(async () => home({ tasks: [running], calls, projects: [project, halyard] })),
    })
    withServices(<Edge />, client)
    // Only work in progress: the notch alone, which still opens.
    await screen.findByRole('button', { name: 'Nothing needs you' })
    expect(screen.queryByText('Permission')).toBeNull()
    calls = [permission]
    act(() => emit(changed('attention_request', 'a1', 'th3', 'p2')))
    const region = screen.getByRole('region', { name: 'Althar' })
    // Said beside the notch, whose by its mark, and on its line in the sheet.
    await waitFor(() => expect(within(region).getAllByText('Permission')).toHaveLength(2))
    expect(within(region).getAllByText('halyard')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '1 needs you' })).toBeTruthy()
  })

  it('opens as the pointer comes onto it, as the main process watches it, and says where it draws', async () => {
    const pointed: Array<(on: boolean) => void> = []
    const host = fakeHost({ onEdgePointed: vi.fn((listener) => (pointed.push(listener), () => {})) })
    withServices(<Edge />, fakeClient({ getHome: vi.fn(async () => home({ tasks: [running] })) }).client, host)
    const count = await screen.findByRole('button', { name: 'Nothing needs you' })
    expect(host.edgeDrawn).toHaveBeenCalled()
    act(() => pointed.forEach((listener) => listener(true)))
    await waitFor(() => expect(count.getAttribute('aria-expanded')).toBe('true'))
    act(() => pointed.forEach((listener) => listener(false)))
    await waitFor(() => expect(count.getAttribute('aria-expanded')).toBe('false'))
  })

  it('under the menu bar, is the sheet on paper, and says how tall it is', async () => {
    const host = fakeHost()
    withServices(<Edge shown={{ place: 'menu' }} />, fakeClient({ getHome: vi.fn(async () => home({ tasks: [running] })) }).client, host)
    expect(await screen.findByText('1 in progress')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Nothing needs you' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Althar' })).toBeNull()
    expect(host.edgeSize).toHaveBeenCalled()
  })
})

describe('the edge’s reads', () => {
  it('are read again on what changes the home, from the moment the feed starts, but not on a permission the rules answered', () => {
    vi.useFakeTimers()
    try {
      const listeners: Array<(event: WatchEvent) => void> = []
      const feed: Feed = { listen: (listener) => (listeners.push(listener), () => {}), stop: () => {} }
      const cache = new QueryClient()
      const invalidate = vi.spyOn(cache, 'invalidateQueries')
      followEdge(feed, cache)
      listeners.forEach((listener) => listener(changed('decision', 'd1')))
      vi.advanceTimersByTime(500)
      expect(invalidate).not.toHaveBeenCalled()
      listeners.forEach((listener) => listener(changed('attention_request', 'a1')))
      listeners.forEach((listener) => listener(changed('task', 't1')))
      vi.advanceTimersByTime(500)
      expect(invalidate).toHaveBeenCalledTimes(1)
      expect(invalidate).toHaveBeenCalledWith({ queryKey: edgeKey })
    } finally {
      vi.useRealTimers()
    }
  })
})
