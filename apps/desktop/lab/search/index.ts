import type { IconName, ProjectInk } from '@althar/ui'

import { coordinatorOf, pullUrl, threadIdOf } from './data'
import { fold, type Hit, matchWord, type Part, partsOf, passageOf, type Ranges, wordsOf } from './match'
import { used, type Use } from './state'
import {
  ALTHAR,
  CONVERSATIONS,
  FILE_PATHS,
  ISSUES,
  NOTES,
  PROJECTS,
  PULLS,
  type Said,
  TASKS,
  TOUCHED,
  type WorldTask,
  projectOf,
  taskOf,
} from './world'

/*
 * Everything search finds, in memory, as one list of entries: tasks, pull
 * requests, issues, the conversations and what was said in them, notes,
 * files, places and actions. A search scores each against the words typed
 * (match.ts), then adds what the person does (how often and how lately they
 * opened it), where it stands (what waits on them first) and where they are
 * (this task's actions, this project's things). It answers in the same
 * frame as the key: nothing waits on a runtime.
 */

export type Kind = 'task' | 'pull' | 'issue' | 'conversation' | 'said' | 'note' | 'file' | 'place' | 'action'

/** Where the person is as search opens: the project whose tab has the window, and the task on screen. */
export interface Context {
  readonly project: string | null
  readonly task: string | null
}

/** What choosing something does. */
export type Go =
  | { readonly to: 'home' }
  | { readonly to: 'task'; readonly slug: string; readonly at?: string; readonly face?: 'talk' | 'out' }
  | { readonly to: 'project'; readonly project: string; readonly room?: string; readonly section?: string; readonly at?: string }
  | { readonly to: 'settings'; readonly section: string }
  | { readonly to: 'key'; readonly key: string; readonly shift?: boolean }
  /** Writes the words to the project's coordinator, in its composer. */
  | { readonly to: 'ask'; readonly project: string; readonly text: string }
  /** What it would do, said in a line: nothing here acts. */
  | { readonly to: 'say'; readonly line: string }

/** A thing a chosen entry can do, beyond opening. */
export interface Act {
  readonly id: string
  readonly title: string
  readonly icon: IconName
  readonly go: Go
  readonly shortcut?: string
  readonly danger?: boolean
}

/** Where it stands, in a word, and how loud. */
export interface Stand {
  readonly word: string
  readonly tone: 'live' | 'signal' | 'quiet' | 'bad'
}

export interface Entry {
  readonly id: string
  readonly kind: Kind
  readonly title: string
  readonly icon: IconName
  /** Exact keys it is found by on their own: #845, 845, DEV-58. */
  readonly keys?: ReadonlyArray<string>
  /** Words it is found by that it doesn't show: a branch, a slug, what it's also called. */
  readonly also?: string
  /** What is inside it, for passages: what was said, a note, a summary, an issue's body. */
  readonly body?: string
  readonly project?: string
  readonly stand?: Stand
  /** Quiet facts after its title: a number, a path, who said it. */
  readonly facts?: ReadonlyArray<string>
  /** Minutes since it last changed. */
  readonly ago?: number
  /** Where what was said was said, for grouping by place: a task's slug, or `conversation:<project>`. */
  readonly place?: string
  readonly who?: Said['who']
  /** An action's own key, drawn beside it. */
  readonly shortcut?: string
  /** What an action belongs to: this task, this project, or Althar. */
  readonly scope?: 'task' | 'project' | 'app'
  readonly go: Go
  readonly acts?: ReadonlyArray<Act>
  readonly danger?: boolean
}

/* Where things stand. */

const STANDS: Readonly<Record<string, Stand>> = {
  drafting: { word: 'Planned', tone: 'quiet' },
  planned: { word: 'Planned', tone: 'quiet' },
  held: { word: 'Held', tone: 'quiet' },
  running: { word: 'Running', tone: 'live' },
  waiting: { word: 'Needs you', tone: 'signal' },
  ready: { word: 'Ready', tone: 'signal' },
  kept: { word: 'Kept for later', tone: 'quiet' },
  stopped: { word: 'Stopped', tone: 'quiet' },
}

