import type {
  BoardSnapshot,
  CoordinatorSnapshot,
  FileDiff,
  FoundTasks,
  HomeSnapshot,
  HomeTask,
  TaskSummary,
  ThreadSnapshot,
  WatchEvent,
} from '@althar/contracts'

import type { AltharClient, Connection, PairedMac, Unsubscribe } from '../AltharClient'
import { ago, ahead, call, file, say, slugOf, task, thread } from './builders'
import { scenario, type Scenario } from './scenario'

/*
 * Althar without a Mac: the demo's afternoon, kept in memory, changing as
 * the runtime would when the person answers. With `live`, the lead of the
 * running backfill streams what it says, and a new permission arrives a
 * little later, so the screens can be seen moving.
 */

export const DEMO_MAC: PairedMac = {
  name: 'Sam’s MacBook Pro',
  pairedAt: '2026-10-20T09:12:00.000Z',
  words: ['harbor', 'velvet', 'quarry', 'lantern'],
}

export type DemoOptions = {
  readonly now?: () => number
  /** Stream text and bring new calls in on timers. */
  readonly live?: boolean
  /** How the phone stands with the Mac, to show each state. */
  readonly connection?: Connection['state']
  /** Answers resolve after this long, as a round trip through the relay would. */
  readonly latency?: number
}

const STREAM = [
  'March’s dry run matches the ledger on 3,870 invoices.',
  'March’s dry run matches the ledger on 3,870 invoices. Two invoices have a refund recorded before the charge;',
  'March’s dry run matches the ledger on 3,870 invoices. Two invoices have a refund recorded before the charge; I’m treating the refund’s date as the charge’s for the total, and listing both in the report.',
]

export class DemoClient implements AltharClient {
  private readonly now: () => number
  private readonly state: Scenario
  private readonly latency: number
  private readonly listeners = new Set<(event: WatchEvent) => void>()
  private readonly connectionListeners = new Set<(connection: Connection) => void>()
  private current: Connection
  private cursor = 1
  private readonly timers: Array<ReturnType<typeof setTimeout>> = []

  constructor(options: DemoOptions = {}) {
    this.now = options.now ?? Date.now
    this.state = scenario(this.now())
    this.latency = options.latency ?? 250
    const wanted = options.connection ?? 'online'
    this.current =
      wanted === 'unpaired'
        ? { state: 'unpaired' }
        : wanted === 'away'
          ? { state: 'away', mac: DEMO_MAC, lastSeen: ago(this.now(), 7) }
          : wanted === 'outdated'
            ? { state: 'outdated', mac: DEMO_MAC, ours: 1, theirs: 2 }
            : { state: wanted, mac: DEMO_MAC }
    if (options.live === true) this.goLive()
  }

