// Scrappy: the parts every direction shares, made of the kit's own pieces (its Round, WorkLine, Checked, Model, Ask, Markdown, Fold) in its tokens.
import { type ReactNode, useState } from 'react'

import type { AttentionRequest, ChangeSummary } from '../../../contracts/src/index'
import {
  Button,
  Caret,
  Checked,
  Disclosure,
  DisclosureTrigger,
  Fact,
  FactLine,
  Fold,
  Icon,
  LinkButton,
  Markdown,
  Model,
  type ModelInfo,
  NeedLine,
  type ProjectRef,
  NeedList,
  reviewerText,
  Round as KitRound,
  Tooltip,
  WorkLine,
  WorkNote,
  WorkSaid,
} from '../../src/index'

import { piecesOf } from '../../../../apps/desktop/src/renderer/shared/evidence'
import type { WorkStep } from '../../../../apps/desktop/src/renderer/shared/rounds'
import { PartView } from '../../../../apps/desktop/src/renderer/shared/ThreadBlocks'
import { cx } from '../../src/lib/cx'
import s from './parts.module.css'
import { proto, useProto } from './state'
import type { Cycle, Handoff, LeadTurn, Row, Stop } from './story'
import { tallyOf } from './story'

/* ——— Words ——— */

export const words = {
  review: (round: number) => `Review ${round + 1}`,
  fixed: 'Fixed',
  kept: 'Kept',
  yours: 'Needs you',
  open: 'Open',
  again: 'again',
  notes: 'Reviewer’s notes',
  readAll: 'Whole message',
  less: 'Less',
  checks: (n: number) => (n === 1 ? '1 check' : `${n} checks`),
  notChecked: (n: number) => `${n} not checked`,
  settled: 'Settled it',
  standing: 'Where it stands',
  decide: 'Needs your decision',
  leave: 'Leave it as it is',
  fix: 'Ask for a fix',
  left: 'Left as it is',
  askedFix: 'Asked the lead to fix it',
  undo: 'Undo',
  checksPassed: 'Checks passed',
  checksFailed: (n: number) => `${n} ${n === 1 ? 'check' : 'checks'} failed`,
  checksRunning: 'Checks running',
  draft: 'Draft',
  passed: 'Passed',
  nothingFound: 'Nothing found',
  worked: (took: string) => `worked ${took}`,
  publishWaits: 'Publishing waits on you.',
  needs: 'Needs you',
  permission: 'Permission',
  decision: 'Decision',
  allow: 'Allow once',
  deny: 'Deny',
  allowed: 'Allowed',
  denied: 'Denied',
  once: 'Once',
}

/* ——— A lead's turn, short: what it set out to do, and what came of it ——— */

/** One step of a turn's work, as the thread's sheet draws it. */
export function StepView({ step, threadId }: { step: WorkStep; threadId: string }) {
  if (step.kind === 'message') return <WorkSaid source={step.text} />
  if (step.kind === 'aside') return <WorkNote>{step.text}</WorkNote>
  return <PartView part={step} threadId={threadId} />
}

/** What it checked, as one chip that opens the kit's own list; what it couldn't, quieter, in the same fold. */
export function ChecksChip({
  id,
  evidence,
  unverified,
}: {
  id: string
  evidence: Parameters<typeof piecesOf>[1]
  unverified: ReadonlyArray<string>
}) {
  const pieces = piecesOf(id, evidence).filter((piece) => piece.form !== 'picture')
  const failed = pieces.filter((piece) => piece.form === 'output' && piece.exit !== undefined && piece.exit !== 0).length
  if (pieces.length === 0 && unverified.length === 0) return null
  return (
    <Disclosure className={s.checks}>
      <DisclosureTrigger>
        <button type="button" className={s.chip}>
          {pieces.length > 0 && (
            <span className={s.chipPart}>
              <Icon name={failed > 0 ? 'close' : 'check'} size={11} className={failed > 0 ? s.bad : s.good} />
              {words.checks(pieces.length)}
            </span>
          )}
          {unverified.length > 0 && <span className={s.quiet}>{words.notChecked(unverified.length)}</span>}
          <Caret />
        </button>
      </DisclosureTrigger>
      <Fold bleed={false}>
        <Checked className={s.checkedList} pieces={pieces} unverified={unverified} />
      </Fold>
    </Disclosure>
  )
}

