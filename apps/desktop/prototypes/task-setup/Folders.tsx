// Scrappy: each direction's view of a repository's recorded setup, from the kit's own parts, in project settings' Running.
import { type ReactNode, useId, useState } from 'react'

import {
  Button,
  Code,
  Field,
  Icon,
  IconButton,
  LinkButton,
  SettingGroup,
  SettingList,
  SettingRow,
  Spinner,
  Switch,
  Terminal,
} from '@althar/ui'

import s from './proto.module.css'
import { changed, proto, type Repo, type Step, useProto, without } from './state'

const text = {
  title: 'Before each task starts',
  addStep: 'Add a step',
  edit: (name: string) => `Change ${name}`,
  remove: (name: string) => `Remove ${name}`,
  name: 'Name',
  command: 'Command',
  files: 'Files from your checkout',
  save: 'Save',
  cancel: 'Cancel',
  none: (repo: string) => `The next task’s lead works out what ${repo} needs and records it here.`,
  nothing: 'Needs nothing set up.',
  again: 'Work it out again',
  skipped: 'Off',
  lastIn: (title: string, at: string) => `Last run for ${title}, ${at}`,
  say: 'Say what to change',
  undo: 'Undo',
  unclear: 'Couldn’t tell which step that changes.',
}

const isCopy = (step: Step) => step.copy !== undefined

/** What a step does, as code: its command, or the files it copies. */
function What({ step }: { step: Step }) {
  if (step.copy !== undefined)
    return (
      <span className={s.chips}>
        {step.copy.map((path) => (
          <Code key={path}>{path}</Code>
        ))}
      </span>
    )
  return <Code className={s.command}>{step.command}</Code>
}

/** A step opened to change, in place: its name, and its command or files. */
function StepEditor({ repo, step, onDone }: { repo: Repo; step: Step; onDone: () => void }) {
  const nameId = useId()
  const whatId = useId()
  const [name, setName] = useState(step.name)
  const [what, setWhat] = useState(step.copy?.join(', ') ?? step.command ?? '')
  return (
    <form
      className={s.editor}
      onSubmit={(event) => {
        event.preventDefault()
        const copy = what
          .split(',')
          .map((one) => one.trim())
          .filter((one) => one !== '')
        if (what.trim() === '') return
        proto.steps(
          repo.id,
          changed(step.id, isCopy(step) ? { name, copy } : { name: name.trim() === '' ? what.trim() : name.trim(), command: what.trim() }),
        )
        if (!isFresh(step)) onDone()
      }}
    >
      <label className={s.field} htmlFor={nameId}>
        <span className={s.key}>{text.name}</span>
        <Field id={nameId} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className={s.field} htmlFor={whatId}>
        <span className={s.key}>{isCopy(step) ? text.files : text.command}</span>
        <Field
          id={whatId}
          className={s.mono}
          autoFocus
          value={what}
          onChange={(event) => setWhat(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onDone()
          }}
        />
      </label>
      <div className={s.actions}>
        <Button size="small" variant="quiet" onClick={onDone}>
          {text.cancel}
        </Button>
        <Button size="small" variant="signal" type="submit">
          {text.save}
        </Button>
      </div>
    </form>
  )
}

/** A repository's name over its steps, where the project has more than one. */
function RepoHead({ repo, many, action }: { repo: Repo; many: boolean; action?: ReactNode }) {
  if (!many && action === undefined) return null
  return (
    <div className={s.repoHead}>
      {many && <span className={s.name}>{repo.name}</span>}
      <span className={s.grow} />
      {action}
    </div>
  )
}

/** Not recorded yet, or recorded as needing nothing. */
function Empty({ repo }: { repo: Repo }) {
  return (
    <div className={s.empty}>
      <Icon name={repo.steps === null ? 'clock' : 'check'} size={15} className={s.glyph} />
      <span>{repo.steps === null ? text.none(repo.name) : text.nothing}</span>
    </div>
  )
}

/* ——— A · Steps: a row each, named, like what it runs; change and remove on hover, in place. ——— */

/** A new step, opened to fill in. */
const addTo = (repo: Repo) => proto.steps(repo.id, (all) => [...all, { id: proto.id(), name: '', command: '', on: true }])
const isFresh = (step: Step) => step.name === '' && step.command === ''

