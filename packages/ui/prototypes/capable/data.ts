// Scrappy: althar on the afternoon of 6 November, as the runtime would give it: a busy board and a lead-started task.
import { card, change, items } from '../../../../apps/desktop/tests/fixtures'
import type { BoardTask, ThreadItem } from './deps'
import { proto } from './state'

export const minutes = (n: number) => new Date(Date.now() - n * 60_000).toISOString()
export const at = (item: ThreadItem, ago: number): ThreadItem => ({ ...item, createdAt: minutes(ago) })

type Card = ReturnType<typeof card>

const opus = { lead: 'claude-code', leadModel: 'claude-opus-5-5', leadEffort: 'xhigh' } as const
const sonnet = { lead: 'claude-code', leadModel: 'claude-sonnet-5-5', leadEffort: 'medium' } as const
const steps = [
  { key: 'implement' as const, agentId: 'claude-code', model: 'claude-opus-5-5', skipped: false },
  { key: 'review' as const, agentId: 'codex', model: 'gpt-6.1-sol', skipped: false },
]
const noReview = [{ key: 'implement' as const, agentId: 'claude-code', model: 'claude-sonnet-5-5', skipped: false }]

const pr = (number: number, title: string, over: Partial<ReturnType<typeof change>> = {}) =>
  change({
    number,
    title,
    url: `https://github.com/AltharIDE/althar/pull/${number}`,
    repository: 'AltharIDE/althar',
    draft: false,
    checks: { outcome: 'passed', passed: 6, failed: 0, running: 0, total: 6, failing: [], list: [] },
    ...over,
  })

/** The task a lead started, and the one whose lead started it. */
export const PARENT = {
  taskId: 'tk-adr',
  threadId: 'th-adr',
  title: 'ADR: agents work as the person’s own',
  slug: 'adr-agents-work-as-the-person-s-own',
} as const
export const CHILD = {
  taskId: 'tk-codex-net',
  threadId: 'th-codex-net',
  title: 'Codex leads reach the network in their shell',
  slug: 'codex-leads-reach-the-network-in-their-shell',
} as const

export const TASKS = {
  adr: (): Card =>
    card({
      ...PARENT,
      ...opus,
      phase: 'running',
      step: 'implement',
      plan: { id: 'pln-adr', steps, startsAt: null, reason: null, end: null },
      branch: 'althar/adr-agents-work-as-the-person-s-own',
      startedAt: minutes(48),
      summary: 'Rewriting ADR-013, ADR-067 and ADR-088 around the irreversible list.',
    }),
  child: (): Card =>
    card({
      ...CHILD,
      ...sonnet,
      phase: 'running',
      step: 'implement',
      plan: { id: 'pln-codex-net', steps: noReview, startsAt: null, reason: null, end: null },
      branch: 'althar/codex-leads-reach-the-network-in-their-shell',
      startedAt: minutes(3),
    }),
  small: (): Card =>
    card({
      taskId: 'tk-small',
      threadId: 'th-small',
      title: 'Small changes finish in minutes, not 40',
      slug: 'small-changes-finish-in-minutes-not-40',
      ...opus,
      phase: 'running',
      step: 'review',
      plan: { id: 'pln-small', steps, startsAt: null, reason: null, end: null },
      branch: 'althar/small-changes-finish-in-minutes-not-40',
      startedAt: minutes(95),
      change: pr(637, 'Small changes finish in minutes, not 40', {
        checks: { outcome: 'running', passed: 3, failed: 0, running: 3, total: 6, failing: [], list: [] },
      }),
    }),
  /** A sketch: a one-line fix on the fast lane, started a few minutes ago. */
  typo: (): Card =>
    card({
      taskId: 'tk-typo',
      threadId: 'th-typo',
      title: 'Run menu says “Strat”',
      slug: 'run-menu-says-strat',
      ...sonnet,
      phase: 'running',
      step: 'implement',
      plan: { id: 'pln-typo', steps: noReview, startsAt: null, reason: null, end: null },
      branch: 'althar/run-menu-says-strat',
      startedAt: minutes(4),
    }),
  command: (): Card =>
    card({
      taskId: 'tk-command',
      threadId: 'th-command',
      title: 'A command’s card in the thread reads cleanly',
      slug: 'a-command-s-card-in-the-thread-reads-cleanly',
      ...opus,
      phase: 'ready',
      step: null,
      plan: { id: 'pln-command', steps, startsAt: null, reason: null, end: null },
      branch: 'althar/a-command-s-card-in-the-thread-reads-cleanly',
      startedAt: minutes(140),
      change: pr(636, 'A command’s card in the thread reads cleanly', {
        checks: { outcome: 'failed', passed: 5, failed: 1, running: 0, total: 6, failing: ['desktop / e2e (2)'], list: [] },
      }),
      checksBack: 'desktop / e2e (2) fails on main too: handed.spec.ts times out on the Windows runner.',
    }),
  runs: (): Card =>
    card({
      taskId: 'tk-runs',
      threadId: 'th-runs',
      title: 'Runs show in the pill over the composer again',
      slug: 'runs-show-in-the-pill-over-the-composer-again',
      ...opus,
      phase: 'ready',
      step: null,
      plan: { id: 'pln-runs', steps, startsAt: null, reason: null, end: null },
      branch: 'althar/runs-show-in-the-pill-over-the-composer-again',
      startedAt: minutes(210),
      change: pr(635, 'Runs show in the pill over the composer again'),
      summary: 'The pill over the composer lists the task’s runs again, with where each answers.',
    }),
  design: (): Card =>
    card({
      taskId: 'tk-design',
      threadId: 'th-design',
      title: 'Design review of #612, the welcome tour',
      slug: 'design-review-of-612-the-welcome-tour',
      kind: 'plain',
      ...opus,
      phase: 'running',
      step: 'implement',
      plan: {
        id: 'pln-design',
        steps: [{ key: 'implement' as const, agentId: 'claude-code', model: 'claude-opus-5-5', skipped: false }],
        startsAt: null,
        reason: null,
        end: null,
      },
      branch: null,
      startedAt: minutes(12),
    }),
  review: (): Card =>
    card({
      taskId: 'tk-review',
      threadId: 'th-review',
      title: 'Review #641 by ninemate: tray icon on KDE',
      slug: 'review-641-by-ninemate-tray-icon-on-kde',
      kind: 'plain',
      ...opus,
      phase: 'running',
      step: 'implement',
      plan: {
        id: 'pln-review',
        steps: [{ key: 'implement' as const, agentId: 'claude-code', model: 'claude-opus-5-5', skipped: false }],
        startsAt: null,
        reason: null,
        end: null,
      },
      branch: null,
      startedAt: minutes(6),
    }),
  flatpak: (): Card =>
    card({
      taskId: 'tk-flatpak',
      threadId: 'th-flatpak',
      title: 'Flatpak: git over SSH',
      slug: 'flatpak-git-over-ssh',
      ...opus,
      phase: 'settled',
      step: null,
      plan: null,
      branch: 'althar/flatpak-git-over-ssh',
      startedAt: minutes(900),
      change: pr(337, 'Flatpak: git over SSH', { state: 'merged' }),
    }),
}

