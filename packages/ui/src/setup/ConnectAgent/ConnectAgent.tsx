import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import type { Brand } from '../../foundations/brands/brands'
import { ConnectKind, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import { Field, FieldError } from '../../primitives/Field/Field'
import { below, Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import s from './ConnectAgent.module.css'

/*
 * What "Connect another" opens: every other way Charrette can reach an
 * agent, grouped by how it signs in. An app it can run but didn't find, an
 * API that takes a key, a model server on this machine, or any command that
 * speaks ACP. A key is typed once and goes to the system keychain; the
 * field says so, and never shows the key again.
 */

export interface ConnectOption {
  id: string
  name: string
  brand?: Brand
  kind: ConnectKind
  /** Where it stands here, as a few words: Not installed, Running · 3 models. */
  state?: string
  /** A local server that is running and can be connected now. */
  ready?: boolean
}

export interface ConnectAgentText {
  title: string
  kinds: Record<ConnectKind, string>
  install: string
  addKey: string
  keyField: (name: string) => string
  keyNote: string
  /** Said when Save is pressed with no key. */
  emptyKey: string
  save: string
  cancel: string
  connect: string
  acp: string
  acpNote: string
  acpField: string
  /** An example command, in the empty field. */
  acpPlaceholder: string
  /** Said when Add is pressed with no command. */
  emptyCommand: string
  add: string
}

export const connectAgentText: ConnectAgentText = {
  title: 'Connect another agent',
  kinds: {
    [ConnectKind.App]: 'Signed in through its own app',
    [ConnectKind.Key]: 'With an API key',
    [ConnectKind.Local]: 'Models on this Mac',
  },
  install: 'How to install',
  addKey: 'Add a key',
  keyField: (name) => `${name} API key`,
  keyNote: 'Kept in your Keychain. Usage is billed to the key’s account.',
  emptyKey: 'Paste the key first',
  save: 'Save',
  cancel: 'Cancel',
  connect: 'Connect',
  acp: 'Any agent that speaks ACP',
  acpNote: 'The command that starts it. Charrette talks to it over the Agent Client Protocol.',
  acpField: 'Command',
  acpPlaceholder: 'my-agent --acp',
  emptyCommand: 'Type the command that starts it',
  add: 'Add',
}

const KINDS = [ConnectKind.App, ConnectKind.Key, ConnectKind.Local] as const

export interface ConnectAgentProps {
  options: readonly ConnectOption[]
  /** Opens an app's own instructions for installing it. */
  onHelp: (id: string) => void
  /** Saves a key to the keychain. */
  onKey: (id: string, key: string) => void
  /**
   * The option whose key is being saved. While it is, its form stays open
   * and Save shows it; when it clears without a keyError, the form closes.
   * Without it, the form closes as soon as the key is handed over.
   */
  savingKey?: string | null
  /** Why a key was not taken, for that option: shown under its field. */
  keyError?: { id: string; message: ReactNode } | null
  /** Connects a local server that is running. */
  onConnect: (id: string) => void
  /** Adds any ACP agent by the command that starts it. Without it, no such section. */
  onCommand?: (command: string) => void
  /** The title's rank in the page's outline; the groups go below it. */
  headingLevel?: HeadingLevel
  className?: string
  text?: Partial<ConnectAgentText>
}

/** Every other way to connect an agent: an app, an API key, a model server here, or any ACP command. */
export function ConnectAgent({
  options,
  onHelp,
  onKey,
  savingKey,
  keyError,
  onConnect,
  onCommand,
  headingLevel = 2,
  className,
  text,
}: ConnectAgentProps) {
  const t = { ...connectAgentText, ...text }
  const [keying, setKeying] = useState<string | null>(null)
  /* a save the consumer tracks: the form waits for it to finish, and closes if nothing went wrong */
  const saving = useRef(savingKey ?? null)
  useEffect(() => {
    const was = saving.current
    saving.current = savingKey ?? null
    if (was !== null && was === keying && savingKey !== was && keyError?.id !== was) setKeying(null)
  }, [savingKey, keyError, keying])
  const group = below(headingLevel)
  return (
    <div className={cx(s.connect, className)}>
      <Heading level={headingLevel} className={s.title}>
        {t.title}
      </Heading>
      {KINDS.map((kind) => {
        const here = options.filter((o) => o.kind === kind)
        if (!here.length) return null
        return (
          <section key={kind} className={s.section} aria-label={t.kinds[kind]}>
            <Heading level={group} className={s.label}>
              {t.kinds[kind]}
            </Heading>
            <ul className={s.list}>
              {here.map((o) => (
                <li key={o.id} className={s.row}>
                  <span className={s.mark}>{o.brand ? <BrandMark brand={o.brand} size={16} /> : <Icon name="plug" size={14} />}</span>
                  <span className={s.name}>{o.name}</span>
                  {o.state && <span className={s.state}>{o.state}</span>}
                  <span className={s.action}>{action(o)}</span>
                  {keying === o.id && (
                    <KeyForm
                      label={t.keyField(o.name)}
                      t={t}
                      saving={savingKey === o.id}
                      error={keyError?.id === o.id ? keyError.message : undefined}
                      onSave={(key) => {
                        onKey(o.id, key)
                        if (savingKey === undefined) setKeying(null)
                      }}
                      onCancel={() => setKeying(null)}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      {onCommand && <Command t={t} level={group} onCommand={onCommand} />}
    </div>
  )

  function action(o: ConnectOption) {
    switch (o.kind) {
      case ConnectKind.App:
        return (
          <ActionButton icon="external" onClick={() => onHelp(o.id)}>
            {t.install}
          </ActionButton>
        )
      case ConnectKind.Key:
        return keying === o.id ? null : <ActionButton onClick={() => setKeying(o.id)}>{t.addKey}</ActionButton>
      case ConnectKind.Local:
        return o.ready ? <ActionButton onClick={() => onConnect(o.id)}>{t.connect}</ActionButton> : null
      default:
        return unreachable(o.kind)
    }
  }
}

/* One field for one secret. Escape leaves the field, not the panel. */
function KeyForm({
  label,
  t,
  saving,
  error,
  onSave,
  onCancel,
}: {
  label: string
  t: ConnectAgentText
  saving: boolean
  error?: ReactNode
  onSave: (key: string) => void
  onCancel: () => void
}) {
  const [key, setKey] = useState('')
  const [empty, setEmpty] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const errorId = useId()
  useEffect(() => field.current?.focus(), [])
  const save = () => {
    if (saving) return
    if (!key.trim()) {
      setEmpty(true)
      field.current?.focus()
      return
    }
    onSave(key.trim())
  }
  const said = empty ? t.emptyKey : error
  return (
    <div className={s.key} data-own-escape="">
      <div className={s.keyRow}>
        <Field
          ref={field}
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label={label}
          className={s.keyField}
          value={key}
          invalid={Boolean(said)}
          aria-describedby={said ? errorId : undefined}
          onChange={(e) => {
            setKey(e.target.value)
            setEmpty(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            }
            if (e.key === 'Escape') onCancel()
          }}
        />
        <Button variant="quiet" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button busy={saving} onClick={save}>
          {t.save}
        </Button>
      </div>
      {said ? <FieldError id={errorId}>{said}</FieldError> : <p className={s.note}>{t.keyNote}</p>}
    </div>
  )
}

function Command({ t, level, onCommand }: { t: ConnectAgentText; level: HeadingLevel; onCommand: (command: string) => void }) {
  const [command, setCommand] = useState('')
  const [empty, setEmpty] = useState(false)
  const errorId = useId()
  const add = () => {
    if (!command.trim()) {
      setEmpty(true)
      return
    }
    onCommand(command.trim())
    setCommand('')
  }
  return (
    <section className={s.section} aria-label={t.acp}>
      <Heading level={level} className={s.label}>
        {t.acp}
      </Heading>
      <p className={s.note}>{t.acpNote}</p>
      <div className={s.keyRow} data-own-escape="">
        <Field
          aria-label={t.acpField}
          placeholder={t.acpPlaceholder}
          invalid={empty}
          aria-describedby={empty ? errorId : undefined}
          spellCheck={false}
          className={cx(s.keyField, s.mono)}
          value={command}
          onChange={(e) => {
            setCommand(e.target.value)
            setEmpty(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
            if (e.key === 'Escape' && command) setCommand('')
          }}
        />
        <Button onClick={add}>{t.add}</Button>
      </div>
      {empty && <FieldError id={errorId}>{t.emptyCommand}</FieldError>}
    </section>
  )
}