/** A turn of the lead's, in two lines: what it set out to do, and what came of it; its work, checks and whole message a press away. */
export function TurnLines({ turn, threadId, quiet = false }: { turn: LeadTurn; threadId: string; quiet?: boolean }) {
  const [whole, setWhole] = useState(false)
  const work = turn.round.work
  const report = turn.round.report
  const message = turn.round.result?.text ?? null
  return (
    <div className={s.turn}>
      {turn.intent !== null && <p className={s.intent}>{turn.intent}</p>}
      {work !== null && (
        <WorkLine took={work.took} summary={work.counts} live={work.live}>
          {work.steps.length === 0 ? undefined : work.steps.map((step) => <StepView key={step.id} step={step} threadId={threadId} />)}
        </WorkLine>
      )}
      {turn.outcome !== null && !whole && (
        <div className={quiet ? s.outcomeQuiet : s.outcome}>
          <Markdown source={turn.outcome} />
        </div>
      )}
      {whole && message !== null && (
        <div className={s.whole}>
          <Markdown source={message} />
        </div>
      )}
      <div className={s.chips}>
        {report !== null && turn.said !== false && (
          <ChecksChip id={report.id} evidence={report.result.evidence} unverified={report.result.unverified ?? []} />
        )}
        {message !== null && message !== turn.outcome && (
          <LinkButton className={s.readAll} onClick={() => setWhole(!whole)}>
            {whole ? words.less : words.readAll}
          </LinkButton>
        )}
      </div>
      {turn.noted.length > 0 && <p className={s.noted}>{turn.noted.join(' ')}</p>}
    </div>
  )
}

/** A lead's turn as a round of the thread: its name, then its two lines. */
export function ShortTurn({ turn, model, threadId }: { turn: LeadTurn; model: ModelInfo; threadId: string }) {
  return (
    <KitRound model={model} at={turn.round.at} data-item={turn.id}>
      <TurnLines turn={turn} threadId={threadId} />
    </KitRound>
  )
}

/* ——— A review, with the settle that answers it, as one card ——— */

/** A file's name and line, without its folders: Runs.ts:2274. */
const shortAt = (at: string) => at.slice(at.lastIndexOf('/') + 1)

/** What became of a finding, in a word, with its commit. */
export function Outcome({ row }: { row: Row }) {
  if (row.yours) return <span className={s.yours}>{words.yours}</span>
  if (row.state === 'fixed')
    return (
      <span className={s.fixed}>
        <Icon name="check" size={11} className={s.good} />
        {words.fixed}
        {row.commit !== null && <code className={s.commit}>{row.commit.slice(0, 7)}</code>}
      </span>
    )
  if (row.state === 'set_aside') return <span className={s.kept}>{words.kept}</span>
  return <span className={s.open}>{words.open}</span>
}

/** A finding in a line: how much it matters, what, where, and what became of it; opened, the reviewer's words and the lead's. */
export function FindingRow({ row, rounds }: { row: Row; rounds?: ReadonlyArray<number> }) {
  const heavy = row.weight === 'blocking' || row.weight === 'major'
  const done = row.state === 'fixed'
  return (
    <Disclosure className={s.finding} data-state-of={row.state}>
      <DisclosureTrigger>
        <button type="button" className={s.row}>
          <span className={heavy && !done ? s.heavy : s.weight}>{reviewerText.weight[row.weight]}</span>
          <span className={s.head}>
            <span className={done ? s.titleDone : s.title} title={row.title}>
              {row.title}
            </span>
            {rounds !== undefined && rounds.length > 1 ? (
              <span className={s.again} title={`Found in reviews ${rounds.map((one) => one + 1).join(' and ')}`}>
                {words.again}
              </span>
            ) : (
              row.again !== null && <span className={s.again}>{words.again}</span>
            )}
          </span>
          {row.at !== null && (
            <code className={s.at} title={row.at}>
              {shortAt(row.at)}
            </code>
          )}
          <Outcome row={row} />
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
              </span>
            </p>
          )}
        </div>
      </Fold>
    </Disclosure>
  )
}

