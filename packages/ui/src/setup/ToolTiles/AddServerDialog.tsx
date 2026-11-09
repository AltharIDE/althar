import { useId, useRef, useState } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { Field, FieldError } from '../../primitives/Field/Field'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { Segmented } from '../../primitives/Segmented/Segmented'
import type { NewServerView, ServerStarter, ToolAgentView } from './tools'
import s from './ToolTiles.module.css'

/*
 * Adding an MCP server: its name, and the address it is reached at or the
 * command that starts it; then, if it needs them, the headers it is sent
 * or the variables it runs with, whose values may be ${VARIABLE}
 * references. Each problem is said at its field, and focus goes to the
 * first. With Same servers everywhere on, every agent gets it; off, the
 * person's agents show by their marks, pressed in or out (the signed-in
 * ones pressed to begin with), and it goes into each one pressed. Opened
 * from one often added, it comes filled in. The call can fail in part, so
 * its words show under the form.
 */

export interface AddServerDialogText {
  title: string
  name: string
  namePlaceholder: string
  how: string
  address: string
  command: string
  addressLabel: string
  commandLabel: string
  addressPlaceholder: string
  commandPlaceholder: string
  headers: string
  env: string
  addHeader: string
  addVariable: string
  pairName: string
  pairValue: string
  /** The name and value fields of a row, and its removal, for a screen reader. */
  pairNameOf: (at: number) => string
  pairValueOf: (at: number) => string
  removePair: (at: number) => string
  secrets: string
  everyAgent: (agents: string) => string
  addTo: string
  writesInto: string
  add: string
  cancel: string
  needsName: string
  badName: string
  taken: (name: string) => string
  needsAddress: string
  badAddress: string
  needsCommand: string
  openQuote: string
  needsPairName: string
  badVariable: string
  badHeader: string
  twice: string
  needsAgent: string
}

export const addServerDialogText: AddServerDialogText = {
  title: 'Add an MCP server',
  name: 'Name',
  namePlaceholder: 'linear',
  how: 'How it runs',
  address: 'An address',
  command: 'A command',
  addressLabel: 'Address',
  commandLabel: 'Command',
  addressPlaceholder: 'https://mcp.example.com/mcp',
  commandPlaceholder: 'npx -y @scope/server',
  headers: 'Headers',
  env: 'Variables',
  addHeader: 'Add a header',
  addVariable: 'Add a variable',
  pairName: 'Name',
  pairValue: 'Value',
  pairNameOf: (at) => `Name ${at + 1}`,
  pairValueOf: (at) => `Value ${at + 1}`,
  removePair: (at) => `Remove row ${at + 1}`,
  secrets: 'Give a secret as ${VARIABLE}, so its value stays out of the files.',
  everyAgent: (agents) => `Every agent gets it: ${agents}.`,
  addTo: 'Add it to',
  writesInto: 'Althar writes it into each one pressed, in its own file.',
  add: 'Add',
  cancel: 'Cancel',
  needsName: 'Give it a name.',
  badName: 'Use letters, numbers, - and _.',
  taken: (name) => `There is a server named ${name} already.`,
  needsAddress: 'Give the address it is reached at.',
  badAddress: 'An address starts with https:// or http://.',
  needsCommand: 'Give the command that starts it.',
  openQuote: 'A quote isn’t closed.',
  needsPairName: 'Give it a name.',
  badVariable: 'Use letters, numbers and _, not starting with a number.',
  badHeader: 'A header’s name has no spaces or colons.',
  twice: 'This name is above already.',
  needsAgent: 'Press at least one agent.',
}

export interface AddServerDialogProps {
  /** One often added, to fill the form in. */
  start?: ServerStarter | null
  /** Same servers everywhere is on: every agent gets it, and none is picked here. */
  sync: boolean
  /** The person's agents on this computer; those signed in are pressed to begin with. */
  agents: readonly ToolAgentView[]
  /** Names already used by a server of the person's. */
  taken?: readonly string[]
  busy?: boolean
  /** What the call couldn't do, in words: it may have added the server to some agents and not others. */
  error?: string | null
  onAdd: (server: NewServerView, agents: readonly string[]) => void
  onClose: () => void
  text?: Partial<AddServerDialogText>
}

interface Pair {
  id: number
  key: string
  value: string
}

