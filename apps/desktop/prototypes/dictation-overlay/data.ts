import type { BoardTask, Load, ProjectSummary, ThreadItem, ThreadSnapshot } from '@althar/contracts'

import { card, change, coordinatorSnapshot, home, items, load, project, snapshot } from '../../tests/fixtures'
import { sentTo } from './sent'

/*
 * Throwaway: what the fake runtime holds. althar, with this repository's own
 * work on dictation as it stood: the coordinator's conversation that made the
 * tasks, the board, the home, and each task's thread. What the person sends
 * from a dictation lands at the end of the thread it went to.
 */

const BOOT = Date.now()
const ago = (minutes: number) => new Date(BOOT - minutes * 60_000).toISOString()
const when = (item: ThreadItem, minutes: number): ThreadItem => ({ ...item, createdAt: ago(minutes) })

export const althar: ProjectSummary = {
  ...project,
  id: 'p1',
  name: 'althar',
  slug: 'althar',
  ink: 'clay',
  repository: '/Users/balazs/Projects/charrette-project/althar',
  repositories: ['althar'],
  worktrees: '/Users/balazs/Charrette/althar',
  lastWorkAt: ago(1),
  tasks: 9,
  running: 3,
  working: 3,
  ready: 2,
}

const STEPS = [
  { key: 'implement' as const, agentId: 'claude-code', model: 'opus', skipped: false },
  { key: 'review' as const, agentId: 'codex', model: null, skipped: false },
]

const worktreeOf = (slug: string) => `/Users/balazs/Charrette/althar/${slug}/althar`

const task = (id: string, overrides: Partial<BoardTask>): BoardTask => ({
  ...card(),
  taskId: id,
  threadId: `th-${id}`,
  plan: { id: `pln-${id}`, steps: STEPS, startsAt: null, reason: 'It knows the composer.', end: 'draft' },
  lead: 'claude-code',
  leadModel: 'opus',
  state: 'active',
  createdAt: ago(90),
  settledAt: null,
  changed: null,
  here: [],
  ...overrides,
  branch: `althar/${overrides.slug ?? id}`,
})

const scroll = task('scroll', {
  title: 'Let a long dictation scroll in the composer',
  slug: 'let-a-long-dictation-scroll-in-the-composer',
  phase: 'running',
  step: 'implement',
  startedAt: ago(9),
  changed: { files: 3, add: 84, del: 12 },
})

const keep = task('keep', {
  title: 'Keep composer text and dictation when navigating away',
  slug: 'keep-composer-text-and-dictation-when-navigating',
  phase: 'running',
  step: 'implement',
  startedAt: ago(14),
  changed: { files: 9, add: 247, del: 112 },
})

const quick = task('quick', {
  title: 'Keep quick tasks on this Mac',
  slug: 'keep-quick-tasks-on-this-mac',
  phase: 'running',
  step: 'review',
  startedAt: ago(41),
  change: change({
    number: 163,
    title: 'Keep quick tasks on this Mac',
    repository: 'AltharIDE/althar',
    draft: true,
    additions: 212,
    deletions: 64,
    checks: { outcome: 'running', passed: 3, failed: 0, running: 2, total: 5, failing: [], list: [] },
  }),
})

const installer = task('installer', {
  title: 'Give Download the installer for this computer',
  slug: 'give-download-the-installer',
  phase: 'ready',
  step: null,
  startedAt: ago(70),
  change: change({
    number: 164,
    title: 'Give Download the installer for this computer',
    repository: 'AltharIDE/althar',
    draft: false,
    additions: 96,
    deletions: 31,
    checks: { outcome: 'passed', passed: 5, failed: 0, running: 0, total: 5, failing: [], list: [] },
  }),
})

const mic = task('mic', {
  title: 'Choose the microphone used for dictation',
  slug: 'choose-the-microphone-used-for-dictation',
  phase: 'ready',
  step: null,
  startedAt: ago(120),
  change: change({
    number: 161,
    title: 'Choose the microphone used for dictation',
    repository: 'AltharIDE/althar',
    draft: false,
    additions: 412,
    deletions: 26,
    checks: { outcome: 'passed', passed: 5, failed: 0, running: 0, total: 5, failing: [], list: [] },
  }),
})

const settled = (id: string, title: string, number: number, hours: number) =>
  task(id, {
    title,
    slug: id,
    phase: 'settled',
    state: 'done',
    step: null,
    settledAt: ago(60 * hours),
    change: change({ number, title, repository: 'AltharIDE/althar', state: 'merged', draft: false }),
  })

const TASKS: ReadonlyArray<BoardTask> = [
  scroll,
  keep,
  quick,
  installer,
  mic,
  settled('kind', 'Read a task’s kind from what it has', 159, 3),
  settled('again', 'Let a finished task go back to work and ship again', 157, 9),
  settled('e2e', 'Green main’s e2e again, and Althar 0.2.0', 158, 14),
]

/** A task's title, by its thread. */
export const titleOf = (threadId: string) => TASKS.find((one) => one.threadId === threadId)?.title ?? 'A task'

export const boardOf = () => ({ cursor: 1, tasks: TASKS, calls: [], settledTotal: 41 })

export const homeOf = () =>
  home({
    projects: [althar],
    tasks: TASKS.filter((one) => one.phase !== 'settled').map((one) => ({ ...one, projectId: 'p1' })),
  })

/** What the person sent from a dictation to a thread, at its end. */
const sentItems = (key: string): ReadonlyArray<ThreadItem> =>
  sentTo(key).map((one) => ({ ...items.you(one.text), createdAt: new Date(one.at).toISOString() }))

/* ——— The coordinator's conversation: where the dictation tasks came from. ——— */

