import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { ReportPreview } from '../src/main/report/bundle'
import type { ProblemAbout, ReportHost } from '../src/renderer/data/services'
import { useAccountSignIn } from '../src/renderer/features/accounts/useAccountSignIn'
import { useBoard } from '../src/renderer/features/board/useBoard'
import { useConnections } from '../src/renderer/features/connections/useConnections'
import { HomeView } from '../src/renderer/features/home/HomeView'
import { useHome } from '../src/renderer/features/home/useHome'
import { draftsOf } from '../src/renderer/features/newProject/draft'
import { NewProjectView } from '../src/renderer/features/newProject/NewProjectView'
import { useNewProject } from '../src/renderer/features/newProject/useNewProject'
import { ProjectView } from '../src/renderer/features/project/ProjectView'
import { useProject } from '../src/renderer/features/project/useProject'
import { ReportDialog } from '../src/renderer/features/report/ReportDialog'
import { StartView } from '../src/renderer/features/start/StartView'
import { useStart } from '../src/renderer/features/start/useStart'
import { coordinatorSnapshot, fakeClient, fakeHost, items } from './fixtures'
import { useSettingsOf, withServices } from './render'

/*
 * The window off a Mac, on Linux here: every key it names is the system's,
 * Ctrl in place of ⌘, and those keys do what they say.
 */

/* The kit reads its system once, from the preload, as it loads: say Linux before it does. */
vi.hoisted(() => {
  ;(window as { althar?: { platform?: string } }).althar = { platform: 'linux' }
})

vi.mock('@althar/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@althar/ui')>()
  const { keysFor } = await import('./mockKeys')
  return { ...actual, ...keysFor('linux') }
})

vi.mock('../src/renderer/shared/device', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/renderer/shared/device')>()
  return { ...actual, platform: 'linux', device: actual.deviceWords('linux') }
})

function Start({ onProject = vi.fn() }: { onProject?: (id: string) => void }) {
  const start = useStart()
  return <StartView model={start} accounts={useAccountSignIn(start)} onProject={onProject} home={() => null} />
}

describe('the first screen off a Mac', () => {
  it('names Ctrl+N and Ctrl+Enter, adds a folder by Ctrl+N and makes the project by Ctrl+Enter, and leaves ⌘ alone', async () => {
    const onProject = vi.fn()
    const { client } = fakeClient({
      listProjects: vi.fn(async () => ({ cursor: 0, projects: [] })),
      readFolder: vi.fn(async () => ({
        kind: 'repository' as const,
        name: 'meridian',
        repositories: [{ path: '/w/meridian', folder: null, name: 'meridian', branch: 'main', remote: null }],
        project: null,
      })),
    })
    const host = fakeHost()
    withServices(<Start onProject={onProject} />, client, host)
    const add = await screen.findByRole('button', { name: /Add a folder/ })
    expect(add.textContent).toContain('Ctrl+N')
    fireEvent.keyDown(window, { key: 'n', metaKey: true })
    expect(host.pickFolder).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true })
    await waitFor(() => expect(host.pickFolder).toHaveBeenCalledTimes(1))
    await screen.findByRole('list', { name: 'Repositories for the project' })
    expect(screen.getByRole('button', { name: /Make the project/ }).textContent).toContain('Ctrl+Enter')
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(onProject).toHaveBeenCalledWith('p1'))
  })
})

describe('the home off a Mac', () => {
  it('names Ctrl+N for a new project', async () => {
    function Home() {
      return <HomeView model={useHome()} start={useStart()} onProject={vi.fn()} onTalk={vi.fn()} onTask={vi.fn()} />
    }
    withServices(<Home />, fakeClient().client)
    await screen.findByRole('complementary', { name: 'Projects' })
    await userEvent.hover(screen.getByRole('button', { name: 'New project' }))
    await waitFor(() => expect(document.body.textContent).toContain('Ctrl+N'))
  })
})

describe('a new project off a Mac', () => {
  it('names Ctrl+Enter to create it', async () => {
    const { client } = fakeClient()
    draftsOf(client).start()
    function NewProject() {
      return <NewProjectView model={useNewProject()} connections={useConnections()} onCreated={vi.fn()} onClose={vi.fn()} />
    }
    withServices(<NewProject />, client, fakeHost({ findRepositories: vi.fn(async () => ({ lookedIn: [], repositories: [] })) }))
    expect((await screen.findByRole('button', { name: /^Create/ })).textContent).toContain('Ctrl+Enter')
  })
})

describe('a report off a Mac', () => {
  it('names Ctrl+Enter to send it', async () => {
    const asked = new Set<(about: ProblemAbout) => void>()
    const preview: ReportPreview = {
      app: { version: '0.4.0', electron: '44.5.0', os: 'Ubuntu 26.04', arch: 'x64' },
      installId: '3f0c9a52-6b1e-4f7d-9a0e-2c5b8d71e4aa',
      context: { screen: 'home', projectId: null, taskId: null, threadId: null, about: null },
      agents: [],
      migrations: { count: 18, last: 'questions' },
      screenshot: false,
      errors: 0,
      logs: [],
    }
    const report: ReportHost = {
      open: vi.fn(async () => ({ reportId: 'r1', screenshot: null, email: null, via: 'send' as const })),
      preview: vi.fn(async () => preview),
      send: vi.fn(async () => ({ kind: 'sent' as const })),
      close: vi.fn(),
      onAsked: (listener) => {
        asked.add(listener)
        return () => void asked.delete(listener)
      },
    }
    render(<ReportDialog host={fakeHost({ report })} />)
    await act(async () => {
      for (const listener of asked) listener({ kind: 'asked', from: 'menu' })
    })
    expect((await screen.findByRole('button', { name: /^Send/ })).textContent).toContain('Ctrl+Enter')
  })
})

describe('the coordinator’s composer off a Mac', () => {
  it('names Ctrl+Enter to send now while it works', async () => {
    const session = {
      id: 'sc',
      agentId: 'claude-code',
      agentName: 'Claude Code',
      state: 'active',
      model: null,
      account: null,
      effort: null,
      models: [],
      turnRunning: true,
      turnStartedAt: null,
      turnEndedAt: null,
      held: true,
      context: null,
      background: [],
    } as const
    const { client } = fakeClient({
      getCoordinator: vi.fn(async () => coordinatorSnapshot({ session, items: [items.tool({ status: 'in_progress' })] })),
    })
    function Project() {
      return (
        <ProjectView
          model={useProject('p1')}
          board={useBoard('p1')}
          connections={useConnections()}
          settings={useSettingsOf('p1')}
          onTask={vi.fn()}
        />
      )
    }
    withServices(<Project />, client)
    const composer = await screen.findByRole('textbox', { name: 'Add to the queue, or interrupt the coordinator' })
    await userEvent.type(composer, 'Stop')
    expect(screen.getByRole('button', { name: /Send now/ }).textContent).toContain('Ctrl+Enter')
  })
})
