import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { SignInWay, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { CopyButton } from '../../primitives/CopyButton/CopyButton'
import { Field, FieldError } from '../../primitives/Field/Field'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import a from './Accounts.module.css'
import type { FoundFolder } from './Accounts'
import s from './AccountSignIn.module.css'

/*
 * Signing an agent's account in, drawn in the accounts list rather than as a
 * sheet over it (ADR-012). The account's own line says where it stands: a new
 * one where it will land, waiting on the browser, checking who it signed in
 * as, then named in its line. A line or two under it holds what the step
 * asks for. The browser comes first; the other ways follow as quiet links,
 * each as the agent offers it: a one-time code, an API key, the provider's
 * console, a folder an account switcher already signed in.
 *
 * The sign-in itself is the consumer's: it runs the agent's own login and
 * moves `step` on. This draws the step it is given and says what was chosen.
 * Escape inside it cancels; it marks itself `data-own-escape` so a panel
 * around it doesn't close first. It takes focus as it opens, and again when
 * a step takes the control that had it.
 */

/** Where a sign-in stands. */
export type AccountSignInStep =
  /** The ways in. */
  | { kind: 'choose' }
  /** The agent's sign-in is open in the browser, waiting on `host`. `link`: to open it elsewhere. `paste`: it takes a code the page shows when the browser can't reach back. */
  | { kind: 'browser'; host: string; link?: string; paste?: boolean; pasteError?: ReactNode }
  /** The agent's sign-in runs in a terminal: opened there, or, where it couldn't be, `line` to run. `notYet`: back without being signed in. */
  | { kind: 'terminal'; line: string; opened: boolean; notYet?: boolean }
  /** A one-time code to type on `page`. `lasts`: how long it still works, as the person reads it. */
  | { kind: 'code'; code: string; page: string; lasts: string; opened?: boolean }
  /** A key to paste. */
  | { kind: 'key'; saving?: boolean; error?: ReactNode }
  /** Folders the agent already signed in with, to add as they are. */
  | { kind: 'folders' }
  /** The agent is saying who it signed in as, or whether it takes the key. */
  | { kind: 'checking'; key?: boolean }
  /** Signed in, to name: who, what pays, and where it goes in the order. */
  | { kind: 'named'; name: string; who?: string; paid?: string; placed?: string; saving?: boolean }
  /** Signed in as an account already there, by its name: nothing was added. */
  | { kind: 'same'; name: string }
  /** The agent stopped, in its own words. */
  | { kind: 'failed'; said: string }

/** The ways an agent offers in. Each shows only when given. */
export interface AccountSignInWays {
  /** The plan it signs in to in the browser: Claude, ChatGPT. */
  browser?: string
  /** It signs in with its own command, in a terminal: first where there is no browser way, else among the others. */
  terminal?: boolean
  /** It signs in with a one-time code too. */
  code?: boolean
  /** Its name for an API key: Anthropic API key. */
  key?: string
  /** The provider's console, billed per use: Anthropic Console. */
  console?: string
  /** Folders account switchers keep its accounts in, not added yet. */
  found?: readonly FoundFolder[]
  /** The person may choose another folder it already signed in with. */
  choose?: boolean
}

export interface AccountSignInText {
  fresh: string
  signingIn: (name: string) => string
  cancel: string
  leave: string
  continueWith: (plan: string) => string
  inTerminalWay: string
  terminal: string
  signInAs: (who: string) => string
  signInAgain: string
  or: string
  code: string
  key: (name: string) => string
  console: (name: string) => string
  folder: string
  holds: (who: string) => string
  approveOn: (host: string) => string
  copyLink: string
  pasteCode: string
  pasteField: (host: string) => string
  continue: string
  emptyPaste: string
  another: string
  inTerminal: string
  runIt: string
  notYet: string
  terminalAgain: string
  checkAgain: string
  finishTerminal: string
  enterAt: (page: string) => string
  waitingCode: string
  copyCode: string
  openPage: string
  lasts: (time: string) => string
  keyField: (name: string) => string
  addKey: string
  emptyKey: string
  keyBilled: string
  choose: string
  addIt: string
  checking: (agent: string) => string
  checkingKey: string
  nameField: string
  emptyName: string
  add: string
  done: string
  same: (name: string) => string
  sameHow: string
  stopped: (agent: string) => string
  tryAgain: string
}

export const accountSignInText: AccountSignInText = {
  fresh: 'New account',
  signingIn: (name) => `Signing ${name} in`,
  cancel: 'Cancel signing in',
  leave: 'Cancel',
  continueWith: (plan) => `Continue with ${plan}`,
  inTerminalWay: 'Sign in in Terminal',
  terminal: 'In Terminal',
  signInAs: (who) => `Sign in as ${who}`,
  signInAgain: 'Sign in again',
  or: 'or',
  code: 'A code',
  key: (name) => name,
  console: (name) => name,
  folder: 'A folder on this Mac',
  holds: (who) => `The browser may still be signed in as ${who}. To add someone else, use another browser profile, or a code.`,
  approveOn: (host) => `Approve on ${host} in your browser`,
  copyLink: 'Copy the link',
  pasteCode: 'Paste a code',
  pasteField: (host) => `The code ${host} showed`,
  continue: 'Continue',
  emptyPaste: 'Paste the code first',
  another: 'Another way',
  inTerminal: 'Finish signing in in Terminal',
  runIt: 'Run this in a terminal to sign in',
  notYet: 'Not signed in yet.',
  terminalAgain: 'Open Terminal again',
  checkAgain: 'Check again',
  finishTerminal: 'Come back here when it’s done, and Althar checks that it signed in.',
  enterAt: (page) => `Enter the code at ${page}`,
  waitingCode: 'Waiting for the code',
  copyCode: 'Copy the code',
  openPage: 'Open the page',
  lasts: (time) => `lasts ${time}`,
  keyField: (name) => name,
  addKey: 'Add key',
  emptyKey: 'Paste the key first',
  keyBilled: 'Billed per use to the key’s account, after your plans.',
  choose: 'Another folder…',
  addIt: 'Add it',
  checking: (agent) => `Checking who ${agent} signed in as…`,
  checkingKey: 'Checking the key…',
  nameField: 'Name this account',
  emptyName: 'Give it a name',
  add: 'Add account',
  done: 'Done',
  same: (name) => `That’s ${name} again`,
  sameHow: 'The browser signed in as an account already here. Sign in from another browser profile, or use a code.',
  stopped: (agent) => `${agent} stopped:`,
  tryAgain: 'Try again',
}

export interface AccountSignInProps {
  /** The agent's name. */
  agent: string
  /** Its place in the order, as shown: where a new one lands. */
  position: number
  /** Signing this account in again; without it, a new one. */
  account?: { name: string; who?: string }
  step: AccountSignInStep
  ways: AccountSignInWays
  /** Who the browser may still be signed in as, when adding one: said once, under the ways. */
  holds?: string
  /** Goes one way in. */
  onWay: (way: SignInWay) => void
  /** Opens the code's page, or the terminal sign-in again. */
  onOpen?: () => void
  /** Asks the agent again who it is signed in as, after a sign-in in a terminal. */
  onCheck?: () => void
  /** A code the browser showed, pasted. */
  onPaste?: (code: string) => void
  /** A key, to check and keep. */
  onKey?: (key: string) => void
  /** Adds a folder an account switcher made, by its id. */
  onAdopt?: (id: string) => void
  /** Picks another folder the agent already signed in with. */
  onChooseFolder?: () => void
  /** Back to the ways in. */
  onBack?: () => void
  /** Signed in, named, and done. */
  onDone: (name: string) => void
  onCancel: () => void
  className?: string
  text?: Partial<AccountSignInText>
}

/** An account signing in, in its own line of the accounts list, with what the step asks for under it. */
export function AccountSignIn(props: AccountSignInProps) {
  const { agent, position, account, step, onCancel, className } = props
  const t = { ...accountSignInText, ...props.text }
  const naming = step.kind === 'named' ? step.name : null
  const [name, setName] = useState(naming ?? '')
  const [given, setGiven] = useState(naming)
  const [empty, setEmpty] = useState(false)
  const nameField = useRef<HTMLInputElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const errorId = useId()
  // Signed in: the name it comes with, in the field.
  if (naming !== given) {
    setGiven(naming)
    if (naming !== null) setName(naming)
  }
  // Opened, focus comes in from the button that opened it; moved on past the control that had it, focus stays.
  const opened = useRef(false)
  useEffect(() => {
    const lost = document.activeElement === null || document.activeElement === document.body
    if (!opened.current || lost) root.current?.focus()
    opened.current = true
  }, [step.kind])
  // Chosen, ready to type over.
  useEffect(() => {
    if (naming !== null) nameField.current?.select()
  }, [naming])

  const finish = (event?: FormEvent) => {
    event?.preventDefault()
    // A name on its way is kept once: Return pressed again while it saves does nothing more.
    if (step.kind === 'named' && step.saving === true) return
    if (name.trim() === '') return setEmpty(true)
    props.onDone(name.trim())
  }

  const status = ((): ReactNode => {
    switch (step.kind) {
      case 'browser':
        return t.approveOn(step.host)
      case 'terminal':
        return step.opened ? t.inTerminal : t.runIt
      case 'code':
        return step.opened ? t.waitingCode : t.enterAt(step.page)
      case 'checking':
        return step.key ? t.checkingKey : t.checking(agent)
      case 'same':
        return t.same(step.name)
      case 'named':
        return step.who
      case 'choose':
      case 'key':
      case 'folders':
      case 'failed':
        return account?.who
      default:
        return unreachable(step)
    }
  })()

  return (
    <div
      ref={root}
      role="group"
      tabIndex={-1}
      aria-label={account ? t.signingIn(account.name) : t.fresh}
      className={cx(s.signIn, className)}
      data-own-escape=""
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        onCancel()
      }}
    >
      <Line naming={step.kind === 'named'} onSubmit={finish}>
        <span className={a.number} aria-hidden="true">
          {position}
        </span>
        {step.kind === 'named' ? (
          <span className={cx(a.name, s.naming)}>
            <input
              ref={nameField}
              className={s.nameField}
              value={name}
              aria-label={t.nameField}
              aria-invalid={empty || undefined}
              aria-describedby={empty ? errorId : undefined}
              size={Math.max(6, name.length + 1)}
              onChange={(event) => {
                setName(event.target.value)
                setEmpty(false)
              }}
            />
          </span>
        ) : (
          <span className={cx(a.name, !account && s.fresh)}>{account ? account.name : t.fresh}</span>
        )}
        <span className={cx(a.who, s.status)} aria-live="polite">
          {empty ? <FieldError id={errorId}>{t.emptyName}</FieldError> : status}
        </span>
        <span className={a.end}>{step.kind === 'named' ? step.paid : null}</span>
        <span className={a.menu}>
          <IconButton icon="close" label={t.cancel} size="small" type="button" onClick={onCancel} />
        </span>
      </Line>
      <Under {...props} t={t} finish={finish} />
    </div>
  )
}

