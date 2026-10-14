// Scrappy: the real desktop app (its router, tabs and home) on the tests' fake client, with this Mac's agents, accounts and code hosts.
/// <reference path="../../../../../apps/desktop/src/renderer/global.d.ts" />
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '../../styles/global.css'
import '../../../../../apps/desktop/src/renderer/app.css'

import { type ReactNode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import type { AgentStatus, BoardTask, ConnectionList, HomeTask, ProjectSummary } from './deps'
import { Outlet, RouterProvider, useRouterState } from './deps'

import { follow } from '../../../../../apps/desktop/src/renderer/data/feed'
import { makeQueryClient } from '../../../../../apps/desktop/src/renderer/data/reads'
import { ServicesProvider } from '../../../../../apps/desktop/src/renderer/data/services'
import { useStart } from '../../../../../apps/desktop/src/renderer/features/start/useStart'
import { BarEnd, TabsFrame } from '../../../../../apps/desktop/src/renderer/features/tabs/TabsFrame'
import { rootRoute } from '../../../../../apps/desktop/src/renderer/root'
import { makeRouter } from '../../../../../apps/desktop/src/renderer/router'
import { SettingsPanel } from './seams/SettingsPanel'
import {
  card,
  change,
  connectionList,
  coordinatorSnapshot,
  fakeClient,
  fakeHost,
  githubGuide,
  home,
  items,
  project,
  snapshot,
  usual,
} from '../../../../../apps/desktop/tests/fixtures'
import { SettingsTabPage } from './round3'
import { type Direction, isRound3, proto, type Round3, useDirection } from './state'
import { useSettingsTab } from './tab'

/* ——— This Mac: a 36 GB, 12-core MacBook Pro with Claude Code, Codex, and OpenCode not yet downloaded. ——— */

const at = (hour: number) => {
  const day = new Date()
  day.setHours(hour, 0, 0, 0)
  return day.toISOString()
}

export const agents: ReadonlyArray<AgentStatus> = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    signIn: 'signed_in',
    login: 'claude auth login',
    version: '2.1.263',
    ways: ['browser'],
    accounts: [
      { ...usual('acc_work', 'signed_in'), name: 'work' },
      {
        ...usual('acc_personal', 'signed_in'),
        name: 'personal',
        home: '/Users/balazs/Library/Application Support/Althar/accounts/acc_personal',
        outUntil: at(16),
      },
    ],
    installed: true,
    kept: false,
    download: null,
  },
  {
    id: 'codex',
    name: 'Codex',
    signIn: 'signed_out',
    login: 'codex login',
    version: '0.159.3',
    ways: ['browser', 'device'],
    // Its sign-in ran out: only the person can sign it in again.
    accounts: [usual('acc_codex', 'signed_out')],
    installed: true,
    kept: false,
    download: null,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    signIn: 'unknown',
    login: 'opencode auth login',
    version: null,
    ways: [],
    accounts: [usual('acc_opencode', 'unknown')],
    installed: false,
    kept: false,
    download: { size: '45 MB', installing: false },
  },
]

const product = (
  one: Pick<ConnectionList['products'][number], 'product' | 'service' | 'name' | 'host' | 'tracker' | 'hostedUrl' | 'selfHosted'> &
    Partial<ConnectionList['products'][number]>,
): ConnectionList['products'][number] => ({
  browserSignIn: false,
  tokenNeeds: null,
  tokenPrefixes: [],
  tokenHelpForKey: null,
  keyChecks: [],
  ...one,
})

