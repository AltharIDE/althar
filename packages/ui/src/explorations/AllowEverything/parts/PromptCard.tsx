import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { Decision, PermissionScope, unreachable } from '../../../foundations/vocabulary'
import { cx } from '../../../lib/cx'
import { AskCard, AskFoot } from '../../../primitives/Ask/Ask'
import { Button } from '../../../primitives/Button/Button'
import { Field } from '../../../primitives/Field/Field'
import { Model } from '../../../primitives/Model/Model'
import { Select } from '../../../primitives/Select/Select'
import {
  type AlwaysDecision,
  offersFor,
  type PermissionAnswer,
  type PermissionRequest,
  permissionText,
  type PermissionText,
  refuses,
  scopeChoices,
  scopeSaid,
} from '../../../thread/Permission/Permission'
import p from '../../../thread/Permission/Permission.module.css'
import s from './PromptCard.module.css'

/*
 * The thread's permission card, as the paths would change it. It is the
 * real card's markup, styles and helpers, so it reads as the card does
 * today, with two places added: a line under the command for a request the
 * "Always ask me" list holds, which says why "always allow" isn't there and
 * what to do instead; and one answer more, after the agent's own, that
 * reaches past this request (C's "stop asking on this task").
 */

/** The answer beyond the agent's own: allow this, and stop asking on the task. */
export const ESCALATE = 'escalate'
export type Picked = Decision | typeof ESCALATE

export type PromptAnswer = PermissionAnswer | { decision: typeof ESCALATE; cmd: string }

export interface Escalation {
  /** Its option's words. */
  option: string
  /** What it does, said under it once it is picked. */
  note: ReactNode
  /** The answer button's words while it is picked. */
  submit: string
}

export interface PromptCardProps {
  request: PermissionRequest
  project: string
  pos?: number
  total?: number
  /** For a request the "Always ask me" list holds: why "always allow" isn't offered, and the way out. */
  held?: ReactNode
  escalate?: Escalation
  /** After the answer's buttons: a way out of asking that isn't an answer, such as a menu. */
  foot?: ReactNode
  defaultPick?: Picked
  onAnswer: (answer: PromptAnswer) => void
  /** Allow every request waiting, once each. */
  onAll?: () => void
  /** Its motion as it is answered, from the stack that holds it. */
  phase?: 'beat' | 'out' | 'outNo' | null
  className?: string
  text?: Partial<PermissionText>
}