/* The account's line: a form while it is being named, so Return keeps the name. */
function Line({ naming, onSubmit, children }: { naming: boolean; onSubmit: (event: FormEvent) => void; children: ReactNode }) {
  return naming ? (
    <form className={cx(a.line, s.line)} onSubmit={onSubmit}>
      {children}
    </form>
  ) : (
    <div className={cx(a.line, s.line)}>{children}</div>
  )
}

/* What the step asks for, under the line. */
function Under({
  step,
  ways,
  account,
  holds,
  onWay,
  onOpen,
  onCheck,
  onPaste,
  onKey,
  onAdopt,
  onChooseFolder,
  onBack,
  onCancel,
  agent,
  t,
  finish,
}: AccountSignInProps & { t: AccountSignInText; finish: (event?: FormEvent) => void }) {
  const another = onBack && <LinkButton onClick={onBack}>{t.another}</LinkButton>
  switch (step.kind) {
    case 'choose': {
      const others = [
        ways.code && { way: SignInWay.Code, label: t.code },
        ways.terminal && ways.browser && { way: SignInWay.Terminal, label: t.terminal },
        ways.console && !account && { way: SignInWay.Console, label: t.console(ways.console) },
        ways.key && !account && { way: SignInWay.Key, label: t.key(ways.key) },
        (ways.found?.length || ways.choose) && !account && { way: SignInWay.Folder, label: t.folder },
      ].filter((way): way is { way: SignInWay; label: string } => Boolean(way))
      // The first way in is a button: the browser, or else the agent's own command in a terminal.
      const first = ways.browser ? (
        <Button size="small" icon="external" onClick={() => onWay(SignInWay.Browser)}>
          {account ? (account.who ? t.signInAs(account.who) : t.signInAgain) : t.continueWith(ways.browser)}
        </Button>
      ) : ways.terminal ? (
        <Button size="small" icon="terminal" onClick={() => onWay(SignInWay.Terminal)}>
          {t.inTerminalWay}
        </Button>
      ) : null
      return (
        <div className={s.under}>
          <div className={s.row}>
            {first}
            {first && others.length > 0 && <span className={s.or}>{t.or}</span>}
            {others.map((way) => (
              <LinkButton key={way.way} onClick={() => onWay(way.way)}>
                {way.label}
              </LinkButton>
            ))}
          </div>
          {holds && !account && <p className={s.hint}>{t.holds(holds)}</p>}
        </div>
      )
    }
    case 'browser':
      return <Browser step={step} t={t} onPaste={onPaste} another={another} />
    case 'terminal':
      return (
        <div className={s.under}>
          {step.opened ? (
            <p className={s.hint}>
              {step.notYet && <span className={s.notYet}>{t.notYet} </span>}
              {t.finishTerminal}
            </p>
          ) : (
            <div className={s.row}>
              <code className={s.command}>{step.line}</code>
              <CopyButton value={step.line} ghost />
            </div>
          )}
          <div className={s.row}>
            {onCheck && <LinkButton onClick={onCheck}>{t.checkAgain}</LinkButton>}
            {step.opened && onOpen && <LinkButton onClick={onOpen}>{t.terminalAgain}</LinkButton>}
            {another}
          </div>
        </div>
      )
    case 'code':
      return (
        <div className={s.under}>
          <div className={s.row}>
            <span className={s.code}>{step.code}</span>
            <CopyButton value={step.code} ghost text={{ copy: t.copyCode }} />
            {!step.opened && onOpen && (
              <Button size="small" icon="external" onClick={onOpen}>
                {t.openPage}
              </Button>
            )}
            <span className={s.quiet}>{t.lasts(step.lasts)}</span>
            {another}
          </div>
        </div>
      )
    case 'key':
      return <Key step={step} ways={ways} t={t} onKey={onKey} another={another} />
    case 'folders':
      return (
        <div className={s.under}>
          {(ways.found?.length ?? 0) > 0 && (
            <ul className={s.folders}>
              {ways.found?.map((found) => (
                <li key={found.id} className={s.folder}>
                  <span className={s.folderName}>{found.name}</span>
                  <span className={s.folderPath}>
                    {found.folder} · {found.from}
                  </span>
                  {onAdopt && <LinkButton onClick={() => onAdopt(found.id)}>{t.addIt}</LinkButton>}
                </li>
              ))}
            </ul>
          )}
          <div className={s.row}>
            {ways.choose && onChooseFolder && <LinkButton onClick={onChooseFolder}>{t.choose}</LinkButton>}
            {another}
          </div>
        </div>
      )
    case 'checking':
      return null
    case 'named':
      return (
        <div className={cx(s.under, s.row, s.ends)}>
          {step.placed && <span className={s.quiet}>{step.placed}</span>}
          <span className={s.gap} />
          <LinkButton onClick={onCancel}>{t.leave}</LinkButton>
          <Button size="small" busy={step.saving} onClick={() => finish()}>
            {account ? t.done : t.add}
          </Button>
        </div>
      )
    case 'same':
      return (
        <div className={s.under}>
          <p className={s.hint}>{t.sameHow}</p>
          <div className={s.row}>
            {ways.code && <LinkButton onClick={() => onWay(SignInWay.Code)}>{t.code}</LinkButton>}
            {another}
          </div>
        </div>
      )
    case 'failed':
      return (
        <div className={s.under}>
          <p className={s.failed}>
            {t.stopped(agent)} <span className={s.said}>{step.said}</span>
          </p>
          <div className={s.row}>{onBack && <LinkButton onClick={onBack}>{t.tryAgain}</LinkButton>}</div>
        </div>
      )
    default:
      return unreachable(step)
  }
}

