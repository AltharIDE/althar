import { useState, type ReactNode, type RefObject } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Model, type ModelInfo } from '../../primitives/Model/Model'
import { FindingState, FindingsReach, Severity, StepState, ToolState, Verdict, unreachable } from '../../foundations/vocabulary'
import { findingsReachText, type ChoiceWords } from '../../foundations/vocabularyText'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { useRefocus } from '../../lib/refocus'
import { Rhythm } from '../../lib/rhythm'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import { Disclosure, Fold, type Disclosable } from '../../primitives/Fold/Fold'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Menu, MenuRadioGroup, MenuRadioItem } from '../../primitives/Menu/Menu'
import { NoteForm } from '../../primitives/NoteForm/NoteForm'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { useThreadShell, type DocRef, type StepRef } from '../Shell/Shell'
import { StepMore, StepRow } from '../Step/Step'
import s from './Review.module.css'

/*
 * A review step has a fixed result: a verdict and a list of findings. Each
 * finding says where, what, and who raised it. The lead settles findings by
 * default: it fixes what holds and sets aside what does not, with a reason.
 * A finding reaches you only when the lead cannot settle it, or when the
 * project says every finding should wait for you. You can still step in on
 * any, and every answer can be taken back until the lead acts on it.
 *
 * The findings are the consumer's data. Each answer comes back as the whole
 * list and as the one change that made it, so the consumer can send the
 * change to the lead without comparing lists. What an answer can be undone
 * to is remembered here, for the session, not written into the data.
 */

export interface ReviewFinding {
  id: string
  severity: Severity
  /** Where: a path and line. */
  at: string
  /** The reviewers that raised it. */
  by: readonly ModelInfo[]
  state: FindingState
  claim: string
  /** A reviewer that disagrees, and why. */
  against?: { model: ModelInfo; text: string }
  /** The lead's question, for a finding that waits on you. */
  ask?: string
  /** Why it was set aside or dismissed. */
  reason?: string
  /** What you told the lead to do instead. */
  told?: string
  /** The round the lead fixed it in. */
  round?: number
}

/** One answer to a finding: what it was, what it is now, and what you said with it. */
export interface FindingChange {
  id: string
  from: FindingState
  to: FindingState
  /** What you told the lead, or why you dismissed it. */
  note?: string
}

export interface ReviewerInfo {
  model: ModelInfo
  /** While the review runs: this reviewer's progress. */
  state?: ToolState
  /** While the review runs: what it is doing, how far along. */
  meta?: string
}

export interface ReviewText {
  label: string
  round: (n: number) => string
  severity: Record<Severity, string>
  verdict: Record<Verdict, string>
  reviewing: (n: number) => string
  combine: string
  combineNote: (reviewers: number) => string
  tally: {
    yours: (n: number) => string
    toLead: (n: number) => string
    all: (n: number) => string
    open: (open: number, of: number) => string
    fixed: (n: number) => string
    aside: (n: number) => string
  }
  byLead: string
  detail: string
  needsCall: string
  disagrees: string
  haveFixed: string
  sayWhat: string
  dismiss: string
  undo: string
  reopen: string
  addReason: string
  leftToLead: string
  leftToLeadNote: string
  /** Fixed by the lead, in a round when the consumer says which. */
  fixedIn: (round?: number) => string
  askedFix: string
  askedFixNote: string
  toldLead: string
  toldLeadNote: string
  setAside: string
  dismissed: string
  dismissedNote: string
  keptNote: string
  tellPlaceholder: string
  reasonPlaceholder: string
  send: string
  save: string
  cancel: string
  skip: string
  emptyTell: string
  emptyReason: string
  leaveRest: (all: boolean) => string
  leaveRestNote: string
  instructions: (name: string) => string
}

