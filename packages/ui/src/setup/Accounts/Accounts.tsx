import { type FormEvent, Fragment, type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { useRefocus } from '../../lib/refocus'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Field, FieldError } from '../../primitives/Field/Field'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Menu, MenuItem, MenuSeparator } from '../../primitives/Menu/Menu'
import { Spinner } from '../../primitives/Spinner/Spinner'
import s from './Accounts.module.css'

/*
 * An agent's accounts: each one sign-in, kept by the agent in a folder of its
 * own (ADR-012), in the order work tries them. Work runs on the first that is
 * signed in and not out of usage. One quiet line each: a faint number, the
 * name, who it is when the agent says, and a word at the end: the plan that
 * pays, per use for a key, or what is off. Its menu signs it in again,
 * renames it in its line, moves it up or down, and removes it.
 *
 * Adding one, or signing one in again, happens in the list itself: the
 * consumer runs the sign-in and passes an AccountSignIn as `signIn`, which
 * takes that account's line, or a new one's where it will land.
 */

/** Where an account's sign-in is kept. */
export type AccountPlace =
  | { kind: 'usual' }
  /** A folder Althar made for it. */
  | { kind: 'own' }
  /** A folder another tool made, or the person chose: as they'd recognise it, ~/.codex-work, and what made it. */
  | { kind: 'adopted'; folder: string; from?: string }

export type AccountState =
  | { kind: 'ready'; paid?: 'plan' | 'key' }
  | { kind: 'signedOut' }
  | { kind: 'checking' }
  /** Out of usage until `back`, a time as the person reads it. */
  | { kind: 'out'; back: string }

export interface AccountEntry {
  id: string
  name: string
  place: AccountPlace
  state: AccountState
  /** Who it is signed in as, when the agent says: you@meridian.dev, or a key by its last characters. */
  who?: string
  /** The plan that pays for it, when the agent says: Claude Max. */
  plan?: string
}

/** A folder an account switcher keeps one of the agent's accounts in, not added yet. */
export interface FoundFolder {
  id: string
  /** Its name there, offered as the account's. */
  name: string
  folder: string
  from: string
}

/** A sign-in under way in the list. */
export interface AccountsSignIn {
  /** The account being signed in again, or null for a new one. */
  account: string | null
  /** Where a new one will land, as an index into the list: after the plans, before the keys. */
  at?: number
  /** The sign-in itself: an AccountSignIn. */
  node: ReactNode
}

export interface AccountsText {
  label: (agent: string) => string
  title: string
  order: string
  plan: string
  key: string
  signedOut: string
  checking: string
  out: (back: string) => string
  signIn: string
  signInAgain: string
  more: (name: string) => string
  rename: string
  up: string
  down: string
  remove: string
  /** What removing does to one in a folder Althar made, and to one another tool made. */
  removeOwn: string
  removeAdopted: string
  nameField: string
  emptyName: string
  add: string
}

export const accountsText: AccountsText = {
  label: (agent) => `${agent} accounts`,
  title: 'Accounts',
  order: 'Work starts at the top',
  plan: 'on a plan',
  key: 'per use',
  signedOut: 'Signed out',
  checking: 'Checking…',
  out: (back) => `until ${back}`,
  signIn: 'Sign in',
  signInAgain: 'Sign in again',
  more: (name) => `More for ${name}`,
  rename: 'Rename',
  up: 'Move up',
  down: 'Move down',
  remove: 'Remove',
  removeOwn: 'Signs it out and deletes its folder.',
  removeAdopted: 'Its folder stays, signed in, for the tool that made it.',
  nameField: 'Name',
  emptyName: 'Give it a name',
  add: 'Add an account',
}

export type AccountsProps = RootProps<
  'div',
  {
    /** The agent's name, for what the controls say. */
    agent: string
    accounts: readonly AccountEntry[]
    /** Signs a signed-out account in, or one again: the consumer starts the sign-in and passes it as `signIn`. */
    onSignIn?: (id: string) => void
    onRename?: (id: string, name: string) => void
    onMove?: (id: string, to: 'up' | 'down') => void
    /** Stops using it. Not offered for the usual folder's account. */
    onRemove?: (id: string) => void
    /** Starts adding one. Without it, no way to add. */
    onAdd?: () => void
    /** A sign-in under way, drawn in the list. While one is, there is no way to start another. */
    signIn?: AccountsSignIn
    text?: Partial<AccountsText>
  }
>

/** An agent's accounts, one quiet line each in the order work tries them, with a sign-in drawn in place. */
export function Accounts({
  agent,
  accounts,
  onSignIn,
  onRename,
  onMove,
  onRemove,
  onAdd,
  signIn,
  className,
  text,
  ...rest
}: AccountsProps) {
  const t = { ...accountsText, ...text }
  // A sign-in that closes, and took focus with it, gives it back to the way to add one.
  const add = useRefocus<HTMLButtonElement>(signIn !== undefined)
  const at = signIn && signIn.account === null ? Math.min(Math.max(signIn.at ?? accounts.length, 0), accounts.length) : -1
  const sheet = (key: string) => (
    <li key={key} className={s.signing}>
      {signIn?.node}
    </li>
  )
  return (
    <div className={cx(s.accounts, className)} {...rest}>
      <div className={s.top}>
        <span className={s.title}>{t.title}</span>
        {accounts.length > 1 && <span className={s.order}>{t.order}</span>}
      </div>
      <ol aria-label={t.label(agent)} className={s.list}>
        {accounts.map((account, index) => (
          <Fragment key={account.id}>
            {index === at && sheet('new')}
            {signIn?.account === account.id ? (
              sheet(account.id)
            ) : (
              <Row
                account={account}
                number={index + 1 + (at !== -1 && index >= at ? 1 : 0)}
                first={index === 0}
                last={index === accounts.length - 1}
                busy={signIn !== undefined}
                t={t}
                onSignIn={onSignIn}
                onRename={onRename}
                onMove={onMove}
                onRemove={onRemove}
              />
            )}
          </Fragment>
        ))}
        {at === accounts.length && sheet('new')}
      </ol>
      {onAdd && (
        <ActionButton ref={add} icon="plus" flush="start" disabled={signIn !== undefined} onClick={onAdd} className={s.add}>
          {t.add}
        </ActionButton>
      )}
    </div>
  )
}

