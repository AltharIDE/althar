import { useId, useState } from 'react'

import { Button } from '../../primitives/Button/Button'
import { Dialog } from '../../primitives/Dialog/Dialog'
import { Field, FieldArea, FieldError } from '../../primitives/Field/Field'
import { Problem } from '../../primitives/Problem/Problem'
import s from './AgentCatalog.module.css'

export interface AcpConnectionDraft {
  readonly id: string
  readonly name: string
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly env?: Readonly<Record<string, string>>
  readonly mode: string | null
  readonly readerMode: string | null
  readonly modeOption: string
  readonly modelOption: string
  readonly effortOption: string | null
  readonly held: Readonly<Record<string, string>>
  readonly registryId: string | null
  readonly registryVersion: string | null
}

export interface CatalogAgent {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly problem?: string | undefined
  readonly version: string | null
  readonly guide: string | null
  readonly command: string | null
  readonly args: ReadonlyArray<string>
  readonly env?: Readonly<Record<string, string>>
  readonly modeOption?: string
  readonly mode: string | null
  readonly readerMode: string | null
}

export interface SavedAcpConnection {
  readonly connection: AcpConnectionDraft
  readonly state: 'unchecked' | 'checking' | 'ready' | 'failed'
  readonly reason: string | null
  readonly version: string | null
}

export interface AgentCatalogProps {
  active?: boolean
  items: ReadonlyArray<CatalogAgent>
  connections: ReadonlyArray<SavedAcpConnection>
  refreshing?: boolean
  problem?: string | null
  error?: string | null
  saving?: boolean
  onRefresh: () => void
  onSave: (connection: AcpConnectionDraft, saved?: () => void) => void
  onCheck: (id: string) => void
  onRemove: (id: string) => void
  onGuide: (url: string) => void
}

const status = {
  unchecked: 'Not checked',
  checking: 'Checking compatibility…',
  ready: 'Available for work',
  failed: 'Compatibility check failed',
}

