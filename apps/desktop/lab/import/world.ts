import { useSyncExternalStore } from 'react'

import { Brand } from '@althar/ui'

/*
 * What Althar finds of other tools in althar's folders, and what the person
 * brought in. Read only: finding and bringing in change nothing where it was
 * found. Two times: arriving, the project just added and nothing brought in
 * yet (the welcome's and the New project tab's directions); and later, weeks
 * on, most of it brought in on the way in and a little new since, made in
 * Conductor and Claude Code beside Althar (Settings' directions).
 */

const now = Date.now()
const DAY = 24 * 60 * 60_000
export const daysAgo = (days: number) => new Date(now - days * DAY).toISOString()

/** The tools whose folders Althar reads. The agents among them have their own marks; the rest a letter. */
export type Tool = 'conductor' | 'orca' | 'cursor' | 't3' | 'paradev' | 'git'
export type Agent = 'claude-code' | 'codex'

export const TOOLS: Record<Tool, { readonly name: string; readonly where: string; readonly brand?: Brand }> = {
  conductor: { name: 'Conductor', where: '~/conductor/workspaces/althar' },
  orca: { name: 'Orca', where: '~/orca/worktrees/althar' },
  cursor: { name: 'Cursor', where: '~/.cursor/worktrees/althar', brand: Brand.Cursor },
  t3: { name: 'T3 Code', where: '~/.t3/worktrees/althar' },
  paradev: { name: 'Paradev', where: '~/.paradev/worktrees/althar' },
  git: { name: 'By hand', where: '~/Code' },
}

export const AGENTS: Record<Agent, { readonly name: string; readonly brand: Brand; readonly where: string; readonly resumes: boolean }> = {
  'claude-code': { name: 'Claude Code', brand: Brand.ClaudeCode, where: '~/.claude/projects', resumes: true },
  codex: { name: 'Codex', brand: Brand.Codex, where: '~/.codex/sessions', resumes: false },
}

export interface PullRequest {
  readonly number: number
  readonly title: string
  readonly state: 'open' | 'draft' | 'merged'
  /** Its checks, as GitHub has them. */
  readonly checks: { readonly passed: number; readonly failed: number; readonly failing?: string }
  /** Someone else's: checked out to review. */
  readonly theirs?: string
}

export interface Worktree {
  readonly id: string
  readonly tool: Tool
  /** Its folder, as the person knows the place. */
  readonly path: string
  readonly branch: string
  /** What it would be called as a task: its pull request's title, else its branch's words. */
  readonly title: string
  readonly uncommitted: { readonly files: number; readonly add: number; readonly del: number } | null
  /** Commits on it not on its remote. */
  readonly unpushed: number
  readonly pr: PullRequest | null
  /** When anything in it last changed. */
  readonly touched: string
  /** Only later: made since the last bring-in. */
  readonly later?: true
}

export interface Conversation {
  readonly id: string
  readonly agent: Agent
  /** The agent's own name for it, else its first words. */
  readonly title: string
  readonly at: string
  readonly messages: number
  /** The worktree it ran in, by id; null for the project's own folder. */
  readonly in: string | null
  readonly later?: true
  /** What was said, for the ones the lab opens. */
  readonly said?: ReadonlyArray<{ readonly who: 'you' | 'agent'; readonly text: string; readonly ago: number }>
}

export interface Setup {
  readonly id: string
  readonly tool: Tool
  /** The file it's kept in. */
  readonly file: string
  readonly script: string
  /** What its words mean here, where the other tool names its own places. */
  readonly reads?: string
  readonly run?: string
}