const standOf = (task: WorldTask): Stand =>
  task.phase === 'settled'
    ? task.state === 'abandoned'
      ? { word: 'Abandoned', tone: 'quiet' }
      : { word: task.pr === undefined ? 'Done' : 'Merged', tone: 'quiet' }
    : (STANDS[task.phase] ?? { word: task.phase, tone: 'quiet' })

const say = (line: string): Go => ({ to: 'say', line })

/* What each kind can do, beyond opening. */

const taskActs = (task: WorldTask): ReadonlyArray<Act> => {
  const branch = `althar/${task.slug}`
  const open = task.phase !== 'settled'
  const command = task.asks?.replace(/^Run /, '')
  return [
    ...(command === undefined
      ? []
      : [
          { id: 'allow', title: `Allow ${command}`, icon: 'check' as const, go: say(`Allowed ${command}: ${task.title} carries on`) },
          { id: 'deny', title: 'Don’t allow', icon: 'close' as const, go: say(`Didn’t allow ${command}`) },
        ]),
    { id: 'open', title: 'Open', icon: 'arrow', go: { to: 'task', slug: task.slug } },
    ...(task.phase === 'ready' && task.pr !== undefined
      ? [{ id: 'merge', title: `Merge #${task.pr}`, icon: 'check' as const, go: say(`Merged #${task.pr}: ${task.title}`) }]
      : []),
    ...(task.phase === 'ready' && task.pr === undefined
      ? [{ id: 'done', title: 'Mark done', icon: 'check' as const, go: say(`${task.title}: done`) }]
      : []),
    ...(task.phase === 'running' ? [{ id: 'stop', title: 'Stop', icon: 'hold' as const, go: say(`Stopped ${task.title}`) }] : []),
    ...(task.phase === 'stopped' ? [{ id: 'resume', title: 'Carry on', icon: 'play' as const, go: say(`${task.title} carries on`) }] : []),
    ...(task.pr === undefined
      ? []
      : [
          {
            id: 'pr',
            title: `Open #${task.pr} on GitHub`,
            icon: 'external' as const,
            go: say(`Would open ${pullUrl(task.project, task.pr)}`),
          },
        ]),
    { id: 'outputs', title: 'Show its outputs', icon: 'artifact', go: { to: 'task', slug: task.slug, face: 'out' }, shortcut: 'o' },
    { id: 'branch', title: 'Copy branch name', icon: 'copy', go: say(`Copied ${branch}`) },
    {
      id: 'ask',
      title: 'Ask the coordinator about it',
      icon: 'comment',
      go: { to: 'ask', project: task.project, text: `About “${task.title}”: ` },
    },
    ...(open
      ? [{ id: 'abandon', title: 'Abandon…', icon: 'remove' as const, go: say(`Would ask before abandoning ${task.title}`), danger: true }]
      : []),
  ]
}

/* The entries. */

const taskEntry = (task: WorldTask): Entry => {
  const stand = standOf(task)
  return {
    id: `task:${task.slug}`,
    kind: 'task',
    title: task.title,
    icon: 'work',
    keys: [...(task.pr === undefined ? [] : [`#${task.pr}`, String(task.pr)]), ...(task.issue === undefined ? [] : [task.issue])],
    also: `althar/${task.slug} ${(task.files ?? []).join(' ')}`,
    body: [task.summary, ...(task.thread ?? []).map((one) => one.text)].filter(Boolean).join(' · '),
    project: task.project,
    stand,
    facts: [...(task.pr === undefined ? [] : [`#${task.pr}`]), ...(task.issue === undefined ? [] : [task.issue])],
    ago: task.ago,
    place: task.slug,
    go: { to: 'task', slug: task.slug },
    acts: taskActs(task),
  }
}