/** Registry discovery and saved commands. The host owns execution and compatibility results. */
export function AgentCatalog({
  active = true,
  items,
  connections,
  refreshing = false,
  problem,
  error,
  saving = false,
  onRefresh,
  onSave,
  onCheck,
  onRemove,
  onGuide,
}: AgentCatalogProps) {
  const [browse, setBrowse] = useState(false)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<AcpConnectionDraft | null>(null)
  const add = (item?: CatalogAgent) => {
    setBrowse(false)
    setDraft({
      id: `acp-${crypto.randomUUID()}`,
      name: item?.name ?? '',
      command: item?.command ?? '',
      args: item?.args ?? [],
      env: item?.env ?? {},
      mode: item === undefined ? 'default' : item.mode,
      readerMode: item === undefined ? 'default' : item.readerMode,
      modeOption: item?.modeOption ?? 'mode',
      modelOption: 'model',
      effortOption: null,
      held: {},
      registryId: item?.id ?? null,
      registryVersion: item?.version ?? null,
    })
  }
  return (
    <section className={s.catalog} aria-label="More agents">
      <div className={s.head}>
        <h2>More agents</h2>
        <div className={s.actions}>
          <Button
            size="small"
            onClick={() => {
              setBrowse(true)
              onRefresh()
            }}
          >
            Browse agents
          </Button>
          <Button size="small" variant="quiet" onClick={() => add()}>
            Add command
          </Button>
        </div>
      </div>
      {error != null && <Problem>{error}</Problem>}
      {connections.length === 0 && <p className={s.note}>Connect another coding agent from the ACP registry or use its own command.</p>}
      <ul className={s.list} aria-label="Added agent connections">
        {connections.map((saved) => (
          <li key={saved.connection.id} className={s.row}>
            <div className={s.words}>
              <strong>{saved.connection.name}</strong>
              <span role={saved.state === 'checking' ? 'status' : undefined}>
                {status[saved.state]}
                {saved.version === null ? '' : ` · ${saved.version}`}
              </span>
              {saved.reason !== null && <Problem size="small">{saved.reason}</Problem>}
            </div>
            <div className={s.actions}>
              {saved.state !== 'checking' && (
                <>
                  <Button size="small" onClick={() => onCheck(saved.connection.id)}>
                    Check compatibility
                  </Button>
                  <Button size="small" variant="quiet" onClick={() => setDraft(saved.connection)}>
                    Edit
                  </Button>
                </>
              )}
              <Button size="small" variant="danger" onClick={() => onRemove(saved.connection.id)}>
                {saved.state === 'checking' ? 'Cancel and remove' : 'Remove'}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {connections.length > 0 && (
        <p className={s.note}>
          Compatibility checks send short prompts using the agent’s account. Sign in with the agent’s own tools first.
        </p>
      )}
      {browse && active && (
        <Dialog
          title="Connect an agent"
          width={620}
          tall
          onClose={() => setBrowse(false)}
          actions={
            <>
              <Button variant="quiet" onClick={() => add()}>
                Use a custom command
              </Button>
              <Button busy={refreshing} onClick={onRefresh}>
                Refresh registry
              </Button>
            </>
          }
        >
          <Field aria-label="Search agents" placeholder="Search agents" value={query} onChange={(event) => setQuery(event.target.value)} />
          {refreshing && (
            <p className={s.note} role="status">
              Refreshing the agent registry…
            </p>
          )}
          {problem != null && <Problem size="small">{problem}</Problem>}
          <ul className={s.results} aria-label="Agent catalog">
            {items
              .filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase()))
              .map((item) => (
                <li key={item.id} className={s.row}>
                  <div className={s.words}>
                    <strong>{item.name}</strong>
                    <span>{item.description}</span>
                    {item.version !== null && <span>{item.version}</span>}
                    {item.command === null && <span>{item.problem ?? 'No distribution for this device'}</span>}
                  </div>
                  <div className={s.actions}>
                    {item.guide !== null && (
                      <Button variant="quiet" size="small" onClick={() => onGuide(item.guide!)}>
                        Setup
                      </Button>
                    )}
                    <Button size="small" disabled={item.command === null} onClick={() => add(item)}>
                      Connect {item.name}
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
          {items.every((item) => !`${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase())) && (
            <p className={s.note}>No agents match this search. Use a custom command to connect another.</p>
          )}
        </Dialog>
      )}
      {draft !== null && (
        <ConnectionForm
          active={active}
          key={draft.id}
          initial={draft}
          saving={saving}
          error={error}
          onClose={() => setDraft(null)}
          onSave={(connection) => onSave(connection, () => setDraft(null))}
        />
      )}
    </section>
  )
}

function ConnectionForm({
  active,
  initial,
  saving,
  error,
  onClose,
  onSave,
}: {
  active: boolean
  initial: AcpConnectionDraft
  saving: boolean
  error: string | null | undefined
  onClose: () => void
  onSave: (draft: AcpConnectionDraft) => void
}) {
  const id = useId()
  const [draft, setDraft] = useState(initial)
  const [args, setArgs] = useState(JSON.stringify(initial.args))
  const [held, setHeld] = useState(JSON.stringify(initial.held))
  const [environment, setEnvironment] = useState(JSON.stringify(initial.env ?? {}))
  const [invalid, setInvalid] = useState<{ field: string; message: string } | null>(null)
  const field = (name: string) => `${id}-${name}`
  const submit = () => {
    const fail = (name: string, message: string) => {
      setInvalid({ field: name, message })
      const element = document.getElementById(field(name))
      const details = element?.closest('details')
      if (details !== null && details !== undefined) details.open = true
      element?.focus()
    }
    if (draft.name.trim() === '') {
      fail('name', 'Give this connection a name.')
      return
    }
    if (draft.command.trim() === '') {
      fail('command', 'Enter the agent’s executable or its full path.')
      return
    }
    let argv: unknown
    let holds: unknown
    try {
      argv = JSON.parse(args) as unknown
    } catch {
      fail('args', 'Use a JSON array of arguments, such as ["acp"].')
      return
    }
    if (!Array.isArray(argv) || !argv.every((arg) => typeof arg === 'string')) {
      fail('args', 'Each argument must be a string in a JSON array.')
      return
    }
    try {
      holds = JSON.parse(held) as unknown
    } catch {
      fail('held', 'Use a JSON object of options and their values.')
      return
    }
    if (
      holds === null ||
      typeof holds !== 'object' ||
      Array.isArray(holds) ||
      !Object.values(holds).every((value) => typeof value === 'string')
    ) {
      fail('held', 'Each held option needs a string value.')
      return
    }
    setInvalid(null)
    let env: unknown
    try {
      env = JSON.parse(environment) as unknown
    } catch {
      fail('env', 'Use a JSON object of environment variables and values.')
      return
    }
    if (
      env === null ||
      typeof env !== 'object' ||
      Array.isArray(env) ||
      !Object.entries(env).every(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string')
    ) {
      fail('env', 'Each environment variable needs a valid name and a string value.')
      return
    }
    onSave({
      ...draft,
      name: draft.name.trim(),
      command: draft.command.trim(),
      args: argv as string[],
      env: env as Record<string, string>,
      held: holds as Record<string, string>,
    })
  }
  const input = (key: 'name' | 'command' | 'mode' | 'readerMode' | 'modeOption' | 'modelOption' | 'effortOption', label: string) => (
    <label className={s.field} htmlFor={field(key)}>
      {label}
      <Field
        id={field(key)}
        value={draft[key] ?? ''}
        invalid={invalid?.field === key}
        aria-describedby={invalid?.field === key ? field('error') : undefined}
        onChange={(event) =>
          setDraft({
            ...draft,
            [key]: event.target.value === '' && ['mode', 'readerMode', 'effortOption'].includes(key) ? null : event.target.value,
          })
        }
      />
    </label>
  )
  if (!active) return null
  return (
    <Dialog
      title={initial.name === '' ? 'Add an agent command' : `Connect ${initial.name}`}
      description="Save the command, then check its compatibility before using it for work."
      width={560}
      tall
      onClose={onClose}
      onSubmit={submit}
      actions={
        <>
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" busy={saving}>
            Save connection
          </Button>
        </>
      }
    >
      {input('name', 'Name')}
      {input('command', 'Executable')}
      <label className={s.field} htmlFor={field('args')}>
        Arguments
        <FieldArea
          id={field('args')}
          className={s.code}
          rows={2}
          value={args}
          invalid={invalid?.field === 'args'}
          aria-describedby={invalid?.field === 'args' ? field('error') : undefined}
          onChange={(event) => setArgs(event.target.value)}
        />
      </label>
      <div className={s.pair}>
        {input('mode', 'Mode that asks before commands')}
        {input('readerMode', 'Mode for reading')}
      </div>
      <p className={s.note}>Use the agent’s mode identifiers. Leave a mode empty only if the agent exposes no modes.</p>
      <details>
        <summary>Session options</summary>
        <div className={s.options}>
          <label className={s.field} htmlFor={field('env')}>
            Environment variables
            <FieldArea
              id={field('env')}
              className={s.code}
              rows={2}
              value={environment}
              invalid={invalid?.field === 'env'}
              aria-describedby={invalid?.field === 'env' ? field('error') : undefined}
              onChange={(event) => setEnvironment(event.target.value)}
            />
          </label>
          {input('modeOption', 'Mode option')}
          {input('modelOption', 'Model option')}
          {input('effortOption', 'Effort option')}
          <label className={s.field} htmlFor={field('held')}>
            Options to keep fixed
            <FieldArea
              id={field('held')}
              className={s.code}
              rows={2}
              value={held}
              invalid={invalid?.field === 'held'}
              aria-describedby={invalid?.field === 'held' ? field('error') : undefined}
              onChange={(event) => setHeld(event.target.value)}
            />
          </label>
        </div>
      </details>
      {invalid !== null && <FieldError id={field('error')}>{invalid.message}</FieldError>}
      {error != null && <Problem>{error}</Problem>}
    </Dialog>
  )
}
