// Scrappy: what the fake runtime answers: the board, and each task's thread.
import { card, snapshot } from '../../../../apps/desktop/tests/fixtures'
import { boardTasks, minutes, TASKS } from './data'
import type { ThreadItem, ThreadSnapshot } from './deps'
import { threads } from './threads'

export const boardOf = () => {
  return { cursor: 1, tasks: boardTasks(), calls: [], settledTotal: 41 }
}

/** The task part of a thread's snapshot, from its card. */
const taskOf = (content: ReturnType<typeof card>, over: Partial<ThreadSnapshot['task']> = {}): ThreadSnapshot['task'] =>
  ({
    ...snapshot().task!,
    id: content.taskId,
    title: content.title,
    slug: content.slug,
    phase: content.phase,
    branch: content.branch,
    worktree: `/Users/balazs/Althar/althar/${content.slug}`,
    startedAt: content.startedAt,
    changes: content.change === null ? [] : [content.change],
    steps: content.plan?.steps ?? [],
    step: content.step,
    stepAt: content.startedAt,
    lead: { agentId: content.lead ?? 'claude-code', model: content.leadModel, account: null },
    issue: content.issue === null ? null : ({ ...content.issue, state: 'In Progress' } as never),
    ...(content.local === true ? { local: true } : {}),
    ...(content.toward === undefined ? {} : { toward: content.toward }),
    ...over,
  }) as unknown as ThreadSnapshot['task']

const session = (model: string, running: boolean) => ({
  ...snapshot().session!,
  model,
  models: ['claude-opus-5-5', 'claude-sonnet-5-5'],
  turnRunning: running,
  turnStartedAt: running ? minutes(1) : null,
  turnEndedAt: running ? null : minutes(2),
})

const CARDS: Record<string, () => ReturnType<typeof card>> = {
  'th-adr': TASKS.adr,
  'th-codex-net': TASKS.child,
  'th-small': TASKS.small,
  'th-typo': TASKS.typo,
  'th-command': TASKS.command,
  'th-runs': TASKS.runs,
  'th-flatpak': TASKS.flatpak,
  'th-design': TASKS.design,
  'th-review': TASKS.review,
}

export const threadOf = (threadId: string): ThreadSnapshot => {
  const content = CARDS[threadId]?.() ?? TASKS.adr()
  const own = threads[threadId]?.() ?? { items: [] as ThreadItem[] }
  return snapshot({
    threadId,
    project: { id: 'p1', name: 'althar' },
    task: taskOf(content, own.task),
    // Only the child's lead is mid-turn; the others ended theirs, so their last words show.
    session: session(content.leadModel ?? 'claude-opus-5-5', threadId === 'th-codex-net'),
    items: own.items,
    attention: own.attention ?? [],
  })
}