const pullEntries = PULLS.map((pull): Entry => {
  const task = pull.task === undefined ? undefined : taskOf(pull.task)
  const stand: Stand =
    pull.state === 'merged'
      ? { word: 'Merged', tone: 'quiet' }
      : pull.checks === 'failed'
        ? { word: 'Checks failed', tone: 'bad' }
        : pull.checks === 'running'
          ? { word: 'Checks running', tone: 'live' }
          : pull.draft === true
            ? { word: 'Draft', tone: 'quiet' }
            : { word: task?.phase === 'ready' ? 'Ready to merge' : 'Open', tone: task?.phase === 'ready' ? 'signal' : 'quiet' }
  const github: Go = say(`Would open ${pullUrl(pull.project, pull.number)}`)
  return {
    id: `pull:${pull.number}`,
    kind: 'pull',
    title: pull.title,
    icon: 'pr',
    keys: [`#${pull.number}`, String(pull.number)],
    also: `pr pull request ${pull.author}`,
    body: pull.body,
    project: pull.project,
    stand,
    facts: [`#${pull.number}`, ...(pull.author === 'Althar' ? [] : [pull.author])],
    ago: pull.ago,
    place: pull.task,
    go: task === undefined ? github : { to: 'task', slug: task.slug },
    acts: [
      ...(task === undefined
        ? []
        : [{ id: 'task', title: 'Open its task', icon: 'work' as const, go: { to: 'task' as const, slug: task.slug } }]),
      { id: 'github', title: 'Open on GitHub', icon: 'external', go: github },
      ...(task === undefined && pull.state === 'open'
        ? [{ id: 'review', title: `Review #${pull.number}`, icon: 'check' as const, go: say(`Started Review #${pull.number}`) }]
        : []),
      ...(task?.phase === 'ready'
        ? [{ id: 'merge', title: `Merge #${pull.number}`, icon: 'check' as const, go: say(`Merged #${pull.number}`) }]
        : []),
      { id: 'copy', title: 'Copy link', icon: 'copy', go: say(`Copied ${pullUrl(pull.project, pull.number)}`) },
    ],
  }
})

const issueEntries = ISSUES.map((issue): Entry => {
  const task = issue.task === undefined ? undefined : taskOf(issue.task)
  const linear = projectOf(issue.project).tracker === 'linear'
  const there: Go = say(`Would open ${issue.key} in ${linear ? 'Linear' : 'GitHub'}`)
  const start: Go = { to: 'ask', project: issue.project, text: `Start a task for ${issue.key}: ${issue.title}` }
  return {
    id: `issue:${issue.key}`,
    kind: 'issue',
    title: issue.title,
    icon: 'issues',
    keys: [issue.key, ...(issue.key.startsWith('#') ? [issue.key.slice(1)] : [issue.key.replace('DEV-', '')])],
    also: 'issue',
    body: issue.body,
    project: issue.project,
    stand: { word: issue.status, tone: issue.status === 'In Progress' || issue.status === 'In Review' ? 'live' : 'quiet' },
    facts: [issue.key],
    ago: issue.ago,
    place: issue.task,
    go: task === undefined ? start : { to: 'task', slug: task.slug },
    acts: [
      ...(task === undefined
        ? [{ id: 'start', title: 'Start a task from it', icon: 'plus' as const, go: start }]
        : [{ id: 'task', title: 'Open its task', icon: 'work' as const, go: { to: 'task' as const, slug: task.slug } }]),
      { id: 'there', title: `Open in ${linear ? 'Linear' : 'GitHub'}`, icon: 'external', go: there },
      { id: 'copy', title: `Copy ${issue.key}`, icon: 'copy', go: say(`Copied ${issue.key}`) },
    ],
  }
})

