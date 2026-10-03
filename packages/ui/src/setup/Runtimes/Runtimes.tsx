import type { ReactNode } from 'react'

import { BrandMark } from '../../foundations/Marks/Marks'
import { Icon } from '../../foundations/Icon/Icon'
import type { Brand } from '../../foundations/brands/brands'
import { RuntimeState, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import { Popover } from '../../primitives/Popover/Popover'
import { Spinner } from '../../primitives/Spinner/Spinner'
import s from './Runtimes.module.css'

/*
 * The agents on this machine that Charrette can run, and where each stands.
 * Each runtime signs in its own way and keeps its own login: Charrette asks
 * it who it is signed in as, opens its sign-in when you ask, and never
 * sees a password or a token. A row says what is true and offers the one
 * thing that would change it. Ready rows say who, and nothing else.
 */

interface RuntimeBase {
  id: string
  name: string
  /** Its mark. Without one, a plug. */
  brand?: Brand
  version?: string
  /** What goes under its row: its accounts, where it has them. */
  detail?: ReactNode
}

/** A runtime on this machine, and where it stands. What a row can say depends on its state, so each state carries only what it needs. */
export type RuntimeEntry = RuntimeBase &
  (
    | {
        state: RuntimeState.Ready
        /** Who it is signed in as, and on what, as the runtime reports it: you@meridian.dev · Max. */
        account?: string
      }
    | { state: RuntimeState.Checking }
    | { state: RuntimeState.SigningIn }
    | {
        state: RuntimeState.SignedOut
        /** Tasks held until it can run again. Makes signing in a call of yours. */
        waiting?: number
      }
    | {
        state: RuntimeState.OutOfUsage
        /** When its allowance comes back. */
        resets: string
        /** Where its work goes until then, by the project's usage-limit rule. Without it, the work waits. */
        movesTo?: string
      }
    | { state: RuntimeState.Missing }
    | {
        state: RuntimeState.Outdated
        version: string
        /** The oldest version Charrette works with. */
        needs: string
      }
  )

export interface RuntimesText {
  checking: string
  signingIn: (name: string) => string
  signedOut: string
  signInNote: (name: string) => string
  waiting: (n: number) => string
  outOfUsage: (resets: string) => string
  movesTo: (to: string) => string
  waits: string
  missing: string
  outdated: (version: string, needs: string) => string
  signIn: string
  cancel: string
  check: string
  install: string
  update: string
  add: string
}

export const runtimesText: RuntimesText = {
  checking: 'Checking who it is signed in as',
  signingIn: (name) => `Finish signing in to ${name} in your browser`,
  signedOut: 'Signed out',
  signInNote: (name) => `Sign in opens ${name}’s own sign-in. Charrette never sees your password.`,
  waiting: (n) => (n === 1 ? '1 task waits for it' : `${n} tasks wait for it`),
  outOfUsage: (resets) => `Out of usage until ${resets}`,
  movesTo: (to) => `its work moves to ${to}`,
  waits: 'its work waits for the reset',
  missing: 'Not installed on this Mac',
  outdated: (version, needs) => `Version ${version} · Charrette needs ${needs} or later`,
  signIn: 'Sign in',
  cancel: 'Cancel',
  check: 'Check again',
  install: 'How to install',
  update: 'How to update',
  add: 'Connect another',
}

export interface RuntimesProps {
  /** What the list is, for a screen reader: Agents on this Mac. */
  label: string
  runtimes: readonly RuntimeEntry[]
  onSignIn?: (id: string) => void
  /** Stops waiting on a sign-in that was opened. */
  onCancel?: (id: string) => void
  /** Looks again, after installing or updating. */
  onCheck?: (id: string) => void
  /** Opens the runtime's own instructions, to install or update it. */
  onHelp?: (id: string) => void
  /** Adds an API key or a local model. Without it (or `connect`), no such row. */
  onAdd?: () => void
  /** What "Connect another" opens beside itself: ConnectAgent. Takes the place of `onAdd`. */
  connect?: ReactNode
  className?: string
  text?: Partial<RuntimesText>
}

/** The agent runtimes on this machine, each with who it is signed in as or what it needs. */
export function Runtimes({ label, runtimes, onSignIn, onCancel, onCheck, onHelp, onAdd, connect, className, text }: RuntimesProps) {
  const t = { ...runtimesText, ...text }
  return (
    <div className={cx(s.runtimes, className)}>
      <ul aria-label={label} className={s.list}>
        {runtimes.map((r) => (
          <Row key={r.id} r={r} t={t} onSignIn={onSignIn} onCancel={onCancel} onCheck={onCheck} onHelp={onHelp} />
        ))}
      </ul>
      {connect ? (
        <Popover
          label={t.add}
          width={420}
          trigger={
            <ActionButton icon="plus" className={s.add}>
              {t.add}
            </ActionButton>
          }
        >
          {connect}
        </Popover>
      ) : (
        onAdd && (
          <ActionButton icon="plus" onClick={onAdd} className={s.add}>
            {t.add}
          </ActionButton>
        )
      )}
    </div>
  )
}

interface RowProps extends Pick<RuntimesProps, 'onSignIn' | 'onCancel' | 'onCheck' | 'onHelp'> {
  r: RuntimeEntry
  t: RuntimesText
}

function Row({ r, t, onSignIn, onCancel, onCheck, onHelp }: RowProps) {
  const { line, note, actions, calls } = parts(r, t, { onSignIn, onCancel, onCheck, onHelp })
  return (
    <li className={s.row}>
      <span className={s.mark}>{r.brand ? <BrandMark brand={r.brand} size={18} /> : <Icon name="plug" size={16} />}</span>
      <span className={s.body}>
        <span className={s.name}>{r.name}</span>
        <span className={cx(s.line, calls && s.calls)}>{line}</span>
        {note && <span className={s.note}>{note}</span>}
        {r.detail && <span className={s.detail}>{r.detail}</span>}
      </span>
      {actions && <span className={s.actions}>{actions}</span>}
    </li>
  )
}

type Handlers = Pick<RuntimesProps, 'onSignIn' | 'onCancel' | 'onCheck' | 'onHelp'>

/* What a row says and offers, by state. `calls` when something waits on you. */
function parts(r: RuntimeEntry, t: RuntimesText, h: Handlers) {
  const help = (words: string) =>
    h.onHelp && (
      <ActionButton icon="external" onClick={() => h.onHelp?.(r.id)}>
        {words}
      </ActionButton>
    )
  const check = h.onCheck && <ActionButton onClick={() => h.onCheck?.(r.id)}>{t.check}</ActionButton>
  switch (r.state) {
    case RuntimeState.Ready:
      return { line: [r.account, r.version && `v${r.version}`].filter(Boolean).join(' · ') }
    case RuntimeState.Checking:
      return {
        line: (
          <>
            <Spinner size="small" />
            {t.checking}
          </>
        ),
      }
    case RuntimeState.SigningIn:
      return {
        line: (
          <>
            <Spinner size="small" />
            {t.signingIn(r.name)}
          </>
        ),
        actions: h.onCancel && (
          <Button variant="quiet" onClick={() => h.onCancel?.(r.id)}>
            {t.cancel}
          </Button>
        ),
      }
    case RuntimeState.SignedOut: {
      const waiting = r.waiting ? t.waiting(r.waiting) : undefined
      return {
        line: waiting ? `${t.signedOut} · ${waiting}` : t.signedOut,
        note: t.signInNote(r.name),
        calls: Boolean(waiting),
        actions: h.onSignIn && (
          <Button variant={waiting ? 'signal' : 'default'} onClick={() => h.onSignIn?.(r.id)}>
            {t.signIn}
          </Button>
        ),
      }
    }
    case RuntimeState.OutOfUsage:
      return {
        line: (
          <>
            {t.outOfUsage(r.resets)}
            {' · '}
            {r.movesTo ? t.movesTo(r.movesTo) : t.waits}
          </>
        ),
      }
    case RuntimeState.Missing:
      return {
        line: t.missing,
        actions: (help(t.install) || check) && (
          <>
            {help(t.install)}
            {check}
          </>
        ),
      }
    case RuntimeState.Outdated:
      return {
        line: t.outdated(r.version, r.needs),
        actions: (help(t.update) || check) && (
          <>
            {help(t.update)}
            {check}
          </>
        ),
      }
    default:
      return unreachable(r)
  }
}