export const reviewText: ReviewText = {
  label: 'Review',
  round: (n) => `round ${n}`,
  severity: { [Severity.High]: 'High', [Severity.Medium]: 'Medium', [Severity.Low]: 'Low' },
  verdict: { [Verdict.Pass]: 'Passed', [Verdict.Changes]: 'Changes requested', [Verdict.Blocked]: 'Blocked' },
  reviewing: (n) => `${n} reviewers, then combined`,
  combine: 'Combine',
  combineNote: (n) => `waits for ${n === 2 ? 'both' : `all ${n}`} · merges duplicates · reports disagreement`,
  tally: {
    yours: (n) => `${n} for you`,
    toLead: (n) => `${n} back to the lead`,
    all: (n) => `${n} findings`,
    open: (open, of) => `${open} of ${of} open`,
    fixed: (n) => `${n} fixed`,
    aside: (n) => `${n} set aside`,
  },
  byLead: 'by the lead',
  detail: 'Findings',
  needsCall: 'Needs your call',
  disagrees: 'disagrees:',
  haveFixed: 'Have it fixed',
  sayWhat: 'Say what to do',
  dismiss: 'Dismiss',
  undo: 'Undo',
  reopen: 'Reopen',
  addReason: 'Add a reason',
  leftToLead: 'Left to the lead',
  leftToLeadNote: '· it fixes or sets aside, and says why',
  fixedIn: (round) => (round ? `Fixed by the lead in round ${round}` : 'Fixed by the lead'),
  askedFix: 'You asked the lead to fix it',
  askedFixNote: '· in its next round',
  toldLead: 'You told the lead',
  toldLeadNote: '· instead of the fix it suggests',
  setAside: 'Set aside by the lead',
  dismissed: 'Dismissed by you',
  dismissedNote: '· sent to the lead',
  keptNote: ' · kept for future reviews',
  tellPlaceholder: 'What the lead should do instead',
  reasonPlaceholder: 'Why it does not apply. Next reviews will know',
  send: 'Send to the lead',
  save: 'Save',
  cancel: 'Cancel',
  skip: 'Skip',
  emptyTell: 'Say what the lead should do',
  emptyReason: 'Write a reason, or skip',
  leaveRest: (all) => `Leave ${all ? 'them' : 'the rest'} to the lead`,
  leaveRestNote: 'It fixes or sets aside each one, and says why',
  instructions: (name) => `Reviewed with your instructions · ${name}`,
}

/** A finding you can still act on: nothing has been decided about it. */
const live = (f: ReviewFinding) => f.state === FindingState.Open || f.state === FindingState.Yours

/** The review's line, in a few words: what is for you, what went back, or how they were settled. */
function tally(items: readonly ReviewFinding[], pass: boolean, t: ReviewText) {
  const count = (st: FindingState) => items.filter((f) => f.state === st).length
  const unsettled = count(FindingState.Open) + count(FindingState.Yours)
  const mine = count(FindingState.Yours) + (pass ? count(FindingState.Open) : 0)
  const toLead = count(FindingState.ToFix) + count(FindingState.Told) + count(FindingState.Lead)
  const aside = count(FindingState.Aside) + count(FindingState.Dismissed)
  const fixed = count(FindingState.Fixed)
  const words = (): string => {
    if (mine) return t.tally.yours(mine)
    if (toLead && !unsettled) return t.tally.toLead(toLead)
    if (unsettled === items.length) return t.tally.all(items.length)
    if (unsettled) return t.tally.open(unsettled, items.length)
    return [fixed > 0 && t.tally.fixed(fixed), aside > 0 && t.tally.aside(aside)].filter(Boolean).join(', ')
  }
  return { text: words(), mine, unsettled, toLead }
}

export interface ReviewProps extends Disclosable {
  /** Where in the task's graph: step n of `of`. */
  n: number
  of: number
  reviewers: readonly ReviewerInfo[]
  /** Running while the reviewers work; Done once combined. */
  state?: StepState.Running | StepState.Done
  verdict?: Verdict
  findings?: readonly ReviewFinding[]
  defaultFindings?: readonly ReviewFinding[]
  /** Every answer you give a finding: the whole list after it, and the change itself. */
  onFindingsChange?: (findings: readonly ReviewFinding[], change: FindingChange) => void
  took?: string
  /** From the second round on. */
  round?: number
  /** Its own thread, which opens beside this one. */
  thread?: StepRef
  /** How findings reach you: the project's setting. It decides whether open findings wait on you. */
  reach?: FindingsReach
  /** The team's instructions for reviews, opened beside the thread when the host can open documents. */
  instructions?: DocRef
  /** The right of the findings' foot: usually a FindingsReachMenu, so the setting can be changed where its effect shows. */
  foot?: ReactNode
  className?: string
  text?: Partial<ReviewText>
}