function Browser({
  step,
  t,
  onPaste,
  another,
}: {
  step: Extract<AccountSignInStep, { kind: 'browser' }>
  t: AccountSignInText
  onPaste?: (code: string) => void
  another: ReactNode
}) {
  const [pasting, setPasting] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  // Pasting starts in the field.
  useEffect(() => {
    if (pasting) field.current?.focus()
  }, [pasting])
  const [code, setCode] = useState('')
  const [empty, setEmpty] = useState(false)
  const errorId = useId()
  if (pasting && onPaste)
    return (
      <form
        className={s.under}
        onSubmit={(event) => {
          event.preventDefault()
          if (code.trim() === '') return setEmpty(true)
          onPaste(code.trim())
        }}
      >
        <div className={s.row}>
          <Field
            ref={field}
            value={code}
            placeholder={t.pasteField(step.host)}
            aria-label={t.pasteField(step.host)}
            invalid={empty || step.pasteError !== undefined}
            aria-describedby={empty || step.pasteError ? errorId : undefined}
            className={s.field}
            onChange={(event) => {
              setCode(event.target.value)
              setEmpty(false)
            }}
          />
          <Button size="small" type="submit">
            {t.continue}
          </Button>
          {another}
        </div>
        {(empty || step.pasteError) && <FieldError id={errorId}>{empty ? t.emptyPaste : step.pasteError}</FieldError>}
      </form>
    )
  return (
    <div className={s.under}>
      <div className={s.row}>
        {step.link && <CopyButton value={step.link} text={{ copy: t.copyLink }} />}
        {step.paste && onPaste && <LinkButton onClick={() => setPasting(true)}>{t.pasteCode}</LinkButton>}
        {another}
      </div>
    </div>
  )
}

