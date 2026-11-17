import type { ThreadItem, TurnTime } from '@althar/contracts'
import { ToolKind, ToolState } from '@althar/ui'

import { type Handed, handedBy, type OutputSoFar } from './handed'
import {
  type Block,
  blocksOf,
  carriedOn,
  type Doing,
  doingOf,
  type Part,
  relayed,
  setupStanding,
  type StepResult,
  type Streamed,
} from './thread'
import { text as threadText } from './ThreadBlocks'
import { took } from './time'
import { duration, type Spent, spentOf, turnOfItems } from './turnTime'

/*
 * A task's thread in rounds (ADR-042). A round starts with an ask: what the
 * person said, what the coordinator passed on, a review's findings, Althar
 * asking the lead to settle a conflict. The lead answers in at most three
 * parts: what it said first, when it said it soon and before changing
 * anything (its acknowledgement); its work, what it said on the way among
 * it; and its result, what it said last, with what its report showed. While
 * it works, what it writes now stands where its result will, and the rest
 * shows under its work's header; once it is writing after its report, that
 * is its answer, and its work folds (ADR-099). What Althar did along the
 * way, a branch made or a loop stopped, is work too; what the person should
 * know is a line of its own.
 *
 * The thread's items are read as blocks (thread.ts), in stretches that end
 * at a report, so what was said after a report stays after it; then each run
 * of one agent's turns is a round.
 *
 * A review is a line of the thread (TaskThread draws it so): the person
 * rarely needs what it said. The lead settling it is the round after it,
 * and folds into that line too once a later round of the lead's hands the
 * work over again; the lead's latest handoff, on the work or on settling a
 * review, always stands open.
 */

/** A message, with what it handed back beside it: the documents and files its work wrote or pointed at, and its own pictures. */
export interface Said {
  readonly id: string
  readonly text: string
  readonly handed: Handed
  /** Still being written. */
  readonly live?: boolean
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
  /** While it works: what it is doing now, in one line; none while it writes. */
  readonly doing: Doing | null
  /** Once it is over, where its time went, as the runtime kept it for its turns; null where none of them did. */
  readonly spent: Spent | null
}

/** Pictures the lead showed the person (show_pictures), as one set. */
export type Shown = Extract<Part, { kind: 'pictures' }>

/** A canvas the lead drew or opened in the round (ADR-104): a line under its work, that opens it. */
export type Drawn = Extract<Part, { kind: 'canvas' }>