/** What the reviewer said besides its findings: one line showing, the rest a press away. */
export function ReviewerNotes({ notes }: { notes: string }) {
  if (notes.trim() === '') return null
  return (
    <Disclosure className={s.notes}>
      <DisclosureTrigger>
        <button type="button" className={s.notesRow}>
          <Caret />
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

/** What Althar did to the reviewer along the way, behind a mark on the card's line. */
export function Noise({ noise }: { noise: ReadonlyArray<string> }) {
  if (noise.length === 0) return null
  return (
    <Tooltip label={noise.join(' ')}>
      <button type="button" className={s.noise} aria-label={noise.join(' ')}>
        <Icon name="load" size={11} />
        {noise.length > 1 && <span>{noise.length}</span>}
      </button>
    </Tooltip>
  )
}

/** What a review found and what the settle did, inside a card or a stop: rows, the reviewer's notes, then the lead's two lines. */
export function CycleBody({ cycle, lead, threadId }: { cycle: Cycle; lead: ModelInfo; threadId: string }) {
  return (
    <div className={s.cycleBody}>
      {cycle.rows.length > 0 && (
        <div className={s.rows}>
          {cycle.rows.map((row) => (
            <FindingRow key={row.id} row={row} />
          ))}
        </div>
      )}
      <ReviewerNotes notes={cycle.notes} />
      {cycle.settle !== null && (
        <div className={s.settle}>
          <div className={s.settleHead}>
            <Model model={lead} />
            <span className={s.quiet}>{cycle.settle.round.at}</span>
          </div>
          <TurnLines turn={cycle.settle} threadId={threadId} quiet />
        </div>
      )}
    </div>
  )
}

/** A review and the settle that answers it, as one card: its line, and opened, what it found and what became of it. */
export function CycleCard({
  cycle,
  reviewer,
  lead,
  threadId,
  defaultOpen,
}: {
  cycle: Cycle
  reviewer: ModelInfo
  lead: ModelInfo
  threadId: string
  defaultOpen: boolean
}) {
  const yours = cycle.rows.some((row) => row.yours)
  return (
    <Disclosure defaultOpen={defaultOpen} className={s.card} data-rhythm="step" data-item={cycle.id}>
      <div className={s.cardHead}>
        <DisclosureTrigger>
          <button type="button" className={s.cardLine}>
            <Caret />
            <span className={s.cardName}>{words.review(cycle.round)}</span>
            <Model model={reviewer} className={s.reviewer} />
            <span className={yours ? s.tallyYours : s.tally}>
              {cycle.rows.length === 0 ? (cycle.passed ? words.passed : words.nothingFound) : tallyOf(cycle.rows, cycle.passed)}
            </span>
          </button>
        </DisclosureTrigger>
        <Noise noise={cycle.noise} />
        <span className={s.cardAt}>{cycle.at}</span>
      </div>
      <Fold bleed={false}>
        <CycleBody cycle={cycle} lead={lead} threadId={threadId} />
      </Fold>
    </Disclosure>
  )
}

/* ——— What needs the person ——— */

/** Whose it is: drawn by no line here, as the task's own lines needn't say. */
const PROJECT = { seed: 'p1', ink: 'clay', name: 'althar' } as unknown as ProjectRef

/**
 * Everything that waits on the person, in one place and the home's own lines: the rules' calls first, as they hold the task
 * up, then the blocking findings its lead kept, each a decision with the decision on it. Answered, a line goes quiet where it is.
 */
export function NeedsYou({
  calls,
  findings,
  onPassOn,
  className,
}: {
  calls: ReadonlyArray<AttentionRequest>
  findings: ReadonlyArray<Row>
  project?: string
  onPassOn?: (words: string) => void
  className?: string
}) {
  const { answers } = useProto()
  if (calls.length === 0 && findings.length === 0) return null
  const decide = (row: Row, said: string, toLead: string) => {
    proto.answer(row.id, said)
    onPassOn?.(toLead)
  }
  return (
    <NeedList whose={false} className={cx(s.needs, className)} aria-label={words.needs}>
      {calls.map((call) => {
        const said = answers[call.id]
        return (
          <NeedLine
            key={call.id}
            kind={said === undefined ? words.permission : said === 'reject' ? words.denied : words.allowed}
            project={PROJECT}
            title={call.title}
            {...(call.command === null ? {} : { command: call.command })}
            {...(said === undefined
              ? {
                  actions: (
                    <>
                      <Button size="small" onClick={() => proto.answer(call.id, 'reject')}>
                        {words.deny}
                      </Button>
                      <Button size="small" variant="signal" onClick={() => proto.answer(call.id, 'allow')}>
                        {words.allow}
                      </Button>
                    </>
                  ),
                }
              : { answer: said === 'reject' ? { said: words.denied, denied: true } : { said: words.allowed, note: words.once } })}
          />
        )
      })}
      {findings.map((row) => {
        const said = answers[row.id]
        return (
          <NeedLine
            key={row.id}
            kind={words.decision}
            project={PROJECT}
            title={row.title}
            {...(row.reason === null ? {} : { brief: row.reason.replace(/[`*_]/g, '') })}
            {...(said === undefined
              ? {
                  actions: (
                    <>
                      <Button size="small" onClick={() => decide(row, words.left, `Leave it as it is: ${row.title}.`)}>
                        {words.leave}
                      </Button>
                      <Button size="small" variant="signal" onClick={() => decide(row, words.askedFix, `Fix it: ${row.title}.`)}>
                        {words.fix}
                      </Button>
                    </>
                  ),
                }
              : { answer: { said } })}
          />
        )
      })}
    </NeedList>
  )
}

/* ——— Where it stands ——— */

/** The facts of where it stands, the most pressing first: its pull request, its checks, its reviews. */
export function StandingFacts({
  change,
  cycles,
  ledger,
}: {
  change: ChangeSummary | null
  cycles: ReadonlyArray<Cycle>
  ledger: ReadonlyArray<Row>
  waits?: number
}) {
  const last = cycles.at(-1)
  const facts: ReactNode[] = []
  if (change !== null) {
    const checks = change.checks
    if (checks !== null && checks.outcome === 'failed')
      facts.push(
        <Fact key="checks" icon="close" tone="danger">
          {words.checksFailed(checks.failed)}
        </Fact>,
      )
    facts.push(
      <Fact key="pr" icon="pr">
        {`${change.short} ${change.prefix}${change.number}${change.draft ? ` · ${words.draft}` : ''}`}
      </Fact>,
    )
    if (checks !== null && checks.outcome === 'passed')
      facts.push(
        <Fact key="checks" icon="check" tone="ok">
          {words.checksPassed}
        </Fact>,
      )
    if (checks !== null && checks.outcome === 'running')
      facts.push(
        <Fact key="checks" tone="live">
          {words.checksRunning}
        </Fact>,
      )
  }
  if (last !== undefined) {
    const fixed = ledger.filter((row) => row.state === 'fixed').length
    const reviews = cycles.length === 1 ? 'Reviewed once' : `Reviewed ${cycles.length} times`
    facts.push(
      <Fact key="review" icon={last.passed ? 'check' : 'answer'} tone={last.passed ? 'ok' : 'quiet'}>
        {ledger.length === 0
          ? `${reviews}, nothing found`
          : `${reviews} · ${fixed === ledger.length ? `${fixed} findings fixed` : `${fixed} of ${ledger.length} findings fixed`}`}
      </Fact>,
    )
  }
  return <FactLine className={s.facts}>{facts}</FactLine>
}

/** What the task built, as it stands, where it stands, and what it checked: the lead's handoff, as one quiet card. */
export function HandoffCard({
  handoff,
  lead,
  facts,
  kicker = words.standing,
  id,
}: {
  handoff: Handoff
  lead: ModelInfo
  facts: ReactNode
  kicker?: string
  id?: string
}) {
  const report = handoff.from?.round.report ?? null
  return (
    <article className={s.handoff} aria-label={kicker} id={id} data-item="handoff">
      <header className={s.handoffHead}>
        <span className={s.kicker}>{kicker}</span>
        <Model model={lead} className={s.handoffBy} />
        {handoff.from !== null && <span className={s.quiet}>{handoff.from.round.at}</span>}
      </header>
      <div className={s.built}>
        <Markdown source={handoff.built} />
      </div>
      {facts}
      {report !== null && <ChecksChip id={`handoff-${report.id}`} evidence={report.result.evidence} unverified={handoff.unverified} />}
    </article>
  )
}

/** The same, as the words of an answer rather than a card: what it built, where it stands, what it checked. */
export function HandoffBody({ handoff, facts }: { handoff: Handoff; facts: ReactNode }) {
  const report = handoff.from?.round.report ?? null
  return (
    <div className={s.handoffBody} data-item="handoff">
      <div className={s.built}>
        <Markdown source={handoff.built} />
      </div>
      {facts}
      {report !== null && <ChecksChip id={`handoff-${report.id}`} evidence={report.result.evidence} unverified={handoff.unverified} />}
    </div>
  )
}

/* ——— The rail of what it went through ——— */

/** Its steps as stops on a line, each opening what happened there; the one open drawn as chosen. */
export function Rail({ stops, open, onOpen }: { stops: ReadonlyArray<Stop>; open: string | null; onOpen: (id: string | null) => void }) {
  return (
    <ol className={s.rail} style={{ '--n': stops.length } as React.CSSProperties} aria-label="What it went through">
      {stops.map((stop) => (
        <li key={stop.id} className={s.stop} data-state={stop.state}>
          <i className={s.bar} />
          <button
            type="button"
            className={s.stopButton}
            aria-expanded={open === stop.id}
            data-open={open === stop.id || undefined}
            onClick={() => onOpen(open === stop.id ? null : stop.id)}
          >
            <span className={s.stopName}>{stop.name}</span>
            <span className={s.stopSum}>{stop.sum}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}
