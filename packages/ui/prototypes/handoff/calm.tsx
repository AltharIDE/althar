// Scrappy: the calm parts every take shares, all of them the kit's own pieces. Anything that is work, a review included, is
// the thread's one faint line (WorkLine) that opens in place; a lead's words are its Round; what it checked is a line too;
// what waits on the person is a short quiet list with the answers on it.
import type { ReactNode, Ref } from 'react'

import type { AttentionRequest } from '../../../contracts/src/index'
import {
  Button,
  Checked,
  Disclosure,
  DisclosureTrigger,
  Fold,
  Icon,
  Markdown,
  type ModelInfo,
  Round as KitRound,
  WorkLine,
  WorkNote,
  WorkSaid,
} from '../../src/index'

import { piecesOf } from '../../../../apps/desktop/src/renderer/shared/evidence'
import type { Round, WorkStep } from '../../../../apps/desktop/src/renderer/shared/rounds'
import { PartView } from '../../../../apps/desktop/src/renderer/shared/ThreadBlocks'
import { cx } from '../../src/lib/cx'
import s from './calm.module.css'
import { proto, useProto } from './state'
import type { Cycle, Handoff, LeadTurn, Row } from './story'
import { firstSentence } from './story'

/* ——— Words ——— */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)

export const words = {
  reviewed: 'reviewed it',
  reviewedAgain: 'reviewed it again',
  reviewedTimes: (n: number) => `reviewed it ${times(n)}`,
  notes: 'Reviewer’s notes',
  checked: (n: number) => (n === 0 ? 'Nothing checked' : `Checked ${plural(n, 'thing')}`),
  notChecked: (n: number) => `${n} not checked`,
  fixed: 'Fixed',
  kept: 'Left as it is',
  yours: 'Yours to decide',
  open: 'Open',
  allow: 'Allow once',
  deny: 'Deny',
  allowed: 'Allowed once',
  denied: 'Denied',
  leave: 'Leave it as it is',
  fix: 'Have it fixed',
  left: 'Left as it is',
  askedFix: 'Asked for a fix',
  needs: 'Needs you',
  howItGotHere: 'How it got here',
}

/** What a review came to, in a few words: 4 findings, 3 fixed, 1 left as it is. */
export const cameTo = (rows: ReadonlyArray<Row>, passed: boolean): string => {
  if (rows.length === 0) return passed ? 'nothing to change' : 'changes asked'
  const fixed = rows.filter((one) => one.state === 'fixed').length
  const yours = rows.filter((one) => one.yours).length
  const kept = rows.filter((one) => one.state === 'set_aside' && !one.yours).length
  const open = rows.filter((one) => one.state === 'open').length
  return [
    plural(rows.length, 'finding'),
    fixed > 0 ? `${fixed} fixed` : null,
    kept > 0 ? `${kept} left as is` : null,
    yours > 0 ? `${yours} for you` : null,
    open > 0 ? `${open} open` : null,
  ]
    .filter(Boolean)
    .join(', ')
}

/** How long, from the thread's own "42m 0s", "1h 3m": in seconds. */
const secondsOf = (took: string) =>
  Number(/(\d+)h/.exec(took)?.[1] ?? 0) * 3600 + Number(/(\d+)m/.exec(took)?.[1] ?? 0) * 60 + Number(/(\d+)s/.exec(took)?.[1] ?? 0)

/** All the work of some rounds, said as the thread says one: 1h 16m. */
export const tookAll = (rounds: ReadonlyArray<Round>) => {
  const total = rounds.reduce((sum, round) => sum + secondsOf(round.work?.took ?? ''), 0)
  const hours = Math.floor(total / 3600)
  const minutes = Math.round((total % 3600) / 60)
  return hours > 0 ? `${hours}h ${minutes}m` : `${Math.max(1, minutes)}m`
}

/* ——— Work, as the thread's sheet draws it ——— */

