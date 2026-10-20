import type { ThreadItem } from '@althar/contracts'
import { ToolKind, ToolState } from '@althar/ui'

import { type Handed, handedBy, type OutputSoFar } from './handed'
import { type Block, blocksOf, carriedOn, type Part, relayed, type StepResult, type Streamed } from './thread'
import { text as threadText } from './ThreadBlocks'
import { took } from './time'

/*
 * A task's thread in rounds (ADR-042). A round starts with an ask: what the
 * person said, what the coordinator passed on, a review's findings, Althar
 * asking the lead to settle a conflict. The lead answers in at most three
 * parts: what it said first, when it said it soon and before changing
 * anything (its acknowledgement); one line for all its work, what it said
 * on the way among it; and its result, what it said last, with what its
 * report showed. While it works, the line says what it is on, in its own
 * last words. What Althar did along the way, a branch made or a loop
 * stopped, is work too; what the person should know is a line of its own.
 *
 * The thread's items are read as blocks (thread.ts), in stretches that end
 * at a report, so what was said after a report stays after it; then each run
 * of one agent's turns is a round.
 */

/** A message, with what it handed back beside it: the documents and files its work wrote or pointed at, and its own pictures. */
export interface Said {
  readonly id: string
  readonly text: string
  readonly handed: Handed
}

/** One thing in a round's work, in order: a step, what it said on the way, or what Althar did along the way. */
export type WorkStep =
  | Extract<Part, { kind: 'tool' | 'thought' | 'plan' | 'message' }>
  | { readonly kind: 'aside'; readonly id: string; readonly text: string }

/** All the work of a round, as its one line says it. */
export interface Work {
  readonly id: string
  readonly steps: ReadonlyArray<WorkStep>
  /** How long, from its first step to its result, or until now while it runs. */
  readonly took: string
  readonly live: boolean
  /** What it did, counted: "edited 3 files, ran 4 commands". */
  readonly counts: string
  /** While it works: what it is on, in its own last words, or its last call. */
  readonly now: string | null
}

export interface Round {
  readonly kind: 'round'
  readonly id: string
  readonly agentId: string | null
  readonly at: string
  readonly ack: Said | null
  readonly work: Work | null
  /** What it said last, once the round is over. */
  readonly result: Said | null
  /** Its report, where it handed one in: what it built, and what it showed. */
  readonly report: { readonly id: string; readonly result: StepResult } | null
  /** The error its agent's turn ended with, said in the open: there's no answer to come. */
  readonly failed: string | null
  /** What it handed back along the way, where it has no result to stand with: shown under its work. */
  readonly handed: Handed
  readonly live: boolean
  /** Everything its lead did, in order: what a document it wrote was last changed by is read from them. */
  readonly parts: ReadonlyArray<Part>
}

export type RoundBlock =
  | Exclude<Block, { kind: 'turn' | 'step' | 'divider' }>
  | Round
  /** What the coordinator passed on to the lead: an ask, in a line of what it is and the rest. */
  | { readonly kind: 'relayed'; readonly id: string; readonly title: string | null; readonly body: string }
  /** Althar, saying something the person should know: a conflict, checks. */
  | { readonly kind: 'althar'; readonly id: string; readonly text: string; readonly tone: 'info' | 'warning' }
  /** Its folder went, or came back: a line across the thread, a change of scene (ADR-055). */
  | { readonly kind: 'folder'; readonly id: string; readonly text: string }
  /** A reviewer's verdict and findings, in its own voice. */
  | { readonly kind: 'verdict'; readonly id: string; readonly at: string; readonly result: StepResult }
  /** The pull request the task opened or pushed to. */
  | { readonly kind: 'published'; readonly id: string; readonly at: string; readonly result: StepResult }

type NoticeContent = Extract<ThreadItem, { kind: 'notice' }>['content']