  /** Stops the demo's timers. */
  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer)
  }

  connection(): Connection {
    return this.current
  }

  onConnection(listener: (connection: Connection) => void): Unsubscribe {
    this.connectionListeners.add(listener)
    return () => this.connectionListeners.delete(listener)
  }

  /** Pairs, as scanning the Mac's code would: reaching it first, then online. */
  pair(_code: string): Promise<PairedMac> {
    this.setConnection({ state: 'connecting', mac: DEMO_MAC })
    return new Promise((resolve) => {
      this.timers.push(
        setTimeout(() => {
          this.setConnection({ state: 'online', mac: DEMO_MAC })
          resolve(DEMO_MAC)
        }, 900),
      )
    })
  }

  async unpair(): Promise<void> {
    this.setConnection({ state: 'unpaired' })
  }

  async home(): Promise<HomeSnapshot> {
    await this.wait()
    return {
      cursor: this.cursor,
      looked: this.state.looked,
      since: this.state.looked,
      tasks: [...this.state.tasks],
      calls: [...this.state.calls],
      events: [...this.state.events],
      projects: this.state.projects.map((project) => {
        const tasks = this.state.tasks.filter((one) => one.projectId === project.id)
        return {
          ...project,
          tasks: tasks.length,
          running: tasks.filter((one) => one.phase === 'running').length,
          working: tasks.filter((one) => one.phase === 'running' || one.phase === 'held').length,
          ready: tasks.filter((one) => one.phase === 'ready').length,
          waiting: this.state.calls.filter((one) => one.projectId === project.id).length,
        }
      }),
    }
  }

  async board(projectId: string): Promise<BoardSnapshot> {
    await this.wait()
    const tasks = this.state.tasks.filter((one) => one.projectId === projectId)
    return {
      cursor: this.cursor,
      tasks,
      calls: this.state.calls.filter((one) => one.projectId === projectId),
      settledTotal: tasks.filter((one) => one.phase === 'settled').length + 41,
    }
  }

  async coordinator(projectId: string): Promise<CoordinatorSnapshot> {
    await this.wait()
    const project = this.state.projects.find((one) => one.id === projectId)
    if (project === undefined) throw new Error(`No project ${projectId}`)
    const threadId = project.coordinatorThreadId ?? `thr_coord_${projectId}`
    // A task's card is posted once and kept current: shown as it stands now.
    const items = (this.state.coordinators.get(threadId) ?? []).map((one) => {
      if (one.kind !== 'task') return one
      const now = this.state.tasks.find((card) => card.taskId === one.content.taskId)
      return now === undefined ? one : { ...one, content: now }
    })
    return {
      threadId,
      cursor: this.cursor,
      project: { id: project.id, name: project.name },
      session: null,
      suggested: { agentId: 'claude-code', agentName: 'Claude Code', model: 'claude-opus-5', effort: null, available: true },
      items,
      earlier: false,
      host: { product: 'github', name: 'GitHub', webUrl: 'https://github.com', connected: true },
      runnables: [],
      launches: [],
    }
  }

  async thread(threadId: string): Promise<ThreadSnapshot> {
    await this.wait()
    const found = this.state.threads.get(threadId)
    if (found === undefined) throw new Error(`No thread ${threadId}`)
    const card = this.state.tasks.find((one) => one.threadId === threadId)
    return card === undefined
      ? found
      : {
          ...found,
          task: {
            ...found.task,
            phase: card.phase,
            step: card.step,
            changes: card.change === null ? [] : [card.change],
            actions:
              card.phase === 'running' || card.phase === 'waiting'
                ? ['stop', 'abandon']
                : card.phase === 'stopped'
                  ? ['resume', 'abandon']
                  : ['abandon'],
          },
          attention: found.attention.filter((one) => this.state.calls.some((open) => open.id === one.id)),
        }
  }

  async fileDiff(taskId: string, path: string): Promise<FileDiff> {
    await this.wait()
    const found = this.state.diffs.get(`${taskId}:${path}`)
    if (found !== undefined) return found
    const changed = [...this.state.threads.values()].find((one) => one.task.id === taskId)?.task.files.find((one) => one.path === path)
    return {
      file: changed ?? file(path, 0, 0),
      lines: [
        { kind: 'hunk', text: '@@ -1,3 +1,4 @@' },
        { kind: 'context', old: 1, new: 1, text: '// The demo keeps two whole diffs; this file’s is a sketch.' },
        { kind: 'added', new: 2, text: `export const changed = '${path}'` },
      ],
      truncated: false,
    }
  }

  /** Finds by title and what the lead last said, a word at a time; with no words, the tasks changed last. */
  async searchTasks(input: { readonly text: string; readonly projectId?: string }): Promise<FoundTasks> {
    await this.wait()
    const words = input.text
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word !== '')
    const scoped = this.state.tasks.filter((one) => input.projectId === undefined || one.projectId === input.projectId)
    const found = scoped
      .map((one) => {
        const title = one.title.toLowerCase()
        const said = (one.summary ?? '').toLowerCase()
        const inTitle = words.filter((word) => title.includes(word)).length
        const inSaid = words.filter((word) => !title.includes(word) && said.includes(word))
        return { one, score: inTitle * 2 + inSaid.length, all: words.every((word) => title.includes(word) || said.includes(word)), inSaid }
      })
      .filter((hit) => words.length === 0 || hit.all)
      .sort((a, b) => b.score - a.score || (b.one.startedAt ?? b.one.createdAt).localeCompare(a.one.startedAt ?? a.one.createdAt))
    return {
      tasks: found.slice(0, 30).map(({ one, inSaid }) => ({
        taskId: one.taskId,
        threadId: one.threadId,
        projectId: one.projectId,
        title: one.title,
        slug: one.slug,
        phase: one.phase,
        state: one.state,
        pullRequest: one.change === null ? null : `#${one.change.number}`,
        changedAt: one.startedAt ?? one.createdAt,
        matched: inSaid.length === 0 || one.summary === null ? null : matchedParts(one.summary, inSaid),
      })),
    }
  }

  watch(listener: (event: WatchEvent) => void): Unsubscribe {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async answer(input: { readonly attentionId: string; readonly decision: 'allow' | 'reject'; readonly reason?: string }): Promise<void> {
    await this.wait()
    const answered = this.close(input.attentionId)
    if (answered?.taskId == null) return
    this.append(
      answered.threadId,
      say.notice(
        input.decision === 'allow' ? 'You allowed it, from your phone' : 'You denied it, from your phone',
        new Date(this.now()).toISOString(),
        'info',
        input.reason ?? null,
      ),
    )
    this.resume(answered.taskId)
  }

  async answerQuestion(input: {
    readonly attentionId: string
    readonly answers: Readonly<Record<string, { readonly values: ReadonlyArray<string> }>>
  }) {
    await this.wait()
    const answered = this.close(input.attentionId)
    if (answered?.taskId == null) return
    const picked = Object.values(input.answers).flatMap((answer) => answer.values)
    this.append(answered.threadId, say.person(`Answered: ${picked.join(', ')}`, new Date(this.now()).toISOString()))
    this.resume(answered.taskId)
  }

  async answerStuck(input: { readonly attentionId: string; readonly answer: { readonly kind: 'tell' | 'retry' | 'wait' | 'abandon' } }) {
    await this.wait()
    const answered = this.close(input.attentionId)
    if (answered?.taskId == null) return
    if (input.answer.kind === 'abandon') this.update(answered.taskId, { phase: 'settled', settledAt: new Date(this.now()).toISOString() })
    else if (input.answer.kind === 'wait') this.update(answered.taskId, { phase: 'held' })
    else this.resume(answered.taskId)
  }

  async send(input: { readonly threadId: string; readonly body: string; readonly dictated?: boolean }): Promise<void> {
    await this.wait()
    const conversation = this.state.coordinators.get(input.threadId)
    if (conversation === undefined) return this.append(input.threadId, say.person(input.body, new Date(this.now()).toISOString()))
    conversation.push(say.person(input.body, new Date(this.now()).toISOString()))
    const project = this.state.projects.find((one) => one.coordinatorThreadId === input.threadId)
    this.changed('thread', input.threadId, project?.id ?? null, input.threadId)
    // The coordinator plans what it was told, a moment later: one task, counting down to its start.
    this.timers.push(setTimeout(() => this.plan(input.threadId, input.body, project?.id ?? ''), this.latency <= 0 ? 0 : 1_200))
  }

  private plan(threadId: string, body: string, projectId: string): void {
    const conversation = this.state.coordinators.get(threadId)
    if (conversation === undefined) return
    const at = new Date(this.now()).toISOString()
    const [first = body] = body.split(/[.\n]/)
    const title = first.trim().slice(0, 70)
    const made = task({
      taskId: `task_${slugOf(title)}_${this.cursor}`,
      projectId,
      title,
      phase: 'planned',
      createdAt: at,
      plan: {
        id: `plan_${slugOf(title)}_${this.cursor}`,
        steps: [
          { key: 'implement', agentId: 'claude-code', model: 'claude-opus-5', skipped: false },
          { key: 'review', agentId: 'codex', model: 'gpt-5.5-codex', skipped: false },
        ],
        startsAt: ahead(this.now(), 2),
        reason: 'Opus 5 knows this code from its last tasks; Codex reviews.',
        end: 'draft',
      },
    })
    this.state.tasks.push(made)
    const name = this.state.projects.find((one) => one.id === projectId)?.name ?? ''
    this.state.threads.set(made.threadId, thread(made, name, [say.person(body, at)]))
    conversation.push(
      say.agent('coordinator', `One task: **${title}**. Opus 5 implements and Codex reviews; it opens a draft pull request.`, at),
    )
    conversation.push(say.task(made, at))
    this.changed('task', made.taskId, projectId, threadId)
  }

  async createTask(input: { readonly projectId: string; readonly title: string; readonly description?: string }): Promise<TaskSummary> {
    await this.wait()
    const at = new Date(this.now()).toISOString()
    const made = task({
      taskId: `task_${slugOf(input.title)}_${this.cursor}`,
      projectId: input.projectId,
      title: input.title,
      phase: 'planned',
      createdAt: at,
      inLine: true,
      place: this.state.tasks.filter((one) => one.phase === 'planned').length + 1,
      queued: { busy: 4, atOnce: 4 },
    })
    this.state.tasks.push(made)
    const project = this.state.projects.find((one) => one.id === input.projectId)
    this.state.threads.set(made.threadId, thread(made, project?.name ?? '', [say.person(input.description ?? input.title, at)]))
    this.changed('task', made.taskId, made.projectId, made.threadId)
    return {
      id: made.taskId,
      projectId: made.projectId,
      title: made.title,
      slug: made.slug,
      threadId: made.threadId,
      state: made.state,
      branch: made.branch,
      agentId: null,
      waiting: 0,
      createdAt: at,
    }
  }

  async startPlan(planId: string): Promise<void> {
    await this.wait()
    const found = this.state.tasks.find((one) => one.plan?.id === planId && one.phase === 'planned')
    if (found?.plan == null) throw new Error('That plan already started')
    this.update(found.taskId, {
      phase: 'running',
      step: 'implement',
      inLine: false,
      lead: found.plan.steps[0]?.agentId ?? null,
      leadModel: found.plan.steps[0]?.model ?? null,
      startedAt: new Date(this.now()).toISOString(),
      plan: { ...found.plan, startsAt: null },
    })
  }

  async holdPlan(planId: string): Promise<void> {
    await this.wait()
    const found = this.state.tasks.find((one) => one.plan?.id === planId && one.phase === 'planned')
    if (found?.plan == null) throw new Error('That plan already started')
    this.update(found.taskId, { plan: { ...found.plan, startsAt: null } })
  }

  async stopTask(taskId: string): Promise<void> {
    await this.wait()
    this.update(taskId, { phase: 'stopped' })
  }

  async markTaskDone(taskId: string): Promise<void> {
    await this.wait()
    this.update(taskId, { phase: 'settled', settledAt: new Date(this.now()).toISOString() })
  }

  async keepTaskForLater(taskId: string): Promise<void> {
    await this.wait()
    this.update(taskId, { phase: 'kept', keptAt: new Date(this.now()).toISOString() })
  }

  async merge(input: { readonly taskId: string; readonly head: string }): Promise<void> {
    await this.wait()
    const found = this.state.tasks.find((one) => one.taskId === input.taskId)
    if (found?.change == null) throw new Error('Nothing to merge')
    if (found.change.head !== input.head) throw new Error('It changed since you looked: look again before merging')
    this.update(input.taskId, {
      phase: 'settled',
      settledAt: new Date(this.now()).toISOString(),
      change: { ...found.change, state: 'merged', draft: false },
    })
  }

  private goLive(): void {
    STREAM.forEach((text, index) => {
      this.timers.push(
        setTimeout(
          () =>
            this.emit({
              _tag: 'Streaming',
              threadId: 'thr_task_backfill',
              itemId: 'item_stream',
              kind: 'agent_message',
              agentId: 'claude-code',
              text,
            }),
          2_000 + index * 1_600,
        ),
      )
    })
    this.timers.push(
      setTimeout(() => {
        const docs = this.state.tasks.find((one) => one.taskId === 'task_dark_docs')
        if (docs === undefined) return
        this.state.calls.push(
          call({
            id: 'att_legacy_css',
            kind: 'permission',
            projectId: docs.projectId,
            taskId: docs.taskId,
            threadId: docs.threadId,
            taskTitle: docs.title,
            taskSlug: docs.slug,
            title: 'Delete 3 files in public/legacy-css',
            reason: 'Deleting files outside the task’s changes asks, in althar-site’s rules',
            command: 'rm public/legacy-css/{docs,print,code}.css',
            createdAt: new Date(this.now()).toISOString(),
          }),
        )
        this.update(docs.taskId, { phase: 'waiting' })
      }, 25_000),
    )
  }

  private wait(): Promise<void> {
    return this.latency <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, this.latency))
  }

  private setConnection(connection: Connection): void {
    this.current = connection
    for (const listener of this.connectionListeners) listener(connection)
  }

  private close(attentionId: string) {
    const index = this.state.calls.findIndex((one) => one.id === attentionId)
    if (index === -1) throw new Error('That call was already answered')
    const [closed] = this.state.calls.splice(index, 1)
    return closed
  }

  /** A task whose call was answered goes back to work, unless another call still holds it. */
  private resume(taskId: string): void {
    const held = this.state.calls.some((one) => one.taskId === taskId)
    this.update(taskId, { phase: held ? 'waiting' : 'running' })
  }

  private update(taskId: string, change: Partial<HomeTask>): void {
    const index = this.state.tasks.findIndex((one) => one.taskId === taskId)
    const found = this.state.tasks[index]
    if (found === undefined) return
    const next = { ...found, ...change }
    this.state.tasks[index] = next
    this.changed('task', taskId, next.projectId, next.threadId)
  }

  private append(threadId: string, item: ThreadSnapshot['items'][number]): void {
    const found = this.state.threads.get(threadId)
    if (found === undefined) return
    this.state.threads.set(threadId, { ...found, items: [...found.items, item] })
    this.changed('thread', threadId, found.project.id, threadId)
  }

  private changed(aggregateType: string, aggregateId: string, projectId: string | null, threadId: string | null): void {
    this.cursor += 1
    this.emit({ _tag: 'Changed', cursor: this.cursor, aggregateType, aggregateId, projectId, threadId })
  }

  private emit(event: WatchEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

/** What matched in `text`, a few words either side, with the words found marked, as the runtime's search says it. */
const matchedParts = (text: string, words: ReadonlyArray<string>): Array<{ text: string; hit: boolean }> => {
  const lower = text.toLowerCase()
  const at = Math.min(...words.map((word) => lower.indexOf(word)).filter((index) => index >= 0))
  const start = Math.max(0, lower.lastIndexOf(' ', Math.max(0, at - 24)) + 1)
  const window = text.slice(start, start + 90)
  const parts: Array<{ text: string; hit: boolean }> = start > 0 ? [{ text: '…', hit: false }] : []
  let rest = window
  while (rest !== '') {
    const next = words
      .map((word) => ({ word, index: rest.toLowerCase().indexOf(word) }))
      .filter((hit) => hit.index >= 0)
      .sort((a, b) => a.index - b.index)[0]
    if (next === undefined) {
      parts.push({ text: rest, hit: false })
      break
    }
    if (next.index > 0) parts.push({ text: rest.slice(0, next.index), hit: false })
    parts.push({ text: rest.slice(next.index, next.index + next.word.length), hit: true })
    rest = rest.slice(next.index + next.word.length)
  }
  if (start + 90 < text.length) parts.push({ text: '…', hit: false })
  return parts
}
