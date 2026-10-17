// Scrappy: althar as the fake runtime holds it: this repository on GitHub, its DEV issues on Linear, its board, its runs and the notes its coordinator keeps.
import {
  card,
  change,
  connectionList,
  githubConnection,
  project,
  projectRules,
  repositories,
} from '../../../../apps/desktop/tests/fixtures'
import type {
  BoardTask,
  ConnectionList,
  ConnectionSummary,
  ProjectNote,
  ProjectRepository,
  ProjectRulesView,
  ProjectSummary,
  Product,
  Runnable,
} from './deps'
import { type Connection, type Notes, proto, type Tracker, trackerResets } from './state'

/** A tracker the project names as its own: a product, on a server, one key its issues share. */
export interface Chosen {
  readonly product: Product
  readonly at: string | null
  readonly key: string
  /** Where its issues are, on the web. */
  readonly url: string
}

export const LINEAR_DEV: Chosen = { product: 'linear', at: 'linear.app', key: 'DEV', url: 'https://linear.app/charrette/team/DEV' }
export const JIRA_OPS: Chosen = {
  product: 'jira_cloud',
  at: 'charrette.atlassian.net',
  key: 'OPS',
  url: 'https://charrette.atlassian.net/jira/software/projects/OPS',
}
export const GITHUB_ISSUES: Chosen = {
  product: 'github',
  at: 'github.com',
  key: 'AltharIDE/althar',
  url: 'https://github.com/AltharIDE/althar/issues',
}

/** The trackers the picker starts the project with: none chosen (its tasks' are found), or Linear's and Jira's. */
const chosenFor = (tracker: Tracker): ReadonlyArray<Chosen> | null => (tracker === 'two' ? [LINEAR_DEV, JIRA_OPS] : null)

/* ——— What changes while the page is open: its name and ink, its rules, its notes, what it runs. ——— */

export interface Kept {
  readonly name: string
  readonly ink: ProjectSummary['ink']
  readonly rules: ProjectRulesView
  readonly dropped: ReadonlySet<string>
  readonly runnables: ReadonlyArray<Runnable>
  /** The trackers it names as its own; null where none were chosen, and its tasks' issues say. */
  readonly trackers: ReadonlyArray<Chosen> | null
}

let kept: Kept = {
  name: 'althar',
  ink: 'clay',
  rules: {
    ...projectRules,
    projectId: 'p1',
    permissions: 'coordinator',
    alwaysAsk: ['default-branch', 'force-push', 'deploy'],
    moveIssues: true,
    resolveConflicts: true,
    end: 'draft',
    conventions: [{ repository: 'althar', branch: null, title: null, template: '.github/pull_request_template.md' }],
  },
  dropped: new Set(),
  runnables: [
    { id: 'rnbl_dev', name: 'Desktop app', command: 'bun run dev', repository: 'althar', own: true, from: 'repository' },
    { id: 'rnbl_sb', name: 'Storybook', command: 'bun run storybook', repository: 'althar', own: false, from: 'person' },
    { id: 'rnbl_site', name: 'Site', command: 'bun --filter @althar/site dev', repository: 'althar', own: false, from: 'person' },
    { id: 'rnbl_check', name: null, command: 'bun run check', repository: 'althar', own: false, from: 'coordinator' },
  ],
  trackers: chosenFor(proto.get().tracker),
}
const listeners = new Set<() => void>()

