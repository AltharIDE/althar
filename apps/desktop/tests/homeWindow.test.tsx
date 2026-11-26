import { createMemoryHistory, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { ServicesProvider } from '../src/renderer/data/services'
import { AutomationsView } from '../src/renderer/features/automations/AutomationsView'
import { projectRoute } from '../src/renderer/features/project/route'
import { SettingsPage } from '../src/renderer/features/settings/SettingsPage'
import { type Section, SECTIONS } from '../src/renderer/features/settings/sections'
import { useStart } from '../src/renderer/features/start/useStart'
import { rootRoute } from '../src/renderer/root'
import { agents, fakeHost, onHomeWindow, onLinuxHome } from './fixtures'
import { servicesFor } from './render'

/*
 * A window on another computer's home (runner-1, over SSH) meets every screen of Settings, a project's settings and
 * Automations with what that home lets it call: each shows what it can, or says calmly what stays on the home and
 * why, and none waits on a read that won't come, or says a word of the API's own.
 */

const runner = onLinuxHome('runner-1')
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <p>The home</p> })

/** The screen: no placeholder left waiting, no refusal said as an error, no word of the API's own. */
const settled = async () => {
  await waitFor(() => expect(document.querySelector('output[aria-label]:has([class*="skeleton" i])')).toBeNull())
  expect(screen.queryByText(/trusted|person client|couldn’t be read|PersonRequired|HomeKeeps/)).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
}

const projectAt = (section: string) => {
  const fake = onHomeWindow()
  const services = servicesFor(fake.client, fakeHost({ homes: runner.homes }))
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, projectRoute]),
    history: createMemoryHistory({ initialEntries: [`/projects/p1?room=settings&section=${section}`] }),
    context: { client: fake.client, cache: services.cache },
  })
  render(
    <ServicesProvider value={services}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  )
  return fake
}

describe('a window on another computer’s home', () => {
  it.each([
    ['tasks', 'How this project’s tasks go stays on runner-1 for now'],
    ['rules', 'This project’s rules stay on runner-1 for now'],
    ['notes', 'The coordinator’s notes stay on runner-1 for now'],
  ])('says calmly what of the project’s %s stays on the home, and asks it nothing it would refuse', async (section, line) => {
    const { client } = projectAt(section)
    expect(await screen.findByText(line)).toBeTruthy()
    await settled()
    expect(client.getProjectRules).not.toHaveBeenCalled()
    expect(client.getProjectNotes).not.toHaveBeenCalled()
  })

  it.each([
    ['general', 'Name'],
    ['code', 'Repositories'],
    ['running', 'What it runs'],
  ])('shows the project’s %s as it stands on the home, under one line where it can’t be changed from here', async (section, shown) => {
    projectAt(section)
    expect(await screen.findByText(shown)).toBeTruthy()
    expect(screen.getAllByText('This window can’t change these on runner-1 yet.')).toHaveLength(1)
    await settled()
  })

  it('names the home, not this Mac, where the project’s repositories are', async () => {
    projectAt('code')
    expect(await screen.findByText('On runner-1')).toBeTruthy()
    expect(screen.queryByText(/On this Mac/)).toBeNull()
  })

  it('says calmly that a project’s automations stay on the home, and asks it for none', async () => {
    const fake = onHomeWindow()
    function Room() {
      const [open, setOpen] = useState<string | null>(null)
      return (
        <AutomationsView
          projectId="p1"
          project="meridian"
          agents={agents.slice(0, 2)}
          lead={{ agentId: 'claude-code', model: null, effort: null }}
          open={open}
          onOpen={setOpen}
          onTask={() => {}}
        />
      )
    }
    render(
      <ServicesProvider value={servicesFor(fake.client, fakeHost({ homes: runner.homes }))}>
        <Room />
      </ServicesProvider>,
    )
    expect(await screen.findByText('This project’s automations stay on runner-1 for now')).toBeTruthy()
    expect(screen.getByText(/They still run there on their schedules/)).toBeTruthy()
    await settled()
    expect(fake.client.getAutomations).not.toHaveBeenCalled()
  })

  it.each(SECTIONS.map((section) => [section]))('loads Settings › %s, with what it can show', async (section) => {
    const fake = onHomeWindow()
    function Page() {
      return <SettingsPage start={useStart({ recheck: true })} section={section as Section} onSection={() => {}} />
    }
    render(
      <ServicesProvider value={servicesFor(fake.client, fakeHost({ homes: runner.homes }))}>
        <Page />
      </ServicesProvider>,
    )
    const page = screen.getByRole('main')
    await waitFor(() => expect(within(page).getByRole('heading', { level: 1 })).toBeTruthy())
    await settled()
    // Something under the heading: a setting, a list, or a calm line on what stays on the home.
    await waitFor(() => expect((page.textContent ?? '').length).toBeGreaterThan(40))
  })
})
