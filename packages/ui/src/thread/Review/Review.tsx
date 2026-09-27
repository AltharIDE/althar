import { useEffect, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { FindingState, FindingsReach, Severity, StepState, ToolState, Verdict, unreachable } from '../../foundations/vocabulary'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import { Disclosure, Fold, type Disclosable } from '../../primitives/Fold/Fold'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Menu, MenuNote, MenuRadioGroup, MenuRadioItem } from '../../primitives/Menu/Menu'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { useShell, type DocRef, type StepRef } from '../Shell/Shell'
import { StepMore, StepRow } from '../Step/Step'
import s from './Review.module.css'
import { Rhythm } from '../../lib/rhythm'

/*
 * A review step has a fixed result: a verdict and a list of findings. Each
 * finding says where, what, and who raised it. The lead settles findings by
 * default: it fixes what holds and sets aside what does not, with a reason.
 * A finding reaches you only when the lead cannot settle it, or when the
 * project says every finding should wait for you. You can still step in on
 * any, and every answer can be taken back until the lead acts on it.
 */

export interface Finding {
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
  /** What it was before your answer, for Undo. */
  was?: FindingState
}

export interface Reviewer {
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
  combineNote: string
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
  fixedIn: (round: number) => string
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
  leaveRest: (all: boolean) => string
  leaveRestNote: string
  instructions: (name: string) => string
  reachLabel: string
  reachMenu: string
  reachShort: Record<FindingsReach, string>
  reachOption: Record<FindingsReach, { title: string; note: string }>
  reachNote: (project: string) => string
}

export const reviewText: ReviewText = {
  label: 'Review',
  round: (n) => `round ${n}`,
  severity: { [Severity.High]: 'High', [Severity.Medium]: 'Medium', [Severity.Low]: 'Low' },
  verdict: { [Verdict.Pass]: 'Passed', [Verdict.Changes]: 'Changes requested', [Verdict.Blocked]: 'Blocked' },
  reviewing: (n) => `${n} reviewers, then combined`,
  combine: 'Combine',
  combineNote: 'waits for both · merges duplicates · reports disagreement',
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
  fixedIn: (round) => `Fixed by the lead in round ${round}`,
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
  leaveRest: (all) => `Leave ${all ? 'them' : 'the rest'} to the lead`,
  leaveRestNote: 'It fixes or sets aside each one, and says why',
  instructions: (name) => `Reviewed with your instructions · ${name}`,
  reachLabel: 'Findings reach you',
  reachMenu: 'Review findings reach you',
  reachShort: {
    [FindingsReach.Stuck]: 'only when the lead can’t settle one',
    [FindingsReach.All]: 'every finding, before the lead acts',
    [FindingsReach.Learn]: 'every finding at first, then fewer',
  },
  reachOption: {
    [FindingsReach.Stuck]: { title: 'Only when the lead can’t settle one', note: 'The lead fixes or sets aside the rest, and says why' },
    [FindingsReach.All]: { title: 'Every finding, before the lead acts', note: 'The lead waits for your pass over the list' },
    [FindingsReach.Learn]: { title: 'Every finding at first, then fewer', note: 'Asks less as you agree with the lead’s calls' },
  },
  reachNote: (project) => `For every review in ${project}. Also in the project’s rules.`,
}

const REACHES = [FindingsReach.Stuck, FindingsReach.All, FindingsReach.Learn] as const

/** A finding you can still act on: nothing has been decided about it. */
const live = (f: Finding) => f.state === FindingState.Open || f.state === FindingState.Yours

/** The review's line, in a few words: what is for you, what went back, or how they were settled. */
function tally(items: readonly Finding[], pass: boolean, t: ReviewText) {
  const count = (st: FindingState) => items.filter((f) => f.state === st).length
  const unsettled = count(FindingState.Open) + count(FindingState.Yours)
  const mine = count(FindingState.Yours) + (pass ? count(FindingState.Open) : 0)
  const toLead = count(FindingState.ToFix) + count(FindingState.Told) + count(FindingState.Lead)
  const aside = count(FindingState.Aside) + count(FindingState.Dismissed)
  const fixed = count(FindingState.Fixed)
  const settled = [fixed > 0 && t.tally.fixed(fixed), aside > 0 && t.tally.aside(aside)].filter(Boolean).join(', ')
  const text = mine
    ? t.tally.yours(mine)
    : toLead && !unsettled
      ? t.tally.toLead(toLead)
      : unsettled === items.length
        ? t.tally.all(items.length)
        : unsettled
          ? t.tally.open(unsettled, items.length)
          : settled
  return { text, mine, unsettled, toLead }
}