const noteEntries = NOTES.map((note): Entry => ({
  id: `note:${note.id}`,
  kind: 'note',
  title: note.body,
  icon: 'quote',
  also: 'note decision',
  body: note.body,
  project: note.project,
  ago: note.ago,
  go: { to: 'project', project: note.project, room: 'settings', section: 'notes', at: note.body.slice(0, 60) },
  acts: [
    {
      id: 'notes',
      title: 'Show in Notes',
      icon: 'quote',
      go: { to: 'project', project: note.project, room: 'settings', section: 'notes', at: note.body.slice(0, 60) },
    },
    { id: 'copy', title: 'Copy', icon: 'copy', go: say('Copied the note') },
    { id: 'drop', title: 'Drop the note…', icon: 'remove', go: say('Would ask before dropping it'), danger: true },
  ],
}))

/** What was said, one entry a message: in a task's thread or a project's conversation. */
const saidEntries: ReadonlyArray<Entry> = [
  ...TASKS.flatMap((task) =>
    (task.thread ?? []).map((one, at): Entry => ({
      id: `said:${task.slug}:${at}`,
      kind: 'said',
      title: one.text,
      icon: 'comment',
      body: one.text,
      project: task.project,
      ago: one.ago,
      place: task.slug,
      who: one.who,
      facts: [task.title],
      go: { to: 'task', slug: task.slug, at: one.text.slice(0, 60) },
      acts: [
        { id: 'open', title: 'Open the thread here', icon: 'arrow', go: { to: 'task', slug: task.slug, at: one.text.slice(0, 60) } },
        { id: 'copy', title: 'Copy what was said', icon: 'copy', go: say('Copied') },
        {
          id: 'ask',
          title: 'Ask the coordinator about it',
          icon: 'comment',
          go: { to: 'ask', project: task.project, text: `About “${one.text.slice(0, 60)}…”: ` },
        },
      ],
    })),
  ),
  ...Object.entries(CONVERSATIONS).flatMap(([project, said]) =>
    said.map((one, at): Entry => ({
      id: `said:conversation:${project}:${at}`,
      kind: 'said',
      title: one.text,
      icon: 'comment',
      body: one.text,
      project,
      ago: one.ago,
      place: `conversation:${project}`,
      who: one.who,
      facts: ['Conversation'],
      go: { to: 'project', project, room: 'talk', at: one.text.slice(0, 60) },
      acts: [
        {
          id: 'open',
          title: 'Open the conversation here',
          icon: 'arrow',
          go: { to: 'project', project, room: 'talk', at: one.text.slice(0, 60) },
        },
        { id: 'copy', title: 'Copy what was said', icon: 'copy', go: say('Copied') },
      ],
    })),
  ),
]

const conversationEntries = PROJECTS.map((project): Entry => ({
  id: `conversation:${project.id}`,
  kind: 'conversation',
  title: `${project.name}’s conversation`,
  icon: 'comment',
  also: 'coordinator talk chat',
  body: (CONVERSATIONS[project.id] ?? []).map((one) => one.text).join(' · '),
  project: project.id,
  ago: Math.min(...(CONVERSATIONS[project.id] ?? []).map((one) => one.ago)),
  place: `conversation:${project.id}`,
  go: { to: 'project', project: project.id, room: 'talk' },
}))

const fileEntries = [...new Set([...FILE_PATHS, ...TOUCHED.keys()])].map((path): Entry => {
  const touched = TOUCHED.get(path) ?? []
  const name = path.split('/').at(-1) ?? path
  const folder = path.slice(0, path.length - name.length - 1)
  return {
    id: `file:${path}`,
    kind: 'file',
    title: name,
    icon: 'file',
    also: path,
    project: ALTHAR,
    facts: [folder, ...(touched.length === 0 ? [] : [touched.length === 1 ? 'changed by 1 task' : `changed by ${touched.length} tasks`])],
    go: say(`Would open ${path} in Zed`),
    acts: [
      { id: 'editor', title: 'Open in Zed', icon: 'external', go: say(`Would open ${path} in Zed`) },
      ...touched.map((slug) => ({
        id: `task-${slug}`,
        title: taskOf(slug)?.title ?? slug,
        icon: 'work' as const,
        go: { to: 'task' as const, slug },
      })),
      { id: 'copy', title: 'Copy path', icon: 'copy', go: say(`Copied ${path}`) },
    ],
  }
})