export function PromptCard({
  request,
  project,
  pos = 1,
  total = 1,
  held,
  escalate,
  foot,
  defaultPick,
  onAnswer,
  onAll,
  phase = null,
  className,
  text,
}: PromptCardProps) {
  const t = { ...permissionText, ...text }
  const { what, cmd, why, agent, step, prefix, kind, scopes } = request
  const beyond: Picked[] = escalate ? [ESCALATE] : []
  const offers: Picked[] = [...offersFor(request), ...beyond]
  const words = (d: Picked) => (d === ESCALATE ? escalate?.option : t.option[d])
  const [pick, setPick] = useState<Picked>(
    defaultPick !== undefined && offers.includes(defaultPick) ? defaultPick : (offers[0] ?? Decision.AllowOnce),
  )
  const [scope, setScope] = useState(PermissionScope.Exact)
  const [note, setNote] = useState('')
  const name = useId()
  const title = useId()
  const noteField = useRef<HTMLInputElement>(null)
  const denying = pick === Decision.Deny
  useEffect(() => {
    if (denying) noteField.current?.focus()
  }, [denying])

  const choicesOf = (d: AlwaysDecision) =>
    scopeChoices({ prefix, kind, ...(scopes ? { scopes } : {}) }, d, { exact: t.exact, prefix: t.prefixOption })
  const scopeOf = (d: AlwaysDecision) => {
    const offered = choicesOf(d).map((choice) => choice.value)
    return offered.includes(scope) ? scope : (offered[0] ?? PermissionScope.Exact)
  }
  const answer = (): PromptAnswer => {
    if (pick === ESCALATE) return { decision: ESCALATE, cmd }
    switch (pick) {
      case Decision.AllowOnce:
        return { decision: pick, cmd }
      case Decision.AllowAlways:
      case Decision.DenyAlways:
        return { decision: pick, cmd, scope: scopeOf(pick) }
      case Decision.Deny:
        return { decision: pick, cmd, note }
      default:
        return unreachable(pick)
    }
  }
  const scopeLine = (d: AlwaysDecision) => {
    const offered = choicesOf(d)
    if (offered.length > 1)
      return (
        <span className={p.scopeLine}>
          <Select
            variant="filled"
            label={d === Decision.AllowAlways ? t.scopeLabel : t.neverScopeLabel}
            value={scopeOf(d)}
            options={offered}
            onChange={(next) => {
              setScope(next)
              setPick(d)
            }}
          />
          <span>{t.inProject(project)}</span>
        </span>
      )
    const [only] = offered
    if (only === undefined || only.value === PermissionScope.Exact) return null
    return (
      <span className={p.scopeLine}>
        <span className={p.scopeOnly}>{scopeSaid(only.value, { prefix, kind }, t)}</span>
        <span>{t.inProject(project)}</span>
      </span>
    )
  }
  const submitWords = () => {
    if (pick === ESCALATE) return escalate?.submit ?? t.allow
    return refuses(pick) ? t.deny : t.allow
  }
  const submit = submitWords()

  return (
    <AskCard
      icon="lock"
      kickerId={title}
      kicker={
        <>
          {t.kicker}
          {total > 1 && <span className={p.pos}> · {t.position(pos, total)}</span>}
        </>
      }
      who={
        (step || agent) && (
          <>
            {step && <span>{step} ·</span>}
            {agent && <Model model={agent} short />}
          </>
        )
      }
      what={what}
      className={cx(p.card, phase && p[phase], className)}
    >
      <div className={p.cmd}>
        <span className={p.prompt} aria-hidden="true">
          $
        </span>
        <code>{cmd}</code>
      </div>
      {why && <p className={p.why}>{why}</p>}
      {held != null && <div className={s.held}>{held}</div>}
      <form
        aria-labelledby={title}
        onSubmit={(e) => {
          e.preventDefault()
          if (!phase) onAnswer(answer())
        }}
        onKeyDown={(e) => {
          const target = e.target
          if (phase || e.defaultPrevented || (target instanceof HTMLInputElement && target.type === 'text')) return
          const d = offers[Number(e.key) - 1]
          if (d) {
            e.preventDefault()
            setPick(d)
          }
        }}
      >
        <fieldset className={p.options}>
          <legend className={p.legend}>{t.legend}</legend>
          {offers.map((d, i) => (
            <div key={d} className={cx(p.option, pick === d && p.on, d === ESCALATE && s.beyond)}>
              <label className={p.optionLabel}>
                <input type="radio" name={name} className={p.radio} checked={pick === d} onChange={() => setPick(d)} />
                <span className={p.key} aria-hidden="true">
                  {i + 1}
                </span>
                <span>{words(d)}</span>
              </label>
              {(d === Decision.AllowAlways || d === Decision.DenyAlways) && scopeLine(d)}
              {d === Decision.Deny && denying && (
                <Field
                  ref={noteField}
                  className={p.note}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  aria-label={t.instead}
                  placeholder={t.insteadPlaceholder}
                />
              )}
              {d === ESCALATE && pick === ESCALATE && <p className={s.beyondNote}>{escalate?.note}</p>}
            </div>
          ))}
        </fieldset>
        <AskFoot>
          <Button type="submit" variant="signal" kbd="↵">
            {submit}
          </Button>
          {total > 1 && onAll && (
            <Button variant="quiet" onClick={onAll}>
              {t.allowAll(total - pos + 1)}
            </Button>
          )}
          {foot}
          <span className={p.keys} aria-hidden="true">
            {t.keys(offers.length)}
          </span>
        </AskFoot>
      </form>
    </AskCard>
  )
}

/** The next requests' edges under the one in front, as the stack draws them. */
export function Peeks({ behind }: { behind: number }) {
  const peeks = Math.min(behind, 2)
  return (
    <>
      {[0, 1].map((k) => (
        <i
          key={k}
          aria-hidden="true"
          className={cx(p.peek, k >= peeks && p.gone)}
          style={{ bottom: Math.max(peeks - k - 1, 0) * 7, left: 10 * (k + 1), right: 10 * (k + 1), zIndex: 2 - k }}
        />
      ))}
    </>
  )
}

/** A stack's frame: room under the card for the edges of what waits behind it. */
export function StackFrame({ behind, children }: { behind: number; children: ReactNode }) {
  return (
    <div className={p.stack} style={{ paddingBottom: Math.min(behind, 2) * 7 }}>
      {children}
      <Peeks behind={behind} />
    </div>
  )
}
