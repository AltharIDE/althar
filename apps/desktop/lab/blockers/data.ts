import type { BoardCall, BoardSnapshot, BoardTask, ChangeSummary, ProjectSummary, ThreadItem, ThreadSnapshot } from '@althar/contracts'

import type { Client } from '../../src/renderer/data/client'
import {
  card,
  change,
  connectionList,
  coordinatorSnapshot,
  fakeClient,
  githubConnection,
  home,
  items,
  repositories,
  snapshot,
} from '../../tests/fixtures'
import { clock, COORDINATOR, direction, keyOfThread, move, moves, PROJECT, taskIdOf, threadIdOf, worldNow } from './state'
import { answer, answered, askWords, optionsFor, raisedOf, talk, tell } from './talk'
import { asksOf, listed, shortOf, specOf, type TaskNow, unstarted } from './world'

/*
 * What the made-up runtime says, read from the simulation as it stands: the
 * project, its board, each task's thread, and the coordinator's conversation
 * where the day's tasks were set waiting for each other. What the person
 * presses in the app (Start, Hold, Abandon, Reopen, Accept and merge, Try
 * again, an answer) comes back here as a move.
 */

const REPOSITORY = 'althar/althar'
const pullUrl = (number: number) => `https://github.com/${REPOSITORY}/pull/${number}`

/** A minute of the clock, as a time on the wall: the clock's now is the window's now. */
export const at = (minute: number) => new Date(Date.now() - (clock.get() - minute) * 60_000).toISOString()
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

const changeOf = (task: TaskNow): ChangeSummary | null => {
  const spec = specOf(task.key)
  const open = task.phase === 'checks' || task.phase === 'stuck' || task.phase === 'ready' || task.phase === 'merged'
  if (!open && !(task.phase === 'abandoned' && task.startedAt !== null)) return null
  const running = task.phase === 'checks'
  const failed = task.phase === 'stuck'
  const list = ['types', 'unit', spec.breaks ?? 'e2e', 'lint']
  return change({
    number: spec.pr,
    title: spec.title,
    url: pullUrl(spec.pr),
    repository: REPOSITORY,
    state: task.phase === 'merged' ? 'merged' : 'open',
    draft: false,
    checks: {
      outcome: failed ? 'failed' : running ? 'running' : 'passed',
      passed: failed ? 3 : running ? 2 : 4,
      failed: failed ? 1 : 0,
      running: running ? 2 : 0,
      total: 4,
      failing: failed ? [list[2] as string] : [],
      list: list.map((name, i) => ({
        name,
        state: failed && i === 2 ? ('failed' as const) : running && i >= 2 ? ('running' as const) : ('passed' as const),
        summary: null,
      })),
    },
  })
}

type Phase = BoardTask['phase']
const phaseOf = (task: TaskNow): Phase => {
  switch (task.phase) {
    case 'waits':
      return task.held ? 'held' : 'planned'
    case 'starting':
      return 'planned'
    case 'implement':
    case 'review':
    case 'checks':
      return 'running'
    case 'stuck':
      return 'stopped'
    case 'ready':
      return 'ready'
    case 'merged':
    case 'abandoned':
      return 'settled'
  }
}

const reviewerOf = (task: TaskNow) => (specOf(task.key).lead === 'codex' ? 'claude-code' : 'codex')

export const cardOf = (task: TaskNow) => {
  const spec = specOf(task.key)
  const phase = phaseOf(task)
  const startsAt =
    task.phase === 'starting' ? new Date(Date.now() + Math.max(1, (1 - (clock.get() - task.since)) * 20) * 1000).toISOString() : null
  return card({
    taskId: taskIdOf(task.key),
    threadId: threadIdOf(task.key),
    title: spec.title,
    slug: spec.slug,
    phase,
    kind: 'change',
    branch: `althar/${spec.slug}`,
    // Its plan from when it was drafted to when it settles, so a card says the step it's on.
    plan:
      phase !== 'settled'
        ? {
            id: `pln_${task.key}`,
            steps: [
              { key: 'implement', agentId: spec.lead, model: spec.model, skipped: false },
              { key: 'review', agentId: reviewerOf(task), model: null, skipped: false },
            ],
            startsAt,
            reason: null,
            end: null,
          }
        : null,
    change: changeOf(task),
    step: task.phase === 'implement' ? 'implement' : phase === 'running' ? 'review' : null,
    summary: null,
    lead: spec.lead,
    leadModel: spec.model,
    startedAt: task.startedAt === null ? null : at(task.startedAt),
    ...(task.phase === 'stuck' ? { stopped: { by: 'althar' as const, at: at(task.since) } } : {}),
  })
}

