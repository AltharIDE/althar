// Scrappy: what the fake runtime answers: the board with what was started on the page, and each task's thread.
import { card, snapshot } from '../../../../apps/desktop/tests/fixtures'
import { boardTasks, minutes, TASKS } from './data'
import type { BoardTask, ThreadItem, ThreadSnapshot } from './deps'
import { proto, type Started } from './state'
import { threads } from './threads'

/** A task started on the page, as its card stands a moment later: under way on the model asked for. */
export const startedCard = (one: Started): BoardTask =>
  ({
    ...card({
      taskId: one.id,
      threadId: `th-${one.id}`,
      title: one.title,
      slug: one.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      phase: 'running',
      step: 'implement',
      lead: 'claude-code',
      leadModel: one.modelId,
      leadEffort: one.small ? 'low' : 'high',
      plan: {
        id: `pln-${one.id}`,
        steps: [
          { key: 'implement', agentId: 'claude-code', model: one.modelId, skipped: false },
          ...(one.review ? [{ key: 'review' as const, agentId: 'codex', model: 'gpt-6.1-sol', skipped: false }] : []),
        ],
        startsAt: null,
        reason: null,
        end: null,
        ...(one.toward === null ? {} : { toward: one.toward }),
        worksIn: one.worksIn,
      },
      issue:
        one.issue === null
          ? null
          : { product: 'linear', key: one.issue, title: one.title, url: `https://linear.app/althar/issue/${one.issue}` },
      branch: `althar/${one.issue === null ? '' : `${one.issue.toLowerCase()}-`}${one.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 40)}`,
      startedAt: new Date(one.at).toISOString(),
      ...(one.worksIn === 'checkout' ? { local: true } : {}),
      ...(one.toward === null ? {} : { toward: one.toward }),
    }),
    state: 'open',
    createdAt: new Date(one.at).toISOString(),
    settledAt: null,
    changed: null,
    here: [],
  }) as unknown as BoardTask

export const boardOf = () => {
  const p = proto.get()
  const tasks = [...p.started.map(startedCard), ...boardTasks()]
  return { cursor: 1, tasks, calls: [], settledTotal: 41 }
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
  'th-command': TASKS.command,
  'th-runs': TASKS.runs,
  'th-flatpak': TASKS.flatpak,
  'th-design': TASKS.design,
  'th-review': TASKS.review,
}

export const threadOf = (threadId: string): ThreadSnapshot => {
  const made = proto.get().started.find((one) => `th-${one.id}` === threadId)
  const content = made !== undefined ? (startedCard(made) as unknown as ReturnType<typeof card>) : (CARDS[threadId]?.() ?? TASKS.adr())
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
