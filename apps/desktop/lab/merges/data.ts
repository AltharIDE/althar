import type { ThreadItem } from '@althar/contracts'

import { items } from '../../tests/fixtures'

/*
 * The coordinator's thread after the person asks it to merge, at four
 * moments: just asked, some merged, one sent back by the queue, all in. Once
 * as today's runtime leaves it (thread items, drawn by the app's own
 * blocksOf and ThreadBlocks), and once as what is going in, row by row, for
 * the directions to draw.
 */

export type Moment = 1 | 2 | 3 | 4
export type Scenario = 'four' | 'one'

export const COORDINATOR = 'claude-code'
const MODEL = 'opus'

/** Where one thing asked to go in stands: the merge line's states. */
export type State = 'waiting' | 'checks' | 'queued' | 'merging' | 'merged' | 'sent_back' | 'conflict'

/** One thing the person asked to go in: a pull request, or a task whose pull request isn't open yet. */
export interface Going {
  readonly key: string
  /** Its pull request, once it has one. */
  readonly number: number | null
  /** Its pull request's title, or its task's while it has none. */
  readonly title: string
  /** Its task, as the board names it. */
  readonly task: string
  readonly url: string | null
  readonly state: State
  /** What it waits for, or what went wrong and what happens next: one line. */
  readonly note?: string
}

export interface Story {
  readonly asked: string
  readonly reply: string
  readonly going: ReadonlyArray<Going>
  /** Something else the person and the coordinator said since, which puts the merges up the thread. */
  readonly since: boolean
}

const REPO = 'https://github.com/AltharIDE/althar/pull/'
const pr = (number: number) => `${REPO}${number}`

const PLAN = { number: 1224, title: 'Plan card offers Runs on during its countdown too', task: 'Runs on during the countdown' }
const HOME = { number: 1222, title: 'A home’s whole experience reviewed and made good', task: 'A home, reviewed end to end' }
const KEEP = { number: 1226, title: 'Keep for later shelves a task without losing it', task: 'Keep for later' }
const WORKERS = { number: 1231, title: 'A worker says when it’s ready for work', task: 'Workers readiness' }

const SENT_BACK = 'The queue’s end-to-end checks failed in homes.spec.ts. Its lead is fixing it; it goes back in with the fix.'

const row = (what: { number: number; title: string; task: string }, state: State, note?: string, open = true): Going => ({
  key: what.task,
  number: open ? what.number : null,
  title: open ? what.title : what.task,
  task: what.task,
  url: open ? pr(what.number) : null,
  state,
  ...(note === undefined ? {} : { note }),
})

const FOUR: Record<Moment, ReadonlyArray<Going>> = {
  1: [
    row(PLAN, 'checks'),
    row(HOME, 'checks'),
    row(KEEP, 'waiting', 'Once its fix is pushed and its checks pass'),
    row(WORKERS, 'waiting', 'Once it’s open, reviewed and green', false),
  ],
  2: [row(PLAN, 'merged'), row(HOME, 'queued'), row(KEEP, 'checks'), row(WORKERS, 'waiting', 'Once it’s reviewed and green')],
  3: [row(PLAN, 'merged'), row(HOME, 'sent_back', SENT_BACK), row(KEEP, 'queued'), row(WORKERS, 'checks')],
  4: [row(PLAN, 'merged'), row(HOME, 'merged'), row(KEEP, 'merged'), row(WORKERS, 'merged')],
}

const ONE: Record<Moment, ReadonlyArray<Going>> = {
  1: [row(PLAN, 'checks')],
  2: [row(PLAN, 'queued')],
  3: [row(PLAN, 'sent_back', 'The queue’s end-to-end checks failed in plan.spec.ts. Its lead is fixing it; it goes back in with the fix.')],
  4: [row(PLAN, 'merged')],
}

const ASKED = { four: 'see everything thru to main', one: 'merge #1224 once it’s green' }
const REPLY = {
  four: 'Queuing #1224 and #1222 for merge. The other two get set to merge on their own once they’re ready.',
  one: 'Queuing #1224. It merges once its checks pass.',
}

export const storyOf = (scenario: Scenario, moment: Moment): Story => ({
  asked: ASKED[scenario],
  reply: REPLY[scenario],
  going: (scenario === 'four' ? FOUR : ONE)[moment],
  since: moment >= 3,
})

/** How long before the page opened each moment's thread began, in minutes. */
const SPAN: Record<Moment, number> = { 1: 2.5, 2: 9, 3: 16, 4: 24 }

