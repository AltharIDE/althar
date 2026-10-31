import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { Field, FieldArea, FieldError } from '../../primitives/Field/Field'
import { Disclosure, DisclosureTrigger, Fold, useOpen } from '../../primitives/Fold/Fold'
import { KeyValues } from '../../primitives/KeyValues/KeyValues'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Skeleton } from '../../primitives/Skeleton/Skeleton'
import { Switch } from '../../primitives/Switch/Switch'
import s from './ReportProblem.module.css'

/*
 * Report a problem: what happened, in the person's own words, the one thing
 * it needs. What goes with it is theirs to see and to leave out: a picture
 * of the window as it was, with its preview; the logs, with every item that
 * goes listed under See what's sent; and an email, if they'd like a reply.
 * Sent, or saved for their mail app, it says so in the same dialog. The
 * consumer takes the screenshot, gathers what goes, and sends it.
 */

export interface ReportProblemText {
  title: string
  what: string
  whatPlaceholder: string
  empty: string
  screenshot: string
  screenshotAlt: string
  logs: string
  logsNote: string
  seeSent: string
  hideSent: string
  reading: string
  email: string
  send: string
  sendKbd: string
  cancel: string
  close: string
}

export const reportProblemText: ReportProblemText = {
  title: 'Report a problem',
  what: 'What happened?',
  whatPlaceholder: 'What you did, what you expected, and what happened instead',
  empty: 'Say what happened first',
  screenshot: 'Include a screenshot of this window',
  screenshotAlt: 'Screenshot of this window',
  logs: 'Include logs',
  logsNote: 'Paths and repository names hidden',
  seeSent: 'See what’s sent',
  hideSent: 'Hide what’s sent',
  reading: 'Reading…',
  email: 'Email, if you’d like a reply',
  send: 'Send',
  sendKbd: '⌘↵',
  cancel: 'Cancel',
  close: 'Close',
}

/** One thing that goes with the report, for See what's sent. */
export interface ReportItem {
  id: string
  label: string
  value: string
  /** It goes only while that switch is on. */
  with?: 'screenshot' | 'logs'
}

/** What the person wrote and chose, as it goes out. */
export interface ReportDraft {
  text: string
  screenshot: boolean
  logs: boolean
  email: string
}

export interface ReportProblemProps {
  /** The window as it was before the dialog opened, as a picture's address. Without one there is no screenshot to include. */
  screenshot?: string
  /** Everything that goes with it, for See what's sent; null while it is still being read. */
  items: readonly ReportItem[] | null
  /** The email the person gave last time. */
  defaultEmail?: string
  /** A line under the title: what the report is about, or how it goes. */
  description?: ReactNode
  onSend: (draft: ReportDraft) => void
  onClose: () => void
  /** Sending it now. */
  sending?: boolean
  /** Why it didn't go. */
  error?: string
  /** Sent, or saved: said in place of the form, with Close. */
  done?: { title: string; line: ReactNode }
  /** See what's sent open from the start. */
  defaultShowing?: boolean
  text?: Partial<ReportProblemText>
}

/** A switch with its words beside it, a line under them, and what it includes at the end. */
function Option({
  label,
  note,
  checked,
  onChange,
  aside,
  children,
}: {
  label: string
  note?: ReactNode
  checked: boolean
  onChange: (on: boolean) => void
  aside?: ReactNode
  children?: ReactNode
}) {
  const id = useId()
  return (
    <div className={cx(s.option, aside !== undefined && s.withAside)}>
      <Switch checked={checked} onChange={onChange} labelledBy={`${id}-l`} {...(note === undefined ? {} : { describedBy: `${id}-n` })} />
      <div className={s.words}>
        <span id={`${id}-l`} className={s.label}>
          {label}
        </span>
        {note !== undefined && (
          <span id={`${id}-n`} className={s.note}>
            {note}
          </span>
        )}
        {children}
      </div>
      {aside}
    </div>
  )
}