export const coordinatorOf = () =>
  coordinatorSnapshot({
    threadId: 'th-coordinator',
    project: { id: 'p1', name: 'althar' },
    items: [
      when(
        items.you(
          'A long dictation runs off the top of the composer, and I can’t read back what I said. And if I click away while I’m talking, everything I said is gone. Can you look at both?',
        ),
        16,
      ),
      when(
        items.says(
          'Made two tasks. One lets a long dictation scroll in the composer, following the newest words until you scroll up to read. The other keeps what you wrote and dictated by its thread, so going elsewhere doesn’t lose it. Both on Claude Code, with Codex reviewing.',
        ),
        15.5,
      ),
      when(items.card(scroll, 'c-scroll'), 15.4),
      when(items.card(keep, 'c-keep'), 15.3),
      ...sentItems('coordinator:p1'),
    ],
  })

/* ——— Each task's thread. ——— */

const tool = (title: string, toolKind: string, path: string | null, minutes: number, slug: string) =>
  when(
    items.tool({
      title,
      toolKind: toolKind as Extract<ThreadItem, { kind: 'tool_call' }>['content']['toolKind'],
      locations: path === null ? [] : [{ path: `${worktreeOf(slug)}/${path}` }],
    }),
    minutes,
  )

const SCROLL_WORK = (slug: string): ReadonlyArray<ThreadItem> => [
  when(
    items.setup({
      repository: 'althar',
      command: 'bun install --frozen-lockfile',
      startedAt: ago(9),
      ended: { at: ago(8.6), code: 0, timedOut: false, stopped: false, last: null },
    }),
    9,
  ),
  tool('Read Composer.tsx', 'read', 'packages/ui/src/composer/Composer/Composer.tsx', 8.4, slug),
  tool('Read Composer.module.css', 'read', 'packages/ui/src/composer/Composer/Composer.module.css', 8.2, slug),
  tool('Read live.ts', 'read', 'apps/desktop/src/renderer/shared/dictation/live.ts', 8, slug),
  when(
    items.says(
      'The words arriving are drawn over the field, and the field holds less than they do, so it’s the overlay that has to scroll. I’ll have it follow the newest words while they come, stop following once you scroll up to read, and follow again when you’re back at the end.',
    ),
    7.6,
  ),
  tool('Edit Composer.tsx', 'edit', 'packages/ui/src/composer/Composer/Composer.tsx', 6, slug),
  tool('Edit Composer.module.css', 'edit', 'packages/ui/src/composer/Composer/Composer.module.css', 5.2, slug),
  tool('Edit ComposerDictation.test.tsx', 'edit', 'packages/ui/tests/ComposerDictation.test.tsx', 4.4, slug),
  when(
    items.tool({
      title: 'bun --filter @althar/ui test -- ComposerDictation',
      toolKind: 'execute',
      command: 'bun --filter @althar/ui test -- ComposerDictation',
      status: 'completed',
      exit: 0,
    }),
    3,
  ),
  when(
    items.says(
      'A long dictation now scrolls in the composer: it follows the newest words, and stops while you read further up. What you read carries over to the field once the words are written down. Shooting the story next.',
    ),
    1.2,
  ),
]

const threadOf = (one: BoardTask, work: ReadonlyArray<ThreadItem>, running: boolean): ThreadSnapshot =>
  snapshot({
    threadId: one.threadId,
    project: { id: 'p1', name: 'althar' },
    host: null,
    task: {
      ...snapshot().task,
      id: one.taskId,
      title: one.title,
      slug: one.slug,
      request: one.title,
      branch: one.branch,
      worktree: worktreeOf(one.slug),
      phase: one.phase,
      steps: STEPS,
      lead: { agentId: 'claude-code', model: 'opus', account: null },
      step: one.step,
      stepAt: one.startedAt,
      startedAt: one.startedAt,
      actions: one.phase === 'running' ? ['stop', 'abandon'] : ['abandon'],
    },
    session: { ...snapshot().session!, model: 'opus', turnRunning: running },
    items: [...work, ...sentItems(`thread:${one.threadId}`)],
  })

export const threadSnapshotOf = (threadId: string): ThreadSnapshot => {
  const one = TASKS.find((candidate) => candidate.threadId === threadId) ?? scroll
  if (one.taskId === 'scroll') return threadOf(one, SCROLL_WORK(one.slug), true)
  const work: ReadonlyArray<ThreadItem> = [
    tool('Read the code it changes', 'read', null, 8, one.slug),
    when(items.says(`Working on it: ${one.title.toLowerCase()}.`), 6),
  ]
  return threadOf(one, work, one.phase === 'running')
}

/* ——— How hard this Mac works: normally, and while it writes down a long dictation with the suites running. ——— */

const GiB = 1024 ** 3

const share = (one: BoardTask, cpu: number, memory: number) => ({
  kind: 'task' as const,
  projectId: 'p1',
  project: 'althar',
  taskId: one.taskId,
  threadId: one.threadId,
  title: one.title,
  agent: { id: 'claude-code', name: 'Claude Code' },
  cpu,
  memory: memory * GiB,
  processes: 9,
})

export const loadOf = (busy: boolean): Load =>
  busy
    ? {
        ...load,
        cpu: 0.94,
        memoryUsed: 26.1 * GiB,
        pressure: 'warning',
        shares: [share(quick, 0.46, 3.1), share(keep, 0.21, 1.9), share(scroll, 0.12, 1.4)],
        history: [...Array.from({ length: 12 }, (_, i) => ({ cpu: 0.5 + i * 0.03, work: 0.4 + i * 0.03 })), { cpu: 0.94, work: 0.79 }],
      }
    : {
        ...load,
        cpu: 0.38,
        shares: [share(quick, 0.18, 2.2), share(keep, 0.08, 1.4), share(scroll, 0.05, 1.1)],
      }
