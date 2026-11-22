import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useNavigate,
} from '@tanstack/react-router'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Release } from '@althar/site/changelog'

import { AltharPage } from '../src/renderer/features/news/AltharPage'
import { betterOf, featuresOf, leadOf, RELEASES, releaseFor, roadmapOf, sayFor } from '../src/renderer/features/news/notes'
import { newsFrom } from '../src/renderer/features/news/store'
import { TabsFrame } from '../src/renderer/features/tabs/TabsFrame'
import { whereOf } from '../src/renderer/features/tabs/tabs'
import { fakeClient, project, status } from './fixtures'
import { withServices } from './render'

/*
 * Althar's own tab and page: the release this Althar is, read from the notes
 * the site keeps; the tab's dot after an update until it's looked at or the
 * tab closed; where the person came from; and the ways in, from the tab, the
 * quick settings' version line, and What's new's way to Coming next.
 */

const NEWEST = RELEASES[0]!
const BEFORE = RELEASES[1]!
const STORED = 'althar.news'

const release = (changes: Release['changes'], version = '9.9.9'): Release => ({
  version,
  date: '2026-01-01',
  title: 'A plain release',
  changes,
})

describe('the notes, as Althar’s page reads them', () => {
  it('finds the release this Althar is, or the one before it between releases', () => {
    expect(releaseFor(NEWEST.version)).toEqual({ release: NEWEST, own: true })
    expect(releaseFor(`${BEFORE.version}-beta.1`).release).toBe(BEFORE)
    expect(releaseFor('999.0.0')).toEqual({ release: NEWEST, own: false })
    expect(releaseFor('0.0.0')).toEqual({ release: NEWEST, own: false })
    expect(releaseFor(undefined)).toEqual({ release: NEWEST, own: false })
  })

  it('leads with the site’s highlight, or the release’s title and its first new line', () => {
    expect(leadOf(NEWEST).title.length).toBeGreaterThan(0)
    expect(leadOf(release([{ kind: 'new', text: 'Goals: give a lead a goal. It keeps going.' }]))).toEqual({
      title: 'A plain release',
      why: 'Give a lead a goal.',
      covers: [],
    })
    expect(leadOf(release([{ kind: 'fixed', text: 'A fix.' }])).why).toBe('')
  })

  it('makes tiles of the features the app draws, named and with their way in', () => {
    const features = featuresOf(
      release([
        { kind: 'new', text: 'Your own host: run Althar on a server.' },
        { kind: 'new', text: 'More agents: connect any coding agent. Althar checks it.' },
        { kind: 'new', text: 'Bring in work from Conductor and Orca: their worktrees become tasks.' },
        { kind: 'improved', text: 'Goals: not new.' },
      ]),
    )
    expect(features.map((one) => one.name)).toEqual(['More agents', 'Bring in your work'])
    expect(features[0]).toMatchObject({ line: 'Connect any coding agent.', icon: 'agents', art: 'agents', way: { to: 'agents' } })
    expect(features[1]?.whole).toBe('Their worktrees become tasks.')
  })

  it('makes tiles of the first named features where the app draws none, leaving out what the lead covers', () => {
    const lines = Array.from({ length: 8 }, (_, i) => ({ kind: 'new' as const, text: `Feature ${i}: does ${i}.` }))
    const features = featuresOf(release([...lines, { kind: 'new', text: 'No name here.' }]), [0])
    expect(features.map((one) => one.name)).toEqual(['Feature 1', 'Feature 2', 'Feature 3', 'Feature 4', 'Feature 5', 'Feature 6'])
    expect(features[0]?.icon).toBeUndefined()
  })

  it('says what feels better in the first few improvements’ first sentences', () => {
    const better = betterOf(release(Array.from({ length: 6 }, (_, i) => ({ kind: 'improved' as const, text: `Better ${i}. And more.` }))))
    expect(better).toEqual(['Better 0.', 'Better 1.', 'Better 2.', 'Better 3.'])
  })

  it('puts what’s being built first, then next and later, each with its picture and where to say what you’d need', () => {
    const roadmap = roadmapOf([
      { stage: 'later', title: 'Teams, in the cloud', detail: 'Shared.' },
      { stage: 'now', title: 'Mobile app', detail: 'Phones.' },
      { stage: 'next', title: 'Something undrawn', detail: 'Not yet.' },
    ])
    expect(roadmap.map((one) => one.stage)).toEqual(['now', 'next', 'later'])
    expect(roadmap[0]).toMatchObject({ picture: 'phone', say: sayFor('Mobile app') })
    expect(roadmap[1]?.picture).toBeUndefined()
    expect(sayFor('Teams, in the cloud')).toBe('https://github.com/AltharIDE/althar/issues/new?title=Teams%2C%20in%20the%20cloud%3A%20')
    expect(roadmapOf().length).toBeGreaterThan(0)
  })
})

describe('what Althar’s tab keeps', () => {
  it('reads what it kept, and nothing of what it can’t read', () => {
    expect(newsFrom(null)).toEqual({})
    expect(newsFrom('not json')).toEqual({})
    expect(newsFrom('7')).toEqual({})
    expect(newsFrom(JSON.stringify({ seen: '0.9.0', from: '0.8.0', closed: true }))).toEqual({ seen: '0.9.0', from: '0.8.0', closed: true })
    expect(newsFrom(JSON.stringify({ seen: 9, from: '', closed: 'yes' }))).toEqual({})
  })

  it('is the window’s own place', () => {
    expect(whereOf('/althar')).toEqual({ kind: 'althar' })
    expect(whereOf('/althar/')).toEqual({ kind: 'althar' })
  })
})

