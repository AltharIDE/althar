// Scrappy: a task's thread, read as what happened: its asks, the lead's turns, each review with the settle that answers it, and where it stands now.
import type { AttentionRequest, ChangeSummary, TaskFinding, ThreadSnapshot } from '../../../contracts/src/index'
import type { EvidencePiece } from '../../src/index'

import { piecesOf } from '../../../../apps/desktop/src/renderer/shared/evidence'
import type { Round, RoundBlock } from '../../../../apps/desktop/src/renderer/shared/rounds'
import type { StepResult } from '../../../../apps/desktop/src/renderer/shared/thread'

/** A finding as a round's row: what it is, where, and what the lead did about it, carried from an earlier round where it was raised before. */
export interface Row {
  readonly id: string
  readonly round: number
  readonly weight: TaskFinding['severity']
  readonly title: string
  readonly claim: string
  readonly at: string | null
  readonly state: TaskFinding['state']
  readonly reason: string | null
  readonly commit: string | null
  /** Raised in an earlier round too: that one's id. */
  readonly again: string | null
  /** A blocking finding the lead kept: the person's to decide. */
  readonly yours: boolean
}

/** One of the lead's turns: what it set out to do, and what came of it, with the round it is. */
export interface LeadTurn {
  readonly kind: 'lead'
  readonly id: string
  readonly round: Round
  readonly step: StepResult['step'] | null
  /** What it set out to do, in a line. */
  readonly intent: string | null
  /** What came of it, in a line or two: its report's summary, else its last word's first sentence. */
  readonly outcome: string | null
  /** What Althar said along the way that the person needn't read: a pull request opened, a commit made. */
  readonly noted: ReadonlyArray<string>
}

/** A review, with the settle that answers it. */
export interface Cycle {
  readonly kind: 'review'
  readonly id: string
  /** From 0. */
  readonly round: number
  readonly at: string
  readonly agentId: string | null
  readonly passed: boolean
  /** What the reviewer said besides its findings. */
  readonly notes: string
  readonly rows: ReadonlyArray<Row>
  /** The reviewer's own work, as lines. */
  readonly work: ReadonlyArray<Round>
  /** What Althar did to the reviewer along the way: started it afresh, told it to carry on. */
  readonly noise: ReadonlyArray<string>
  readonly settle: LeadTurn | null
}

export type Beat =
  | LeadTurn
  | Cycle
  /** What the person said, the coordinator passed on, and anything else as every thread draws it. */
  | { readonly kind: 'block'; readonly id: string; readonly block: RoundBlock }

/** A stop on the rail of what the task went through. */
export interface Stop {
  readonly id: string
  readonly name: string
  /** What came of it, in a few words. */
  readonly sum: string
  readonly state: 'done' | 'now' | 'yours' | 'next'
}

export interface Handoff {
  /** What the task has built, as it stands: the lead's latest `built`, else what it said last. */
  readonly built: string
  /** The round it is from. */
  readonly from: LeadTurn | null
  readonly pieces: ReadonlyArray<EvidencePiece>
  readonly unverified: ReadonlyArray<string>
}

export interface Story {
  readonly beats: ReadonlyArray<Beat>
  readonly cycles: ReadonlyArray<Cycle>
  readonly turns: ReadonlyArray<LeadTurn>
  readonly handoff: Handoff | null
  /** Every finding once, as it stands now, the person's first. */
  readonly ledger: ReadonlyArray<Row & { readonly rounds: ReadonlyArray<number> }>
  readonly yours: { readonly findings: ReadonlyArray<Row>; readonly calls: ReadonlyArray<AttentionRequest> }
  readonly change: ChangeSummary | null
  readonly rail: ReadonlyArray<Stop>
}

/** What Althar does to an agent that the person needn't read in the open. */
const NOISE = [/afresh/i, /went quiet/i, /fresh session/i, /carry on/i, /carried on/i, /Started again/i]