const boardTaskOf = (task: TaskNow): BoardTask => ({
  ...cardOf(task),
  state: task.phase === 'merged' ? 'merged' : task.phase === 'abandoned' ? 'abandoned' : 'open',
  createdAt: at(-60),
  settledAt: task.phase === 'merged' ? at(task.mergedAt ?? 0) : task.phase === 'abandoned' ? at(task.abandonedAt ?? 0) : null,
  changed: null,
  here: [],
})

/* What else the project holds, so the board reads like a day's work. */
const other = (
  slug: string,
  title: string,
  phase: 'running' | 'settled',
  lead: 'claude-code' | 'codex',
  minutes: number,
  pr?: number,
): BoardTask => ({
  ...card({
    taskId: `t_${slug}`,
    threadId: `th_${slug}`,
    title,
    slug,
    phase,
    kind: 'change',
    plan: null,
    lead,
    branch: `althar/${slug}`,
    ...(phase === 'running' ? { step: 'implement' as const, startedAt: minutesAgo(minutes) } : {}),
    ...(pr === undefined
      ? {}
      : {
          change: change({
            number: pr,
            title,
            state: phase === 'settled' ? 'merged' : 'open',
            draft: false,
            url: pullUrl(pr),
            repository: REPOSITORY,
          }),
        }),
  }),
  state: phase === 'settled' ? 'merged' : 'open',
  createdAt: minutesAgo(minutes + 30),
  settledAt: phase === 'settled' ? minutesAgo(minutes) : null,
  changed: null,
  here: [],
})

const OTHERS: ReadonlyArray<BoardTask> = [
  other('virtualize-the-thread-view', 'Virtualize the thread view', 'running', 'claude-code', 34),
  other('errand-lines-plain-words', 'Errand lines on hold read in plain words', 'settled', 'claude-code', 140, 966),
  other('small-change-team', 'A small change’s card lets you pick its team', 'settled', 'claude-code', 260, 961),
]

const projectSummary = (): ProjectSummary => {
  const world = worldNow()
  const running = world.tasks.filter((one) => phaseOf(one) === 'running').length + 1
  return {
    id: PROJECT,
    name: 'althar',
    slug: 'althar',
    ink: 'teal',
    lastWorkAt: minutesAgo(1),
    repository: '/Users/balazs/Code/althar',
    repositories: ['althar'],
    worktrees: '/Users/balazs/Charrette/althar',
    tasks: world.tasks.length + OTHERS.length,
    running,
    yours: world.tasks.filter((one) => one.phase === 'ready').length,
    working: running,
    usageLimit: 'move',
    rotateAccounts: false,
    onlyAccounts: null,
    coordinatorThreadId: COORDINATOR,
  }
}

/** The coordinator's question for each abandoned blocker something waits on (C), as a call in Needs you. */
const questionCalls = (): ReadonlyArray<BoardCall> => {
  if (direction.get() !== 'c') return []
  const world = worldNow()
  return asksOf(world).map((ask) => {
    const raised = raisedOf(moves.get()).findLast((one) => one.blocker === ask.blocker.key)
    return {
      id: raised?.id ?? `ask_${ask.blocker.key}`,
      kind: 'question',
      title: `${shortOf(ask.blocker.key)} was abandoned. What should ${listed(ask.waiting.map((one) => shortOf(one.key)))} do?`,
      reason: '',
      command: null,
      stuck: null,
      question: {
        message: askWords(world, ask.blocker.key, ask.waiting),
        why: askWords(world, ask.blocker.key, ask.waiting).split(' I’d ')[1]?.replace(/^/, 'I’d ') ?? '',
        fields: ask.waiting.map((dep) => ({
          id: dep.key,
          question: `What should ${shortOf(dep.key)} do?`,
          type: 'choice' as const,
          options: optionsFor(world, ask.blocker.key, dep).map((one) => ({
            value: one.value,
            label: one.label,
            ...(one.note === undefined ? {} : { note: one.note }),
          })),
          multiple: false,
          wordsField: `${dep.key}_words`,
          required: false,
        })),
      },
      createdAt: at(ask.at),
      taskId: null,
      threadId: COORDINATOR,
      taskTitle: null,
      taskSlug: null,
    } as unknown as BoardCall
  })
}