function AddStep({ repo }: { repo: Repo }) {
  if (repo.steps === null) return null
  return (
    <Button size="small" icon="plus" onClick={() => addTo(repo)}>
      {text.addStep}
    </Button>
  )
}

function StepRows({ repo, many }: { repo: Repo; many: boolean }) {
  const [opened, setOpen] = useState<string | null>(null)
  const steps = repo.steps ?? []
  const fresh = steps.find(isFresh)
  const open = fresh?.id ?? opened
  const close = () => {
    if (fresh !== undefined) proto.steps(repo.id, without(fresh.id))
    setOpen(null)
  }
  return (
    <div className={s.repo}>
      <RepoHead repo={repo} many={many} {...(many ? { action: <AddStep repo={repo} /> } : {})} />
      {steps.length === 0 ? (
        <Empty repo={repo} />
      ) : (
        <SettingList>
          {steps.map((step) => (
            <SettingRow
              key={step.id}
              className={s.row}
              title={isFresh(step) ? text.addStep : step.name}
              note={open === step.id ? undefined : <What step={step} />}
              mark={<Icon name={isCopy(step) ? 'copy' : 'terminal'} size={15} className={s.glyph} />}
              {...(open === step.id ? { under: <StepEditor repo={repo} step={step} onDone={close} /> } : {})}
            >
              {() =>
                open === step.id ? null : (
                  <span className={s.hover}>
                    <IconButton icon="pencil" size="small" label={text.edit(step.name)} onClick={() => setOpen(step.id)} />
                    <IconButton
                      icon="close"
                      size="small"
                      label={text.remove(step.name)}
                      onClick={() => proto.steps(repo.id, without(step.id))}
                    />
                  </span>
                )
              }
            </SettingRow>
          ))}
        </SettingList>
      )}
    </div>
  )
}

/* ——— B · Switches: each step on or off; its command changed by clicking it; a file taken out by its cross. ——— */

function InlineCommand({ repo, step }: { repo: Repo; step: Step }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(step.command ?? '')
  if (!editing)
    return (
      <button type="button" className={s.inline} onClick={() => setEditing(true)} title={text.edit(step.name)}>
        <Code className={s.command}>{step.command}</Code>
        <Icon name="pencil" size={12} className={s.inlinePen} />
      </button>
    )
  const done = (save: boolean) => {
    if (save) proto.steps(repo.id, changed(step.id, { command: value.trim() }))
    else setValue(step.command ?? '')
    setEditing(false)
  }
  return (
    <Field
      className={s.mono}
      autoFocus
      value={value}
      aria-label={text.edit(step.name)}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => done(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') done(true)
        if (event.key === 'Escape') done(false)
      }}
    />
  )
}

function Files({ repo, step }: { repo: Repo; step: Step }) {
  return (
    <span className={s.chips}>
      {(step.copy ?? []).map((path) => (
        <span key={path} className={s.file}>
          <Code>{path}</Code>
          <IconButton
            icon="close"
            size="small"
            label={`Don’t copy ${path}`}
            onClick={() =>
              proto.steps(repo.id, (all) =>
                all
                  .map((one) => (one.id === step.id ? { ...one, copy: (one.copy ?? []).filter((p) => p !== path) } : one))
                  .filter((one) => one.copy === undefined || one.copy.length > 0),
              )
            }
          />
        </span>
      ))}
    </span>
  )
}

function Again({ repo }: { repo: Repo }) {
  if (repo.steps === null) return null
  return <LinkButton onClick={() => proto.restore(repo.id, null)}>{text.again}</LinkButton>
}

function SwitchRows({ repo, many }: { repo: Repo; many: boolean }) {
  const steps = repo.steps ?? []
  return (
    <div className={s.repo}>
      <RepoHead repo={repo} many={many} {...(many ? { action: <Again repo={repo} /> } : {})} />
      {steps.length === 0 ? (
        <Empty repo={repo} />
      ) : (
        <SettingList>
          {steps.map((step) => (
            <SettingRow
              key={step.id}
              className={step.on ? undefined : s.off}
              title={step.name}
              note={isCopy(step) ? <Files repo={repo} step={step} /> : <InlineCommand repo={repo} step={step} />}
            >
              {(ids) => <Switch checked={step.on} onChange={(on) => proto.steps(repo.id, changed(step.id, { on }))} {...ids} />}
            </SettingRow>
          ))}
        </SettingList>
      )}
    </div>
  )
}