/** The first sentence of some markdown, plain. */
export const firstSentence = (text: string): string => {
  const plain = text
    .replace(/^#+\s.*$/gm, '')
    .replace(/[*_`]/g, '')
    .trim()
  const line = plain.split('\n').find((one) => one.trim() !== '' && !one.trim().startsWith('|')) ?? ''
  const end = /^.*?[.!?](?=\s|$)/.exec(line.trim())?.[0]
  return (end ?? line).trim()
}

const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((one) => one.length > 3),
  )

/** Whether a later finding is an earlier one raised again: the same file, and its title much the same. */
const sameFinding = (later: TaskFinding, earlier: TaskFinding) => {
  if (later.file !== earlier.file) return false
  if ((later.title ?? '') === (earlier.title ?? '')) return true
  const a = words(later.title ?? later.claim)
  const b = words(earlier.title ?? earlier.claim)
  const shared = [...a].filter((one) => b.has(one)).length
  return shared >= Math.min(3, Math.min(a.size, b.size))
}

const rowOf = (finding: TaskFinding, earlier: ReadonlyArray<TaskFinding>): Row => ({
  id: finding.id,
  round: finding.round,
  weight: finding.severity,
  title: finding.title ?? firstSentence(finding.claim),
  claim: finding.claim,
  at: finding.file === null ? null : finding.line === null ? finding.file : `${finding.file}:${finding.line}`,
  state: finding.state,
  reason: finding.reason,
  commit: finding.commit,
  again: earlier.find((one) => one.round < finding.round && sameFinding(finding, one))?.id ?? null,
  yours: finding.state === 'set_aside' && finding.severity === 'blocking',
})

const turnOf = (round: Round, noted: ReadonlyArray<string>): LeadTurn => {
  const report = round.report?.result ?? null
  const said = round.result?.text ?? null
  return {
    kind: 'lead',
    id: round.id,
    round,
    step: report?.step ?? null,
    intent: round.ack === null ? null : firstSentence(round.ack.text),
    outcome: report !== null && report.summary.trim() !== '' ? report.summary : said === null ? null : firstSentence(said),
    noted,
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What a review's rows came to, in a few words: 4 found · 3 fixed · 1 kept. */
export const tallyOf = (rows: ReadonlyArray<Row>, passed: boolean): string => {
  if (rows.length === 0) return passed ? 'Passed' : 'Changes asked'
  const fixed = rows.filter((one) => one.state === 'fixed').length
  const yours = rows.filter((one) => one.yours).length
  const kept = rows.filter((one) => one.state === 'set_aside' && !one.yours).length
  const open = rows.filter((one) => one.state === 'open').length
  return [
    plural(rows.length, 'finding'),
    fixed > 0 ? `${fixed} fixed` : null,
    kept > 0 ? `${kept} kept` : null,
    yours > 0 ? `${yours} needs you` : null,
    open > 0 ? `${open} open` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** What a review came to, as short as a stop on the rail says it: 3 of 4 fixed, 1 needs you, Passed. */
const railSum = (cycle: Cycle): string => {
  const rows = cycle.rows
  if (rows.length === 0) return cycle.passed ? 'Passed' : 'Changes asked'
  const yours = rows.filter((one) => one.yours).length
  const open = rows.filter((one) => one.state === 'open').length
  const fixed = rows.filter((one) => one.state === 'fixed').length
  if (yours > 0) return `${yours} needs you`
  if (open > 0) return `${open} open`
  return fixed === rows.length ? `${fixed} fixed` : `${fixed} of ${rows.length} fixed`
}

/** Reads a task's thread, in rounds as the app has them, as what happened and where it stands. */
export const storyOf = (
  rounds: ReadonlyArray<RoundBlock>,
  snapshot: ThreadSnapshot | null,
  findings: ReadonlyArray<TaskFinding>,
): Story => {
  // Who reviews: whoever reported a review.
  const reviewers = new Set(
    rounds.flatMap((block) => (block.kind === 'verdict' && block.result.agentId !== null ? [block.result.agentId] : [])),
  )
  const beats: Beat[] = []
  const cycles: Cycle[] = []
  const turns: LeadTurn[] = []
  let noise: string[] = []
  let reviewing: Round[] = []
  let noted: string[] = []
  const lastTurn = () => beats.findLast((beat): beat is LeadTurn => beat.kind === 'lead')
  for (const block of rounds) {
    switch (block.kind) {
      case 'round': {
        // A reviewer's work, before its verdict.
        if (block.agentId !== null && reviewers.has(block.agentId) && block.report === null) {
          reviewing.push(block)
          break
        }
        const turn = turnOf(block, noted)
        noted = []
        turns.push(turn)
        const cycle = cycles.at(-1)
        if (turn.step === 'settle' && cycle !== undefined && cycle.settle === null && cycle.round === block.report?.result.round) {
          cycles[cycles.length - 1] = { ...cycle, settle: turn }
          beats[beats.indexOf(cycle)] = cycles[cycles.length - 1]!
        } else beats.push(turn)
        break
      }
      case 'althar': {
        if (NOISE.some((pattern) => pattern.test(block.text))) noise.push(block.text)
        else if (block.tone === 'warning') beats.push({ kind: 'block', id: block.id, block })
        else {
          // News that the task's state says again (a pull request opened): with the turn before it.
          const turn = lastTurn()
          if (turn === undefined) noted.push(block.text)
          else beats[beats.indexOf(turn)] = { ...turn, noted: [...turn.noted, block.text] }
        }
        break
      }
      case 'verdict': {
        const round = block.result.round
        const raised = findings.filter((one) => one.round === round)
        const fallback = block.result.findings.map((finding, index): TaskFinding => ({
          id: `${block.id}-${index}`,
          review: block.id,
          round,
          severity: finding.severity,
          title: finding.title ?? null,
          claim: finding.claim,
          file: finding.file,
          line: finding.line,
          at: null,
          state: 'open',
          reason: null,
          commit: null,
        }))
        const cycle: Cycle = {
          kind: 'review',
          id: block.id,
          round,
          at: block.at,
          agentId: block.result.agentId,
          passed: block.result.verdict === 'pass',
          notes: block.result.summary,
          rows: (raised.length > 0 ? raised : fallback).map((one) => rowOf(one, findings)),
          work: reviewing,
          noise,
          settle: null,
        }
        reviewing = []
        noise = []
        cycles.push(cycle)
        beats.push(cycle)
        break
      }
      default:
        beats.push({ kind: 'block', id: block.id, block })
    }
  }
  // What it built, as last said, with what the latest report showed.
  const reported = turns.filter((turn) => turn.round.report !== null)
  const builtBy = reported.findLast((turn) => turn.round.report?.result.built != null)
  const latest = reported.at(-1) ?? null
  const lastWord = turns.findLast((turn) => turn.round.result !== null)
  const built = builtBy?.round.report?.result.built ?? lastWord?.round.result?.text ?? null
  const report = latest?.round.report ?? null
  const handoff: Handoff | null =
    built === null
      ? null
      : {
          built,
          from: builtBy ?? lastWord ?? null,
          pieces: report === null ? [] : piecesOf(report.id, report.result.evidence),
          unverified: reported.findLast((turn) => turn.round.report?.result.unverified != null)?.round.report?.result.unverified ?? [],
        }
  // Every finding once, by the first round it was raised in, as it stands after the last round that raised it.
  const all = cycles.flatMap((cycle) => cycle.rows)
  const first = (row: Row): Row => {
    const earlier = row.again === null ? undefined : all.find((one) => one.id === row.again)
    return earlier === undefined ? row : first(earlier)
  }
  const chains = new Map<string, Row[]>()
  for (const row of all) chains.set(first(row).id, [...(chains.get(first(row).id) ?? []), row])
  const order = (row: Row) => (row.yours ? 0 : row.state === 'open' ? 1 : row.state === 'set_aside' ? 2 : 3)
  const ledger = [...chains.values()]
    .map((chain) => ({ ...chain.at(-1)!, rounds: chain.map((one) => one.round) }))
    .sort((a, b) => order(a) - order(b))
  const calls = snapshot?.attention ?? []
  const change = snapshot?.task.changes.at(-1) ?? null
  // The rail: its work, each review with its settle, and publishing.
  const implement = turns.find((turn) => turn.step === 'implement')
  const publishing = snapshot?.task.step === 'publish'
  const published = beats.some((beat) => beat.kind === 'block' && beat.block.kind === 'published')
  const rail: Stop[] = [
    ...(implement === undefined
      ? []
      : [
          {
            id: implement.id,
            name: 'Implement',
            sum: (implement.round.work?.took ?? '').replace(/^(\d+[hm])(?: \d+[ms])+$/, '$1'),
            state: 'done' as const,
          },
        ]),
    ...cycles.map((cycle): Stop => ({
      id: cycle.id,
      name: `Review ${cycle.round + 1}`,
      sum: railSum(cycle),
      state: cycle.rows.some((row) => row.yours) ? 'yours' : 'done',
    })),
    ...(change === null && !publishing && !published
      ? []
      : [
          {
            id: 'publish',
            name: 'Publish',
            sum:
              publishing && calls.length > 0 ? 'Waits on you' : change === null ? '' : `${change.short} ${change.prefix}${change.number}`,
            state: publishing && calls.length > 0 ? ('yours' as const) : publishing ? ('now' as const) : ('done' as const),
          },
        ]),
  ]
  return {
    beats,
    cycles,
    turns,
    handoff,
    ledger,
    yours: { findings: ledger.filter((row) => row.yours), calls },
    change,
    rail,
  }
}