/** Althar's housekeeping, by its role; before roles, by what it said. */
const ASIDES = [
  /on a branch of its own/,
  /on branches of its own/,
  /is a change now/,
  /times in a row to the same end/,
  /showed no sign of work/,
]

const roleOf = (content: NoticeContent): 'relayed' | 'aside' | 'folder' | 'news' =>
  content.role === 'folder'
    ? 'folder'
    : relayed(content)
      ? 'relayed'
      : content.role === 'aside' || (content.role === undefined && ASIDES.some((pattern) => pattern.test(content.title)))
        ? 'aside'
        : 'news'

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`)

const CHANGES = new Set([ToolKind.Edit, ToolKind.Create, ToolKind.Delete])

/** What a stretch of work did, counted, in the words a person uses: "edited 3 files, read 2 files, ran 4 commands". */
export const countsOf = (steps: ReadonlyArray<WorkStep>): string => {
  const tools = steps.flatMap((step) => (step.kind === 'tool' ? [step] : []))
  const looked = tools.filter((tool) => tool.toolKind === ToolKind.Read && tool.pictures.length > 0).length
  const read = new Set(tools.filter((tool) => tool.toolKind === ToolKind.Read && tool.pictures.length === 0).map((tool) => tool.target))
    .size
  const edited = new Set(tools.filter((tool) => CHANGES.has(tool.toolKind)).map((tool) => tool.target)).size
  const ran = tools.filter((tool) => tool.toolKind === ToolKind.Run).length
  return [
    edited > 0 ? `edited ${plural(edited, 'file', 'files')}` : null,
    read > 0 ? `read ${plural(read, 'file', 'files')}` : null,
    looked > 0 ? `looked at ${plural(looked, 'screenshot', 'screenshots')}` : null,
    ran > 0 ? `ran ${plural(ran, 'command', 'commands')}` : null,
  ]
    .filter((one) => one !== null)
    .join(', ')
}

/** How long what the lead says on the way may be on the line, as what it is on. */
const NOW_LENGTH = 110

/** The first line of what it said, short, as what it is on. */
export const nowOf = (text: string): string => {
  const first = (text.trim().split('\n')[0] ?? '').replace(/[*_`]/g, '').replace(/:$/, '')
  return first.length > NOW_LENGTH ? `${first.slice(0, NOW_LENGTH - 2).trimEnd()}…` : first
}

/** What Althar says of files, said shorter: a list of them becomes how many. */
export const shorter = (text: string): string =>
  text.replace(
    /, in ((?:[\w./@-]+, )+[\w./@-]+)/g,
    (_all, list: string) => `, in ${list.split(', ').length} files${list.endsWith('.') ? '.' : ''}`,
  )

/** "One more round, from the person: they want…" says what it is before what. */
const NAMED = /^([^.:]{4,80}?), from the person:\s*(.*)$/s

/** How soon after its round starts what the lead says first counts as its acknowledgement. */
const ACK_WITHIN = 3 * 60_000

/** What a round is made of while it is gathered: its lead, when it started, and everything it did, in order. */
interface Gathering {
  readonly id: string
  readonly agentId: string | null
  readonly at: string
  readonly steps: Array<Part | WorkStep>
  report: Round['report']
  /** How many of its steps came before its report: what it said after that is its result. */
  reportedAfter: number
}

/** What rounds are read from, as blocks are (thread.ts). */
export interface RoundSource {
  readonly items: ReadonlyArray<ThreadItem>
  readonly turnRunning: boolean
  readonly worktree: string | null
  readonly queue?: boolean
  readonly outputs?: ReadonlyMap<string, OutputSoFar>
  readonly turnStarted?: string | null
  readonly openedAt?: string | null
  readonly reading?: boolean
  readonly turnEnded?: string | null
}