function StepView({ step, threadId }: { step: WorkStep; threadId: string }) {
  if (step.kind === 'message') return <WorkSaid source={step.text} />
  if (step.kind === 'aside') return <WorkNote>{step.text}</WorkNote>
  return <PartView part={step} threadId={threadId} />
}

/** A round's steps, and where its words aren't shown elsewhere, its words last. */
export const stepsOf = (round: Round, threadId: string, said = false): ReactNode => {
  const steps = round.work?.steps ?? []
  const ack = said && round.ack !== null ? [<WorkSaid key="ack" source={round.ack.text} />] : []
  const last = said && round.result !== null ? [<WorkSaid key="said" source={round.result.text} />] : []
  const all = [...ack, ...steps.map((step) => <StepView key={step.id} step={step} threadId={threadId} />), ...last]
  return all.length === 0 ? undefined : all
}

/** A round's work, in its faint line. */
export function Work({ round, threadId, said = false }: { round: Round; threadId: string; said?: boolean }) {
  if (round.work === null) return null
  return (
    <WorkLine took={round.work.took} summary={round.work.counts} live={round.work.live}>
      {stepsOf(round, threadId, said)}
    </WorkLine>
  )
}

/** A turn of the lead's as one faint line: who, how long, and what came of it; opened, all of it, its words last. */
export function TurnLine({ turn, lead, threadId }: { turn: LeadTurn; lead: ModelInfo; threadId: string }) {
  const round = turn.round
  const outcome = turn.outcome === null ? undefined : firstSentence(turn.outcome)
  return (
    <div data-rhythm="mark" data-item={turn.id} className={s.line}>
      <WorkLine who={lead} took={round.work?.took ?? ''} {...(outcome === undefined ? {} : { summary: outcome })}>
        {stepsOf(round, threadId, true)}
      </WorkLine>
    </div>
  )
}

/* ——— What it checked ——— */

/** What the latest report checked, as one faint line that opens the kit's own list; what it couldn't, in the same. */
export function ChecksLine({ handoff }: { handoff: Handoff }) {
  const report = handoff.from?.round.report ?? null
  const pieces = report === null ? [] : piecesOf(report.id, report.result.evidence).filter((piece) => piece.form !== 'picture')
  if (pieces.length === 0 && handoff.unverified.length === 0) return null
  return (
    <WorkLine
      took=""
      text={{ worked: () => words.checked(pieces.length) }}
      {...(handoff.unverified.length === 0 ? {} : { summary: words.notChecked(handoff.unverified.length) })}
    >
      <Checked pieces={pieces} unverified={handoff.unverified} />
    </WorkLine>
  )
}

/** What the task built, as it stands, in the lead's words, and what it checked under them. */
export function HandoffWords({ handoff }: { handoff: Handoff }) {
  return (
    <>
      <Markdown source={handoff.built} />
      <ChecksLine handoff={handoff} />
    </>
  )
}

/* ——— A review ——— */

/** A file's name and line, without its folders: Runs.ts:2274. */
const shortAt = (at: string) => at.slice(at.lastIndexOf('/') + 1)

const outcomeOf = (row: Row) =>
  row.yours ? words.yours : row.state === 'fixed' ? words.fixed : row.state === 'set_aside' ? words.kept : words.open

/** A finding in a line: what, where, and what became of it; opened, the reviewer's words and the lead's. */
function Finding({ row }: { row: Row }) {
  return (
    <Disclosure className={s.finding}>
      <DisclosureTrigger>
        <button type="button" className={s.findingRow} data-state-of={row.yours ? 'yours' : row.state}>
          <span className={s.findingTitle} title={row.title}>
            {row.weight === 'blocking' && <span className={s.blocking}>Blocking</span>}
            {row.title}
          </span>
          {row.at !== null && (
            <code className={s.findingAt} title={row.at}>
              {shortAt(row.at)}
            </code>
          )}
          <span className={s.findingOutcome}>{outcomeOf(row)}</span>
        </button>
      </DisclosureTrigger>
      <Fold bleed={false}>
        <div className={s.findingBody}>
          <Markdown source={row.claim} />
          {row.reason !== null && (
            <p className={s.reason}>
              <Icon name="corner" size={11} />
              <span>
                <Markdown source={row.reason} />
                {row.commit !== null && <code className={s.commit}>{row.commit.slice(0, 7)}</code>}
              </span>
            </p>
          )}
        </div>
      </Fold>
    </Disclosure>
  )
}