interface RowProps extends Pick<AccountsProps, 'onSignIn' | 'onRename' | 'onMove' | 'onRemove'> {
  account: AccountEntry
  number: number
  first: boolean
  last: boolean
  /** A sign-in is under way elsewhere in the list: this row starts no other. */
  busy: boolean
  t: AccountsText
}

function Row({ account, number, first, last, busy, t, onSignIn, onRename, onMove, onRemove }: RowProps) {
  const [renaming, setRenaming] = useState(false)
  const { state, place } = account
  // Who it is when the agent says; a folder another tool made, by where it is.
  const who = account.who ?? (place.kind === 'adopted' ? [place.folder, place.from].filter(Boolean).join(' · ') : null)
  const end = ((): ReactNode => {
    switch (state.kind) {
      case 'ready':
        return account.plan ?? (state.paid === 'key' ? t.key : state.paid === 'plan' ? t.plan : null)
      case 'out':
        return (
          <span className={s.until}>
            <Icon name="clock" size={11} />
            {t.out(state.back)}
          </span>
        )
      case 'checking':
        return (
          <span className={s.until}>
            <Spinner size="small" />
            {t.checking}
          </span>
        )
      case 'signedOut':
        return onSignIn && !busy ? (
          <ActionButton tone="strong" size="small" flush="end" onClick={() => onSignIn(account.id)}>
            {t.signIn}
          </ActionButton>
        ) : (
          <span className={s.signedOut}>{t.signedOut}</span>
        )
      default:
        return unreachable(state)
    }
  })()
  const removable = place.kind !== 'usual' && onRemove !== undefined
  const again = onSignIn !== undefined && state.kind !== 'signedOut' && !busy
  const menu = (again || onRename || onMove || removable) && (
    <Menu
      label={t.more(account.name)}
      align="end"
      width={260}
      // Rename takes focus into the name; anything else gives it back to the button.
      returnFocus={() => !renaming}
      trigger={<IconButton icon="more" label={t.more(account.name)} size="small" className={s.more} />}
    >
      {again && (
        <MenuItem icon="external" onSelect={() => onSignIn(account.id)}>
          {t.signInAgain}
        </MenuItem>
      )}
      {onRename && (
        <MenuItem icon="pencil" onSelect={() => setRenaming(true)}>
          {t.rename}
        </MenuItem>
      )}
      {onMove && (
        <>
          <MenuItem icon="up" disabled={first} onSelect={() => onMove(account.id, 'up')}>
            {t.up}
          </MenuItem>
          <MenuItem icon="down" disabled={last} onSelect={() => onMove(account.id, 'down')}>
            {t.down}
          </MenuItem>
        </>
      )}
      {removable && (
        <>
          <MenuSeparator />
          <MenuItem
            icon="remove"
            tone="danger"
            description={place.kind === 'own' ? t.removeOwn : t.removeAdopted}
            onSelect={() => onRemove(account.id)}
          >
            {t.remove}
          </MenuItem>
        </>
      )}
    </Menu>
  )
  return (
    <li className={cx(s.row, state.kind === 'signedOut' && s.yours, state.kind === 'out' && s.resting)}>
      <span className={s.number} aria-hidden="true">
        {number}
      </span>
      {renaming && onRename ? (
        <Rename
          name={account.name}
          t={t}
          onSave={(name) => {
            onRename(account.id, name)
            setRenaming(false)
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <>
          <span className={s.name} title={account.name}>
            {account.name}
          </span>
          <span className={s.who}>{who}</span>
        </>
      )}
      <span className={s.end}>{end}</span>
      <span className={s.menu}>{menu}</span>
    </li>
  )
}

/* The name, edited in its own line: Return keeps it, Escape leaves it as it was. */
function Rename({ name, t, onSave, onCancel }: { name: string; t: AccountsText; onSave: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(name)
  const [empty, setEmpty] = useState(false)
  const errorId = useId()
  const field = useRef<HTMLInputElement>(null)
  // Renaming starts in the field, chosen from the menu, which leaves focus there.
  useEffect(() => {
    field.current?.focus()
    field.current?.select()
  }, [])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (value.trim() === '') return setEmpty(true)
    onSave(value.trim())
  }
  return (
    <form className={s.rename} onSubmit={submit}>
      <Field
        aria-label={t.nameField}
        ref={field}
        value={value}
        invalid={empty}
        data-own-escape=""
        aria-describedby={empty ? errorId : undefined}
        onChange={(event) => {
          setValue(event.target.value)
          setEmpty(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
        }}
        className={s.renameField}
      />
      {empty && <FieldError id={errorId}>{t.emptyName}</FieldError>}
    </form>
  )
}
