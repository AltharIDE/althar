import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { Model, type ModelInfo } from '../../foundations/Model/Model'
import { AllowedBy, Decision, PermissionScope, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { Code } from '../../primitives/Code/Code'
import { Caret, Disclosure, DisclosureTrigger, Fold, type Disclosable } from '../../primitives/Fold/Fold'
import { Select } from '../../primitives/Select/Select'
import { AskAnswered, AskCard, AskFoot, AskNote } from '../Ask/Ask'
import s from './Permission.module.css'
import { Rhythm } from '../../lib/rhythm'

/*
 * ACP permission requests carry options of four kinds: allow once, allow
 * always, reject once, reject always. The agent asks; Charrette answers. So a
 * rule saved here is Charrette's, and it answers for every agent in the
 * project, whichever runtime it is. Most requests never get here: the
 * project's rules and the lead answer them, and only what the rules keep for
 * you arrives as a card.
 */

/** The start of a command, for "always allow": the program and its first word, or the program and the site when that word is a URL. */
export function prefixOf(cmd: string): string {
  const [a = '', b = ''] = cmd.split(' ')
  if (b.includes('://')) {
    try {
      return `${a} ${new URL(b).origin}`
    } catch {
      return a
    }
  }
  return b.startsWith('-') || !b ? a : `${a} ${b}`
}

export type Answer =
  | { decision: Decision.AllowOnce; cmd: string }
  | { decision: Decision.AllowAlways; cmd: string; scope: PermissionScope }
  | { decision: Decision.Deny; cmd: string; note: string }
  | { decision: Decision.DenyAlways; cmd: string; scope: PermissionScope }

/** Whether an answer is a no. */
function refuses(d: Decision): boolean {
  switch (d) {
    case Decision.AllowOnce:
    case Decision.AllowAlways:
      return false
    case Decision.Deny:
    case Decision.DenyAlways:
      return true
    default:
      return unreachable(d)
  }
}

/** Who answered a request before you did. */
export type AnsweredBy = { by: AllowedBy.Rule; /** The rule, as it is written. */ rule: string } | { by: AllowedBy.Lead; lead: ModelInfo }

export interface PermissionRequest {
  /** What it wants to do, in a sentence. */
  what: string
  cmd: string
  /** Why it asks, in its own words. */
  why?: string
  /** The model asking. */
  agent?: ModelInfo
  /** The step it is on. */
  step?: string
  /** What the request is a kind of, as the scope of an "always": anything that reaches staging. Without it, that scope is not offered. */
  kind?: string
  /** The answers the agent offers, in its order; an ACP request names its own. Without them: allow once, allow always, deny. */
  offers?: readonly Decision[]
}

export interface PermissionText {
  kicker: string
  position: (pos: number, total: number) => string
  legend: string
  /** Each answer, as an option. */
  option: Record<Decision, string>
  /** Each answer, once given. */
  decided: Record<Decision, string>
  scopeLabel: string
  prefixOption: (prefix: string) => string
  prefixSaid: (prefix: ReactNode) => ReactNode
  exact: string
  inProject: (project: string) => string
  savedTo: (project: string) => string
  instead: string
  insteadPlaceholder: string
  allow: string
  deny: string
  allowAll: (n: number) => string
  keys: (n: number) => string
  undo: string
  stackDone: (allowed: number, denied: number) => string
  stackNote: string
  allowedCount: (n: number) => string
  allowedWho: (byRules: number, byLead: number, project: string) => string
  /** After an answer someone else gave. */
  answeredByRule: (rule: string) => string
  answeredByLead: string
}

export const permissionText: PermissionText = {
  kicker: 'Needs your permission',
  position: (pos, total) => `${pos} of ${total}`,
  legend: 'Your answer',
  option: {
    [Decision.AllowOnce]: 'Yes, this once',
    [Decision.AllowAlways]: 'Yes, and always allow',
    [Decision.Deny]: 'No, and say what to do instead',
    [Decision.DenyAlways]: 'No, and never allow',
  },
  decided: {
    [Decision.AllowOnce]: 'Allowed once',
    [Decision.AllowAlways]: 'Allowed always',
    [Decision.Deny]: 'Denied',
    [Decision.DenyAlways]: 'Denied always',
  },
  scopeLabel: 'What to always allow',
  prefixOption: (p) => `commands starting “${p}”`,
  prefixSaid: (p) => <>commands starting {p}</>,
  exact: 'this exact command',
  inProject: (project) => `in ${project}`,
  savedTo: (project) => `saved to ${project} rules`,
  instead: 'What to do instead',
  insteadPlaceholder: 'Say what to do instead',
  allow: 'Allow',
  deny: 'Deny',
  allowAll: (n) => `Allow all ${n}`,
  keys: (n) => `1–${n} to choose`,
  undo: 'Undo',
  stackDone: (allowed, denied) => `Allowed ${allowed}${denied > 0 ? `, denied ${denied}` : ''}`,
  stackNote: 'each answer went back to its own step',
  allowedCount: (n) => `Allowed ${n} requests`,
  allowedWho: (rules, lead, project) =>
    [rules > 0 && `${rules} by ${project}’s rules`, lead > 0 && `${lead} by the lead`].filter(Boolean).join(', '),
  answeredByRule: (rule) => `by ${rule}`,
  answeredByLead: 'by the lead',
}

const OFFERS: readonly Decision[] = [Decision.AllowOnce, Decision.AllowAlways, Decision.Deny]

/** How far an "always" reaches, in words. */
function scopeSaid(scope: PermissionScope, request: Pick<PermissionRequest, 'cmd' | 'kind'>, t: PermissionText): ReactNode {
  switch (scope) {
    case PermissionScope.Prefix:
      return t.prefixSaid(<Code>{prefixOf(request.cmd)}</Code>)
    case PermissionScope.Exact:
      return t.exact
    case PermissionScope.Kind:
      return request.kind ?? t.exact
    default:
      return unreachable(scope)
  }
}

type Phase = null | 'beat' | 'out' | 'outNo'

interface CardProps extends PermissionRequest {
  project: string
  defaultDecision?: Decision
  pos?: number
  total?: number
  phase: Phase
  onAnswer: (a: Answer) => void
  onAll?: () => void
  t: PermissionText
}

function Card({
  what,
  cmd,
  why,
  agent,
  step,
  kind,
  offers = OFFERS,
  project,
  defaultDecision = offers[0] ?? Decision.AllowOnce,
  pos = 1,
  total = 1,
  phase,
  onAnswer,
  onAll,
  t,
}: CardProps) {
  const [pick, setPick] = useState<Decision>(defaultDecision)
  const [scope, setScope] = useState(PermissionScope.Prefix)
  const [note, setNote] = useState('')
  const name = useId()
  const title = useId()
  const noteField = useRef<HTMLInputElement>(null)
  const denying = pick === Decision.Deny
  const no = refuses(pick)

  useEffect(() => {
    if (denying) noteField.current?.focus()
  }, [denying])

  const answer = (): Answer => {
    switch (pick) {
      case Decision.AllowOnce:
        return { decision: pick, cmd }
      case Decision.AllowAlways:
        return { decision: pick, cmd, scope }
      case Decision.Deny:
        return { decision: pick, cmd, note }
      case Decision.DenyAlways:
        return { decision: pick, cmd, scope }
      default:
        return unreachable(pick)
    }
  }

  return (
    <AskCard
      icon="lock"
      kickerId={title}
      kicker={
        <>
          {t.kicker}
          {total > 1 && <span className={s.pos}> · {t.position(pos, total)}</span>}
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
      className={cx(s.card, phase && s[phase])}
    >
      <div className={s.cmd}>
        <span className={s.prompt} aria-hidden="true">
          $
        </span>
        <code>{cmd}</code>
      </div>
      {why && <p className={s.why}>{why}</p>}
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
        <fieldset className={s.options}>
          <legend className={s.legend}>{t.legend}</legend>
          {offers.map((d, i) => (
            <div key={d} className={cx(s.option, pick === d && s.on)}>
              <label className={s.optionLabel}>
                <input type="radio" name={name} className={s.radio} checked={pick === d} onChange={() => setPick(d)} />
                <span className={s.key} aria-hidden="true">
                  {i + 1}
                </span>
                <span>{t.option[d]}</span>
              </label>
              {(d === Decision.AllowAlways || d === Decision.DenyAlways) && (
                <span className={s.scopeLine}>
                  <Select
                    variant="filled"
                    label={t.scopeLabel}
                    value={scope}
                    options={[
                      { value: PermissionScope.Prefix, label: t.prefixOption(prefixOf(cmd)) },
                      { value: PermissionScope.Exact, label: t.exact },
                      ...(kind ? [{ value: PermissionScope.Kind, label: kind }] : []),
                    ]}
                    onChange={(next) => {
                      setScope(next)
                      setPick(d)
                    }}
                  />
                  <span>{t.inProject(project)}</span>
                </span>
              )}
              {d === Decision.Deny && denying && (
                <input
                  ref={noteField}
                  type="text"
                  className={s.note}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  aria-label={t.instead}
                  placeholder={t.insteadPlaceholder}
                />
              )}
            </div>
          ))}
        </fieldset>
        <AskFoot>
          <Button type="submit" variant="signal" kbd="↵">
            {no ? t.deny : t.allow}
          </Button>
          {total > 1 && onAll && (
            <Button variant="quiet" onClick={onAll}>
              {t.allowAll(total - pos + 1)}
            </Button>
          )}
          <span className={s.keys} aria-hidden="true">
            {t.keys(offers.length)}
          </span>
        </AskFoot>
      </form>
    </AskCard>
  )
}

/* Answering: a yes beats once in violet, then the card folds to its answer; a no just steps aside. */
const BEAT = 420
const OUT = 220
function useAnswer<T>(onDone: (a: T) => void) {
  const [phase, setPhase] = useState<Phase>(null)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((x) => window.clearTimeout(x)), [])
  const later = (f: () => void, ms: number) => timers.current.push(window.setTimeout(f, ms))
  const answer = (a: T, denied: boolean) => {
    const finish = () => {
      setPhase(null)
      onDone(a)
    }
    if (denied) {
      setPhase('outNo')
      later(finish, OUT)
    } else {
      setPhase('beat')
      later(() => setPhase('out'), BEAT)
      later(finish, BEAT + OUT)
    }
  }
  return [phase, answer] as const
}

function By({ who, t }: { who: AnsweredBy; t: PermissionText }) {
  switch (who.by) {
    case AllowedBy.Rule:
      return <AskNote>· {t.answeredByRule(who.rule)}</AskNote>
    case AllowedBy.Lead:
      return (
        <AskNote>
          · {t.answeredByLead} <Model model={who.lead} short />
        </AskNote>
      )
    default:
      return unreachable(who)
  }
}

/** What follows an answer once given: the command, its scope, or its note. */
function Said({ answer, request, project, t }: { answer: Answer; request: PermissionRequest; project: string; t: PermissionText }) {
  switch (answer.decision) {
    case Decision.AllowOnce:
      return <AskNote code>{answer.cmd}</AskNote>
    case Decision.Deny:
      return <AskNote code>{answer.note || answer.cmd}</AskNote>
    case Decision.AllowAlways:
    case Decision.DenyAlways:
      return (
        <AskNote>
          · {scopeSaid(answer.scope, request, t)} · {t.savedTo(project)}
        </AskNote>
      )
    default:
      return unreachable(answer)
  }
}

export interface PermissionProps extends PermissionRequest {
  /** The project whose rules an "always" answer is saved to. */
  project: string
  /** Start already answered: from history, or answered by someone else (see answeredBy). */
  defaultAnswer?: Answer
  /** It was answered before you did, by a rule or the lead. Shown without Undo. */
  answeredBy?: AnsweredBy
  /** The answer picked before you pick one. Allow once, unless told. */
  defaultDecision?: Decision
  onAnswer?: (a: Answer) => void
  text?: Partial<PermissionText>
}

/** One request, answerable in place. Once answered it folds to a line saying what you said, with Undo. */
export function Permission({ defaultAnswer, answeredBy, defaultDecision, onAnswer, project, text, ...request }: PermissionProps) {
  const t = { ...permissionText, ...text }
  const [answer, setAnswer] = useState<Answer | null>(defaultAnswer ?? null)
  const [phase, answerWith] = useAnswer<Answer>((a) => {
    setAnswer(a)
    onAnswer?.(a)
  })
  if (answer) {
    return (
      <AskAnswered
        denied={refuses(answer.decision)}
        said={t.decided[answer.decision]}
        onUndo={answeredBy ? undefined : () => setAnswer(null)}
        undo={t.undo}
      >
        <Said answer={answer} request={request} project={project} t={t} />
        {answeredBy && <By who={answeredBy} t={t} />}
      </AskAnswered>
    )
  }
  return (
    <Card
      {...request}
      project={project}
      defaultDecision={defaultDecision}
      phase={phase}
      t={t}
      onAnswer={(a) => answerWith(a, refuses(a.decision))}
    />
  )
}

export interface PermissionsProps {
  items: PermissionRequest[]
  project: string
  /** Each answer, as it is given. */
  onAnswer?: (request: PermissionRequest, answer: Answer) => void
  text?: Partial<PermissionText>
}

/**
 * Several waiting at once, as a stack: one at a time, the rest showing
 * underneath, so you know how many are coming. A stack forms only when steps
 * run side by side; each answer still goes back to its own agent.
 */
export function Permissions({ items, project, onAnswer, text }: PermissionsProps) {
  const t = { ...permissionText, ...text }
  const [i, setI] = useState(0)
  const [log, setLog] = useState<Answer[]>([])
  const [phase, answerWith] = useAnswer<number>((next) => setI(next))
  if (i >= items.length) {
    const denied = log.filter((a) => refuses(a.decision)).length
    return (
      <AskAnswered
        said={t.stackDone(items.length - denied, denied)}
        undo={t.undo}
        onUndo={() => {
          setI(0)
          setLog([])
        }}
      >
        <AskNote>· {t.stackNote}</AskNote>
      </AskAnswered>
    )
  }
  const current = items[i]
  if (!current) return null
  const peeks = Math.min(items.length - i - 1, 2)
  return (
    <div className={s.stack} style={{ paddingBottom: peeks * 7 }}>
      <Card
        key={i}
        {...current}
        project={project}
        pos={i + 1}
        total={items.length}
        phase={phase}
        t={t}
        onAnswer={(a) => {
          setLog([...log, a])
          onAnswer?.(current, a)
          answerWith(i + 1, refuses(a.decision))
        }}
        onAll={() => {
          const rest = items.slice(i)
          const answers = rest.map((it): Answer => ({ decision: Decision.AllowOnce, cmd: it.cmd }))
          setLog([...log, ...answers])
          rest.forEach((it, k) => {
            const a = answers[k]
            if (a) onAnswer?.(it, a)
          })
          answerWith(items.length, false)
        }}
      />
      {[0, 1].map((k) => (
        <i
          key={k}
          aria-hidden="true"
          className={cx(s.peek, k >= peeks && s.gone)}
          style={{ bottom: Math.max(peeks - k - 1, 0) * 7, left: 10 * (k + 1), right: 10 * (k + 1), zIndex: 2 - k }}
        />
      ))}
    </div>
  )
}

export type AllowedItem = { step: string; cmd: string } & (
  | { by: AllowedBy.Rule; /** The rule that allowed it. */ rule: string }
  | { by: AllowedBy.Lead; /** The lead that allowed it, and why. */ lead: ModelInfo; why: string }
)

function Who({ item }: { item: AllowedItem }) {
  switch (item.by) {
    case AllowedBy.Rule:
      return <>{item.rule}</>
    case AllowedBy.Lead:
      return (
        <>
          <Model model={item.lead} short />: {item.why}
        </>
      )
    default:
      return unreachable(item)
  }
}

export interface AllowedProps extends Disclosable {
  items: AllowedItem[]
  project: string
  text?: Partial<PermissionText>
}

/** What was allowed without you: one quiet line, which opens to each request and who said yes. Nothing here waited on you. */
export function Allowed({ items, project, text, ...disclosure }: AllowedProps) {
  const t = { ...permissionText, ...text }
  const rules = items.filter((it) => it.by === AllowedBy.Rule).length
  return (
    <Disclosure {...disclosure} rhythm={Rhythm.Allowed}>
      <DisclosureTrigger>
        <button type="button" className={s.allowedRow}>
          <Icon name="lock" size={11} />
          <span className={s.said}>{t.allowedCount(items.length)}</span>
          <span className={s.saidNote}>· {t.allowedWho(rules, items.length - rules, project)}</span>
          <span className={s.rule} aria-hidden="true" />
          <Caret />
        </button>
      </DisclosureTrigger>
      <Fold>
        <ul className={s.allowedList}>
          {items.map((it) => (
            <li key={it.cmd}>
              <span className={s.allowedStep}>{it.step}</span>
              <code className={s.allowedCmd}>{it.cmd}</code>
              <span className={s.allowedBy}>
                <Who item={it} />
              </span>
            </li>
          ))}
        </ul>
      </Fold>
    </Disclosure>
  )
}