export const boardNow = (): BoardSnapshot => {
  const world = worldNow()
  // Under its blocker (B), an abandoned task something waits on keeps its card in Needs you, drawn by the lab: not in Settled.
  const asked = new Set(direction.get() === 'b' ? asksOf(world).map((one) => one.blocker.key) : [])
  const tasks = world.tasks.filter((one) => !asked.has(one.key))
  return {
    cursor: 3,
    tasks: [...tasks.map(boardTaskOf), ...OTHERS],
    calls: [...questionCalls()],
    settledTotal: tasks.filter((one) => one.phase === 'merged' || one.phase === 'abandoned').length + 2,
  }
}

/* ——— threads ——— */

let sequence = 0
const placed = (item: ThreadItem, id: string, minute: number): ThreadItem => {
  sequence += 1
  return { ...item, id, sequence, createdAt: at(minute) } as ThreadItem
}
const you = (text: string, id: string, minute: number) => placed(items.you(text), id, minute)
const says = (text: string, id: string, minute: number, agentId = 'claude-code') => placed(items.says(text, agentId), id, minute)
/** Althar's own line in the thread: a notice from the runtime. */
const althar = (text: string, id: string, minute: number) =>
  placed(items.notice({ title: text, source: 'runtime', severity: 'info' }, null), id, minute)

/** What the lead says as it starts: what it read of what it waited for, and the person's word. */
const opening = (task: TaskNow): string => {
  const after = task.blockers.filter((one) => worldNow().byKey.get(one)?.phase === 'merged')
  const read =
    after.length === 0
      ? ''
      : ` I’ve read what ${listed(after.map(shortOf))} built (${listed(after.map((one) => `#${specOf(one).pr}`))}): ${after.map((one) => specOf(one).built.charAt(0).toLowerCase() + specOf(one).built.slice(1)).join(' ')}`
  const word = task.word === null ? '' : ' I’ll do as you said.'
  const without = task.without.length === 0 ? '' : ` I’ll go without ${listed(task.without.map(shortOf))}.`
  return `On it.${read}${without}${word} I’ll open the pull request once it’s reviewed.`
}

const taskItems = (task: TaskNow): ReadonlyArray<ThreadItem> => {
  const spec = specOf(task.key)
  const id = threadIdOf(task.key)
  sequence = 0
  const out: ThreadItem[] = [you(`${spec.title}. ${spec.brief}`, `${id}_you`, spec.begun?.startedAt ?? -60)]
  if (task.startedAt !== null && spec.begun === undefined) {
    const after = task.blockers.filter((one) => worldNow().byKey.get(one)?.phase === 'merged')
    if (task.started === 'blockers')
      out.push(
        althar(
          `${listed(after.map((one) => `${shortOf(one)} merged as #${specOf(one).pr}`))}, so this started.`,
          `${id}_started`,
          task.startedAt - 0.02,
        ),
      )
    if (task.started === 'you' && task.without.length > 0)
      out.push(althar(`Started without ${listed(task.without.map(shortOf))}, which was abandoned.`, `${id}_started`, task.startedAt - 0.02))
    if (task.word !== null) out.push(you(task.word, `${id}_word`, task.startedAt - 0.01))
    out.push(says(opening(task), `${id}_says`, task.startedAt, spec.lead))
  }
  if (task.phase === 'stuck')
    out.push(althar(`Stuck: ${spec.breaks ?? 'a check'} failed twice, and its lead couldn’t fix it.`, `${id}_stuck`, task.since))
  return out
}