/** A review step: a line with the verdict and a tally, which opens to its findings. Opens by itself when something waits on you. */
export function Review({
  n,
  of,
  reviewers,
  state = StepState.Done,
  verdict,
  findings,
  defaultFindings = [],
  onFindingsChange,
  took,
  round,
  thread,
  reach = FindingsReach.Stuck,
  instructions,
  foot,
  className,
  text,
  open,
  defaultOpen,
  onOpenChange,
}: ReviewProps) {
  const t = { ...reviewText, ...text }
  const { openDoc } = useThreadShell()
  const [items, setItems] = useControlled(findings, defaultFindings)
  /* what each answer can be undone to, for this session */
  const [before, setBefore] = useState<ReadonlyMap<string, FindingState>>(new Map())
  const pass = reach === FindingsReach.All
  const running = state === StepState.Running
  const { text: said, mine, unsettled, toLead } = tally(items, pass, t)
  const needsYou =
    items.some((f) => f.state === FindingState.Yours) || (reach !== FindingsReach.Stuck && items.some((f) => f.state === FindingState.Open))
  const apply = (changes: readonly FindingChange[], patch: (f: ReviewFinding, c: FindingChange) => ReviewFinding) => {
    let next: readonly ReviewFinding[] = items
    for (const c of changes) next = next.map((f) => (f.id === c.id ? patch(f, c) : f))
    setItems(next)
    for (const c of changes) onFindingsChange?.(next, c)
  }
  const answer = (id: string, to: FindingState, note?: string) => {
    const f = items.find((x) => x.id === id)
    if (!f) return
    setBefore(new Map(before).set(id, f.state))
    apply([{ id, from: f.state, to, note }], (x) => ({
      ...x,
      state: to,
      told: to === FindingState.Told ? note : undefined,
      reason: to === FindingState.Dismissed ? note : x.reason,
    }))
  }
  const undo = (id: string) => {
    const f = items.find((x) => x.id === id)
    const was = before.get(id)
    if (!f || was === undefined) return
    const rest = new Map(before)
    rest.delete(id)
    setBefore(rest)
    apply([{ id, from: f.state, to: was }], (x) => ({ ...x, state: was, told: undefined, reason: undefined }))
  }
  const reason = (id: string, note: string) => {
    const f = items.find((x) => x.id === id)
    if (!f) return
    apply([{ id, from: f.state, to: f.state, note }], (x) => ({ ...x, reason: note }))
  }
  const leaveRest = () => {
    const open = items.filter((f) => f.state === FindingState.Open)
    const was = new Map(before)
    for (const f of open) was.set(f.id, f.state)
    setBefore(was)
    apply(
      open.map((f) => ({ id: f.id, from: f.state, to: FindingState.Lead })),
      (x) => ({ ...x, state: FindingState.Lead }),
    )
  }
  const opens = !running && items.length > 0
  const openCount = items.filter((f) => f.state === FindingState.Open).length
  const label = round && round > 1 ? `${t.label} · ${t.round(round)}` : t.label
  const glyph = running ? <Spinner size="small" /> : mine ? <span className={s.you} aria-hidden="true" /> : <Icon name="check" size={11} />
  const docs = instructions && openDoc

  return (
    <Disclosure
      open={open}
      defaultOpen={defaultOpen ?? needsYou}
      onOpenChange={onOpenChange}
      rhythm={Rhythm.Step}
      className={cx(s.review, className)}
    >
      <StepRow
        n={n}
        of={of}
        label={t.label}
        state={running ? StepState.Started : StepState.Done}
        glyph={glyph}
        thread={thread}
        more={opens && <StepMore label={t.detail} />}
      >
        <b className={s.label}>{label}</b>
        <span className={s.who}>
          {reviewers.map((r, i) => (
            <span key={r.model.id}>
              {i > 0 && <span className={s.plus}>+</span>}
              <Model model={r.model} short />
            </span>
          ))}
        </span>
        {running ? (
          <span className={s.note}>· {t.reviewing(reviewers.length)}</span>
        ) : (
          <>
            {/* once every finding is settled, how they were settled says more than the verdict did */}
            {verdict && (unsettled > 0 || !items.length) && <span className={s.said}>· {t.verdict[verdict]}</span>}
            {items.length > 0 && <span className={mine ? s.forYou : unsettled ? s.note : s.said}>· {said}</span>}
            {!unsettled && !toLead && items.length > 0 && <span className={s.note}>· {t.byLead}</span>}
            {took && <span className={s.note}>· {took}</span>}
          </>
        )}
      </StepRow>

      {running && (
        <div className={s.live}>
          {reviewers.map((r) => (
            <div key={r.model.id} className={cx(s.reviewer, r.state === ToolState.Running && s.running)}>
              {r.state === ToolState.Running ? <Spinner size="small" /> : <Icon name="check" size={10} />}
              <Model model={r.model} />
              <span className={s.meta}>{r.meta}</span>
            </div>
          ))}
          <div className={cx(s.reviewer, s.queued)}>
            <Icon name="branch" size={10} />
            <span>{t.combine}</span>
            <span className={s.meta}>{t.combineNote(reviewers.length)}</span>
          </div>
        </div>
      )}

      {opens && (
        <Fold>
          <div className={s.body}>
            <ol className={s.findings}>
              {items.map((f) => (
                <FindingRow
                  key={f.id}
                  f={f}
                  pass={pass}
                  many={reviewers.length > 1}
                  canUndo={before.has(f.id)}
                  onAnswer={(to, note) => answer(f.id, to, note)}
                  onUndo={() => undo(f.id)}
                  onReason={(note) => reason(f.id, note)}
                  t={t}
                />
              ))}
            </ol>
            {pass && openCount > 0 && (
              <div className={s.rest}>
                <Button onClick={leaveRest}>{t.leaveRest(openCount === items.length)}</Button>
                <span>{t.leaveRestNote}</span>
              </div>
            )}
            {(docs || foot) && (
              <div className={s.foot}>
                {docs ? (
                  <LinkButton onClick={() => openDoc(instructions)}>
                    {t.instructions(instructions.path?.split('/').pop() ?? instructions.title ?? '')}
                  </LinkButton>
                ) : (
                  <span />
                )}
                {foot}
              </div>
            )}
          </div>
        </Fold>
      )}
    </Disclosure>
  )
}