function Key({
  step,
  ways,
  t,
  onKey,
  another,
}: {
  step: Extract<AccountSignInStep, { kind: 'key' }>
  ways: AccountSignInWays
  t: AccountSignInText
  onKey?: (key: string) => void
  another: ReactNode
}) {
  const [key, setKey] = useState('')
  const field = useRef<HTMLInputElement>(null)
  // Chosen from the ways in, it starts in the field.
  useEffect(() => field.current?.focus(), [])
  const [empty, setEmpty] = useState(false)
  const errorId = useId()
  const label = t.keyField(ways.key ?? '')
  return (
    <form
      className={s.under}
      onSubmit={(event) => {
        event.preventDefault()
        if (key.trim() === '') return setEmpty(true)
        onKey?.(key.trim())
      }}
    >
      <div className={s.row}>
        <Field
          ref={field}
          type="password"
          value={key}
          placeholder={label}
          aria-label={label}
          invalid={empty || step.error !== undefined}
          aria-describedby={empty || step.error ? errorId : undefined}
          className={cx(s.field, s.mono)}
          onChange={(event) => {
            setKey(event.target.value)
            setEmpty(false)
          }}
        />
        <Button size="small" type="submit" busy={step.saving}>
          {t.addKey}
        </Button>
        {another}
      </div>
      {empty || step.error ? (
        <FieldError id={errorId}>{empty ? t.emptyKey : step.error}</FieldError>
      ) : (
        <p className={s.hint}>{t.keyBilled}</p>
      )}
    </form>
  )
}