const boardTask = (content: Card, ago: number, over: Partial<BoardTask> = {}): BoardTask =>
  ({
    ...content,
    state: content.phase === 'settled' ? 'settled' : 'open',
    createdAt: minutes(ago),
    settledAt: content.phase === 'settled' ? minutes(ago - 60) : null,
    changed: null,
    here: [],
    ...over,
  }) as unknown as BoardTask

/** The board as it stands before anything is started on the page. */
export const boardTasks = (): BoardTask[] => [
  boardTask(TASKS.child(), 3),
  boardTask(TASKS.review(), 6),
  boardTask(TASKS.design(), 12),
  boardTask(TASKS.adr(), 50),
  boardTask(TASKS.small(), 96),
  boardTask(TASKS.command(), 142),
  boardTask(TASKS.runs(), 212),
  boardTask(TASKS.flatpak(), 900),
]

/** The coordinator's conversation today: short, as it is optional now. */
export const coordinatorTalk = (): ThreadItem[] => [
  at(items.you('Plan the ADR for agents working as my own. Opus 5.5, xhigh.'), 52),
  at(items.says('Planned **ADR: agents work as the person’s own** on Opus 5.5 at xhigh, reviewed by GPT-6.1 Sol.'), 51),
  at(items.card(TASKS.adr(), 'card-adr'), 51),
  ...(proto.get().surface === 'sketches'
    ? [
        at(items.notice({ title: '§capable-now', source: 'runtime' }, null), 1),
        at(items.notice({ title: '§away', source: 'runtime' }, null), 0),
      ]
    : []),
  ...(proto.get().surface === 'tune' ? tuning() : []),
]

/** Surface 6: the person asks for two settings, which the coordinator changes; later, news wakes it, and what it proposes loosens what asks. */
const tuning = (): ThreadItem[] => [
  at(items.you('New tasks should each get a worktree, and work toward next until 0.9 is out.'), 9),
  at(items.says('Done. Tasks already running keep theirs.'), 8),
  at(items.notice({ title: '§tune-changes', source: 'runtime' }, null), 8),
  at(items.notice({ title: 'DEV-201 and DEV-203 are waiting on you to merge', source: 'runtime' }, null), 3),
  at(
    items.says('Both have passed their checks and their reviews found nothing. That’s the fourth and fifth today waiting only on a merge.'),
    2,
  ),
  at(items.notice({ title: '§tune-loosen', source: 'runtime' }, null), 2),
]