/** See what's sent, and the list it opens. */
function Sent({ items, t }: { items: readonly ReportItem[] | null; t: ReportProblemText }) {
  const open = useOpen()
  return (
    <>
      <DisclosureTrigger>
        <LinkButton className={s.see}>{open ? t.hideSent : t.seeSent}</LinkButton>
      </DisclosureTrigger>
      <Fold bleed={false}>
        <div className={s.sent} aria-busy={items === null || undefined}>
          {items === null ? (
            <>
              <span className={s.reading}>{t.reading}</span>
              <Skeleton width="70%" />
              <Skeleton width="85%" />
              <Skeleton width="55%" />
            </>
          ) : (
            <KeyValues keyWidth={112} items={items.map((item) => [item.label, item.value] as const)} />
          )}
        </div>
      </Fold>
    </>
  )
}

export function ReportProblem({
  screenshot,
  items,
  defaultEmail = '',
  description,
  onSend,
  onClose,
  sending = false,
  error,
  done,
  defaultShowing = false,
  text,
}: ReportProblemProps) {
  const t = { ...reportProblemText, ...text }
  const [what, setWhat] = useState('')
  const [shot, setShot] = useState(screenshot !== undefined)
  const [logs, setLogs] = useState(true)
  const [email, setEmail] = useState(defaultEmail)
  const [empty, setEmpty] = useState(false)
  const form = useRef<HTMLTextAreaElement>(null)
  const ids = { what: useId(), empty: useId(), email: useId(), error: useId() }
  // Sent or saved, the form is gone: focus goes to Close, so it isn't lost.
  const closeRef = useRef<HTMLButtonElement>(null)
  const finished = done !== undefined
  useEffect(() => {
    if (finished) closeRef.current?.focus()
  }, [finished])

  if (done !== undefined)
    return (
      // The same dialog, in place: a form at the same height, so it says so where the person was looking, without opening again.
      <Dialog
        title={done.title}
        description={done.line}
        onClose={onClose}
        onSubmit={onClose}
        width={520}
        tall
        actions={
          <Button ref={closeRef} type="submit">
            {t.close}
          </Button>
        }
      />
    )

  const send = () => {
    if (sending) return
    if (what.trim() === '') {
      setEmpty(true)
      form.current?.focus()
      return
    }
    onSend({ text: what.trim(), screenshot: shot && screenshot !== undefined, logs, email: email.trim() })
  }
  // ⌘↵ (Ctrl+Enter elsewhere) sends from the box, where Enter is a new line.
  const sendOnKeys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      send()
    }
  }
  const shown = (items ?? []).filter((item) =>
    item.with === 'screenshot' ? shot && screenshot !== undefined : item.with === 'logs' ? logs : true,
  )

  return (
    <Dialog
      title={t.title}
      description={description}
      onClose={onClose}
      onSubmit={send}
      width={520}
      tall
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="submit" busy={sending} kbd={t.sendKbd}>
            {t.send}
          </Button>
        </>
      }
    >
      <div className={s.form}>
        <div className={s.what}>
          <label htmlFor={ids.what} className={s.label}>
            {t.what}
          </label>
          <FieldArea
            ref={form}
            id={ids.what}
            rows={4}
            value={what}
            placeholder={t.whatPlaceholder}
            invalid={empty}
            {...(empty ? { 'aria-describedby': ids.empty } : {})}
            onKeyDown={sendOnKeys}
            onChange={(event) => {
              setWhat(event.target.value)
              setEmpty(false)
            }}
          />
          {empty && <FieldError id={ids.empty}>{t.empty}</FieldError>}
        </div>
        {screenshot !== undefined && (
          <Option
            label={t.screenshot}
            checked={shot}
            onChange={setShot}
            aside={<div className={cx(s.shot, !shot && s.shotOff)}>{shot && <img src={screenshot} alt={t.screenshotAlt} />}</div>}
          />
        )}
        <Option label={t.logs} note={t.logsNote} checked={logs} onChange={setLogs}>
          <Disclosure defaultOpen={defaultShowing} className={s.disclosure}>
            <Sent items={items === null ? null : shown} t={t} />
          </Disclosure>
        </Option>
        <div className={s.email}>
          <label htmlFor={ids.email} className={s.label}>
            {t.email}
          </label>
          <Field id={ids.email} type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        {error !== undefined && (
          <p id={ids.error} role="alert" className={s.error}>
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