/* ——— C · As it last ran: each step with how it went, the failed one open on what it printed. ——— */

const seconds = (n: number) => (n < 1 ? '<1 s' : n < 60 ? `${Math.round(n)} s` : `${Math.floor(n / 60)} min ${Math.round(n % 60)} s`)

const printed = (step: Step): string[] =>
  step.last?.tail !== undefined
    ? [...step.last.tail]
    : isCopy(step)
      ? (step.copy ?? []).map((path) => `copied ${path}`)
      : ['Resolving dependencies', 'Saved lockfile', `done in ${seconds(step.last?.seconds ?? 0)}`]

function LastIn({ repo }: { repo: Repo }) {
  if (repo.lastIn === undefined || (repo.steps ?? []).length === 0) return null
  return <span className={s.quiet}>{text.lastIn(repo.lastIn.title, repo.lastIn.at)}</span>
}

function RunRows({ repo, many }: { repo: Repo; many: boolean }) {
  const failed = repo.steps?.find((one) => one.last !== undefined && !one.last.ok)
  const [open, setOpen] = useState<string | null>(failed?.id ?? null)
  const [editing, setEditing] = useState<string | null>(null)
  const steps = repo.steps ?? []
  return (
    <div className={s.repo}>
      <RepoHead repo={repo} many={many} {...(many ? { action: <LastIn repo={repo} /> } : {})} />
      {steps.length === 0 ? (
        <Empty repo={repo} />
      ) : (
        <ol className={s.run}>
          {steps.map((step) => {
            const bad = step.last !== undefined && !step.last.ok
            const shown = open === step.id
            if (editing === step.id)
              return (
                <li key={step.id} className={s.runEdit}>
                  <StepEditor repo={repo} step={step} onDone={() => setEditing(null)} />
                </li>
              )
            return (
              <li key={step.id} className={s.runItem}>
                <div className={s.runRow}>
                  <button type="button" className={s.runMain} aria-expanded={shown} onClick={() => setOpen(shown ? null : step.id)}>
                    <span className={bad ? s.bad : step.on ? s.ok : s.quiet}>
                      <Icon name={!step.on ? 'stop' : bad ? 'close' : 'check'} size={14} />
                    </span>
                    <span className={bad ? s.runNameBad : step.on ? s.runName : s.runNameOff}>{step.name}</span>
                    <What step={step} />
                  </button>
                  <span className={s.hover}>
                    <IconButton icon="pencil" size="small" label={text.edit(step.name)} onClick={() => setEditing(step.id)} />
                  </span>
                  <span className={s.time}>{!step.on ? text.skipped : step.last === undefined ? '' : seconds(step.last.seconds)}</span>
                </div>
                {shown && step.on && (
                  <div className={s.output}>
                    <Terminal lines={printed(step)} {...(step.last?.code === undefined ? {} : { exit: step.last.code })} />
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

/* ——— D · Say it: the steps to read, and one line to say what to change. ——— */

/** What saying it does, standing in for the agent that would change the setup. */
const heard = (said: string, repos: ReadonlyArray<Repo>): { repo: Repo; before: ReadonlyArray<Step>; line: string } | null => {
  const words = said.toLowerCase()
  const keys: ReadonlyArray<[RegExp, RegExp]> = [
    [/playwright|browser/, /playwright/i],
    [/electron/, /electron/i],
    [/prisma|database|client/, /database/i],
    [/\.env|secret|config|settings|copy/, /^copy/i],
    [/depend|install/, /dependencies/i],
  ]
  const off = /don.?t|skip|stop|no |remove|without|turn off/.test(words)
  const run = /^(also )?(run|add) (.+)$/i.exec(said.trim())
  if (run !== null) {
    const repo = repos.find((one) => words.includes(one.name)) ?? repos[0]
    if (repo === undefined) return null
    const before = repo.steps ?? []
    const command = run[3]!.replace(/^`|`$/g, '')
    proto.steps(repo.id, (all) => [...all, { id: proto.id(), name: `Run ${command.split(' ')[0]}`, command, on: true }])
    return { repo, before, line: `Added ${command} to ${repo.name}’s setup.` }
  }
  for (const [said_, name] of keys) {
    if (!said_.test(words)) continue
    for (const repo of repos) {
      const step = repo.steps?.find((one) => name.test(one.name))
      if (step === undefined) continue
      const before = repo.steps ?? []
      proto.steps(repo.id, changed(step.id, { on: !off }))
      return { repo, before, line: off ? `Stopped “${step.name}” in ${repo.name}.` : `“${step.name}” runs again in ${repo.name}.` }
    }
  }
  return null
}

function SaidRows({ repos }: { repos: ReadonlyArray<Repo> }) {
  const many = repos.length > 1
  return (
    <div className={s.said}>
      {repos.map((repo) => (
        <div key={repo.id} className={s.repo}>
          <RepoHead repo={repo} many={many} />
          {(repo.steps ?? []).length === 0 ? (
            <Empty repo={repo} />
          ) : (
            <ol className={s.readList}>
              {(repo.steps ?? []).map((step) => (
                <li key={step.id} className={step.on ? s.readItem : s.readItemOff}>
                  <span className={s.readName}>{step.name}</span>
                  <What step={step} />
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
    </div>
  )
}

function SayIt({ repos }: { repos: ReadonlyArray<Repo> }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ repo: Repo; before: ReadonlyArray<Step>; line: string } | 'unclear' | null>(null)
  const failing = repos.some((repo) => repo.steps?.some((one) => one.last !== undefined && !one.last.ok))
  const suggestion = repos.every((repo) => repo.steps === null)
    ? ''
    : failing
      ? 'Skip generating the database client'
      : 'Don’t install Playwright’s browsers'
  return (
    <div className={s.say}>
      <form
        className={s.sayForm}
        onSubmit={(event) => {
          event.preventDefault()
          if (value.trim() === '') return
          setBusy(true)
          setDone(null)
          window.setTimeout(() => {
            setBusy(false)
            setDone(heard(value, proto.get().repos) ?? 'unclear')
            setValue('')
          }, 900)
        }}
      >
        <Field
          className={s.sayField}
          value={value}
          placeholder={suggestion === '' ? text.say : suggestion}
          aria-label={text.say}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Tab' && value === '' && suggestion !== '') {
              event.preventDefault()
              setValue(suggestion)
            }
          }}
        />
        {busy && <Spinner size="small" />}
      </form>
      {done === 'unclear' ? (
        <p className={s.sayLine}>{text.unclear}</p>
      ) : done !== null ? (
        <p className={s.sayLine}>
          {done.line}{' '}
          <LinkButton
            onClick={() => {
              proto.restore(done.repo.id, done.before)
              setDone(null)
            }}
          >
            {text.undo}
          </LinkButton>
        </p>
      ) : null}
    </div>
  )
}

/** The direction's view, where the settings page puts it: in Running, after what the project runs. */
export function ProtoFolders() {
  const p = useProto()
  const many = p.repos.length > 1
  const single = p.repos.length === 1 ? p.repos[0] : undefined
  if (p.direction === 'D')
    return (
      <SettingGroup title={text.title} headingLevel={3}>
        <SaidRows repos={p.repos} />
        {p.repos.some((repo) => repo.steps !== null) && <SayIt repos={p.repos} />}
      </SettingGroup>
    )
  const Each = p.direction === 'A' ? StepRows : p.direction === 'B' ? SwitchRows : RunRows
  const head =
    single === undefined
      ? {}
      : p.direction === 'A'
        ? { action: <AddStep repo={single} /> }
        : p.direction === 'B'
          ? { action: <Again repo={single} /> }
          : { note: <LastIn repo={single} /> }
  return (
    <SettingGroup title={text.title} headingLevel={3} {...head}>
      <div className={s.repos} data-single={single !== undefined || undefined}>
        {p.repos.map((repo) => (
          <Each key={`${p.direction}:${p.which}:${p.moment}:${repo.id}`} repo={repo} many={many} />
        ))}
      </div>
    </SettingGroup>
  )
}
