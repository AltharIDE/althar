// Scrappy: the real desktop app (its router, tabs, home, project and task screens) on the tests' fake client.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../styles/global.css'
import '../../../../../apps/desktop/src/renderer/app.css'

import { type ReactNode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { type BoardTask, type HomeTask, Outlet, type ProjectSummary, RouterProvider, useNavigate, useQuery, useRouterState } from './deps'

import { reads } from '../../../../../apps/desktop/src/renderer/data/reads'
import { ServicesProvider } from '../../../../../apps/desktop/src/renderer/data/services'
import { follow } from '../../../../../apps/desktop/src/renderer/data/feed'
import { makeQueryClient } from '../../../../../apps/desktop/src/renderer/data/reads'
import { ProjectSettings } from '../../../../../apps/desktop/src/renderer/features/project/ProjectSettings'
import { useProjectSettings } from '../../../../../apps/desktop/src/renderer/features/project/useProjectSettings'
import { useConnections } from '../../../../../apps/desktop/src/renderer/features/connections/useConnections'
import { SettingsPanel } from '../../../../../apps/desktop/src/renderer/features/settings/SettingsPanel'
import { useStart } from '../../../../../apps/desktop/src/renderer/features/start/useStart'
import { BarEnd, TabsFrame } from '../../../../../apps/desktop/src/renderer/features/tabs/TabsFrame'
import { rootRoute } from '../../../../../apps/desktop/src/renderer/root'
import { makeRouter } from '../../../../../apps/desktop/src/renderer/router'
import {
  card,
  change,
  coordinatorSnapshot,
  fakeClient,
  fakeHost,
  home,
  items,
  project,
  snapshot,
} from '../../../../../apps/desktop/tests/fixtures'
import { CurrentProject, type Direction, OnTask, proto, useProto } from './state'

/* ——— What the fake runtime holds: two projects, a board with a bit of everything, a task under way. ——— */

const atlas: ProjectSummary = {
  ...project,
  id: 'p2',
  name: 'atlas',
  slug: 'atlas',
  ink: 'ochre',
  repositories: ['atlas'],
  running: 0,
  working: 0,
}
const projects = [project, atlas]

const boardTask = (overrides: Partial<BoardTask>): BoardTask => ({
  ...card(),
  state: 'open',
  createdAt: '2026-10-14T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
})

const tasks: BoardTask[] = [
  boardTask({
    taskId: 't1',
    threadId: 'th1',
    title: 'Retry refund webhooks after a 429',
    slug: 'retry-refund-webhooks',
    phase: 'running',
    step: 'implement',
    startedAt: '2026-10-14T09:10:00.000Z',
  }),
  boardTask({
    taskId: 't2',
    threadId: 'th2',
    title: 'Invoice PDF drops the VAT line',
    slug: 'invoice-vat-line',
    phase: 'running',
    step: 'review',
    startedAt: '2026-10-14T08:40:00.000Z',
  }),
  boardTask({
    taskId: 't3',
    threadId: 'th3',
    title: 'Backfill idempotency keys on refunds',
    slug: 'backfill-idempotency',
    phase: 'planned',
  }),
  boardTask({
    taskId: 't4',
    threadId: 'th4',
    title: 'Rate-limit the partner API',
    slug: 'rate-limit-partner-api',
    phase: 'ready',
    change: change({ draft: false }),
    summary: 'Limited the partner API to 20 requests a second.',
  }),
  boardTask({
    taskId: 't5',
    threadId: 'th5',
    title: 'Tidy the refund docs',
    slug: 'tidy-refund-docs',
    phase: 'ready',
    changed: { files: 2, add: 9, del: 4 },
  }),
]

const { client } = fakeClient({
  listProjects: async () => ({ cursor: 3, projects }),
  getHome: async () =>
    home({
      projects,
      tasks: tasks.filter((one) => one.phase !== 'planned').map((one): HomeTask => ({ ...one, projectId: 'p1' })),
    }),
  getBoard: async () => ({ cursor: 1, tasks, calls: [], settledTotal: 12 }),
  getCoordinator: async (projectId: string) =>
    coordinatorSnapshot({
      project: { id: projectId, name: projects.find((one) => one.id === projectId)?.name ?? 'meridian' },
      items: [
        items.you('Refund webhooks fail when the partner API answers 429. Can you fix it?'),
        items.tool({ title: 'Read src/refunds/webhooks.ts' }),
        items.says('The webhook gives up on the first 429. I planned a task to retry with backoff.'),
        items.card(
          card({ taskId: 't1', threadId: 'th1', title: 'Retry refund webhooks after a 429', phase: 'running', step: 'implement' }),
          'c1',
        ),
      ],
    }),
  getThread: async () =>
    snapshot({
      task: { ...snapshot().task, title: 'Retry refund webhooks after a 429', slug: 'retry-refund-webhooks' },
      items: [
        items.you('Retry refund webhooks with backoff when the partner API answers 429.'),
        items.tool({ title: 'Read src/refunds/webhooks.ts' }),
        items.says('The handler gives up on the first 429. I’ll reuse the retry helper from billing and add a test.'),
        items.tool({ title: 'Edit src/refunds/webhooks.ts' }),
      ],
    }),
})

const host = fakeHost()
const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }

/* ——— The direction's root: the app's own tabs, with the app's settings in every tab's bar. ——— */

/** Where the window is, as the router's state says it. */
interface Located {
  readonly location: { readonly pathname: string }
}

/** The project whose tab has the window: the one on show, or the one the task on show is in. */
function useCurrent(): ProjectSummary | null {
  const path = useRouterState({ select: (state: Located) => state.location.pathname })
  const listed: ReadonlyArray<ProjectSummary> = useQuery(reads(client).projects()).data?.projects ?? []
  const threadId = /^\/threads\/([^/]+)/.exec(path)?.[1]
  const thread = useQuery({ ...reads(client).thread(threadId ?? ''), enabled: threadId !== undefined }).data
  const projectId = /^\/projects\/([^/]+)/.exec(path)?.[1] ?? (threadId === undefined ? undefined : thread?.project.id)
  return listed.find((one) => one.id === projectId) ?? null
}

/** Outside the home, the app's settings in the bar's far end; ⌘, opens them (in B, on Althar). */
function AppSettings() {
  const start = useStart()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key !== ',') return
      event.preventDefault()
      setOpen((now) => {
        if (!now) proto.set({ scope: 'althar' })
        return !now
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <BarEnd>
      <div style={{ order: 10, display: 'flex' }}>
        <SettingsPanel start={start} open={open} onOpenChange={setOpen} />
      </div>
    </BarEnd>
  )
}

/** On a task's screen, its project's settings, where the direction puts them there (A: in the bar; B: in the one panel). */
function TaskProjectSettings({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const settings = useProjectSettings(projectId, () => void navigate({ to: '/' }))
  const repositories = useQuery(reads(client).repositories(projectId)).data ?? []
  const connections = useConnections()
  return (
    <OnTask.Provider value={true}>
      <ProjectSettings
        model={settings}
        seed={projectId}
        repositories={repositories}
        connections={connections.list}
        host={null}
        tracker={null}
        onRepositories={() => void navigate({ to: '/projects/$projectId/repositories', params: { projectId } })}
        onRules={() => void navigate({ to: '/projects/$projectId/rules', params: { projectId } })}
        onConnect={() => undefined}
      />
    </OnTask.Provider>
  )
}

function Root() {
  const current = useCurrent()
  const path = useRouterState({ select: (state: Located) => state.location.pathname })
  const onTask = path.startsWith('/threads/')
  return (
    <CurrentProject.Provider value={current}>
      <TabsFrame>
        {path !== '/' && <AppSettings />}
        {onTask && current !== null && <TaskProjectSettings key={current.id} projectId={current.id} />}
        <Outlet />
      </TabsFrame>
    </CurrentProject.Provider>
  )
}

// The route every screen hangs from draws this root instead; `update` is the router's own, if not in its types here.
;(rootRoute as unknown as { update: (options: { component: () => ReactNode }) => void }).update({ component: Root })

function Caption({ children }: { children: ReactNode }) {
  const { direction } = useProto()
  return (
    <div
      style={{
        position: 'fixed',
        left: 16,
        bottom: 12,
        zIndex: 1,
        font: '500 11px/1.4 var(--font-sans, inherit)',
        color: 'var(--t-3)',
        pointerEvents: 'none',
      }}
    >
      {direction} · {children}
    </div>
  )
}

export const boot = (direction: Direction, name: string) => {
  proto.set({ direction })
  // Every page opens on the home tab, then on meridian's, whatever another page kept.
  window.localStorage.removeItem('althar.tabs')
  const router = makeRouter({ client, cache })
  const element = document.getElementById('root')
  if (element === null) throw new Error('The page has no #root')
  createRoot(element).render(
    <ServicesProvider value={services}>
      <RouterProvider router={router} />
      <Caption>{name}</Caption>
    </ServicesProvider>,
  )
}