export const WORKTREES: ReadonlyArray<Worktree> = [
  {
    id: 'lima',
    tool: 'conductor',
    path: '~/conductor/workspaces/althar/lima',
    branch: 'balazs/usage-meter-reset',
    title: 'Reset the usage meter at the window’s edge',
    uncommitted: { files: 3, add: 84, del: 12 },
    unpushed: 2,
    pr: {
      number: 941,
      title: 'Reset the usage meter at the window’s edge',
      state: 'draft',
      checks: { passed: 3, failed: 1, failing: 'e2e (macos)' },
    },
    touched: daysAgo(0.2),
  },
  {
    id: 'sqlite-wal',
    tool: 'orca',
    path: '~/orca/worktrees/althar/sqlite-wal',
    branch: 'sqlite-wal-checkpoint',
    title: 'SQLite WAL checkpoint',
    uncommitted: { files: 6, add: 210, del: 40 },
    unpushed: 0,
    pr: null,
    touched: daysAgo(1),
  },
  {
    id: 'export-md',
    tool: 't3',
    path: '~/.t3/worktrees/althar/export-md',
    branch: 't3code/export-markdown',
    title: 'Export a thread as Markdown',
    uncommitted: null,
    unpushed: 0,
    pr: { number: 955, title: 'Export a thread as Markdown', state: 'open', checks: { passed: 5, failed: 0 } },
    touched: daysAgo(2),
  },
  {
    id: 'k3f9',
    tool: 'cursor',
    path: '~/.cursor/worktrees/althar/k3f9',
    branch: 'fix/notarize-intel',
    title: 'Notarize the Intel build',
    uncommitted: null,
    unpushed: 1,
    pr: null,
    touched: daysAgo(3),
  },
  {
    id: 'onboarding',
    tool: 'paradev',
    path: '~/.paradev/worktrees/althar/onboarding-copy',
    branch: 'onboarding-copy',
    title: 'Onboarding copy',
    uncommitted: { files: 1, add: 12, del: 3 },
    unpushed: 0,
    pr: null,
    touched: daysAgo(6),
  },
  {
    id: 'oslo',
    tool: 'conductor',
    path: '~/conductor/workspaces/althar/oslo',
    branch: 'balazs/tray-dark',
    title: 'Tray icon in dark menu bars',
    uncommitted: null,
    unpushed: 0,
    pr: { number: 902, title: 'Tray icon in dark menu bars', state: 'merged', checks: { passed: 4, failed: 0 } },
    touched: daysAgo(11),
  },
  {
    id: 'review-948',
    tool: 'git',
    path: '~/Code/althar-review',
    branch: 'review/pr-948',
    title: 'Review #948',
    uncommitted: null,
    unpushed: 0,
    pr: { number: 948, title: 'Faster board diff', state: 'open', checks: { passed: 4, failed: 0 }, theirs: 'mira-k' },
    touched: daysAgo(4),
  },
  {
    id: 'quito',
    tool: 'conductor',
    path: '~/conductor/workspaces/althar/quito',
    branch: 'balazs/scratch-search',
    title: 'Search on Scratch',
    uncommitted: { files: 2, add: 40, del: 2 },
    unpushed: 0,
    pr: null,
    touched: daysAgo(0.1),
    later: true,
  },
]

export const SETUPS: ReadonlyArray<Setup> = [
  {
    id: 'conductor',
    tool: 'conductor',
    file: 'conductor.json',
    script: 'bun install\ncp "$CONDUCTOR_ROOT_PATH/.env" .env',
    reads: '$CONDUCTOR_ROOT_PATH is the project’s own folder.',
    run: 'bun run dev',
  },
  { id: 'cursor', tool: 'cursor', file: '.cursor/worktrees.json', script: 'bun install\ncp "$ROOT_WORKTREE_PATH/.env" .env' },
]

const said = (lines: ReadonlyArray<[who: 'you' | 'agent', text: string]>, ago: number) =>
  lines.map(([who, text], i) => ({ who, text, ago: ago + (lines.length - i) * 0.002 }))