/** What the reviewer said besides its findings: its first words, the rest a press away. */
function Notes({ notes }: { notes: string }) {
  if (notes.trim() === '') return null
  return (
    <Disclosure className={s.notes}>
      <DisclosureTrigger>
        <button type="button" className={s.notesRow}>
          <Icon name="chevron" size={11} className={s.notesChevron} />
          <span className={s.notesName}>{words.notes}</span>
          <span className={s.notesLine}>{notes.replace(/[`*_]/g, '')}</span>
        </button>
      </DisclosureTrigger>
      <Fold bleed={false}>
        <div className={s.notesBody}>
          <Markdown source={notes} />
        </div>
      </Fold>
    </Disclosure>
  )
}

/** What a review found, the reviewer's notes, and the lead's answer to it, as the sheet a review's line opens. */
export function ReviewSheet({ cycle, lead, threadId }: { cycle: Cycle; lead: ModelInfo; threadId: string }) {
  return (
    <div className={s.sheet}>
      {cycle.rows.length > 0 && (
        <div className={s.findings}>
          {cycle.rows.map((row) => (
            <Finding key={row.id} row={row} />
          ))}
        </div>
      )}
      <Notes notes={cycle.notes} />
      {cycle.settle !== null && <TurnLine turn={cycle.settle} lead={lead} threadId={threadId} />}
    </div>
  )
}

/** A review, with the lead's answer to it, as one faint line in the thread: who, and what came of it. Althar's restarts on hover. */
export function ReviewLine({
  cycle,
  reviewer,
  lead,
  threadId,
  withSettle = true,
  defaultOpen = false,
}: {
  cycle: Cycle
  reviewer: ModelInfo
  lead: ModelInfo
  threadId: string
  /** Its settle inside it; false where the thread shows the settle as a turn of its own. */
  withSettle?: boolean
  defaultOpen?: boolean
}) {
  const shown = withSettle ? cycle : { ...cycle, settle: null }
  return (
    <div data-rhythm="mark" data-item={cycle.id} className={s.line} title={cycle.noise.length === 0 ? undefined : cycle.noise.join(' ')}>
      <WorkLine
        who={reviewer}
        took=""
        text={{ workedBy: () => (cycle.round === 0 ? words.reviewed : words.reviewedAgain) }}
        summary={cameTo(cycle.rows, cycle.passed)}
        defaultOpen={defaultOpen}
      >
        <ReviewSheet cycle={shown} lead={lead} threadId={threadId} />
      </WorkLine>
    </div>
  )
}

/* ——— A lead's turn ——— */

/**
 * A turn of the lead's, as the thread's Round draws it, quieter: what it set out to do, the line of its work, and what came
 * of it in a line or two; its whole message last in its work. Where it is the handoff, what the task has built, whole.
 */
export function Turn({
  turn,
  lead,
  threadId,
  handoff = null,
  at,
  ref,
  children,
}: {
  turn: LeadTurn
  lead: ModelInfo
  threadId: string
  handoff?: Handoff | null
  at?: string
  ref?: Ref<HTMLElement>
  children?: ReactNode
}) {
  const round = turn.round
  const report = round.report?.result ?? null
  // A reply to the person is its own words, whole; a step's turn, what came of it.
  const said = report === null ? (round.result?.text ?? null) : report.summary.trim() === '' ? (round.result?.text ?? null) : report.summary
  const whole = report !== null && round.result !== null && round.result.text !== said
  return (
    <KitRound model={lead} at={at ?? round.at} data-item={turn.id} ref={ref}>
      {round.ack !== null && <Markdown source={round.ack.text} />}
      {round.work !== null && (
        <WorkLine took={round.work.took} summary={round.work.counts} live={round.work.live}>
          {stepsOf({ ...round, ack: null }, threadId, whole || handoff !== null)}
        </WorkLine>
      )}
      {handoff !== null ? <HandoffWords handoff={handoff} /> : said !== null && <Markdown source={said} />}
      {children}
    </KitRound>
  )
}

/* ——— What waits on the person ——— */

/** A call's title without the step it's from: Publish: push … → Push …. */
const plainTitle = (title: string) => {
  const rest = title.replace(/^[A-Z][a-z]+:\s+/, '')
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}
const sentence = (text: string) => {
  const plain = text.replace(/`|\*\*/g, '').trim()
  return /[.!?]$/.test(plain) ? plain : `${plain}.`
}

function Ask({
  title,
  why,
  code,
  said,
  actions,
}: {
  title: string
  why: string | null
  code: string | null
  said: string | undefined
  actions: ReactNode
}) {
  return (
    <div className={s.ask} data-said={said === undefined ? undefined : ''} title={why ?? undefined}>
      <span className={s.dot} aria-hidden="true" />
      <div className={s.askText}>
        <p className={s.askTitle}>{title}</p>
        {why !== null && <p className={s.askWhy}>{why}</p>}
        {code !== null && (
          <code className={s.askCode} title={code}>
            {code}
          </code>
        )}
      </div>
      <div className={s.askActions}>{said === undefined ? actions : <span className={s.askSaid}>{said}</span>}</div>
    </div>
  )
}

/**
 * Everything that waits on the person, in one short list with the answers on it: the rules' calls first, as they hold the
 * task up, then the blocking findings its lead left to them. Answered, a line goes quiet where it is.
 */
export function Asks({
  calls,
  findings,
  onPassOn,
  docked = false,
  bare = false,
  className,
  ref,
}: {
  calls: ReadonlyArray<AttentionRequest>
  findings: ReadonlyArray<Row>
  onPassOn?: ((words: string) => void) | undefined
  /** Over the composer, staying in view as the thread scrolls. */
  docked?: boolean
  /** Inside a message: no card of its own. */
  bare?: boolean
  className?: string
  ref?: Ref<HTMLElement>
}) {
  const { answers } = useProto()
  if (calls.length === 0 && findings.length === 0) return null
  const decide = (row: Row, said: string, toLead: string) => {
    proto.answer(row.id, said)
    onPassOn?.(toLead)
  }
  return (
    <section
      ref={ref}
      className={cx(s.asks, docked && s.docked, bare && s.bare, className)}
      aria-label={words.needs}
      data-rhythm={docked ? 'mark' : undefined}
    >
      {calls.map((call) => (
        <Ask
          key={call.id}
          title={plainTitle(call.title)}
          why={call.reason === null ? null : sentence(call.reason)}
          code={call.command}
          said={answers[call.id]}
          actions={
            <>
              <Button size="small" onClick={() => proto.answer(call.id, words.denied)}>
                {words.deny}
              </Button>
              <Button size="small" variant="signal" onClick={() => proto.answer(call.id, words.allowed)}>
                {words.allow}
              </Button>
            </>
          }
        />
      ))}
      {findings.map((row) => (
        <Ask
          key={row.id}
          title={row.title}
          why={row.reason === null ? null : sentence(row.reason)}
          code={null}
          said={answers[row.id]}
          actions={
            <>
              <Button size="small" onClick={() => decide(row, words.left, `Leave it as it is: ${row.title}.`)}>
                {words.leave}
              </Button>
              <Button size="small" onClick={() => decide(row, words.askedFix, `Fix it: ${row.title}.`)}>
                {words.fix}
              </Button>
            </>
          }
        />
      ))}
    </section>
  )
}