export const data = {
  get: () => kept,
  set: (next: Partial<Kept>) => {
    kept = { ...kept, ...next }
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}
trackerResets.add(() => data.set({ trackers: chosenFor(proto.get().tracker) }))

/* ——— The project, as listed, and the one beside it. ——— */

export const projectsOf = (): ProjectSummary[] => [
  {
    ...project,
    id: 'p1',
    name: kept.name,
    slug: 'althar',
    ink: kept.ink,
    repository: '/Users/balazs/Projects/charrette-project/althar',
    repositories: ['althar'],
    worktrees: '/Users/balazs/Charrette/althar',
    tasks: 6,
    running: 2,
    working: 2,
    waiting: 0,
  },
  {
    ...project,
    id: 'p2',
    name: 'charrette-site',
    slug: 'charrette-site',
    ink: 'teal',
    repository: '/Users/balazs/Projects/charrette-site',
    repositories: ['charrette-site'],
    worktrees: '/Users/balazs/Charrette/charrette-site',
    tasks: 1,
    running: 0,
    working: 0,
  },
]

/* ——— Where its code and issues are, as the picker says they stand. ——— */

export const repositoryOf = (connection: Connection): ProjectRepository => ({
  ...repositories[0]!,
  id: 'repo_althar',
  name: 'althar',
  path: '/Users/balazs/Projects/charrette-project/althar',
  branch: 'main',
  role: 'other',
  host: {
    ...repositories[0]!.host!,
    path: 'AltharIDE/althar',
    url: 'https://github.com/AltharIDE/althar',
    account: { login: 'balazs', state: connection === 'host' ? 'reauth_required' : 'ready' },
  },
  tasks: 6,
})

const linear: ConnectionSummary = {
  id: 'conn_linear',
  product: 'linear',
  name: 'Linear',
  webUrl: 'https://linear.app',
  account: { login: 'balazs', name: 'Balázs' },
  auth: 'token',
  state: 'ready',
}

const jira: ConnectionSummary = {
  id: 'conn_jira',
  product: 'jira_cloud',
  name: 'Jira',
  webUrl: 'https://charrette.atlassian.net',
  account: { login: 'balazs@charrette.dev', name: 'Balázs' },
  auth: 'token',
  state: 'ready',
}

/** Althar's connections, for every project: GitHub, Linear (unless the picker says it isn't) and Jira. */
export const connectionsOf = (connection: Connection): ConnectionList => ({
  ...connectionList,
  connections: [
    { ...githubConnection, account: { login: 'balazs', name: 'Balázs' }, state: connection === 'host' ? 'reauth_required' : 'ready' },
    ...(connection === 'tracker' ? [] : [linear]),
    jira,
  ],
  products: [
    ...connectionList.products,
    {
      product: 'jira_cloud',
      service: 'jira',
      name: 'Jira',
      host: false,
      tracker: true,
      hostedUrl: null,
      selfHosted: false,
      browserSignIn: false,
      tokenNeeds: null,
      tokenPrefixes: [],
      tokenHelpForKey: null,
      keyChecks: [],
    },
  ],
  places: [{ product: 'github', webUrl: 'https://github.com', project: 'althar', remote: null, repositories: ['AltharIDE/althar'] }],
})

/* ——— Its board: this week's real tasks, each naming its DEV issue where there is a tracker. ——— */

const issue = (key: string, title: string) => ({
  product: 'linear' as const,
  key,
  title,
  url: `https://linear.app/charrette/issue/${key}/${title.toLowerCase().replace(/[^a-z]+/g, '-')}`,
})

const opsIssue = (key: string, title: string) => ({
  product: 'jira_cloud' as const,
  key,
  title,
  url: `https://charrette.atlassian.net/browse/${key}`,
})

const boardTask = (overrides: Partial<BoardTask>): BoardTask => ({
  ...card(),
  state: 'open',
  createdAt: '2026-10-16T09:00:00.000Z',
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
  branch: overrides.branch ?? `althar/${overrides.slug ?? 'task'}`,
})

export const tasksOf = (tracker: Tracker): BoardTask[] => {
  const named = (key: string, title: string) => (tracker === 'none' ? { issue: null } : { issue: issue(key, title) })
  return [
    boardTask({
      taskId: 't1',
      threadId: 'th1',
      title: 'Prototype: project settings that look good',
      slug: 'project-settings-that-look-good',
      phase: 'running',
      step: 'implement',
      startedAt: '2026-10-16T15:30:00.000Z',
      ...named('DEV-231', 'Project settings that look good'),
    }),
    boardTask({
      taskId: 't2',
      threadId: 'th2',
      title: 'Allow everything for a project and a task',
      slug: 'allow-everything',
      phase: 'running',
      step: 'review',
      startedAt: '2026-10-16T13:10:00.000Z',
      ...named('DEV-224', 'Allow everything for a project and a task'),
    }),
    boardTask({
      taskId: 't3',
      threadId: 'th3',
      title: 'Many things to run, not one Run',
      slug: 'many-things-to-run',
      phase: 'planned',
      ...named('DEV-219', 'Many things to run'),
    }),
    boardTask({
      taskId: 't4',
      threadId: 'th4',
      title: 'Green main’s post-merge: cover #122’s merge paths',
      slug: 'green-post-merge',
      phase: 'ready',
      change: change({ draft: false, number: 224, title: 'Green main’s post-merge', repository: 'AltharIDE/althar' }),
      summary: 'Covers the submodule failures #122 handles, and nudges on review drafts.',
      ...(tracker === 'two' ? { issue: opsIssue('OPS-88', 'Green main post-merge') } : named('DEV-226', 'Green main post-merge')),
    }),
  ]
}

/* ——— The notes its coordinator keeps (ADR-031): what the person decided in conversation, that the code doesn’t show. ——— */

const NOTES: ReadonlyArray<ProjectNote> = [
  {
    id: 'n1',
    body: 'Bring main in by merging it, never by rebasing: a branch with a pull request keeps its commits.',
    createdAt: '2026-10-02T10:12:00.000Z',
    keptBy: 'coordinator',
  },
  {
    id: 'n2',
    body: 'Agents run only the checks and unit tests of the packages they changed, with one worker; the full suites run on the pull request.',
    createdAt: '2026-10-04T16:40:00.000Z',
    keptBy: 'coordinator',
  },
  {
    id: 'n3',
    body: 'The end-to-end run, coverage and packaging run after merge on main, not on the pull request.',
    createdAt: '2026-10-06T09:05:00.000Z',
    keptBy: 'coordinator',
  },
  {
    id: 'n4',
    body: 'Prototypes go on one plain page on a Vite server, built from the app’s real components. Never in Storybook.',
    createdAt: '2026-10-12T18:22:00.000Z',
    keptBy: 'coordinator',
  },
  {
    id: 'n5',
    body: 'Althar is light only: no dark variants, even where a brief asks for them.',
    createdAt: '2026-10-12T18:30:00.000Z',
    keptBy: 'person',
  },
  {
    id: 'n6',
    body: 'UI labels name the feature plainly and say on or off: “Resolve conflicts automatically”, not house phrasing.',
    createdAt: '2026-10-12T20:15:00.000Z',
    keptBy: 'coordinator',
  },
  {
    id: 'n7',
    body: 'Screenshots at 1×, of only the part that changed.',
    createdAt: '2026-10-14T11:02:00.000Z',
    keptBy: 'coordinator',
  },
  {
    id: 'n8',
    body: 'Needs you is the one thing to watch. Add as few buttons as possible; the person says the rest to the lead.',
    createdAt: '2026-10-15T11:17:00.000Z',
    keptBy: 'coordinator',
  },
  {
    id: 'n9',
    body: 'Done sits beside a task’s status, where the eye already is, not in the header’s far corner.',
    createdAt: '2026-10-15T14:48:00.000Z',
    keptBy: 'coordinator',
  },
]

export const notesOf = (notes: Notes): ProjectNote[] =>
  (notes === 'many' ? NOTES : NOTES.slice(0, 2)).filter((note) => !kept.dropped.has(note.id))