/* Places: projects and their views, Althar's settings. */

const ROOMS: ReadonlyArray<readonly [string, string, IconName, string]> = [
  ['board', 'Board', 'list', 'tasks lanes'],
  ['talk', 'Conversation', 'comment', 'coordinator talk chat'],
  ['automations', 'Automations', 'automation', 'schedule'],
  ['artifacts', 'Artifacts', 'canvas', 'canvases outputs'],
  ['settings', 'Project settings', 'gear', 'preferences configure'],
]

const PROJECT_SECTIONS: ReadonlyArray<readonly [string, string, IconName, string]> = [
  ['notes', 'Notes', 'quote', 'decisions'],
  ['code', 'Code and issues', 'plug', 'repositories tracker linear github'],
  ['rules', 'Rules', 'lock', 'permissions sandbox allow everything'],
  ['running', 'Running', 'play', 'run command dev server'],
  ['tasks', 'Tasks', 'work', 'presets reviews'],
]

const SETTINGS: ReadonlyArray<readonly [string, string, IconName, string]> = [
  ['agents', 'Agents', 'agents', 'claude codex models sign in accounts'],
  ['mcp-servers', 'MCP servers', 'plug', 'tools'],
  ['skills', 'Skills', 'knowledge', ''],
  ['code-hosts', 'Code hosts and trackers', 'branch', 'github linear gitlab connections'],
  ['tasks', 'Tasks', 'work', 'plans reviews presets countdown'],
  ['pull-requests', 'Pull requests', 'pr', 'reviews seal co-author'],
  ['this-mac', 'Work on this Mac', 'load', 'agents at once memory dictation'],
  ['notifications', 'Notifications', 'bell', 'sounds'],
  ['appearance', 'Appearance', 'image', 'dark light theme icon'],
  ['editor-and-browser', 'Editor and browser', 'file', 'zed vs code'],
  ['about', 'About Althar', 'down', 'version update'],
]

const isMacKeys = /Mac/.test(navigator.platform)
const mod = isMacKeys ? '⌘' : 'Ctrl+'
const shift = /Mac/.test(navigator.platform) ? '⇧' : 'Shift+'

const placeEntries: ReadonlyArray<Entry> = [
  {
    id: 'place:home',
    kind: 'place',
    title: 'Home',
    icon: 'work',
    also: 'all projects start',
    shortcut: `${mod}1`,
    scope: 'app',
    go: { to: 'home' },
  },
  ...PROJECTS.map((project, at): Entry => ({
    id: `place:${project.id}`,
    kind: 'place',
    title: project.name,
    icon: 'folder',
    also: 'project',
    project: project.id,
    shortcut: `${mod}${at + 2}`,
    facts: ['Project'],
    scope: 'app',
    go: { to: 'project', project: project.id, room: 'both' },
  })),
  ...PROJECTS.flatMap((project) => [
    ...ROOMS.map(([room, name, icon, also]): Entry => ({
      id: `place:${project.id}:${room}`,
      kind: 'place',
      title: name,
      icon,
      also,
      project: project.id,
      facts: [project.name],
      scope: 'project',
      go: { to: 'project', project: project.id, room },
    })),
    ...PROJECT_SECTIONS.map(([section, name, icon, also]): Entry => ({
      id: `place:${project.id}:settings:${section}`,
      kind: 'place',
      title: name,
      icon,
      also: `${also} project settings`,
      project: project.id,
      facts: [`${project.name} › Settings`],
      scope: 'project',
      go: { to: 'project', project: project.id, room: 'settings', section },
    })),
  ]),
  ...SETTINGS.map(([section, name, icon, also]): Entry => ({
    id: `place:settings:${section}`,
    kind: 'place',
    title: name,
    icon,
    also: `${also} settings preferences`,
    facts: ['Settings'],
    scope: 'app',
    go: { to: 'settings', section },
  })),
]