/** A command line in its words, as a shell splits it: quotes keep spaces in a word. Null where a quote isn't closed. */
export const splitCommand = (line: string): string[] | null => {
  const words: string[] = []
  let word = ''
  let quote: '"' | "'" | null = null
  let started = false
  for (const char of line.trim()) {
    if (quote !== null) {
      if (char === quote) quote = null
      else word += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) words.push(word)
      word = ''
      started = false
    } else {
      word += char
      started = true
    }
  }
  if (quote !== null) return null
  if (started) words.push(word)
  return words
}

const NAME = /^[A-Za-z0-9_-]+$/
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/
const HEADER = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

const isAddress = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** Adding an MCP server: a name, an address or a command, its headers or variables, and which agents get it. */
export function AddServerDialog({
  start = null,
  sync,
  agents,
  taken = [],
  busy = false,
  error = null,
  onAdd,
  onClose,
  text,
}: AddServerDialogProps) {
  const t = { ...addServerDialogText, ...text }
  const id = useId()
  const [name, setName] = useState(start?.name ?? '')
  const [way, setWay] = useState<'address' | 'command'>(start?.way ?? 'address')
  const [address, setAddress] = useState(start?.way === 'address' ? start.runs : '')
  const [command, setCommand] = useState(start?.way === 'command' ? start.runs : '')
  const [pairs, setPairs] = useState<Pair[]>([])
  const next = useRef(0)
  const [picked, setPicked] = useState<readonly string[]>(() => agents.filter((agent) => agent.signedIn === true).map((agent) => agent.id))
  const [tried, setTried] = useState(false)

  const problems: Record<string, string> = {}
  const trimmed = name.trim()
  if (trimmed === '') problems.name = t.needsName
  else if (!NAME.test(trimmed)) problems.name = t.badName
  else if (taken.includes(trimmed)) problems.name = t.taken(trimmed)
  if (way === 'address') {
    if (address.trim() === '') problems.runs = t.needsAddress
    else if (!isAddress(address.trim())) problems.runs = t.badAddress
  } else if (command.trim() === '') problems.runs = t.needsCommand
  else if (splitCommand(command) === null) problems.runs = t.openQuote
  const seen = new Set<string>()
  pairs.forEach((pair) => {
    const key = pair.key.trim()
    if (key === '' && pair.value.trim() === '') return
    if (key === '') problems[`pair-${pair.id}`] = t.needsPairName
    else if (way === 'command' && !VARIABLE.test(key)) problems[`pair-${pair.id}`] = t.badVariable
    else if (way === 'address' && !HEADER.test(key)) problems[`pair-${pair.id}`] = t.badHeader
    else if (seen.has(key.toLowerCase())) problems[`pair-${pair.id}`] = t.twice
    seen.add(key.toLowerCase())
  })
  if (!sync && picked.length === 0) problems.agents = t.needsAgent
  const shown = tried ? problems : {}

  const submit = () => {
    setTried(true)
    const first = Object.keys(problems)[0]
    if (first !== undefined) {
      // The first problem's field takes focus, so it is in view and its words are read.
      document.getElementById(`${id}-${first}`)?.focus()
      return
    }
    const given = pairs.filter((pair) => pair.key.trim() !== '')
    const values = Object.fromEntries(given.map((pair) => [pair.key.trim(), pair.value]))
    const words = splitCommand(command) ?? []
    const server: NewServerView =
      way === 'address'
        ? { name: trimmed, url: address.trim(), ...(given.length === 0 ? {} : { headers: values }) }
        : { name: trimmed, command: words[0] ?? '', args: words.slice(1), ...(given.length === 0 ? {} : { env: values }) }
    onAdd(server, sync ? agents.map((agent) => agent.id) : picked)
  }

  const field = (key: string) => ({
    id: `${id}-${key}`,
    invalid: shown[key] !== undefined,
    ...(shown[key] === undefined ? {} : { 'aria-describedby': `${id}-${key}-error` }),
  })
  const problem = (key: string) => shown[key] !== undefined && <FieldError id={`${id}-${key}-error`}>{shown[key]}</FieldError>

  return (
    <Dialog
      title={t.title}
      width={560}
      tall
      holding={busy}
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button variant="signal" type="submit" busy={busy}>
            {t.add}
          </Button>
        </>
      }
    >
      <div className={s.form}>
        <div className={s.formRow}>
          <label className={s.formLabel} htmlFor={`${id}-name`}>
            {t.name}
          </label>
          <Field
            {...field('name')}
            value={name}
            placeholder={t.namePlaceholder}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setName(event.target.value)}
          />
          {problem('name')}
        </div>
        <div className={s.formRow}>
          <div className={s.formBar}>
            <label className={s.formLabel} htmlFor={`${id}-runs`}>
              {way === 'address' ? t.addressLabel : t.commandLabel}
            </label>
            <Segmented<'address' | 'command'>
              label={t.how}
              value={way}
              onChange={setWay}
              options={[
                { value: 'address', label: t.address },
                { value: 'command', label: t.command },
              ]}
            />
          </div>
          <Field
            {...field('runs')}
            className={s.mono}
            autoComplete="off"
            spellCheck={false}
            value={way === 'address' ? address : command}
            placeholder={way === 'address' ? t.addressPlaceholder : t.commandPlaceholder}
            onChange={(event) => (way === 'address' ? setAddress(event.target.value) : setCommand(event.target.value))}
          />
          {problem('runs')}
        </div>
        <fieldset className={s.pairs}>
          <legend className={s.formLabel}>{way === 'address' ? t.headers : t.env}</legend>
          {pairs.map((pair, at) => (
            <div key={pair.id} className={s.pairRow}>
              <div className={s.pair}>
                <Field
                  {...field(`pair-${pair.id}`)}
                  aria-label={t.pairNameOf(at)}
                  className={s.mono}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={way === 'address' ? 'Authorization' : 'API_KEY'}
                  value={pair.key}
                  onChange={(event) =>
                    setPairs((now) => now.map((one) => (one.id === pair.id ? { ...one, key: event.target.value } : one)))
                  }
                />
                <Field
                  aria-label={t.pairValueOf(at)}
                  className={s.mono}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={way === 'address' ? 'Bearer ${TOKEN}' : '${API_KEY}'}
                  value={pair.value}
                  onChange={(event) =>
                    setPairs((now) => now.map((one) => (one.id === pair.id ? { ...one, value: event.target.value } : one)))
                  }
                />
                <IconButton
                  icon="close"
                  size="small"
                  label={t.removePair(at)}
                  onClick={() => setPairs((now) => now.filter((one) => one.id !== pair.id))}
                />
              </div>
              {problem(`pair-${pair.id}`)}
            </div>
          ))}
          <span className={s.pairFoot}>
            <LinkButton
              onClick={() => {
                next.current += 1
                setPairs((now) => [...now, { id: next.current, key: '', value: '' }])
              }}
            >
              {way === 'address' ? t.addHeader : t.addVariable}
            </LinkButton>
            {pairs.length > 0 && <span className={s.quiet}>{t.secrets}</span>}
          </span>
        </fieldset>
        {sync ? (
          <p className={s.quiet}>{t.everyAgent(and(agents.map((agent) => agent.name)))}</p>
        ) : (
          <div className={s.formRow}>
            <span className={s.formLabel} id={`${id}-agents-label`}>
              {t.addTo}
            </span>
            <div
              className={s.picks}
              role="group"
              aria-labelledby={`${id}-agents-label`}
              {...(shown.agents === undefined ? {} : { 'aria-describedby': `${id}-agents-error` })}
            >
              {agents.map((agent, at) => {
                const on = picked.includes(agent.id)
                return (
                  <button
                    key={agent.id}
                    id={at === 0 ? `${id}-agents` : undefined}
                    type="button"
                    aria-pressed={on}
                    className={cx(s.pick, !on && s.pickOut)}
                    onClick={() => setPicked((now) => (on ? now.filter((one) => one !== agent.id) : [...now, agent.id]))}
                  >
                    <span className={s.pickMark} aria-hidden="true">
                      {agent.brand === undefined ? <Icon name="plug" size={13} /> : <BrandMark brand={agent.brand} size={13} />}
                    </span>
                    <span className={s.truncate}>{agent.name}</span>
                  </button>
                )
              })}
            </div>
            {problem('agents')}
            <span className={s.quiet}>{t.writesInto}</span>
          </div>
        )}
        {error !== null && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}

const and = (names: readonly string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)