export const CONVERSATIONS: ReadonlyArray<Conversation> = [
  {
    id: 'cc-meter',
    agent: 'claude-code',
    title: 'Reset the usage meter when the five-hour window rolls over',
    at: daysAgo(0.2),
    messages: 48,
    in: 'lima',
    said: said(
      [
        ['you', 'The usage meter stays at 100% after the five-hour window rolls over. It should reset at the window’s edge.'],
        [
          'agent',
          'The meter reads `resetsAt` once, when the window opens, and never again. I’ll schedule a re-read at `resetsAt`, and on wake, since a sleeping Mac misses the timer.',
        ],
        ['you', 'Do it. And keep the last reading while the new one loads, no flash to zero.'],
        [
          'agent',
          'Done in `usageMeter.ts`: a timer at the edge, a re-read on `powerMonitor` resume, and the old reading kept until the new one lands. Two commits, not pushed yet. The macOS e2e still fails on the draft PR: the wake test needs a fake clock.',
        ],
      ],
      0.2,
    ),
  },
  {
    id: 'cc-sleep',
    agent: 'claude-code',
    title: 'Why does the meter jump to 100% after sleep?',
    at: daysAgo(4),
    messages: 16,
    in: 'lima',
    said: said(
      [
        ['you', 'Why does the meter jump to 100% after the Mac sleeps?'],
        [
          'agent',
          'It reads usage once on launch and adds what it sees after; a wake replays the whole window as new. It needs to read the total again on wake.',
        ],
      ],
      4,
    ),
  },
  {
    id: 'cx-wal',
    agent: 'codex',
    title: 'Checkpoint the SQLite WAL when the runtime is idle',
    at: daysAgo(1),
    messages: 27,
    in: 'sqlite-wal',
    said: said(
      [
        ['you', 'The WAL file grows to 400 MB after a week. Checkpoint it when nothing is running.'],
        [
          'agent',
          'Added an idle checkpoint in `store/db.ts`: after 30 s with no writes it runs `PRAGMA wal_checkpoint(TRUNCATE)`. Not committed yet. Tests pass locally; I haven’t measured a week’s file.',
        ],
      ],
      1,
    ),
  },
  {
    id: 'cc-export',
    agent: 'claude-code',
    title: 'Export a thread as Markdown, pictures as links',
    at: daysAgo(2),
    messages: 33,
    in: 'export-md',
  },
  { id: 'cx-notarize', agent: 'codex', title: 'Notarization fails on the Intel build', at: daysAgo(3), messages: 12, in: 'k3f9' },
  {
    id: 'cc-flaky',
    agent: 'claude-code',
    title: 'Flaky e2e: the board drag test times out on CI',
    at: daysAgo(1.5),
    messages: 22,
    in: null,
    said: said(
      [
        ['you', 'The board drag test times out on CI about one run in five. Why?'],
        [
          'agent',
          'It waits on a fixed 300 ms for the drop animation, and CI’s runners are slow enough to miss it. Waiting for the card’s `data-settled` instead fixes it; I ran it 50 times with no failure.',
        ],
        ['you', 'Good, leave it there for now.'],
      ],
      1.5,
    ),
  },
  { id: 'cc-queue', agent: 'claude-code', title: 'How the merge queue builds its commits', at: daysAgo(6), messages: 9, in: null },
  {
    id: 'cx-logs',
    agent: 'codex',
    title: 'Where does the runtime write its logs on Windows?',
    at: daysAgo(8),
    messages: 5,
    in: null,
    said: said(
      [
        ['you', 'Where does the runtime write its logs on Windows?'],
        ['agent', 'Under `%APPDATA%\\Althar\\logs`, one file a day, kept for 14 days.'],
      ],
      8,
    ),
  },
  { id: 'cc-notes', agent: 'claude-code', title: 'Draft the release notes for 0.8.2', at: daysAgo(19), messages: 14, in: null },
  { id: 'cx-paint', agent: 'codex', title: 'Profile the board’s first paint', at: daysAgo(23), messages: 12, in: null },
  { id: 'cc-tray', agent: 'claude-code', title: 'Make the tray icon follow a dark menu bar', at: daysAgo(12), messages: 31, in: 'oslo' },
  {
    id: 'cc-kit',
    agent: 'claude-code',
    title: 'Move the settings page onto the kit’s SettingsLayout',
    at: daysAgo(41),
    messages: 63,
    in: null,
  },
  { id: 'cc-bun', agent: 'claude-code', title: 'Why is bun install slow in worktrees?', at: daysAgo(52), messages: 11, in: null },
  { id: 'cx-sign', agent: 'codex', title: 'Sign the Windows installer in CI', at: daysAgo(64), messages: 19, in: null },
  {
    id: 'cc-search',
    agent: 'claude-code',
    title: 'Search the chats on Scratch by what was said',
    at: daysAgo(0.1),
    messages: 14,
    in: 'quito',
    later: true,
  },
  {
    id: 'cc-later-1',
    agent: 'claude-code',
    title: 'Why does ⌘K open twice after a reload?',
    at: daysAgo(0.6),
    messages: 7,
    in: null,
    later: true,
  },
  {
    id: 'cx-later-1',
    agent: 'codex',
    title: 'Read the 0.9.0 changelog for breaking changes',
    at: daysAgo(2.5),
    messages: 4,
    in: null,
    later: true,
  },
]