export interface FindingsReachMenuText {
  label: string
  menu: string
  option: Record<FindingsReach, ChoiceWords & { short: string }>
  note: (project: string) => string
}

export const findingsReachMenuText: FindingsReachMenuText = {
  label: 'Findings reach you',
  menu: 'Review findings reach you',
  option: findingsReachText,
  note: (project) => `For every review in ${project}. Also in the project’s rules.`,
}

const REACHES = [FindingsReach.Stuck, FindingsReach.All, FindingsReach.Learn] as const

export interface FindingsReachMenuProps {
  value: FindingsReach
  onChange: (reach: FindingsReach) => void
  project: string
  /** How far Learn has come, after its note: 6 of 10 so far. */
  learned?: string
  text?: Partial<FindingsReachMenuText>
}

/** The project's setting for how review findings reach you, as a quiet menu: for a Review's foot. */
export function FindingsReachMenu({ value, onChange, project, learned, text }: FindingsReachMenuProps) {
  const t = { ...findingsReachMenuText, ...text }
  return (
    <span className={s.reach}>
      <span>{t.label}</span>
      <Menu
        label={t.menu}
        note={t.note(project)}
        placement="above"
        align="end"
        width={340}
        trigger={
          <ActionButton size="small" flush="end" trailingIcon="chevronD">
            {t.option[value].short}
          </ActionButton>
        }
      >
        <MenuRadioGroup label={t.menu} value={value} onChange={(v) => onChange(REACHES.find((r) => r === v) ?? value)}>
          {REACHES.map((r) => (
            <MenuRadioItem
              key={r}
              value={r}
              description={r === FindingsReach.Learn && learned ? `${t.option[r].note} · ${learned}` : t.option[r].note}
            >
              {t.option[r].title}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </Menu>
    </span>
  )
}

type Editing = null | 'tell' | 'reason'

interface FindingRowProps {
  f: ReviewFinding
  many: boolean
  pass: boolean
  canUndo: boolean
  onAnswer: (to: FindingState, note?: string) => void
  onUndo: () => void
  onReason: (note: string) => void
  t: ReviewText
}

/** A finding's own actions. For one that waits on you: have it fixed, say what to do instead, or dismiss it. */
function FindingRow({ f, many, pass, canUndo, onAnswer, onUndo, onReason, t }: FindingRowProps) {
  const [editing, setEditing] = useState<Editing>(null)
  const tellRef = useRefocus<HTMLButtonElement>(editing === 'tell')
  const passing = pass && f.state === FindingState.Open

  return (
    <li className={cx(s.finding, s[f.state], s[f.severity], passing && s.pass)}>
      <span className={s.severity}>{t.severity[f.severity]}</span>
      <div className={s.main}>
        <div className={s.top}>
          <span className={s.at}>{f.at}</span>
          {many && (
            <span className={s.by}>
              {f.by.map((m) => (
                <Model key={m.id} model={m} short />
              ))}
            </span>
          )}
        </div>
        <p className={s.claim}>{f.claim}</p>
        {f.against && live(f) && (
          <p className={s.against}>
            <Model model={f.against.model} short /> {t.disagrees} {f.against.text}
          </p>
        )}
        <Settled
          f={f}
          editing={editing}
          canUndo={canUndo}
          onUndo={onUndo}
          onReopen={() => onAnswer(FindingState.Open)}
          onReason={() => setEditing('reason')}
          t={t}
        />
        {f.state === FindingState.Yours && (
          <div className={s.yoursCard}>
            <span className={s.call}>
              <Icon name="answer" size={12} />
              {t.needsCall}
            </span>
            {f.ask && <p className={s.ask}>{f.ask}</p>}
            {editing !== 'tell' && (
              <div className={s.yoursActs}>
                <Button variant="signal" onClick={() => onAnswer(FindingState.ToFix)}>
                  {t.haveFixed}
                </Button>
                <Button ref={tellRef} onClick={() => setEditing('tell')}>
                  {t.sayWhat}
                </Button>
                <Button variant="quiet" onClick={() => onAnswer(FindingState.Dismissed)}>
                  {t.dismiss}
                </Button>
              </div>
            )}
          </div>
        )}
        {passing && !editing && <Acts pass onAnswer={onAnswer} onTell={() => setEditing('tell')} tellRef={tellRef} t={t} />}
        {editing && (
          <NoteForm
            className={s.form}
            text={
              editing === 'tell'
                ? { placeholder: t.tellPlaceholder, submit: t.send, cancel: t.cancel, empty: t.emptyTell }
                : { placeholder: t.reasonPlaceholder, submit: t.save, cancel: t.skip, empty: t.emptyReason }
            }
            onSubmit={(note) => {
              if (editing === 'tell') onAnswer(FindingState.Told, note)
              else onReason(note)
              setEditing(null)
            }}
            onCancel={() => setEditing(null)}
          />
        )}
      </div>
      {!pass && f.state === FindingState.Open && !editing && (
        <Acts onAnswer={onAnswer} onTell={() => setEditing('tell')} tellRef={tellRef} t={t} />
      )}
    </li>
  )
}

/** What has become of a finding, once something has: a line, and the words behind it. */
function Settled({
  f,
  editing,
  canUndo,
  onUndo,
  onReopen,
  onReason,
  t,
}: {
  f: ReviewFinding
  editing: Editing
  canUndo: boolean
  onUndo: () => void
  onReopen: () => void
  onReason: () => void
  t: ReviewText
}) {
  const undo = canUndo && <LinkButton onClick={onUndo}>{t.undo}</LinkButton>
  switch (f.state) {
    case FindingState.Open:
    case FindingState.Yours:
      return null
    case FindingState.Lead:
      return (
        <p className={cx(s.line, s.in)}>
          {t.leftToLead}
          <span className={s.k}>{t.leftToLeadNote}</span>
          {undo}
        </p>
      )
    case FindingState.Fixed:
      return (
        <p className={s.line}>
          <Icon name="check" size={10} /> {t.fixedIn(f.round)}
        </p>
      )
    case FindingState.ToFix:
      return (
        <p className={cx(s.line, s.in)}>
          {t.askedFix}
          <span className={s.k}>{t.askedFixNote}</span>
          {undo}
        </p>
      )
    case FindingState.Told:
      return (
        <>
          <p className={cx(s.line, s.in)}>
            {t.toldLead}
            <span className={s.k}>{t.toldLeadNote}</span>
            {undo}
          </p>
          <p className={s.reason}>{f.told}</p>
        </>
      )
    case FindingState.Aside:
      return (
        <>
          <p className={s.line}>
            {t.setAside}
            <LinkButton onClick={onReopen}>{t.reopen}</LinkButton>
          </p>
          {f.reason && <p className={s.reason}>{f.reason}</p>}
        </>
      )
    case FindingState.Dismissed:
      return (
        <>
          <p className={s.line}>
            {t.dismissed}
            <span className={s.k}>
              {t.dismissedNote}
              {f.reason && t.keptNote}
            </span>
            {!f.reason && !editing && <LinkButton onClick={onReason}>{t.addReason}</LinkButton>}
            {undo}
          </p>
          {f.reason && <p className={s.reason}>{f.reason}</p>}
        </>
      )
    default:
      return unreachable(f.state)
  }
}

function Acts({
  pass,
  onAnswer,
  onTell,
  tellRef,
  t,
}: {
  pass?: boolean
  onAnswer: (to: FindingState) => void
  onTell: () => void
  tellRef: RefObject<HTMLButtonElement | null>
  t: ReviewText
}) {
  return (
    <span className={cx(s.acts, pass && s.actsPass)}>
      {pass && (
        <ActionButton tone="strong" onClick={() => onAnswer(FindingState.ToFix)}>
          {t.haveFixed}
        </ActionButton>
      )}
      <ActionButton ref={tellRef} onClick={onTell}>
        {t.sayWhat}
      </ActionButton>
      <ActionButton onClick={() => onAnswer(FindingState.Dismissed)}>{t.dismiss}</ActionButton>
    </span>
  )
}