/** A task's thread in rounds, oldest first, with what is still being written but not yet read at the end. */
export const roundsOf = (
  source: RoundSource,
  streaming: ReadonlyMap<string, Streamed>,
  ago: (iso: string) => string,
  now: string = new Date().toISOString(),
): ReadonlyArray<RoundBlock> => {
  const { items, turnRunning, worktree } = source
  const at = new Map(items.map((item) => [item.id, item.createdAt]))
  for (const [id, streamed] of streaming) if (!at.has(id)) at.set(id, streamed.at)
  // In stretches that end at a report, so blocksOf never folds what was said after one into the turn before it.
  const stretches: Array<Array<ThreadItem>> = [[]]
  for (const item of items) {
    stretches.at(-1)?.push(item)
    if (item.kind === 'step_result') stretches.push([])
  }
  // When the newest of what came before the last stretch was written: what was asked in it may have waited behind that.
  const earlierAt = new Date(
    items
      .slice(0, items.length - (stretches.at(-1)?.length ?? 0))
      .reduce((newest, item) => Math.max(newest, Date.parse(item.createdAt)), 0),
  ).toISOString()
  const blocks = stretches.flatMap((stretch, index) => {
    const last = index === stretches.length - 1
    return blocksOf(
      {
        items: stretch,
        turnRunning: turnRunning && last,
        worktree,
        queue: (source.queue ?? turnRunning) && last,
        ...(source.outputs === undefined ? {} : { outputs: source.outputs }),
        ...(last && source.turnStarted !== undefined ? { turnStarted: source.turnStarted } : {}),
        // What opens the thread is answered in its first stretch, when that is all there is yet.
        ...(last && index === 0 && source.openedAt !== undefined ? { openedAt: source.openedAt } : {}),
        ...(last && source.reading !== undefined ? { reading: source.reading } : {}),
        ...(last && source.turnEnded !== undefined ? { turnEnded: source.turnEnded } : {}),
        ...(last && index > 0 ? { earlierAt } : {}),
      },
      last ? streaming : new Map(),
      ago,
      now,
    )
  })
  /** What a line of Althar's says, as the notice it was. */
  const noticeOf = (block: Extract<Block, { kind: 'divider' }>): NoticeContent => {
    const item = items.find((one) => one.id === block.id)
    return item?.kind === 'notice' ? item.content : { source: 'runtime', severity: 'info', title: block.text, description: null }
  }
  // The lead's turn runs in its last round, unless its reply to what it was last asked is still waited for.
  const lastTurn = blocks.some((block) => block.kind === 'waiting') ? -1 : blocks.findLastIndex((block) => block.kind === 'turn')
  // Nor where Althar carried the step on after it, after a restart: then the turn running is a later one that has said nothing
  // yet, and the round before it is over.
  const running = turnRunning && !blocks.slice(lastTurn + 1).some((block) => block.kind === 'divider' && carriedOn(noticeOf(block)))
  const out: Array<RoundBlock> = []
  let open: Gathering | null = null
  // What Althar did between rounds goes in the next one's work.
  let pending: Array<WorkStep> = []
  const close = (live: boolean) => {
    if (open !== null) out.push(roundOf(open, live, at, worktree, now))
    open = null
  }
  blocks.forEach((block, index) => {
    switch (block.kind) {
      case 'turn': {
        if (open === null || open.agentId !== block.agentId) {
          close(false)
          open = { id: block.id, agentId: block.agentId, at: block.at, steps: [...pending], report: null, reportedAfter: 0 }
          pending = []
        }
        open.steps.push(...block.parts)
        if (running && index === lastTurn) close(true)
        return
      }
      case 'step': {
        const result = block.result
        if (result.step === 'review') {
          close(false)
          out.push({ kind: 'verdict', id: block.id, at: block.at, result })
        } else if (result.step === 'publish') {
          close(false)
          out.push({ kind: 'published', id: block.id, at: block.at, result })
        } else if (open !== null) {
          // A second report with no ask between them, as in threads from before what was passed on had its place: the first
          // closes a round of its own, so nothing it showed is lost, and what came after it is the next round's.
          if (open.report !== null) {
            const later = open.steps.slice(open.reportedAfter)
            const first = later[0]
            out.push(roundOf({ ...open, steps: open.steps.slice(0, open.reportedAfter) }, false, at, worktree, now))
            open = {
              id: first?.id ?? block.id,
              agentId: open.agentId,
              at: first === undefined ? block.at : ago(at.get(first.id) ?? now),
              steps: later,
              report: null,
              reportedAfter: 0,
            }
          }
          open.report = { id: block.id, result }
          open.reportedAfter = open.steps.length
        } else
          out.push({
            kind: 'round',
            id: block.id,
            agentId: result.agentId,
            at: block.at,
            ack: null,
            work: null,
            result: null,
            report: { id: block.id, result },
            failed: null,
            handed: handedBy([], worktree),
            live: false,
            parts: [],
          })
        return
      }
      case 'divider': {
        const content = noticeOf(block)
        const role = roleOf(content)
        if (role === 'relayed') {
          close(false)
          const body = content.description ?? block.text.replace(/^From the coordinator:\s*/, '')
          const named = NAMED.exec(body)
          out.push({ kind: 'relayed', id: block.id, title: named?.[1] ?? null, body: named?.[2] ?? body })
          return
        }
        if (role === 'aside') {
          const aside = { kind: 'aside' as const, id: block.id, text: block.text }
          if (open !== null) open.steps.push(aside)
          else pending.push(aside)
          return
        }
        close(false)
        if (role === 'folder') {
          out.push({ kind: 'folder', id: block.id, text: block.text })
          return
        }
        out.push({ kind: 'althar', id: block.id, text: shorter(block.text), tone: content.severity === 'info' ? 'info' : 'warning' })
        return
      }
      case 'setup': {
        // Set up as it should be, it is Althar's housekeeping: with the next round's work. Under way or failed, it stands alone.
        const ended = block.setup.ended
        if (ended !== null && !ended.stopped && ended.code === 0) {
          const aside = { kind: 'aside' as const, id: block.id, text: threadText.setup.done(block.setup) }
          if (open !== null) open.steps.push(aside)
          else pending.push(aside)
          return
        }
        close(false)
        out.push(block)
        return
      }
      default:
        close(false)
        out.push(block)
    }
  })
  close(turnRunning)
  return out
}