export interface ReviewProps extends Disclosable {
  /** Where in the task's graph: step n of `of`. */
  n: number
  of: number
  reviewers: readonly Reviewer[]
  /** Running while the reviewers work; Done once combined. */
  state?: StepState.Running | StepState.Done
  verdict?: Verdict
  findings?: readonly Finding[]
  defaultFindings?: readonly Finding[]
  /** Every change you make to a finding, as the whole list. */
  onFindingsChange?: (findings: readonly Finding[]) => void
  took?: string
  /** From the second round on. */
  round?: number
  /** Its own thread, which opens beside this one. */
  thread?: StepRef
  /** How findings reach you: the project's setting. */
  reach?: FindingsReach
  defaultReach?: FindingsReach
  onReachChange?: (reach: FindingsReach) => void
  /** How far Learn has come, after its note: 6 of 10 so far. */
  learned?: string
  project: string
  /** The team's instructions for reviews, opened beside the thread. */
  instructions?: DocRef
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
  reach: reachProp,
  defaultReach = FindingsReach.Stuck,
  onReachChange,
  learned,
  project,
  instructions,
  text,
  open,
  defaultOpen,
  onOpenChange,
}: ReviewProps) {
  const t = { ...reviewText, ...text }
  const { openDoc } = useShell()
  const [items, setItems] = useControlled(findings, defaultFindings, onFindingsChange)
  const [reach, setReach] = useControlled(reachProp, defaultReach, onReachChange)
  const pass = reach === FindingsReach.All
  const running = state === StepState.Running
  const { text: said, mine, unsettled, toLead } = tally(items, pass, t)
  const needsYou =
    items.some((f) => f.state === FindingState.Yours) || (reach !== FindingsReach.Stuck && items.some((f) => f.state === FindingState.Open))
  const change = (id: string, patch: Partial<Finding>) => setItems(items.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  const opens = !running && items.length > 0
  const open_ = items.filter((f) => f.state === FindingState.Open).length
  const label = round && round > 1 ? `${t.label} · ${t.round(round)}` : t.label

  const glyph = running ? <Spinner size="small" /> : mine ? <span className={s.you} aria-hidden="true" /> : <Icon name="check" size={11} />

  return (
    <Disclosure open={open} defaultOpen={defaultOpen ?? needsYou} onOpenChange={onOpenChange} rhythm={Rhythm.Step} className={s.review}>
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
            {took && reviewers.length < 2 && <span className={s.note}>· {took}</span>}
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
            <span className={s.meta}>{t.combineNote}</span>
          </div>
        </div>
      )}

      {opens && (
        <Fold>
          <div className={s.body}>
            <ol className={s.findings}>
              {items.map((f) => (
                <FindingRow key={f.id} f={f} pass={pass} many={reviewers.length > 1} onChange={(patch) => change(f.id, patch)} t={t} />
              ))}
            </ol>
            {pass && open_ > 0 && (
              <div className={s.rest}>
                <Button
                  onClick={() =>
                    setItems(
                      items.map((f) => (f.state === FindingState.Open ? { ...f, state: FindingState.Lead, was: FindingState.Open } : f)),
                    )
                  }
                >
                  {t.leaveRest(open_ === items.length)}
                </Button>
                <span>{t.leaveRestNote}</span>
              </div>
            )}
            <div className={s.foot}>
              {instructions ? (
                <LinkButton onClick={() => openDoc(instructions)}>
                  {t.instructions(instructions.path?.split('/').pop() ?? instructions.title ?? '')}
                </LinkButton>
              ) : (
                <span />
              )}
              <span className={s.reach}>
                <span>{t.reachLabel}</span>
                <Menu
                  label={t.reachMenu}
                  placement="above"
                  align="end"
                  width={340}
                  trigger={
                    <ActionButton size="small" flush="end" trailingIcon="chevronD">
                      {t.reachShort[reach]}
                    </ActionButton>
                  }
                >
                  <MenuRadioGroup label={t.reachMenu} value={reach} onChange={(v) => setReach(REACHES.find((r) => r === v) ?? reach)}>
                    {REACHES.map((r) => (
                      <MenuRadioItem
                        key={r}
                        value={r}
                        description={r === FindingsReach.Learn && learned ? `${t.reachOption[r].note} · ${learned}` : t.reachOption[r].note}
                      >
                        {t.reachOption[r].title}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                  <MenuNote>{t.reachNote(project)}</MenuNote>
                </Menu>
              </span>
            </div>
          </div>
        </Fold>
      )}
    </Disclosure>
  )
}

type Editing = null | 'tell' | 'reason'

interface FindingRowProps {
  f: Finding
  many: boolean
  pass: boolean
  onChange: (patch: Partial<Finding>) => void
  t: ReviewText
}

/** A finding's own actions. For one that waits on you: have it fixed, say what to do instead, or dismiss it. */
function FindingRow({ f, many, pass, onChange, t }: FindingRowProps) {
  const [editing, setEditing] = useState<Editing>(null)
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) input.current?.focus()
  }, [editing])
  const back = () => onChange({ state: f.was ?? FindingState.Open, reason: undefined, told: undefined })
  const save = () => {
    const said = draft.trim()
    if (editing === 'tell') {
      if (!said) return
      onChange({ state: FindingState.Told, was: f.state, told: said })
    } else if (said) onChange({ reason: said })
    setDraft('')
    setEditing(null)
  }
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
        <Settled f={f} editing={editing} onChange={onChange} onBack={back} onReason={() => setEditing('reason')} t={t} />
        {f.state === FindingState.Yours && (
          <div className={s.yoursCard}>
            <span className={s.call}>
              <Icon name="answer" size={12} />
              {t.needsCall}
            </span>
            {f.ask && <p className={s.ask}>{f.ask}</p>}
            {editing !== 'tell' && (
              <div className={s.yoursActs}>
                <Button variant="signal" onClick={() => onChange({ state: FindingState.ToFix, was: FindingState.Yours })}>
                  {t.haveFixed}
                </Button>
                <Button onClick={() => setEditing('tell')}>{t.sayWhat}</Button>
                <Button
                  variant="quiet"
                  onClick={() => onChange({ state: FindingState.Dismissed, was: FindingState.Yours, reason: undefined })}
                >
                  {t.dismiss}
                </Button>
              </div>
            )}
          </div>
        )}
        {passing && !editing && <Acts pass state={f.state} onChange={onChange} onTell={() => setEditing('tell')} t={t} />}
        {editing && (
          <div className={s.form}>
            <input
              ref={input}
              className={s.field}
              value={draft}
              aria-label={editing === 'tell' ? t.tellPlaceholder : t.reasonPlaceholder}
              placeholder={editing === 'tell' ? t.tellPlaceholder : t.reasonPlaceholder}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setEditing(null)
                }
              }}
            />
            <Button onClick={save} disabled={!draft.trim()}>
              {editing === 'tell' ? t.send : t.save}
            </Button>
            <Button variant="quiet" onClick={() => setEditing(null)}>
              {editing === 'tell' ? t.cancel : t.skip}
            </Button>
          </div>
        )}
      </div>
      {!pass && f.state === FindingState.Open && !editing && (
        <Acts state={f.state} onChange={onChange} onTell={() => setEditing('tell')} t={t} />
      )}
    </li>
  )
}