export interface Round {
  readonly kind: 'round'
  readonly id: string
  readonly agentId: string | null
  /** The model its own turn ran on, where the runtime recorded it; null for rounds from before it did. */
  readonly model: string | null
  readonly at: string
  readonly ack: Said | null
  readonly work: Work | null
  /** What it said last, once the round is over. */
  readonly result: Said | null
  /** While it runs: what it is writing now, the last thing it did, where its result will stand. */
  readonly writing: Said | null
  /** It is writing after its report, its answer: its work is over, and folds. */
  readonly answered: boolean
  /** Its report, where it handed one in: what it built, and what it showed. */
  readonly report: { readonly id: string; readonly result: StepResult } | null
  /** The error its agent's turn ended with, said in the open: there's no answer to come. */
  readonly failed: Extract<Part, { kind: 'notice' }> | null
  /** What it handed back along the way, where it has no result to stand with: shown under its work. */
  readonly handed: Handed
  /** Pictures it showed the person, in order, where it showed them: before its result, or after it. */
  readonly shown: { readonly before: ReadonlyArray<Shown>; readonly after: ReadonlyArray<Shown> }
  /** The canvases it drew or opened, in order: open under its work, each a line that opens it. */
  readonly drawn: ReadonlyArray<Drawn>
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
  | {
      readonly kind: 'althar'
      readonly id: string
      readonly text: string
      readonly tone: 'info' | 'warning'
      readonly links?: ReadonlyArray<{ readonly label: string; readonly url: string }>
      /** What the line is built on, such as a host's raw answer: folded under it. */
      readonly details?: string
      /** A task the line is about, which it links to: one this task's lead started (ADR-097), in one line. */
      readonly task?: { readonly threadId: string; readonly title: string }
    }
  /** Its folder went, or came back: a line across the thread, a change of scene (ADR-056). */
  | { readonly kind: 'folder'; readonly id: string; readonly text: string }
  /** A step of the work: a change started, a stamped row of its own (a task is a conversation plus parts). */
  | { readonly kind: 'work_step'; readonly id: string; readonly step: NonNullable<NoticeContent['step']> }
  /**
   * A reviewer's verdict and findings, in its own voice, on the model its review ran; with the lead's round settling them,
   * where a later round of the lead's handed the work over since.
   */
  | {
      readonly kind: 'verdict'
      readonly id: string
      readonly at: string
      readonly model: string | null
      readonly result: StepResult
      readonly settle: Round | null
    }
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
  const skills = (reported: boolean) =>
    new Set(tools.flatMap((tool) => (tool.state === ToolState.Done && tool.skills?.reported === reported ? tool.skills.names : []))).size
  const loaded = skills(true)
  const readSkills = skills(false)
  return [
    loaded > 0 ? `loaded ${plural(loaded, 'skill', 'skills')}` : null,
    readSkills > 0 ? `read ${plural(readSkills, 'skill', 'skills')}` : null,
    edited > 0 ? `edited ${plural(edited, 'file', 'files')}` : null,
    read > 0 ? `read ${plural(read, 'file', 'files')}` : null,
    looked > 0 ? `looked at ${plural(looked, 'screenshot', 'screenshots')}` : null,
    ran > 0 ? `ran ${plural(ran, 'command', 'commands')}` : null,
  ]
    .filter((one) => one !== null)
    .join(', ')
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
  readonly model: string | null
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
  /** Where each turn's time went, by its id (`turnsById`). */
  readonly turns?: ReadonlyMap<string, TurnTime>
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
  // Where a round's time went: its items' turns, as the runtime kept them.
  const turnOf = turnOfItems(items)
  const kept = source.turns
  const spending = (ids: ReadonlyArray<string>) =>
    kept === undefined
      ? null
      : spentOf(
          ids.flatMap((id) => turnOf.get(id) ?? []),
          kept,
        )
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
        ...(source.turns === undefined ? {} : { turns: source.turns }),
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
  // The round its lead's turn runs in now, by its id: it stays open for what follows the turn, as the report it hands in
  // before its answer.
  let liveId: string | null = null
  // What Althar did between rounds goes in the next one's work.
  let pending: Array<WorkStep> = []
  const close = () => {
    if (open !== null) out.push(roundOf(open, open.id === liveId, at, worktree, now, spending))
    open = null
  }
  blocks.forEach((block, index) => {
    switch (block.kind) {
      case 'turn': {
        // A turn that said and did nothing a person could see (an empty message, a blank thought) opens no round and draws no
        // fold: the reply that follows, as a turn of its own, is the round, on its own model and from its own time. The turn
        // at work now stays, as it may be about to say something.
        const parts = block.parts.filter((part) => !isEmpty(part))
        if (parts.length === 0 && !(running && index === lastTurn)) return
        if (open === null || open.agentId !== block.agentId) {
          close()
          open = {
            id: block.id,
            agentId: block.agentId,
            model: block.model,
            at: block.at,
            steps: [...pending],
            report: null,
            reportedAfter: 0,
          }
          pending = []
        }
        open.steps.push(...parts)
        if (running && index === lastTurn) liveId = open.id
        return
      }
      case 'step': {
        const result = block.result
        if (result.step === 'review') {
          close()
          out.push({ kind: 'verdict', id: block.id, at: block.at, model: block.result.model ?? null, result, settle: null })
        } else if (result.step === 'publish') {
          close()
          out.push({ kind: 'published', id: block.id, at: block.at, result })
        } else if (open !== null) {
          // A second report with no ask between them, as in threads from before what was passed on had its place: the first
          // closes a round of its own, so nothing it showed is lost, and what came after it is the next round's.
          if (open.report !== null) {
            const later = open.steps.slice(open.reportedAfter)
            const first = later[0]
            out.push(roundOf({ ...open, steps: open.steps.slice(0, open.reportedAfter) }, false, at, worktree, now, spending))
            const id = first?.id ?? block.id
            if (open.id === liveId) liveId = id
            open = {
              id,
              agentId: open.agentId,
              model: open.model,
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
            model: result.model ?? null,
            at: block.at,
            ack: null,
            work: null,
            result: null,
            writing: null,
            answered: false,
            report: { id: block.id, result },
            failed: null,
            handed: handedBy([], worktree),
            shown: { before: [], after: [] },
            drawn: [],
            live: false,
            parts: [],
          })
        return
      }
      case 'divider': {
        const content = noticeOf(block)
        // A step of the work is a row of its own, between rounds.
        if (content.step !== undefined) {
          close()
          out.push({ kind: 'work_step', id: block.id, step: content.step })
          return
        }
        const role = roleOf(content)
        if (role === 'relayed') {
          close()
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
        close()
        if (role === 'folder') {
          out.push({ kind: 'folder', id: block.id, text: block.text })
          return
        }
        out.push({
          kind: 'althar',
          id: block.id,
          text: shorter(block.text),
          tone: content.severity === 'info' ? 'info' : 'warning',
          ...(block.links === undefined ? {} : { links: block.links }),
          ...(block.details === undefined ? {} : { details: block.details }),
          ...(content.task === undefined ? {} : { task: { threadId: content.task.threadId, title: content.task.title } }),
        })
        return
      }
      case 'setup': {
        // Set up as it should be, it is Althar's housekeeping: with the next round's work. Under way or failed, it stands alone.
        if (setupStanding(block.setup) === 'done') {
          const aside = { kind: 'aside' as const, id: block.id, text: threadText.setup.done(block.setup) }
          if (open !== null) open.steps.push(aside)
          else pending.push(aside)
          return
        }
        close()
        out.push(block)
        return
      }
      default:
        close()
        out.push(block)
    }
  })
  close()
  return withSettled(out)
}

/** A message or a thought with nothing in it: no words, no pictures, no files. */
const isEmpty = (part: Part): boolean =>
  (part.kind === 'message' && part.text.trim() === '' && part.pictures.length === 0 && part.files.length === 0) ||
  (part.kind === 'thought' && part.text.trim() === '')

/** Whether a block is a round its lead reported in, on its work or on settling a review: a handoff. */
const handsOver = (block: RoundBlock | undefined): block is Round =>
  block?.kind === 'round' && (block.report?.result.step === 'implement' || block.report?.result.step === 'settle')

/**
 * Each review with the round its lead settled it in, right after it, where a
 * later round handed the work over again: the latest handoff stands open.
 */
const withSettled = (blocks: ReadonlyArray<RoundBlock>): ReadonlyArray<RoundBlock> => {
  const latest = blocks.findLastIndex(handsOver)
  const out: Array<RoundBlock> = []
  for (let at = 0; at < blocks.length; at++) {
    const block = blocks[at]
    if (block === undefined) continue
    const ahead = at + 1
    const next = blocks[ahead]
    if (block.kind === 'verdict' && handsOver(next) && next.report?.result.step === 'settle' && !next.live && ahead < latest) {
      out.push({ ...block, settle: next })
      at = ahead
    } else out.push(block)
  }
  return out
}

/** A round, from everything its lead did: its acknowledgement, its work in one line, and its result. */
const roundOf = (
  open: Gathering,
  live: boolean,
  at: ReadonlyMap<string, string>,
  worktree: string | null,
  now: string,
  spending: (ids: ReadonlyArray<string>) => Spent | null,
): Round => {
  // An error its agent's turn ended with is said in the open; any other notice of its own stays in the work, as Althar's do.
  const ending = open.steps.at(-1)
  const failed = !live && ending?.kind === 'notice' && ending.tone === 'error' ? ending : undefined
  // What it said after its report, by where it stands among its steps.
  const afterReport = new Set(open.steps.slice(open.reportedAfter).map((step) => step.id))
  // Pictures it showed the person stand open in the round, not in its work.
  const pictures = open.steps.flatMap((step) => (step.kind === 'pictures' ? [step] : []))
  // The canvases it drew stand open too, under its work.
  const drawn = open.steps.flatMap((step) => (step.kind === 'canvas' ? [step] : []))
  const steps: ReadonlyArray<WorkStep> = open.steps.flatMap((step) =>
    step === failed || step.kind === 'pictures' || step.kind === 'canvas'
      ? []
      : step.kind === 'notice'
        ? [{ kind: 'aside' as const, id: step.id, text: step.text }]
        : [step],
  )
  const messages = steps.flatMap((step) => (step.kind === 'message' && step.text.trim() !== '' ? [step] : []))
  // What it is writing now: while it runs, the message it is on.
  const writing = live ? messages.findLast((message) => message.live === true) : undefined
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
    first !== writing &&
    (live || followed) &&
    time(first.id) - start < ACK_WITHIN &&
    (firstChange < 0 || steps.indexOf(first) < firstChange)
      ? first
      : undefined
  const work = steps.filter((step) => step !== ack && step !== result && step !== writing)
  // Writing after its report, it is answering: its work is over.
  const answered = writing !== undefined && open.report !== null && afterReport.has(writing.id)
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
    ...(message.live === true ? { live: true } : {}),
    handed: handedBy([...(withFiles ? files : []), { id: message.id, pictures: message.pictures, files: message.files }], worktree),
  })
  const lastStep = work.at(-1)
  const until = result === undefined ? (reported ?? (lastStep === undefined ? start : time(lastStep.id))) : time(result.id)
  const iso = (ms: number) => new Date(ms).toISOString()
  const spent = live ? null : spending(open.steps.map((step) => step.id))
  return {
    kind: 'round',
    id: open.id,
    agentId: open.agentId,
    model: open.model,
    at: open.at,
    ack: ack === undefined ? null : said(ack, false),
    // At work with nothing done yet, it has a line all the same: it is at work.
    work:
      work.length === 0 && !live
        ? null
        : {
            id: `work:${open.id}`,
            steps: work,
            took:
              spent === null
                ? took(iso(work[0] === undefined ? start : time(work[0].id)), live && !answered ? now : iso(until))
                : duration(spent.work),
            live,
            counts: countsOf(work),
            doing: live
              ? doingOf(
                  work.flatMap((step) => (step.kind === 'aside' ? [] : [step])),
                  writing !== undefined,
                )
              : null,
            spent,
          },
    result: result === undefined ? null : said(result, true),
    writing: writing === undefined ? null : said(writing, false),
    answered,
    report: open.report,
    failed: failed === undefined ? null : failed,
    handed: handedBy(result === undefined ? files : [], worktree),
    // Where it showed them: after its result where it said that first.
    shown: {
      before: pictures.filter((shown) => result === undefined || open.steps.indexOf(shown) < open.steps.indexOf(result)),
      after: pictures.filter((shown) => result !== undefined && open.steps.indexOf(shown) > open.steps.indexOf(result)),
    },
    drawn,
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