/** The thread's items for a moment, oldest first, as the runtime writes them today. */
export const itemsOf = (scenario: Scenario, moment: Moment): ReadonlyArray<ThreadItem> => {
  const start = Date.now() - SPAN[moment] * 60_000
  let sequence = 0
  const placed = (item: ThreadItem, seconds: number): ThreadItem => {
    sequence += 1
    return { ...item, id: `${scenario}-${sequence}`, sequence, createdAt: new Date(start + seconds * 1000).toISOString() }
  }
  const by = { model: MODEL }
  const says = (text: string, at: number) => placed({ ...items.says(text, COORDINATOR), ...by }, at)
  const call = (title: string, at: number) =>
    placed({ ...items.tool({ title, toolKind: 'other', status: 'completed' }, COORDINATOR), ...by }, at)
  const you = (text: string, at: number) => placed(items.you(text), at)
  /** A line of Althar's own, as the person's thread showed it. */
  const line = (title: string, at: number) => placed(items.notice({ title, source: 'runtime' }, null), at)
  const card = (at: number) =>
    placed(
      items.mergeLine({
        key: 'github:AltharIDE/althar main',
        branch: null,
        rows: storyOf(scenario, moment)
          // The card holds what is in the line: a pull request waiting on its errand's wait joins it once that is met.
          .going.filter((one) => one.number !== null && one.state !== 'waiting')
          .map((one) => ({
            number: one.number!,
            title: one.title,
            url: one.url!,
            state: one.state,
            ...(one.state === 'sent_back' && one.note !== undefined ? { reason: one.note } : {}),
          })),
      }),
      at,
    )
  const out: Array<ThreadItem> = []
  const push = (...more: ReadonlyArray<ThreadItem>) => void out.push(...more)
  if (scenario === 'four') {
    push(
      you(ASKED.four, 0),
      call('list_tasks', 4),
      call('read_pull_request #1224', 12),
      call('read_pull_request #1222', 17),
      call('read_task Keep for later', 24),
      call('read_task Workers readiness', 31),
      call('merge_pull_request #1224', 42),
      call('merge_pull_request #1222', 47),
      says(REPLY.four, 56),
      line('Kept your errand: merge #1224 once its turn to merge comes and its checks pass', 57),
      call('keep_errand', 58),
      card(59),
      line('Kept your errand: merge #1222 once its turn to merge comes and its checks pass', 60),
      line('Kept your errand: merge Keep for later’s pull request once its fix is pushed and its checks pass', 61),
      line('Kept your errand: merge the workers readiness pull request once it’s open, reviewed and green', 62),
    )
    if (moment >= 2)
      push(
        call('merge_pull_request #1224', 5 * 60),
        says('#1224 is in the merge queue.', 5 * 60 + 4),
        line('Put #1224 in the merge queue. Errand done', 5 * 60 + 5),
        call('merge_pull_request #1222', 6 * 60),
        line('Put #1222 in the merge queue. Errand done', 6 * 60 + 1),
      )
    if (moment >= 3)
      push(
        call('merge_pull_request #1226', 10 * 60),
        says('#1226 is in the merge queue.', 10 * 60 + 3),
        line('Put #1226 in the merge queue. Errand done', 10 * 60 + 4),
        you('anything else waiting on me?', 11 * 60),
        call('list_tasks', 11 * 60 + 4),
        says('Just the plan for Offline drafts: its countdown ends in 2 minutes unless you hold it.', 11 * 60 + 9),
        call('read_checks #1222', 13 * 60),
        says(
          '#1222 came back out of the queue: the end-to-end checks failed in homes.spec.ts. I’ve passed it to its lead; it goes back in once it’s green.',
          13 * 60 + 8,
        ),
        line('Errand on hold: merge #1222 — the merge queue sent it back: its checks failed. Say go ahead to continue.', 13 * 60 + 9),
      )
    if (moment >= 4)
      push(
        line('Errand resumed: merge #1222 once its turn to merge comes and its checks pass', 18 * 60),
        call('merge_pull_request #1222', 19 * 60),
        line('Put #1222 in the merge queue. Errand done', 19 * 60 + 1),
        call('merge_pull_request #1231', 20 * 60),
        says('#1231 is in the merge queue.', 20 * 60 + 3),
        line('Put #1231 in the merge queue. Errand done', 20 * 60 + 4),
      )
    return out
  }
  push(
    you(ASKED.one, 0),
    call('read_pull_request #1224', 5),
    call('merge_pull_request #1224', 11),
    says(REPLY.one, 15),
    line('Kept your errand: merge #1224 once its turn to merge comes and its checks pass', 16),
    card(17),
  )
  if (moment >= 2) push(call('merge_pull_request #1224', 5 * 60), line('Put #1224 in the merge queue. Errand done', 5 * 60 + 1))
  if (moment >= 3)
    push(
      you('anything else waiting on me?', 11 * 60),
      call('list_tasks', 11 * 60 + 4),
      says('Just the plan for Offline drafts: its countdown ends in 2 minutes unless you hold it.', 11 * 60 + 9),
      call('read_checks #1224', 13 * 60),
      says('#1224 came back out of the queue: the end-to-end checks failed in plan.spec.ts. I’ve passed it to its lead.', 13 * 60 + 8),
      line('Errand on hold: merge #1224 — the merge queue sent it back: its checks failed. Say go ahead to continue.', 13 * 60 + 9),
    )
  if (moment >= 4)
    push(
      line('Errand resumed: merge #1224 once its turn to merge comes and its checks pass', 18 * 60),
      call('merge_pull_request #1224', 19 * 60),
      line('Put #1224 in the merge queue. Errand done', 19 * 60 + 1),
    )
  return out
}

/** What the person and the coordinator said since the merges were asked for, alone: drawn the app's way in every direction. */
export const sinceItems = (moment: Moment): ReadonlyArray<ThreadItem> => {
  const start = Date.now() - (SPAN[moment] - 11) * 60_000
  let sequence = 0
  const placed = (item: ThreadItem, seconds: number): ThreadItem => {
    sequence += 1
    return { ...item, id: `since-${sequence}`, sequence, createdAt: new Date(start + seconds * 1000).toISOString() }
  }
  return [
    placed(items.you('anything else waiting on me?'), 0),
    placed({ ...items.tool({ title: 'list_tasks', toolKind: 'other', status: 'completed' }, COORDINATOR), model: MODEL }, 4),
    placed(
      { ...items.says('Just the plan for Offline drafts: its countdown ends in 2 minutes unless you hold it.', COORDINATOR), model: MODEL },
      9,
    ),
  ]
}

/** When the merges were asked for, as the thread says it. */
export const askedAt = (moment: Moment): string => new Date(Date.now() - SPAN[moment] * 60_000).toISOString()
