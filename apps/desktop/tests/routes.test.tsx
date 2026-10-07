import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChangedFile, ThreadSnapshot } from '@althar/contracts'

import { taskRoute } from '../src/renderer/features/task/route'
import { keptFrom } from '../src/renderer/features/tabs/tabs'
import { rootRoute } from '../src/renderer/root'
import { fakeClient, project, snapshot } from './fixtures'
import { withServices } from './render'

/*
 * The app's own routes, under its tabs: what the window does going from one
 * place to another, which a single screen's test can't see.
 */

const file: ChangedFile = { path: 'src/checkout.ts', from: null, status: 'modified', add: 4, del: 1, binary: false, uncommitted: false }

/** A task's thread, in a project, ready or under way, with something changed either way. */
const taskIn = (threadId: string, projectId: string, title: string, phase: 'ready' | 'running'): ThreadSnapshot => {
  const base = snapshot()
  return {
    ...base,
    threadId,
    project: { id: projectId, name: projectId },
    task: { ...base.task, id: `t-${threadId}`, title, phase, files: [file], commits: 1 },
  }
}

beforeEach(() => window.localStorage.clear())

describe('going from one task to another', () => {
  it('reads the second afresh: its own face, and the way back to each in its own project', async () => {
    // The second answers only when the test says, so the window is seen in between.
    let answer: (snapshot: ThreadSnapshot) => void = () => undefined
    const second = new Promise<ThreadSnapshot>((resolve) => {
      answer = resolve
    })
    const getThread = vi.fn(async (threadId: string) => (threadId === 'tha' ? taskIn('tha', 'p1', 'Ready one', 'ready') : second))
    const { client } = fakeClient({
      getThread,
      listProjects: vi.fn(async () => ({ cursor: 3, projects: [project, { ...project, id: 'p2', name: 'halyard', slug: 'halyard' }] })),
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([taskRoute]),
      history: createMemoryHistory({ initialEntries: ['/threads/tha'] }),
    })
    withServices(<RouterProvider router={router} />, client)
    // Ready, the first opens on what it made.
    expect(await screen.findByRole('article', { name: 'Ready one' })).toBeTruthy()

    act(() => router.history.push('/threads/thb'))
    // Until the second is read, nothing of the first stands in for it.
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Ready one' })).toBeNull())
    act(() => answer(taskIn('thb', 'p2', 'Running one', 'running')))

    // Under way, the second opens on its conversation, though the first had opened on its outputs.
    expect(await screen.findByRole('region', { name: 'Thread' })).toBeTruthy()
    expect(screen.queryByRole('article', { name: 'Running one' })).toBeNull()
    // Each project goes back to its own task.
    await waitFor(() =>
      expect(keptFrom(window.localStorage.getItem('althar.tabs'))?.tasks).toEqual({
        p1: { threadId: 'tha', title: 'Ready one' },
        p2: { threadId: 'thb', title: 'Running one' },
      }),
    )
  })
})