/* Actions: Althar's own, the project's, and the task's on screen. */

const appActions: ReadonlyArray<Entry> = [
  {
    id: 'action:settings',
    kind: 'action',
    title: 'Settings',
    icon: 'gear',
    also: 'preferences',
    shortcut: isMacKeys ? `${shift}${mod},` : `${mod}${shift},`,
    scope: 'app',
    go: { to: 'key', key: ',', shift: true },
  },
  {
    id: 'action:quick',
    kind: 'action',
    title: 'Quick settings',
    icon: 'gear',
    also: 'preferences theme',
    shortcut: `${mod},`,
    scope: 'app',
    go: { to: 'key', key: ',' },
  },
  {
    id: 'action:usage',
    kind: 'action',
    title: 'Plan usage',
    icon: 'load',
    also: 'limits tokens accounts',
    shortcut: `${mod}U`,
    scope: 'app',
    go: { to: 'key', key: 'u' },
  },
  {
    id: 'action:new-project',
    kind: 'action',
    title: 'New project',
    icon: 'plus',
    also: 'add folder repository',
    shortcut: `${mod}N`,
    scope: 'app',
    go: { to: 'key', key: 'n' },
  },
  {
    id: 'action:dark',
    kind: 'action',
    title: 'Switch to dark appearance',
    icon: 'theme',
    also: 'theme night mode',
    scope: 'app',
    go: say('Would switch to dark: the lab draws light only'),
  },
  {
    id: 'action:report',
    kind: 'action',
    title: 'Report a problem',
    icon: 'bell',
    also: 'bug feedback',
    scope: 'app',
    go: say('Would open Report a problem'),
  },
]

const projectActions = (project: string): ReadonlyArray<Entry> => {
  const name = projectOf(project).name
  return [
    {
      id: 'action:run',
      kind: 'action',
      title: `Run ${name}`,
      icon: 'play',
      also: 'start dev server bun run dev',
      project,
      scope: 'project',
      go: say(`Running bun run dev on ${name}’s main`),
    },
    {
      id: 'action:ask',
      kind: 'action',
      title: 'Ask the coordinator',
      icon: 'comment',
      also: 'new task start talk message',
      project,
      scope: 'project',
      go: { to: 'ask', project, text: '' },
    },
    {
      id: 'action:automation',
      kind: 'action',
      title: 'New automation',
      icon: 'automation',
      also: 'schedule',
      project,
      scope: 'project',
      go: { to: 'project', project, room: 'automations' },
    },
    {
      id: 'action:note',
      kind: 'action',
      title: 'Add a note',
      icon: 'quote',
      also: 'decision remember',
      project,
      scope: 'project',
      go: { to: 'project', project, room: 'settings', section: 'notes' },
    },
  ]
}

const thisTaskActions = (slug: string): ReadonlyArray<Entry> => {
  const task = taskOf(slug)
  if (task === undefined) return []
  return taskActs(task)
    .filter((one) => one.id !== 'open' && one.id !== 'ask')
    .map((one): Entry => ({
      id: `action:task:${one.id}`,
      kind: 'action',
      title: one.title,
      icon: one.icon,
      project: task.project,
      scope: 'task',
      facts: [task.title],
      go: one.go,
      ...(one.shortcut === undefined ? {} : { shortcut: one.shortcut }),
      ...(one.danger === true ? { danger: true } : {}),
    }))
}

const ALWAYS: ReadonlyArray<Entry> = [
  ...TASKS.map(taskEntry),
  ...pullEntries,
  ...issueEntries,
  ...conversationEntries,
  ...saidEntries,
  ...noteEntries,
  ...fileEntries,
  ...placeEntries,
  ...appActions,
]

/** Everything, with the actions of where the person is. */
export const entriesFor = (context: Context): ReadonlyArray<Entry> => [
  ...ALWAYS,
  ...projectActions(context.project ?? ALTHAR),
  ...(context.task === null ? [] : thisTaskActions(context.task)),
]