/** A round, from everything its lead did: its acknowledgement, its work in one line, and its result. */
const roundOf = (open: Gathering, live: boolean, at: ReadonlyMap<string, string>, worktree: string | null, now: string): Round => {
  // An error its agent's turn ended with is said in the open; any other notice of its own stays in the work, as Althar's do.
  const ending = open.steps.at(-1)
  const failed = !live && ending?.kind === 'notice' && ending.tone === 'error' ? ending : undefined
  // What it said after its report, by where it stands among its steps.
  const afterReport = new Set(open.steps.slice(open.reportedAfter).map((step) => step.id))
  const steps: ReadonlyArray<WorkStep> = open.steps.flatMap((step) =>
    step === failed ? [] : step.kind === 'notice' ? [{ kind: 'aside' as const, id: step.id, text: step.text }] : [step],
  )
  const messages = steps.flatMap((step) => (step.kind === 'message' && step.text.trim() !== '' ? [step] : []))
  const time = (id: string) => Date.parse(at.get(id) ?? now)
  const start = steps[0] === undefined ? Date.parse(now) : time(steps[0].id)
  const firstChange = steps.findIndex((step) => step.kind === 'tool' && CHANGES.has(step.toolKind))
  const reported = open.report === null ? null : time(open.report.id)
  // Its result: what it said last, once it's over, unless its report came after that, which is then the result.
  const last = live ? undefined : messages.at(-1)
  const result = last !== undefined && (open.report === null || afterReport.has(last.id)) ? last : undefined
  // Its acknowledgement: what it said first, if soon, before it changed anything, with work after it (or work to come), and not its result.
  const first = messages[0]
  const followed = first !== undefined && steps.slice(steps.indexOf(first) + 1).some((step) => step.kind === 'tool' || step.kind === 'plan')
  const ack =
    first !== undefined &&
    first !== result &&
    (live || followed) &&
    time(first.id) - start < ACK_WITHIN &&
    (firstChange < 0 || steps.indexOf(first) < firstChange)
      ? first
      : undefined
  const work = steps.filter((step) => step !== ack && step !== result)
  // What its work wrote or pointed at, and what it handed over in what it said on the way, stand with its result; not the
  // pictures its tools looked at.
  const files = work.flatMap((step) =>
    step.kind === 'tool' && step.files.length > 0
      ? [{ id: step.id, pictures: [], files: step.files, undone: step.state !== ToolState.Done, target: step.target }]
      : step.kind === 'message' && (step.pictures.length > 0 || step.files.length > 0)
        ? [{ id: step.id, pictures: step.pictures, files: step.files }]
        : [],
  )
  const said = (message: (typeof messages)[number], withFiles: boolean): Said => ({
    id: message.id,
    text: message.text,
    handed: handedBy([...(withFiles ? files : []), { id: message.id, pictures: message.pictures, files: message.files }], worktree),
  })
  const lastStep = work.at(-1)
  const lastSaid = work.findLast((step) => step.kind === 'message')
  const until = result === undefined ? (reported ?? (lastStep === undefined ? start : time(lastStep.id))) : time(result.id)
  const iso = (ms: number) => new Date(ms).toISOString()
  return {
    kind: 'round',
    id: open.id,
    agentId: open.agentId,
    at: open.at,
    ack: ack === undefined ? null : said(ack, false),
    // At work with nothing done yet, it has a line all the same: it is at work.
    work:
      work.length === 0 && !live
        ? null
        : {
            id: `work:${open.id}`,
            steps: work,
            took: took(iso(work[0] === undefined ? start : time(work[0].id)), live ? now : iso(until)),
            live,
            counts: countsOf(work),
            now: !live
              ? null
              : lastSaid !== undefined
                ? nowOf(lastSaid.text)
                : lastStep?.kind === 'tool'
                  ? `${lastStep.verb} ${lastStep.target}`
                  : null,
          },
    result: result === undefined ? null : said(result, true),
    report: open.report,
    failed: failed === undefined ? null : failed.text,
    handed: handedBy(result === undefined ? files : [], worktree),
    live,
    parts: open.steps.filter((step): step is Part => step.kind !== 'aside' && step !== failed),
  }
}