/** Older conversations than the list shows, by agent: counted, and brought in with "all". */
export const OLDER: Record<Agent, number> = { 'claude-code': 14, codex: 4 }

export type Era = 'arriving' | 'later'

/** What's there in an era: arriving, all but what came later; later, all. */
export const worktreesOf = (era: Era) => WORKTREES.filter((one) => era === 'later' || one.later !== true)
export const conversationsOf = (era: Era) => CONVERSATIONS.filter((one) => era === 'later' || one.later !== true)

/** Where things come from, as the shortcuts name them: the agents first, then the tools whose worktrees they are. */
export type Source = Agent | Tool
export const SOURCES: readonly Source[] = ['claude-code', 'codex', 'conductor', 'orca', 't3', 'cursor', 'paradev', 'git']
export const nameOf = (who: Source) => (who in AGENTS ? AGENTS[who as Agent].name : TOOLS[who as Tool].name)
export const isAgent = (who: Source): who is Agent => who in AGENTS

/**
 * Everything of one source: an agent's conversations, wherever they ran, and its older ones; a tool's worktrees, the
 * conversations that ran in them, and its setup.
 */
export const thingsOf = (who: Source, era: Era) => {
  if (isAgent(who))
    return { worktrees: [], conversations: conversationsOf(era).filter((one) => one.agent === who), older: OLDER[who], setup: undefined }
  const worktrees = worktreesOf(era).filter((one) => one.tool === who)
  return {
    worktrees,
    conversations: conversationsOf(era).filter((one) => worktrees.some((w) => w.id === one.in)),
    older: 0,
    setup: SETUPS.find((one) => one.tool === who),
  }
}

/** Picked by default: work not finished (no merged PR, not someone else's), and conversations of the last month. */
export const pickedByDefault = (one: Worktree) => one.pr?.state !== 'merged' && one.pr?.theirs === undefined
export const recent = (one: Conversation) => now - Date.parse(one.at) < 30 * DAY
/** Whether a time is within the last days. */
export const within = (iso: string, days: number) => now - Date.parse(iso) < days * DAY