/** What has become of a finding, once something has: a line, and the words behind it. */
function Settled({
  f,
  editing,
  onChange,
  onBack,
  onReason,
  t,
}: {
  f: Finding
  editing: Editing
  onChange: (patch: Partial<Finding>) => void
  onBack: () => void
  onReason: () => void
  t: ReviewText
}) {
  const undo = <LinkButton onClick={onBack}>{t.undo}</LinkButton>
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
          <Icon name="check" size={10} /> {t.fixedIn(f.round ?? 2)}
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
            <LinkButton onClick={() => onChange({ state: FindingState.Open })}>{t.reopen}</LinkButton>
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
  state,
  onChange,
  onTell,
  t,
}: {
  pass?: boolean
  state: FindingState
  onChange: (patch: Partial<Finding>) => void
  onTell: () => void
  t: ReviewText
}) {
  return (
    <span className={cx(s.acts, pass && s.actsPass)}>
      {pass && (
        <ActionButton tone="strong" onClick={() => onChange({ state: FindingState.ToFix, was: state })}>
          {t.haveFixed}
        </ActionButton>
      )}
      <ActionButton onClick={onTell}>{t.sayWhat}</ActionButton>
      <ActionButton onClick={() => onChange({ state: FindingState.Dismissed, was: state, reason: undefined })}>{t.dismiss}</ActionButton>
    </span>
  )
}