const threadOf = (threadId: string): ThreadSnapshot => {
  const key = keyOfThread(threadId)
  const task = key === null ? undefined : worldNow().byKey.get(key)
  if (task === undefined) return snapshot({ threadId, project: { id: PROJECT, name: 'althar' } })
  const spec = specOf(task.key)
  const base = snapshot()
  const phase = phaseOf(task)
  const one = changeOf(task)
  return snapshot({
    threadId,
    project: { id: PROJECT, name: 'althar' },
    task: {
      ...base.task,
      id: taskIdOf(task.key),
      title: spec.title,
      slug: spec.slug,
      branch: `althar/${spec.slug}`,
      worktree: `/Users/balazs/Charrette/althar/${spec.slug}/althar`,
      phase,
      state: task.phase === 'merged' || task.phase === 'abandoned' ? 'settled' : 'active',
      step: phase === 'running' ? (task.phase === 'implement' ? 'implement' : 'review') : null,
      stepAt: at(task.since),
      startedAt: task.startedAt === null ? null : at(task.startedAt),
      settledAt: task.phase === 'merged' ? at(task.mergedAt ?? 0) : task.phase === 'abandoned' ? at(task.abandonedAt ?? 0) : null,
      changes: one === null ? [] : [one],
      steps: [
        { key: 'implement', agentId: spec.lead, model: spec.model, skipped: false },
        { key: 'review', agentId: reviewerOf(task), model: null, skipped: false },
      ],
      lead: { agentId: spec.lead, model: spec.model, account: null },
      actions: task.phase === 'merged' ? [] : task.phase === 'abandoned' ? ['reopen'] : ['stop', 'abandon'],
      ...(task.phase === 'stuck' ? { stopped: { by: 'althar' as const, at: at(task.since) } } : {}),
      ...(task.phase === 'abandoned' ? { state: 'abandoned' } : {}),
    } as ThreadSnapshot['task'],
    // No lead before it starts: nothing reads its brief yet.
    session: unstarted(task)
      ? null
      : {
          ...(base.session as NonNullable<ThreadSnapshot['session']>),
          agentId: spec.lead,
          agentName: spec.lead === 'codex' ? 'Codex' : 'Claude Code',
          model: spec.model,
          turnRunning: phase === 'running',
          held: false,
          state: 'active',
        },
    items: taskItems(task),
  })
}

/* ——— the coordinator's conversation ——— */

const START = -62

/** The cards the coordinator's answer holds: the tasks it set waiting, and the one held. */
const SET = ['pair', 'ssh', 'hosts', 'guide', 'reconnect']

const coordinatorItems = (): ReadonlyArray<ThreadItem> => {
  sequence = 0
  const world = worldNow()
  const out: ThreadItem[] = [
    you(
      'Let’s go on with Althar Cloud’s first slice; the host service and sealing are under way. Pairing after the host service, SSH setup once the host service and sealing are both in, the Hosts screen after pairing, and the guide last. Hold Reconnect for now.',
      'c_you',
      START,
    ),
    says(
      'Done. Each starts by itself once what it waits for has merged, and I’ll ask you if one of those is abandoned. Reconnect is held until you start it.',
      'c_says',
      START + 0.5,
    ),
    ...SET.map((key, i) => placed(items.card(cardOf(world.byKey.get(key) as TaskNow)), `c_card_${key}`, START + 0.6 + i * 0.01)),
  ]
  const asks = direction.get() === 'c' ? raisedOf(moves.get()) : []
  // What was said by now: scrubbed back before it, it hasn't been yet.
  const said = talk.get().filter((one) => one.at <= clock.get())
  const events = [
    ...said.map((one, i) => ({ at: one.at, i, kind: 'talk' as const })),
    ...asks.map((one, i) => ({ at: one.at, i, kind: 'ask' as const })),
  ].toSorted((a, b) => a.at - b.at)
  const open = new Set(asksOf(world).map((one) => one.blocker.key))
  for (const event of events) {
    if (event.kind === 'talk') {
      const one = said[event.i] as (typeof said)[number]
      out.push(you(one.you, `c_t${event.i}_you`, one.at), says(one.answer, `c_t${event.i}_says`, one.at + 0.3))
      continue
    }
    const raised = asks[event.i] as (typeof asks)[number]
    const done = answered.get().get(raised.id)
    out.push(says(askWords(raised.world, raised.blocker, raised.waiting), `${raised.id}_says`, raised.at + 0.1))
    out.push(
      placed(
        items.question({
          attentionId: raised.id,
          message: `What should ${listed(raised.waiting.map((one) => shortOf(one.key)))} do?`,
          fields: raised.waiting.map((dep) => ({
            id: dep.key,
            question: raised.waiting.length === 1 ? 'What should it do?' : `${shortOf(dep.key)}`,
            type: 'choice' as const,
            options: optionsFor(raised.world, raised.blocker, dep).map((one) => ({
              value: one.value,
              label: one.label,
              ...(one.note === undefined ? {} : { note: one.note }),
            })),
            multiple: false,
            wordsField: `${dep.key}_words`,
            required: false,
          })),
          state: done !== undefined ? 'answered' : open.has(raised.blocker) ? 'open' : 'withdrawn',
          answers: done?.answers ?? null,
          withdrawn: done === undefined && !open.has(raised.blocker) ? 'Settled from the board' : null,
        } as Parameters<typeof items.question>[0]),
        `${raised.id}_q`,
        raised.at + 0.11,
      ),
    )
  }
  return out
}