const rootRoute = createRootRoute({
  component: () => (
    <TabsFrame>
      <Outlet />
    </TabsFrame>
  ),
})
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <p>Home screen</p> })
const projectRoute = createRoute({ getParentRoute: () => rootRoute, path: '/projects/$projectId', component: () => <p>Project screen</p> })
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings/$section', component: () => <p>Settings screen</p> })
const altharRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/althar',
  validateSearch: (search: Record<string, unknown>): { view?: 'coming' } => (search.view === 'coming' ? { view: 'coming' } : {}),
  component: function Althar() {
    const { view } = altharRoute.useSearch()
    const navigate = useNavigate()
    return (
      <AltharPage
        view={view ?? 'new'}
        onView={(next) => void navigate({ to: '/althar', search: next === 'coming' ? { view: 'coming' } : {} })}
        onWay={(to) => void navigate({ to: '/settings/$section', params: { section: to } })}
      />
    )
  },
})

/** The window on a version of Althar, at an address, with what Althar's tab kept. */
const windowAt = (path: string, version: string, kept?: object) => {
  if (kept !== undefined) window.localStorage.setItem(STORED, JSON.stringify(kept))
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, projectRoute, settingsRoute, altharRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const fake = fakeClient({
    listProjects: vi.fn(async () => ({ cursor: 3, projects: [project] })),
    status: vi.fn(async () => ({ ...status, appVersion: version })),
  })
  withServices(<RouterProvider router={router} />, fake.client)
  return router
}

const kept = () => newsFrom(window.localStorage.getItem(STORED))

describe('Althar’s tab', () => {
  beforeEach(() => window.localStorage.clear())

  it('has a dot after an update until it’s looked at, and its page says where the person came from', async () => {
    const router = windowAt(`/projects/${project.id}`, NEWEST.version, { seen: BEFORE.version })
    await userEvent.click(await screen.findByRole('button', { name: 'Althar, what’s new in this version' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/althar'))
    expect(await screen.findByLabelText(`Updated from ${BEFORE.version} to ${NEWEST.version}`)).toBeTruthy()
    expect((await screen.findByRole('button', { name: 'Althar' })).getAttribute('aria-current')).toBe('page')
    expect(kept()).toEqual({ seen: NEWEST.version, from: BEFORE.version })
  })

  it('has no news on the first launch with it: what runs is what’s been seen', async () => {
    windowAt(`/projects/${project.id}`, NEWEST.version)
    expect(await screen.findByRole('button', { name: 'Althar' })).toBeTruthy()
    await waitFor(() => expect(kept()).toEqual({ seen: NEWEST.version }))
  })

  it('has no news where this Althar has no notes of its own', async () => {
    windowAt(`/projects/${project.id}`, '999.0.0', { seen: NEWEST.version })
    expect(await screen.findByRole('button', { name: 'Althar' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /what’s new in this version/ })).toBeNull()
  })

  it('closes until the next update brings news, and its news goes with it', async () => {
    const router = windowAt('/althar', NEWEST.version, { seen: NEWEST.version, from: BEFORE.version })
    await userEvent.click(await screen.findByRole('button', { name: 'Close Althar' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Althar' })).toBeNull())
    expect(router.state.location.pathname).not.toBe('/althar')
    expect(kept()).toEqual({ seen: NEWEST.version, from: BEFORE.version, closed: true })
  })

  it('comes back with its dot when an update brings news, and closing it then is looking at it', async () => {
    windowAt(`/projects/${project.id}`, NEWEST.version, { seen: BEFORE.version, closed: true })
    expect(await screen.findByRole('button', { name: 'Althar, what’s new in this version' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Close Althar' }))
    await waitFor(() => expect(kept()).toEqual({ seen: NEWEST.version, from: BEFORE.version, closed: true }))
  })

  it('opens again from the quick settings’ version line, which closes them', async () => {
    const router = windowAt(`/projects/${project.id}`, NEWEST.version, { seen: NEWEST.version, closed: true })
    await userEvent.click(await screen.findByRole('button', { name: 'Althar settings' }))
    await userEvent.click(await screen.findByRole('button', { name: 'What’s new' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/althar'))
    expect((await screen.findByRole('button', { name: 'Althar' })).getAttribute('aria-current')).toBe('page')
    expect(kept().closed).toBeUndefined()
  })
})

describe('Althar’s page', () => {
  beforeEach(() => window.localStorage.clear())

  it('goes from What’s new to Coming next, which opens on what’s being built', async () => {
    const router = windowAt('/althar', NEWEST.version, { seen: NEWEST.version })
    await userEvent.click(await screen.findByRole('button', { name: 'See what’s coming next' }))
    await waitFor(() => expect(router.state.location.search).toEqual({ view: 'coming' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Shape what’s next' })).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /Say what you’d need/ }).length).toBeGreaterThan(0)
  })

  it('says Up to date in its bar, and from no version where the person didn’t update', async () => {
    windowAt('/althar', NEWEST.version, { seen: NEWEST.version })
    expect(await screen.findByText('Up to date')).toBeTruthy()
    expect(screen.queryByLabelText(/Updated from/)).toBeNull()
  })
})