/**
 * A message's list of the screenshots shown under it, a table of their names
 * ("| A1 | The first message lands… |"), says again what their captions say:
 * it goes, with the line that brings it in. Other tables stay.
 */
export const withoutShotList = (text: string, names: ReadonlySet<string>): string => {
  if (names.size === 0 || !text.includes('|')) return text
  const lines = text.split('\n')
  const out: Array<string> = []
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at] ?? ''
    if (!line.trimStart().startsWith('|')) {
      out.push(line)
      continue
    }
    let end = at
    while (end < lines.length && (lines[end] ?? '').trimStart().startsWith('|')) end++
    const firsts = lines.slice(at + 2, end).map((row) => row.split('|')[1]?.trim() ?? '')
    const named = firsts.filter((cell) => names.has(cell) || /^[A-Z]\d+$/.test(cell)).length
    if (firsts.length > 0 && named / firsts.length > 0.6) {
      const blank = () => {
        while (out.length > 0 && (out.at(-1) ?? '').trim() === '') out.pop()
      }
      blank()
      const before = out.at(-1) ?? ''
      if (/screenshot|shots/i.test(before) || before.trim().endsWith(':')) out.pop()
      // The blank line after the table keeps what came before apart from what follows.
      blank()
    } else out.push(...lines.slice(at, end))
    at = end - 1
  }
  return out.join('\n')
}