/* Scoring. */

/** A question's words that say nothing of what it asks about. */
export const FILLER = new Set(
  'what why how where when who which did do does is are was were can could should would we i you it the a an to of in on about for and or our my me us there that this with any from been be have has had'.split(
    ' ',
  ),
)

export interface Found {
  readonly entry: Entry
  readonly score: number
  /** The letters of its title that matched. */
  readonly ranges: Ranges
  /** Where it matched inside, a few words either side, where it did. */
  readonly passage: ReadonlyArray<Part> | null
  /** A key typed exactly: it is the one meant. */
  readonly exact: boolean
}

const KIND_WEIGHT: Readonly<Record<Kind, number>> = {
  task: 1,
  place: 0.95,
  action: 0.95,
  pull: 0.9,
  issue: 0.9,
  conversation: 0.85,
  note: 0.8,
  said: 0.7,
  file: 0.6,
}

/** The habit: opened often and lately counts most, fading over a few days. */
const habitOf = (use: Use | undefined) => {
  if (use === undefined) return 0
  const days = (Date.now() - use.at) / 86_400_000
  return 4 * Math.log2(1 + use.n / (1 + days))
}

const standWeight = (entry: Entry) => {
  switch (entry.stand?.tone) {
    case 'signal':
      return 3
    case 'live':
      return 2
    case 'bad':
      return 2
    default:
      return entry.stand?.word === 'Merged' || entry.stand?.word === 'Done' || entry.stand?.word === 'Abandoned' ? -1 : 0
  }
}

export interface Ask {
  /** The kinds to look at. */
  readonly kinds?: ReadonlyArray<Kind>
  /** Only this project's. */
  readonly project?: string | null
  /** Whether what is inside things (what was said, a note's body) counts, and how much. */
  readonly inside?: number
  /** Whether letters in order with gaps count. */
  readonly fuzzy?: boolean
  /** Any of the words will do, the more the better, and a question's filler words don't count: for words asked as a question. */
  readonly any?: boolean
}

const keyOf = (word: string) => fold(word).replace(/^#/, '')

/** Scores every entry against the words, best first. */
export const search = (entries: ReadonlyArray<Entry>, query: string, context: Context, ask: Ask = {}): ReadonlyArray<Found> => {
  const words = ask.any === true ? wordsOf(query).filter((word) => !FILLER.has(word)) : wordsOf(query)
  const inside = ask.inside ?? 0.35
  const out: Array<Found> = []
  for (const entry of entries) {
    if (ask.kinds !== undefined && !ask.kinds.includes(entry.kind)) continue
    if (ask.project != null && entry.project !== undefined && entry.project !== ask.project) continue
    let score = 0
    let exact = false
    const ranges: Array<readonly [number, number]> = []
    let insideWords: Array<string> = []
    let ok = true
    let matched = 0
    for (const word of words) {
      const key = entry.keys?.some((one) => keyOf(one) === keyOf(word)) === true
      if (key) {
        exact = true
        score += 40
        continue
      }
      // The start of a number or a key: #84 finds #840 to #849.
      if (/\d/.test(word) && entry.keys?.some((one) => keyOf(one).startsWith(keyOf(word))) === true) {
        score += 14
        continue
      }
      const loose = (ask.fuzzy ?? true) && entry.kind !== 'said' && entry.kind !== 'note' && entry.title.length <= 80
      const title = matchWord(entry.title, word, loose)
      const also = entry.also === undefined ? null : matchWord(entry.also, word, false)
      const body = inside > 0 && entry.body !== undefined ? matchWord(entry.body, word, false) : null
      const best = Math.max(title?.score ?? 0, (also?.score ?? 0) * 0.6, (body?.score ?? 0) * inside)
      if (best === 0) {
        if (ask.any === true) continue
        ok = false
        break
      }
      matched += 1
      if (title !== null && title.score >= best) ranges.push(...title.ranges)
      else if (body !== null && (body.score * inside >= best || title === null)) insideWords = [...insideWords, word]
      score += best
    }
    if (!ok || (ask.any === true && matched === 0 && words.length > 0)) continue
    // Of words asked, each one more that matched counts, and all of them most.
    if (ask.any === true) score += matched * 3 + (matched === words.length ? 4 : 0)
    if (words.length === 0) score = 0
    // A phrase typed whole, in order, counts for more than its words apart.
    if (words.length > 1 && fold(entry.title).includes(words.join(' '))) score += 6
    score *= KIND_WEIGHT[entry.kind]
    score += habitOf(used.get()[entry.id]) + standWeight(entry)
    if (context.project !== null && entry.project === context.project) score += 2
    if (entry.scope === 'task') score += 5
    if (entry.place !== undefined && entry.place === context.task) score += 3
    if (entry.ago !== undefined) score += 1.5 / (1 + entry.ago / 1440)
    // What was said and a note are long: they show the words around where they matched, wherever that is.
    const long = entry.kind === 'said' || entry.kind === 'note'
    const passage = long
      ? passageOf(entry.title, words, 60)
      : insideWords.length > 0 && entry.body !== undefined
        ? passageOf(entry.body, insideWords)
        : null
    out.push({ entry, score, ranges: mergeRanges(ranges), passage, exact })
  }
  return out.sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score)
}

