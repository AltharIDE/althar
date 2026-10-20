import { act, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { HomeCall, HomeTask, ProjectSummary } from '@althar/contracts'

import type { Client } from '../src/renderer/data/client'
import { type Host, ServicesProvider } from '../src/renderer/data/services'
import { EdgeView, type EdgePlaceShown } from '../src/renderer/features/edge/EdgeView'
import { followEdge, useEdge } from '../src/renderer/features/edge/useEdge'
import { card, changed, fakeClient, fakeHost, home, project } from './fixtures'
import { servicesFor } from './render'

/*
 * Althar at the edge of the screen, where the rest of its tests don't go:
 * work that comes in ready to accept, said for a moment by its project; a
 * call in a project the edge doesn't list, not said; and a stuck step whose
 * agent isn't on this Mac, or is no one.
 */

/** The edge as its entry starts it: the window's services, and its own reads followed from the start. */
const withEdge = (node: ReactNode, client: Client, host: Host = fakeHost()) => {
  const services = servicesFor(client, host)
  followEdge(services.feed, services.cache)
  return render(<ServicesProvider value={services}>{node}</ServicesProvider>)
}

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

const island: EdgePlaceShown = { place: 'island', notch: { width: 179, height: 32 } }

function Edge({ shown = island }: { shown?: EdgePlaceShown }) {
  return <EdgeView model={useEdge()} shown={shown} />
}

describe('what the edge says as it comes in', () => {
  it('says work ready to accept, by its project’s mark', async () => {
    let tasks: ReadonlyArray<HomeTask> = [running]
    const { client, emit } = fakeClient({ getHome: vi.fn(async () => home({ tasks, projects: [project, halyard] })) })
    withEdge(<Edge />, client)
    await screen.findByRole('button', { name: 'Nothing needs you' })
    tasks = [running, task({ taskId: 't2', threadId: 'th2', title: 'Name the limits better', phase: 'ready', projectId: 'p2' })]
    act(() => emit(changed('task', 't2', 'th2', 'p2')))
    const region = screen.getByRole('region', { name: 'Althar' })
    await waitFor(() => expect(within(region).getAllByText('halyard')).toHaveLength(2))
    expect(screen.getByRole('button', { name: '1 needs you' })).toBeTruthy()
  })

  it('says nothing of a call in a project it doesn’t list', async () => {
    let calls: ReadonlyArray<HomeCall> = []
    const getHome = vi.fn(async () => home({ tasks: [running], calls, projects: [project] }))
    const { client, emit } = fakeClient({ getHome })
    withEdge(<Edge />, client)
    await screen.findByRole('button', { name: 'Nothing needs you' })
    calls = [{ ...permission, projectId: 'gone' }]
    act(() => emit(changed('attention_request', 'a1', 'th3', 'gone')))
    await waitFor(() => expect(getHome).toHaveBeenCalledTimes(2))
    expect(within(screen.getByRole('region', { name: 'Althar' })).queryByText('Permission')).toBeNull()
  })
})

describe('a stuck step at the edge', () => {
  it('names an agent not on this Mac by its id, and one that is no one as the agent', async () => {
    const stuck = (id: string, agentId: string | null, taskTitle: string): HomeCall => ({
      ...permission,
      id,
      kind: 'stuck',
      title: '',
      command: null,
      stuck: { step: 'implement', why: 'session_ended', detail: null, agentId, round: 0, open: 0 },
      projectId: 'p1',
      threadId: `th-${id}`,
      taskTitle,
    })
    const { client } = fakeClient({
      getHome: vi.fn(async () => home({ calls: [stuck('s1', 'grok', 'On Grok'), stuck('s2', null, 'On no one')], projects: [project] })),
    })
    withEdge(<Edge shown={{ place: 'menu' }} />, client)
    const grok = await screen.findByRole('article', { name: 'On Grok' })
    expect(within(grok).getByText(/^grok closed before finishing the step/)).toBeTruthy()
    expect(within(screen.getByRole('article', { name: 'On no one' })).getByText(/^The agent closed before finishing the step/)).toBeTruthy()
  })
})