export const makeClient = () =>
  fakeClient({
    listProjects: async () => ({ cursor: 3, projects: [projectSummary()] }),
    openProject: async () => projectSummary(),
    getHome: async () =>
      home({
        looked: minutesAgo(180),
        since: minutesAgo(180),
        projects: [projectSummary()],
        tasks: boardNow()
          .tasks.filter((task) => task.phase !== 'settled')
          .map((task) => ({ ...task, projectId: PROJECT })),
        calls: boardNow().calls.map((call) => ({ ...call, projectId: PROJECT })),
      }),
    getBoard: async () => boardNow(),
    getCoordinator: async () => {
      const base = snapshot().session as NonNullable<ThreadSnapshot['session']>
      return coordinatorSnapshot({
        threadId: COORDINATOR,
        project: { id: PROJECT, name: 'althar' },
        host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
        session: { ...base, model: 'claude-opus-5-5', turnRunning: false, turnStartedAt: null, held: false },
        items: [...coordinatorItems()],
      })
    },
    getThread: async (threadId: string) => threadOf(threadId),
    getThreadItem: async (threadId: string, itemId: string) => {
      const found = threadId === COORDINATOR ? coordinatorItems() : threadOf(threadId).items
      return found.find((one) => one.id === itemId) ?? null
    },
    // As a runtime would, a moment after: the window puts up its own copy of what was sent first, then takes the stored one.
    send: async (input: { threadId: string; body: string }) => {
      if (input.threadId === COORDINATOR) setTimeout(() => tell(input.body), 400)
    },
    answerQuestion: async (input: {
      attentionId: string
      answers: Readonly<Record<string, { values: ReadonlyArray<string>; words?: string }>>
    }) => answer(input.attentionId, input.answers),
    startPlan: async (planId: string) => move({ kind: 'start', key: planId.replace(/^pln_/, '') }),
    holdPlan: async (planId: string) => {
      move({ kind: 'hold', key: planId.replace(/^pln_/, '') })
      return true
    },
    abandonTask: async (taskId: string) => move({ kind: 'abandon', key: taskId.replace(/^t_/, '') }),
    reopenTask: async (taskId: string) => move({ kind: 'reopen', key: taskId.replace(/^t_/, '') }),
    merge: async (taskId: string) => move({ kind: 'merge', key: taskId.replace(/^t_/, '') }),
    tryAgain: async (threadId: string) => {
      const key = keyOfThread(threadId)
      if (key !== null) move({ kind: 'retry', key })
    },
    resumeTask: async (input: { taskId: string }) => move({ kind: 'retry', key: input.taskId.replace(/^t_/, '') }),
    getRepositories: async () => repositories.slice(0, 1).map((one) => ({ ...one, name: 'althar', path: '/Users/balazs/Code/althar' })),
    listConnections: async () => ({ ...connectionList, connections: [githubConnection] }),
  } as unknown as Partial<Client>)

/** The tabs the window keeps at every load: the project's, on its board and conversation side by side. */
export const TABS = { open: [PROJECT], places: {}, rooms: { [PROJECT]: 'both' } }
