import { type FormEvent, useEffect, useId, useRef, useState } from 'react'

import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import { Choices } from '../../primitives/Choices/Choices'
import { Field, FieldError } from '../../primitives/Field/Field'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { Menu, MenuItem, MenuSeparator } from '../../primitives/Menu/Menu'
import { Popover } from '../../primitives/Popover/Popover'
import { Spinner } from '../../primitives/Spinner/Spinner'
import s from './Accounts.module.css'

/*
 * An agent's accounts: each one sign-in, kept by the agent in a folder of
 * its own (ADR-012). The agent's usual folder is the first; the person adds
 * more, in a folder Charrette makes and opens the agent's sign-in in, or one
 * an account switcher already made. Work runs on the first account, in this
 * order, that is signed in and not out of usage, and moves to the next when
 * one runs out. Each row says where the account stands and offers what would
 * change it; its menu renames, reorders and removes it.
 */

/** Where an account's sign-in is kept. */
export type AccountPlace =
  | { kind: 'usual' }
  /** A folder Charrette made for it. */
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
}

/** A folder an account switcher keeps one of the agent's accounts in, not added yet. */
export interface FoundFolder {
  id: string
  /** Its name there, offered as the account's. */
  name: string
  folder: string
  from: string
}

/** Where a new account's sign-in goes: a folder of its own, one found, or one the person chooses. */
export type AddWhere = { kind: 'own' } | { kind: 'found'; id: string } | { kind: 'choose' }

export interface AccountsText {
  label: (agent: string) => string
  usual: string
  own: string
  from: (from: string) => string
  ready: string
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
  removeNote: string
  save: string
  cancel: string
  nameField: string
  emptyName: string
  add: string
  addTitle: (agent: string) => string
  where: string
  ownNote: (agent: string) => string
  foundNote: (from: string) => string
  choose: string
  chooseNote: string
  addButton: string
}

export const accountsText: AccountsText = {
  label: (agent) => `${agent} accounts`,
  usual: 'Its usual folder',
  own: 'A folder of its own',
  from: (from) => `from ${from}`,
  ready: 'Signed in',
  plan: 'on a plan',
  key: 'on a key, paid per use',
  signedOut: 'Signed out',
  checking: 'Checking who it is signed in as',
  out: (back) => `Out of usage until ${back}`,
  signIn: 'Sign in',
  signInAgain: 'Sign in again',
  more: (name) => `More for ${name}`,
  rename: 'Rename',
  up: 'Move up',
  down: 'Move down',
  remove: 'Remove',
  removeNote: 'Its folder stays, signed in, for the agent’s own tool.',
  save: 'Save',
  cancel: 'Cancel',
  nameField: 'Name',
  emptyName: 'Give it a name',
  add: 'Add an account',
  addTitle: (agent) => `Add a ${agent} account`,
  where: 'Where it signs in',
  ownNote: (agent) => `Charrette makes the folder, with your settings, and opens ${agent}’s own sign-in there.`,
  foundNote: (from) => `Already signed in, made by ${from}.`,
  choose: 'Another folder…',
  chooseNote: 'One the agent already signed in with.',
  addButton: 'Add',
}

export interface AccountsProps {
  /** The agent's name, for what the controls say. */
  agent: string
  accounts: readonly AccountEntry[]
  /** Folders account switchers keep this agent's accounts in, offered when adding one. */
  found?: readonly FoundFolder[]
  onSignIn?: (id: string) => void
  onRename?: (id: string, name: string) => void
  onMove?: (id: string, to: 'up' | 'down') => void
  /** Stops using it. Not offered for the usual folder's account. */
  onRemove?: (id: string) => void
  /** Adds one. Without it, no way to add. */
  onAdd?: (input: { readonly name: string; readonly where: AddWhere }) => void | Promise<void>
  /** The add form opened: a moment to look for found folders. */
  onAdding?: () => void
  className?: string
  text?: Partial<AccountsText>
}