/** How long ago, as a list says it: 2h, yesterday, 4 days, 3 Oct. */
export const when = (iso: string) => {
  const ms = now - Date.parse(iso)
  if (ms < DAY) return `${Math.max(1, Math.round(ms / 3_600_000))}h ago`
  if (ms < 2 * DAY) return 'Yesterday'
  if (ms < 7 * DAY) return `${Math.round(ms / DAY)} days ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** What was brought in, kept apart by era: on the way in, and later. */
export interface Brought {
  readonly worktrees: ReadonlySet<string>
  readonly conversations: ReadonlySet<string>
  /** Whose setup is the project's: a tool's, by id. */
  readonly setup: string | null
  /** Direction C: found things the person set aside, not to be offered again. */
  readonly left: ReadonlySet<string>
  /** Settings' third: other tools' new work comes in as it's made. */
  readonly follow: ReadonlySet<Tool | Agent>
  /** The older conversations brought in, counted by agent, as the lists count them. */
  readonly older: Readonly<Partial<Record<Agent, number>>>
}

const empty: Brought = { worktrees: new Set(), conversations: new Set(), setup: null, left: new Set(), follow: new Set(), older: {} }

/** Later, what came in on the way: everything picked by default, Conductor's setup. */
const already = (): Brought => ({
  worktrees: new Set(
    worktreesOf('arriving')
      .filter(pickedByDefault)
      .map((one) => one.id),
  ),
  conversations: new Set(
    conversationsOf('arriving')
      .filter(recent)
      .map((one) => one.id),
  ),
  setup: 'conductor',
  left: new Set(),
  follow: new Set(),
  older: {},
})

let era = 'arriving' as Era
let brought: Brought = era === 'later' ? already() : empty
const listeners = new Set<() => void>()
const tell = () => {
  for (const listener of listeners) listener()
}

export const world = {
  era: () => era,
  brought: () => brought,
  /** Starts the era again, as it was. */
  reset: (to: Era) => {
    era = to
    brought = to === 'later' ? already() : empty
    tell()
  },
  bring: (what: {
    readonly worktrees?: readonly string[]
    readonly conversations?: readonly string[]
    readonly setup?: string | null
    readonly older?: readonly Agent[]
  }) => {
    brought = {
      ...brought,
      older: { ...brought.older, ...Object.fromEntries((what.older ?? []).map((who) => [who, OLDER[who]])) },
      worktrees: new Set([...brought.worktrees, ...(what.worktrees ?? [])]),
      conversations: new Set([...brought.conversations, ...(what.conversations ?? [])]),
      setup: what.setup === undefined ? brought.setup : what.setup,
    }
    tell()
  },
  /** What the way in brings with nothing changed: for a page opened on the board after it. */
  arrived: () => {
    brought = { ...already(), setup: 'conductor' }
    tell()
  },
  leave: (ids: readonly string[]) => {
    brought = { ...brought, left: new Set([...brought.left, ...ids]) }
    tell()
  },
  follow: (who: Tool | Agent, on: boolean) => {
    const next = new Set(brought.follow)
    if (on) next.add(who)
    else next.delete(who)
    brought = { ...brought, follow: next }
    tell()
  },
  /** Keeps in step with a tool, or stops: on, what it made since comes in at once, and what it makes from then on. */
  keep: (who: Tool | Agent, on: boolean) => {
    world.follow(who, on)
    if (!on) return
    // What it made since the last look; what was left out on the way in stays out.
    const all = notYet(brought)
    const left = {
      worktrees: all.worktrees.filter((one) => one.later === true),
      conversations: all.conversations.filter((one) => one.later === true),
    }
    const isAgent = who in AGENTS
    world.bring(
      isAgent
        ? { conversations: left.conversations.filter((one) => one.agent === who && one.in === null).map((one) => one.id) }
        : {
            worktrees: left.worktrees.filter((one) => one.tool === who).map((one) => one.id),
            conversations: left.conversations.filter((one) => WORKTREES.find((w) => w.id === one.in)?.tool === who).map((one) => one.id),
          },
    )
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export const useBrought = () => useSyncExternalStore(world.subscribe, world.brought)

/** What is there and not brought in or set aside: new, in an era. */
export const notYet = (b: Brought) => ({
  worktrees: worktreesOf(era).filter((one) => !b.worktrees.has(one.id) && !b.left.has(one.id)),
  conversations: conversationsOf(era).filter((one) => !b.conversations.has(one.id) && !b.left.has(one.id)),
})

export const worktreeOf = (id: string | null) => WORKTREES.find((one) => one.id === id)
