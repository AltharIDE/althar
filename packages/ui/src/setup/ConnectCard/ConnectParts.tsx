import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { CanState, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { CopyButton } from '../../primitives/CopyButton/CopyButton'
import { Field, FieldError } from '../../primitives/Field/Field'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './ConnectParts.module.css'

/*
 * What a step of a walk in is made of, inside a ConnectCard: a line of words,
 * a code to type on the service's page, what to do on a page it opens, the
 * permissions a token is made with, a token noticed on the clipboard, a
 * field to paste into, a row of presses, waiting on the other side, and what
 * the connection can do. The card centres its words and presses; lists,
 * fields and facts read from the left.
 */

/* ---- words ---------------------------------------------------------------------- */

export interface ConnectTextProps {
  /** body: what the step says; note: a quieter word on it; hint: under a field, where its value came from. */
  tone?: 'body' | 'note' | 'hint'
  children: ReactNode
  className?: string
}

/** A line of the step's words. Bold within it names what matters: an account, an owner. */
export function ConnectText({ tone = 'body', children, className }: ConnectTextProps) {
  return <p className={cx(s.text, s[tone], className)}>{children}</p>
}

/** Something found, with a tick, or what is wrong, in red: GitLab answers at git.halyard.dev. */
export function ConnectFound({ tone = 'ok', children }: { tone?: 'ok' | 'no'; children: ReactNode }) {
  return (
    <p className={cx(s.found, tone === 'no' && s.foundNo)} role={tone === 'no' ? 'alert' : undefined}>
      <Icon name={tone === 'ok' ? 'check' : 'close'} size={12} />
      <span>{children}</span>
    </p>
  )
}

/* ---- presses -------------------------------------------------------------------- */

export interface ConnectActionsProps {
  /** The step's one press, as wide as the card. */
  primary?: boolean
  /** Where the row sits: centred under the card's words, or from the left. */
  align?: 'center' | 'start'
  children: ReactNode
}

/** A row of presses, or a press beside what it waits on. */
export function ConnectActions({ primary = false, align = 'center', children }: ConnectActionsProps) {
  return <div className={cx(s.actions, primary && s.primary, align === 'start' && s.start)}>{children}</div>
}

/** Waiting on the service, or on you: a quiet spinner and what it waits for. */
export function ConnectWaiting({ children }: { children: ReactNode }) {
  return (
    <output className={s.wait}>
      <Spinner size="small" />
      <span>{children}</span>
    </output>
  )
}

/* ---- a code to type ------------------------------------------------------------- */

export interface ConnectCodeText {
  copy: string
}

export const connectCodeText: ConnectCodeText = { copy: 'Copy the code' }

export interface ConnectCodeProps {
  code: string
  /** Smaller, for a narrow side panel. */
  compact?: boolean
  /** What writes to the clipboard, where the host has its own. */
  write?: (text: string) => Promise<void>
  text?: Partial<ConnectCodeText>
}

/** A one-time code to type on the service's page, large, with a press that copies it. */
export function ConnectCode({ code, compact = false, write, text }: ConnectCodeProps) {
  const t = { ...connectCodeText, ...text }
  return (
    <div className={cx(s.code, compact && s.codeCompact)}>
      <span className={s.codeText}>{code}</span>
      <CopyButton value={code} ghost text={{ copy: t.copy }} {...(write === undefined ? {} : { write })} />
    </div>
  )
}

/* ---- what to do on a page ------------------------------------------------------- */

export interface ConnectStepsText {
  title: string
}

export const connectStepsText: ConnectStepsText = { title: 'On the page' }

/** What to do on the page the step opens, in order. */
export function ConnectSteps({ items, text }: { items: readonly ReactNode[]; text?: Partial<ConnectStepsText> }) {
  const t = { ...connectStepsText, ...text }
  const id = useId()
  return (
    <div className={s.steps}>
      <p id={id} className={s.k}>
        {t.title}
      </p>
      <ol aria-labelledby={id} className={s.ol}>
        {items.map((item, i) => (
          <li key={i}>
            <span className={s.n} aria-hidden="true">
              {i + 1}.
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ---- the permissions a token is made with --------------------------------------- */

export interface ConnectPermission {
  /** As the service's page names it: Pull requests, read:pipeline:bitbucket. */
  name: string
  /** How much, where the page asks: Read and write. */
  level?: string
  /** What Althar does with it. */
  why?: string
}

export interface ConnectPermsText {
  title: string
  /** The press that shows them, where they are folded away. */
  see: (count: number) => string
}

export const connectPermsText: ConnectPermsText = {
  title: 'Filled in on the page',
  see: (count) => (count === 1 ? 'See the permission it sets' : `See the ${count} permissions it sets`),
}

export interface ConnectPermsProps {
  rows: readonly ConnectPermission[]
  /** Behind a press, for a card, where one thing at a time is enough. */
  fold?: boolean
  /** Names that read as code, such as scopes. */
  mono?: boolean
  text?: Partial<ConnectPermsText>
}

/** What a token is made with on the service's page: each permission, how much, and what Althar does with it. */
export function ConnectPerms({ rows, fold = false, mono = false, text }: ConnectPermsProps) {
  const t = { ...connectPermsText, ...text }
  const [open, setOpen] = useState(!fold)
  const id = useId()
  if (!open)
    return (
      <div className={s.foldRow}>
        <LinkButton aria-expanded={false} onClick={() => setOpen(true)}>
          {t.see(rows.length)}
        </LinkButton>
      </div>
    )
  return (
    <div className={s.perms}>
      <p id={id} className={s.k}>
        {t.title}
      </p>
      <dl aria-labelledby={id} className={cx(s.sheet, mono && s.mono)}>
        {rows.map((row) => (
          <div key={row.name} className={cx(s.perm, row.level === undefined && s.permScope)}>
            <dt>{row.name}</dt>
            {row.level !== undefined && <dd className={s.permLevel}>{row.level}</dd>}
            {row.why !== undefined && <dd className={s.permWhy}>{row.why}</dd>}
          </div>
        ))}
      </dl>
    </div>
  )
}

/* ---- facts ---------------------------------------------------------------------- */

/** A few facts about a sign-in, keys on the left, on a sunken sheet: its account, its scopes, what it reaches. */
export function ConnectFacts({
  rows,
}: {
  rows: readonly { readonly label: string; readonly value: ReactNode; readonly mono?: boolean }[]
}) {
  return (
    <dl className={cx(s.sheet, s.facts)}>
      {rows.map((row) => (
        <div key={row.label} className={s.factRow}>
          <dt>{row.label}</dt>
          <dd className={row.mono ? s.factMono : undefined}>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/* ---- the clipboard -------------------------------------------------------------- */

export interface ConnectClipText {
  seen: (what: string) => string
  use: string
}

export const connectClipText: ConnectClipText = {
  seen: (what) => `${what} is on your clipboard`,
  use: 'Use it',
}

export interface ConnectClipProps {
  /** What it looks like: A GitHub token. */
  what: string
  /** It, shown without the middle: github_pat_11ABX····7Qx. */
  shown: string
  onUse: () => void
  busy?: boolean
  text?: Partial<ConnectClipText>
}

/** A token noticed on the clipboard as the window came back, with the press that takes it. */
export function ConnectClip({ what, shown, onUse, busy = false, text }: ConnectClipProps) {
  const t = { ...connectClipText, ...text }
  return (
    <output className={s.clip}>
      <Icon name="clip" size={13} />
      <span className={s.clipWords}>
        <span>{t.seen(what)}</span>
        <span className={s.clipValue}>{shown}</span>
      </span>
      <Button size="small" busy={busy} onClick={onUse}>
        {t.use}
      </Button>
    </output>
  )
}

/* ---- a field -------------------------------------------------------------------- */

export interface ConnectFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  /** Pressed, or Enter in the field. */
  onSubmit?: () => void
  /** The press beside it: Check, Continue. Without one, Enter still submits. */
  submit?: string
  /** What is in it is being checked. */
  busy?: boolean
  placeholder?: string
  /** password for a token, which isn't shown as it is typed or pasted. */
  type?: 'password' | 'text' | 'url' | 'email'
  /** Set as code: a token, a key. */
  mono?: boolean
  /** Why what is in it won't do. */
  error?: ReactNode
  /** Where its value came from, under it: From Tessera's git config. */
  hint?: ReactNode
  /** Takes focus as it shows: the step's typing goes here. */
  focus?: boolean
}

/** A field to paste or type into, with its press, and why what is in it won't do. */
export function ConnectField({
  label,
  value,
  onChange,
  onSubmit,
  submit,
  busy = false,
  placeholder,
  type = 'text',
  mono = false,
  error,
  hint,
  focus = false,
}: ConnectFieldProps) {
  const input = useRef<HTMLInputElement>(null)
  // Only as it shows: where focus goes after that is the person's.
  const focusFirst = useRef(focus)
  useEffect(() => {
    if (focusFirst.current) input.current?.focus()
  }, [])
  const errorId = useId()
  const hintId = useId()
  const said = error !== undefined && error !== null && error !== false
  const described = [said ? errorId : null, hint === undefined ? null : hintId].filter((id) => id !== null).join(' ')
  const send = (event: FormEvent) => {
    event.preventDefault()
    if (!busy) onSubmit?.()
  }
  return (
    <form className={s.field} onSubmit={send} noValidate>
      <label className={s.label}>
        {label}
        <span className={s.fieldRow}>
          <Field
            ref={input}
            type={type}
            value={value}
            invalid={said}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            className={mono ? s.mono : undefined}
            {...(described === '' ? {} : { 'aria-describedby': described })}
            onChange={(e) => onChange(e.target.value)}
          />
          {submit !== undefined && (
            <Button size="small" type="submit" busy={busy}>
              {submit}
            </Button>
          )}
        </span>
      </label>
      {said && <FieldError id={errorId}>{error}</FieldError>}
      {hint !== undefined && (
        <span id={hintId} className={s.hint}>
          {hint}
        </span>
      )}
    </form>
  )
}

/* ---- what it can do ------------------------------------------------------------- */

export interface ConnectCan {
  id: string
  /** What Althar needs it to do: Push a task's branch. */
  text: string
  state: CanState
  /** What was found, at the line's end: balazs, northwind, Developer. */
  fact?: ReactNode
  /** Why not, or why it can't be known, under it. */
  why?: ReactNode
}

export interface ConnectChecksText {
  /** Each state, read out after the line. */
  can: string
  cannot: string
  unknown: string
  checking: string
  waiting: string
}

export const connectChecksText: ConnectChecksText = {
  can: 'it can',
  cannot: 'it can’t',
  unknown: 'not known',
  checking: 'checking',
  waiting: 'not checked yet',
}

const said = (state: CanState, t: ConnectChecksText): string => {
  switch (state) {
    case CanState.Can:
      return t.can
    case CanState.Cannot:
      return t.cannot
    case CanState.Unknown:
      return t.unknown
    case CanState.Checking:
      return t.checking
    case CanState.Waiting:
      return t.waiting
    default:
      return unreachable(state)
  }
}

function CanGlyph({ state }: { state: CanState }) {
  switch (state) {
    case CanState.Can:
      return <Icon name="check" size={12} />
    case CanState.Cannot:
      return <span className={s.no}>!</span>
    case CanState.Unknown:
      return <span className={s.unknown} />
    case CanState.Checking:
      return <Spinner size="small" />
    case CanState.Waiting:
      return <span className={s.todo} />
    default:
      return unreachable(state)
  }
}

/* Each line's look, by how it stands. */
const STATE_CLASS: Record<CanState, string | undefined> = {
  [CanState.Can]: s.isCan,
  [CanState.Cannot]: s.isCannot,
  [CanState.Unknown]: s.isUnknown,
  [CanState.Checking]: s.isChecking,
  [CanState.Waiting]: s.isWaiting,
}

export interface ConnectChecksProps {
  /** What the list is, for a screen reader: What GitHub lets Althar do. */
  label: string
  items: readonly ConnectCan[]
  text?: Partial<ConnectChecksText>
}

/** What a connection can do: each thing Althar needs, ticked, being asked, not, or not known, with what was found or why not. */
export function ConnectChecks({ label, items, text }: ConnectChecksProps) {
  const t = { ...connectChecksText, ...text }
  const busy = items.some((item) => item.state === CanState.Checking)
  return (
    <ul aria-label={label} aria-busy={busy || undefined} className={s.cans}>
      {items.map((item) => (
        <li key={item.id} className={cx(s.can, STATE_CLASS[item.state])}>
          <span className={s.glyph} aria-hidden="true">
            <CanGlyph state={item.state} />
          </span>
          <span className={s.words}>
            <span className={s.canText}>
              {item.text}
              <VisuallyHidden>, {said(item.state, t)}</VisuallyHidden>
            </span>
            {item.why !== undefined && <span className={s.why}>{item.why}</span>}
          </span>
          {item.fact !== undefined && <span className={s.canFact}>{item.fact}</span>}
        </li>
      ))}
    </ul>
  )
}