/** An agent's accounts, each with where it stands, and a way to add another. */
export function Accounts({
  agent,
  accounts,
  found = [],
  onSignIn,
  onRename,
  onMove,
  onRemove,
  onAdd,
  onAdding,
  className,
  text,
}: AccountsProps) {
  const t = { ...accountsText, ...text }
  const [adding, setAdding] = useState(false)
  // The usual sign-in alone is what the agent's own row already says: only the way to add another shows.
  const listed = accounts.length > 1 || accounts.some((account) => account.place.kind !== 'usual')
  return (
    <div className={cx(s.accounts, className)}>
      {listed && (
        <ul aria-label={t.label(agent)} className={s.list}>
          {accounts.map((account, index) => (
            <Row
              key={account.id}
              account={account}
              first={index === 0}
              last={index === accounts.length - 1}
              t={t}
              onSignIn={onSignIn}
              onRename={onRename}
              onMove={onMove}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
      {onAdd && (
        <Popover
          label={t.addTitle(agent)}
          width={380}
          open={adding}
          onOpenChange={(open) => {
            setAdding(open)
            if (open) onAdding?.()
          }}
          trigger={
            <ActionButton icon="plus" className={s.add}>
              {t.add}
            </ActionButton>
          }
        >
          <AddForm
            agent={agent}
            found={found}
            t={t}
            onAdd={async (input) => {
              await onAdd(input)
              setAdding(false)
            }}
            onCancel={() => setAdding(false)}
          />
        </Popover>
      )}
    </div>
  )
}

interface RowProps extends Pick<AccountsProps, 'onSignIn' | 'onRename' | 'onMove' | 'onRemove'> {
  account: AccountEntry
  first: boolean
  last: boolean
  t: AccountsText
}

function Row({ account, first, last, t, onSignIn, onRename, onMove, onRemove }: RowProps) {
  const [renaming, setRenaming] = useState(false)
  const { state, place } = account
  const where =
    place.kind === 'usual'
      ? t.usual
      : place.kind === 'own'
        ? t.own
        : [place.folder, place.from && t.from(place.from)].filter(Boolean).join(' · ')
  const line = ((): React.ReactNode => {
    switch (state.kind) {
      case 'ready':
        return [t.ready, state.paid && t[state.paid]].filter(Boolean).join(' · ')
      case 'signedOut':
        return t.signedOut
      case 'checking':
        return (
          <>
            <Spinner size="small" />
            {t.checking}
          </>
        )
      case 'out':
        return t.out(state.back)
    }
  })()
  const removable = place.kind !== 'usual' && onRemove !== undefined
  const menu = (onRename || onMove || removable || (onSignIn && state.kind !== 'signedOut')) && (
    <Menu
      label={t.more(account.name)}
      align="end"
      width={260}
      trigger={<IconButton icon="more" label={t.more(account.name)} size="small" />}
    >
      {onSignIn && state.kind !== 'signedOut' && (
        <MenuItem icon="terminal" onSelect={() => onSignIn(account.id)}>
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
          <MenuItem icon="remove" tone="danger" description={t.removeNote} onSelect={() => onRemove(account.id)}>
            {t.remove}
          </MenuItem>
        </>
      )}
    </Menu>
  )
  return (
    <li className={s.row}>
      <span className={s.body}>
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
          <span className={s.name}>{account.name}</span>
        )}
        <span className={cx(s.line, state.kind === 'signedOut' && s.attention)}>{line}</span>
        <span className={s.place}>{where}</span>
      </span>
      <span className={s.actions}>
        {state.kind === 'signedOut' && onSignIn && (
          <Button size="small" onClick={() => onSignIn(account.id)}>
            {t.signIn}
          </Button>
        )}
        {menu}
      </span>
    </li>
  )
}

function Rename({ name, t, onSave, onCancel }: { name: string; t: AccountsText; onSave: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(name)
  const [empty, setEmpty] = useState(false)
  const errorId = useId()
  const field = useRef<HTMLInputElement>(null)
  // Renaming starts in the field, chosen from the menu.
  useEffect(() => field.current?.select(), [])
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
        aria-describedby={empty ? errorId : undefined}
        onChange={(event) => {
          setValue(event.target.value)
          setEmpty(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
        }}
      />
      <Button size="small" type="submit">
        {t.save}
      </Button>
      <Button size="small" variant="quiet" type="button" onClick={onCancel}>
        {t.cancel}
      </Button>
      {empty && <FieldError id={errorId}>{t.emptyName}</FieldError>}
    </form>
  )
}

interface AddFormProps {
  agent: string
  found: readonly FoundFolder[]
  t: AccountsText
  onAdd: (input: { readonly name: string; readonly where: AddWhere }) => Promise<void>
  onCancel: () => void
}

function AddForm({ agent, found, t, onAdd, onCancel }: AddFormProps) {
  const [name, setName] = useState('')
  const [where, setWhere] = useState<string>('own')
  const [empty, setEmpty] = useState(false)
  const [busy, setBusy] = useState(false)
  const nameId = useId()
  const errorId = useId()
  const options = [
    { value: 'own', title: t.own, note: t.ownNote(agent) },
    ...found.map((place) => ({ value: `found:${place.id}`, title: place.folder, note: t.foundNote(place.from) })),
    { value: 'choose', title: t.choose, note: t.chooseNote },
  ]
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (name.trim() === '') return setEmpty(true)
    const chosen: AddWhere = where.startsWith('found:')
      ? { kind: 'found', id: where.slice('found:'.length) }
      : where === 'choose'
        ? { kind: 'choose' }
        : { kind: 'own' }
    setBusy(true)
    try {
      await onAdd({ name: name.trim(), where: chosen })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className={s.form} onSubmit={(event) => void submit(event)}>
      <p className={s.title}>{t.addTitle(agent)}</p>
      <span className={s.field}>
        <label className={s.label} htmlFor={nameId}>
          {t.nameField}
        </label>
        <Field
          id={nameId}
          value={name}
          placeholder="work"
          invalid={empty}
          aria-describedby={empty ? errorId : undefined}
          onChange={(event) => {
            setName(event.target.value)
            setEmpty(false)
          }}
        />
        {empty && <FieldError id={errorId}>{t.emptyName}</FieldError>}
      </span>
      <Choices
        label={t.where}
        options={options}
        value={where}
        onChange={(value) => {
          setWhere(value)
          const place = found.find((each) => `found:${each.id}` === value)
          if (place !== undefined && name.trim() === '') setName(place.name)
        }}
      />
      <span className={s.buttons}>
        <Button variant="quiet" type="button" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button type="submit" busy={busy}>
          {t.addButton}
        </Button>
      </span>
    </form>
  )
}