/** Every code host and tracker Althar knows; GitHub and Linear connected. */
const connections: ConnectionList = {
  cursor: 4,
  connections: [
    {
      id: 'conn_github',
      product: 'github',
      name: 'GitHub',
      webUrl: 'https://github.com',
      account: { login: 'balazs', name: 'Balázs' },
      auth: 'device_flow',
      state: 'ready',
    },
    {
      id: 'conn_linear',
      product: 'linear',
      name: 'Linear',
      webUrl: 'https://linear.app',
      account: { login: 'balazs', name: 'Balázs' },
      auth: 'pkce',
      state: 'ready',
    },
  ],
  products: [
    product({
      product: 'github',
      service: 'github',
      name: 'GitHub',
      host: true,
      tracker: true,
      hostedUrl: 'https://github.com',
      selfHosted: true,
      browserSignIn: true,
      tokenPrefixes: ['github_pat_', 'ghp_'],
    }),
    product({
      product: 'gitlab',
      service: 'gitlab',
      name: 'GitLab',
      host: true,
      tracker: true,
      hostedUrl: 'https://gitlab.com',
      selfHosted: true,
      browserSignIn: true,
      tokenPrefixes: ['glpat-'],
    }),
    product({
      product: 'bitbucket_cloud',
      service: 'bitbucket',
      name: 'Bitbucket',
      host: true,
      tracker: false,
      hostedUrl: 'https://bitbucket.org',
      selfHosted: false,
      tokenNeeds: 'email',
      tokenPrefixes: ['ATATT'],
    }),
    product({
      product: 'bitbucket_dc',
      service: 'bitbucket',
      name: 'Bitbucket Data Center',
      host: true,
      tracker: false,
      hostedUrl: null,
      selfHosted: true,
    }),
    product({
      product: 'linear',
      service: 'linear',
      name: 'Linear',
      host: false,
      tracker: true,
      hostedUrl: 'https://linear.app',
      selfHosted: false,
      browserSignIn: true,
      tokenPrefixes: ['lin_api_'],
    }),
    product({
      product: 'jira_cloud',
      service: 'jira',
      name: 'Jira',
      host: false,
      tracker: true,
      hostedUrl: null,
      selfHosted: false,
      tokenNeeds: 'email',
      tokenPrefixes: ['ATATT'],
    }),
    product({
      product: 'jira_dc',
      service: 'jira',
      name: 'Jira Data Center',
      host: false,
      tracker: true,
      hostedUrl: null,
      selfHosted: true,
    }),
    product({
      product: 'trello',
      service: 'trello',
      name: 'Trello',
      host: false,
      tracker: true,
      hostedUrl: 'https://trello.com',
      selfHosted: false,
      tokenNeeds: 'key',
      tokenPrefixes: ['ATTA'],
    }),
  ],
  places: connectionList.places,
}

/* ——— Two projects on the home, with a bit of everything under way. ——— */

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
export const projects = [project, atlas]