const mergeRanges = (ranges: ReadonlyArray<readonly [number, number]>): Ranges => {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const out: Array<[number, number]> = []
  for (const [from, to] of sorted) {
    const last = out.at(-1)
    if (last !== undefined && from <= last[1]) last[1] = Math.max(last[1], to)
    else out.push([from, to])
  }
  return out
}

/** The title of what was found, the letters that matched marked. */
export const titleParts = (found: Found) => partsOf(found.entry.title, found.ranges)

/** Whether the words read as a question: a question mark, or a question's first word. */
export const asksSomething = (query: string) =>
  /\?\s*$/.test(query) || /^(what|why|how|where|when|who|which|did|do|does|is|are|can|should|could|would)\b/i.test(query.trim())

/* What the empty box shows. */

/** What waits on the person: in this project, or everywhere from the home. */
export const needsYou = (context: Context): ReadonlyArray<Entry> =>
  TASKS.filter(
    (task) => (task.phase === 'waiting' || task.phase === 'ready') && (context.project === null || task.project === context.project),
  ).map(taskEntry)

/** What was opened from search lately, most-used and latest first. */
export const recent = (entries: ReadonlyArray<Entry>, context: Context, most = 6): ReadonlyArray<Entry> => {
  const uses = used.get()
  return entries
    .filter(
      (entry) =>
        uses[entry.id] !== undefined && (context.project === null || entry.project === undefined || entry.project === context.project),
    )
    .sort((a, b) => habitOf(uses[b.id]) - habitOf(uses[a.id]))
    .slice(0, most)
}

/** The actions of where the person is: this task's, then this project's. */
export const actionsHere = (entries: ReadonlyArray<Entry>, context: Context): ReadonlyArray<Entry> => {
  const task = entries.filter((entry) => entry.scope === 'task')
  if (task.length > 0) return task
  return entries.filter((entry) => entry.kind === 'action' && entry.scope === 'project')
}

export const projectName = (id: string | undefined) => (id === undefined ? undefined : projectOf(id).name)
export const projectInk = (id: string) => projectOf(id).ink as ProjectInk
export const conversationThread = coordinatorOf
export const taskThread = threadIdOf
export const KINDS_NAMED: Readonly<Record<Kind, string>> = {
  task: 'Tasks',
  pull: 'Pull requests',
  issue: 'Issues',
  conversation: 'Conversations',
  said: 'What was said',
  note: 'Notes',
  file: 'Files',
  place: 'Places',
  action: 'Actions',
}

export type { Hit }
