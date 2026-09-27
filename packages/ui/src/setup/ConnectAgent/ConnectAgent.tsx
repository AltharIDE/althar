import { useEffect, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import type { Brand } from '../../foundations/brands/brands'
import { ConnectKind, unreachable } from '../../foundations/vocabulary'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { Button } from '../../primitives/Button/Button'
import { Field } from '../../primitives/Field/Field'
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
  save: string
  cancel: string
  connect: string
  acp: string
  acpNote: string
  acpField: string
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
  save: 'Save',
  cancel: 'Cancel',
  connect: 'Connect',
  acp: 'Any agent that speaks ACP',
  acpNote: 'The command that starts it. Charrette talks to it over the Agent Client Protocol.',
  acpField: 'Command',
  add: 'Add',
}

const KINDS = [ConnectKind.App, ConnectKind.Key, ConnectKind.Local] as const

export interface ConnectAgentProps {
  options: readonly ConnectOption[]
  /** Opens an app's own instructions for installing it. */
  onHelp: (id: string) => void
  /** Saves a key to the keychain. */
  onKey: (id: string, key: string) => void
  /** Connects a local server that is running. */
  onConnect: (id: string) => void
  /** Adds any ACP agent by the command that starts it. Without it, no such section. */
  onCommand?: (command: string) => void
  className?: string
  text?: Partial<ConnectAgentText>
}

/** Every other way to connect an agent: an app, an API key, a model server here, or any ACP command. */
export function ConnectAgent({ options, onHelp, onKey, onConnect, onCommand, className, text }: ConnectAgentProps) {
  const t = { ...connectAgentText, ...text }
  const [keying, setKeying] = useState<string | null>(null)
  return (
    <div className={cx(s.connect, className)}>
      <h2 className={s.title}>{t.title}</h2>
      {KINDS.map((kind) => {
        const here = options.filter((o) => o.kind === kind)
        if (!here.length) return null
        return (
          <section key={kind} className={s.section} aria-label={t.kinds[kind]}>
            <h3 className={s.label}>{t.kinds[kind]}</h3>
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
                      onSave={(key) => {
                        onKey(o.id, key)
                        setKeying(null)
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
      {onCommand && <Command t={t} onCommand={onCommand} />}
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
  onSave,
  onCancel,
}: {
  label: string
  t: ConnectAgentText
  onSave: (key: string) => void
  onCancel: () => void
}) {
  const [key, setKey] = useState('')
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => field.current?.focus(), [])
  const save = () => key.trim() && onSave(key.trim())
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
          onChange={(e) => setKey(e.target.value)}
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
        <Button disabled={!key.trim()} onClick={save}>
          {t.save}
        </Button>
      </div>
      <p className={s.note}>{t.keyNote}</p>
    </div>
  )
}

function Command({ t, onCommand }: { t: ConnectAgentText; onCommand: (command: string) => void }) {
  const [command, setCommand] = useState('')
  const add = () => {
    if (!command.trim()) return
    onCommand(command.trim())
    setCommand('')
  }
  return (
    <section className={s.section} aria-label={t.acp}>
      <h3 className={s.label}>{t.acp}</h3>
      <p className={s.note}>{t.acpNote}</p>
      <div className={s.keyRow} data-own-escape="">
        <Field
          aria-label={t.acpField}
          placeholder="my-agent --acp"
          spellCheck={false}
          className={cx(s.keyField, s.mono)}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
            if (e.key === 'Escape' && command) setCommand('')
          }}
        />
        <Button disabled={!command.trim()} onClick={add}>
          {t.add}
        </Button>
      </div>
    </section>
  )
}