const boardTask = (overrides: Partial<BoardTask>): BoardTask => ({
  ...card(),
  state: 'open',
  createdAt: at(9),
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
    startedAt: at(9),
  }),
  boardTask({
    taskId: 't2',
    threadId: 'th2',
    title: 'Invoice PDF drops the VAT line',
    slug: 'invoice-vat-line',
    phase: 'running',
    step: 'review',
    startedAt: at(8),
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
]

const { client } = fakeClient({
  status: async () => ({ apiVersion: 1, appVersion: '0.2.0', agents }),
  listProjects: async () => ({ cursor: 3, projects }),
  getHome: async () => home({ projects, tasks: tasks.map((one): HomeTask => ({ ...one, projectId: 'p1' })) }),
  getBoard: async () => ({ cursor: 1, tasks, calls: [], settledTotal: 12 }),
  getCoordinator: async (projectId: string) =>
    coordinatorSnapshot({
      project: { id: projectId, name: projects.find((one) => one.id === projectId)?.name ?? 'meridian' },
      items: [items.you('Refund webhooks fail when the partner API answers 429. Can you fix it?')],
    }),
  getThread: async () => snapshot(),
  listConnections: async () => connections,
  // GitHub's walk in starts from meridian's remote and gh; another service from its own token page.
  getConnectGuide: async (service) =>
    service === 'github'
      ? githubGuide
      : {
          service,
          places: [],
          clis: [],
          email: null,
          tokenPages:
            service === 'gitlab'
              ? [
                  {
                    product: 'gitlab',
                    webUrl: 'https://gitlab.com',
                    url: 'https://gitlab.com/-/user_settings/personal_access_tokens?name=Althar',
                  },
                ]
              : [],
        },
  listEditors: async () => [
    { id: 'cursor', name: 'Cursor' },
    { id: 'vscode', name: 'Visual Studio Code' },
    { id: 'zed', name: 'Zed' },
    { id: 'xcode', name: 'Xcode' },
    { id: 'finder', name: 'Finder' },
  ],
  getSettings: async () => ({
    coAuthor: { on: true, line: 'Co-authored-by: Althar <337922799+AltharAi@users.noreply.github.com>' },
    agentsAtOnce: { count: 4, own: null, machine: { count: 4, cores: 12, memory: 36 } },
    postTeamReviews: false,
  }),
})

const host = fakeHost({
  sounds: async () => [
    'Basso',
    'Blow',
    'Bottle',
    'Frog',
    'Funk',
    'Glass',
    'Hero',
    'Morse',
    'Ping',
    'Pop',
    'Purr',
    'Sosumi',
    'Submarine',
    'Tink',
  ],
  // No editor's own icon in a browser: each shows its first letter, as the kit does without one.
  editorPicture: async () => {
    throw new Error('Not in a browser')
  },
  update: {
    glance: async () => ({ ready: '0.2.1', working: true, restarting: false, failed: null }),
    onChange: () => () => undefined,
    restart: async () => false,
  },
})
void host.setPreference('sound', 'Glass')
void host.setPreference('editor', 'cursor')

const cache = makeQueryClient()
const services = { client, host, cache, feed: follow(client, cache) }

/* ——— Settings on every screen, not just the home: the gear at the end of every tab's bar, ⌘, everywhere. ——— */

/** Where the window is, as the router's state says it. */
interface Located {
  readonly location: { readonly pathname: string }
}

function Root() {
  const path = useRouterState({ select: (state: Located) => state.location.pathname })
  const direction = useDirection()
  const tab = useSettingsTab()
  // The third round: Settings is a tab, and while it has the window its page is the screen.
  const round3 = isRound3(direction) ? direction : null
  const onTab = round3 !== null && tab.open && tab.current
  return (
    <TabsFrame>
      {/* The home draws its own; today, no other screen has them. */}
      {(path !== '/' || onTab) && direction !== 'today' && <AppSettings path={path} />}
      {onTab ? <SettingsTab variant={round3} /> : <Outlet />}
      <Address path={path} onTab={onTab} />
    </TabsFrame>
  )
}

function SettingsTab({ variant }: { variant: Round3 }) {
  return <SettingsTabPage variant={variant} start={useStart()} />
}

/* ——— The live page's address: ?d=B&s=agents, the direction and what is open, kept as they change ——— */

let live = false

/** What is open, as the address says it: a section of the Settings tab, or the screen, and the quick panel over it. */
export const stateOf = (path: string, onTab: boolean, tab: { readonly section: string; readonly quick: boolean }) => {
  if (onTab) return tab.section
  const screen = path === '/' ? 'home' : path.startsWith('/projects/') ? 'board' : 'task'
  if (!tab.quick) return screen
  return screen === 'home' ? 'quick' : `${screen}-quick`
}

export const letterOf = (direction: Direction) => (direction === 'today' ? 'today' : direction.replace('3', ''))

function Address({ path, onTab }: { path: string; onTab: boolean }) {
  const direction = useDirection()
  const tab = useSettingsTab()
  const s = stateOf(path, onTab, tab)
  useEffect(() => {
    if (!live) return
    const url = new URL(window.location.href)
    url.searchParams.set('d', letterOf(direction))
    url.searchParams.set('s', s)
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url.href)
  }, [direction, s])
  return null
}

function AppSettings({ path }: { path: string }) {
  const start = useStart()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key !== ',') return
      event.preventDefault()
      setOpen((now) => !now)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const projectId = /^\/projects\/([^/]+)/.exec(path)?.[1]
  const where = projects.find((one) => one.id === projectId)?.name ?? (path.startsWith('/threads/') ? 'the task' : 'Home')
  return (
    <BarEnd>
      <div style={{ order: 10, display: 'flex' }}>
        <SettingsPanel start={start} open={open} onOpenChange={setOpen} where={where} />
      </div>
    </BarEnd>
  )
}

// The route every screen hangs from draws this root instead; `update` is the router's own, if not in its types here.
;(rootRoute as unknown as { update: (options: { component: () => ReactNode }) => void }).update({ component: Root })

function Caption({ children }: { children: ReactNode }) {
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
      {children}
    </div>
  )
}

/**
 * Draws the app on this page's direction. A page of one direction has its
 * name in a caption; the live page has its switcher instead (`below`), and
 * keeps its address as the direction and what is open change.
 */
export const boot = (direction: Direction, name: string, options: { readonly below?: ReactNode; readonly hash?: string } = {}) => {
  proto.set(direction)
  // Every page opens on the home tab, whatever another page kept, or where the live page's address says.
  window.localStorage.removeItem('althar.tabs')
  window.location.hash = options.hash ?? '#/'
  live = options.below !== undefined
  const router = makeRouter({ client, cache })
  const element = document.getElementById('root')
  if (element === null) throw new Error('The page has no #root')
  createRoot(element).render(
    <ServicesProvider value={services}>
      <RouterProvider router={router} />
      {options.below ?? (
        <Caption>
          {direction === 'today' ? 'Today' : direction} · {name}
        </Caption>
      )}
    </ServicesProvider>,
  )
}
