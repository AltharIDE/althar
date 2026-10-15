// Scrappy: what the directions share: words for a runnable and its run, and adding, editing and managing them.
import { type ReactNode, useEffect, useId, useState } from 'react'

import { Icon } from '../../src/foundations/Icon/Icon'
import { Button } from '../../src/primitives/Button/Button'
import { CheckList } from '../../src/primitives/CheckList/CheckList'
import { Dialog } from '../../src/primitives/Dialog/Dialog'
import { Field } from '../../src/primitives/Field/Field'
import { FormRow } from '../../src/primitives/FormRow/FormRow'
import { IconButton } from '../../src/primitives/IconButton/IconButton'
import { LinkButton } from '../../src/primitives/LinkButton/LinkButton'
import { LiveDot } from '../../src/primitives/LiveDot/LiveDot'
import { Segmented } from '../../src/primitives/Segmented/Segmented'
import { Spinner } from '../../src/primitives/Spinner/Spinner'
import { Switch } from '../../src/primitives/Switch/Switch'
import { addressOf } from '../../../../apps/desktop/src/renderer/shared/running'
import { ago, running, useNow } from '../../../../apps/desktop/src/renderer/shared/time'
import s from './parts.module.css'
import { nameOf, SCRIPTS, type Script } from './scripts'
import {
  FOUND,
  type Goes,
  type Opening,
  placeOf,
  proto,
  type Run,
  type Runnable,
  type Screen,
  type Source,
  useProto,
  useScreen,
} from './state'

export { s as css }

/* ——— Words ——— */

export const label = (runnable: Runnable) => runnable.name ?? runnable.command

export const isLive = (run: Run | null): run is Run & { readonly state: 'starting' | 'running' } =>
  run !== null && (run.state === 'starting' || run.state === 'running')

/** Where it runs from this screen, in a word: main, or this task. */
export const whereOf = (runnable: Runnable, screen: Screen) => (placeOf(runnable, screen.place) === 'main' ? 'main' : 'this task')

export const sourceText: Record<Source, string> = {
  repository: 'From package.json',
  person: 'Added by you',
  coordinator: 'Added by the coordinator',
}

const iso = (ms: number) => new Date(ms).toISOString()

/** How its run stands, in a few words: Starting, localhost:5290 · up 12m, Failed 8m ago · exit 1. Null where it hasn't run. */
export const stateOf = (runnable: Runnable, run: Run | null, now: string): string | null => {
  if (run === null) return null
  const ended = run.endedAt === null ? '' : ago(iso(run.endedAt), new Date(now))
  switch (run.state) {
    case 'starting':
      return 'Starting…'
    case 'running':
      if (run.url !== null) return `${addressOf(run.url)} · up ${running(iso(run.startedAt), now)}`
      return runnable.goes.kind === 'window'
        ? `Its window is open · up ${running(iso(run.startedAt), now)}`
        : `Running · ${running(iso(run.startedAt), now)}`
    case 'ended':
      return `Finished ${ended} · exit 0`
    case 'failed':
      return `Failed ${ended} · exit ${run.code ?? '?'}`
    case 'stopped':
      return `Stopped ${ended}`
  }
}

/** The state's words, red where it failed, cobalt where it answers. */
export function StateWords({ runnable, run, now }: { runnable: Runnable; run: Run | null; now: string }) {
  const words = stateOf(runnable, run, now)
  if (words === null) return null
  return <span className={run?.state === 'failed' ? s.bad : run?.state === 'running' ? s.live : undefined}>{words}</span>
}

/** Its run at a glance: live, starting, failed, finished, or ready to run. */
export function RunGlyph({ run }: { run: Run | null }) {
  if (run?.state === 'running') return <LiveDot />
  if (run?.state === 'starting') return <Spinner size="small" />
  if (run?.state === 'failed') return <Icon name="close" size={12} className={s.bad} />
  if (run?.state === 'ended') return <Icon name="check" size={12} />
  return <Icon name="play" size={12} />
}

/* ——— What a screen sees of them ——— */

export function useRuns() {
  const p = useProto()
  const screen = useScreen()
  const now = useNow(p.runs.some((one) => one.state === 'starting' || one.state === 'running'))
  const here = (runnable: Runnable) => placeOf(runnable, screen.place)
  const runOf = (runnable: Runnable): Run | null =>
    p.runs.find((one) => one.runnableId === runnable.id && one.place === here(runnable)) ?? null
  const fallback = p.runnables.find((one) => one.id === p.defaultId) ?? p.runnables[0] ?? null
  return {
    ...p,
    screen,
    now,
    here,
    runOf,
    /** Its run in the other place, while it runs there: main's, seen from a task. */
    elsewhere: (runnable: Runnable): Run | null =>
      p.runs.find((one) => one.runnableId === runnable.id && one.place !== here(runnable) && isLive(one)) ?? null,
    /** The runs in tasks, seen from the project. */
    inTasks: screen.place === 'main' ? p.runs.filter((one) => one.place === 'task' && isLive(one)) : [],
    /** The one a single press runs. */
    def: fallback,
    live: p.runnables.filter((one) => isLive(runOf(one))),
    start: (runnable: Runnable) => proto.run(runnable.id, here(runnable)),
    /** Runs it where it runs from here, or stops it there. */
    toggle: (runnable: Runnable) => {
      const run = runOf(runnable)
      if (isLive(run)) proto.stop(run.id)
      else proto.run(runnable.id, here(runnable))
    },
    open: (run: Run | null) => {
      if (run?.url != null) window.open(run.url, '_blank')
    },
  }
}

/** What a run printed, as its terminal shows it: the end of it, and how it ended. */
export const outputOf = (runnable: Runnable, run: Run | null): { lines: string[]; live?: string; exit?: number; failure?: string } => {
  const command = runnable.command
  if (run === null) return { lines: [] }
  const setup = '$ test -d node_modules || bun install --frozen-lockfile'
  const port = run.url === null ? null : addressOf(run.url)
  const tail = (() => {
    switch (runnable.id) {
      case 'pitch':
        return [
          '@althar/pitch dev: VITE+ v1.0.0-rc.0  ready in 412 ms',
          `@althar/pitch dev:   ➜  Local:   http://${port ?? 'localhost:5290'}/`,
        ]
      case 'storybook':
      case 'found-storybook':
        return [
          '@althar/ui storybook: Storybook 10.6.0 for react-vite started',
          '@althar/ui storybook: 1.2 s for manager and 3.8 s for preview',
          `@althar/ui storybook:   Local:            http://${port ?? 'localhost:6006'}/`,
        ]
      case 'desktop':
      case 'found-desktop':
        return [
          '@althar/desktop dev: vp build --config vite.node.config.ts',
          '@althar/desktop dev: ✓ 214 modules transformed. built in 1.84s',
          '@althar/desktop dev: electron .',
          '@althar/desktop dev: [main] Althar 0.2.0, runtime listening',
        ]
      case 'site':
        return [
          '@althar/site dev: VITE+ v1.0.0-rc.0  ready in 388 ms',
          `@althar/site dev:   ➜  Local:   http://${port ?? 'localhost:5320'}/`,
        ]
      case 'unit':
        return run.state === 'failed'
          ? [
              '@althar/ui test:  ✓ src/primitives/Menu/Menu.test.tsx (12 tests) 141ms',
              '@althar/ui test:  ✗ src/chrome/ProjectFront/ProjectFront.test.tsx > runs its default branch',
              '@althar/ui test:  Test Files  1 failed | 147 passed (148)',
              '@althar/ui test:       Tests  1 failed | 1203 passed (1204)',
            ]
          : [
              '@althar/ui test:  ✓ src/primitives/Menu/Menu.test.tsx (12 tests) 141ms',
              '@althar/ui test:  ✓ src/chrome/TaskMenu/TaskMenu.test.tsx (21 tests) 233ms',
              '@althar/ui test:  Test Files  148 passed (148)',
              '@althar/ui test:       Tests  1204 passed (1204)',
            ]
      case 'e2e':
        return [
          '@althar/desktop test:e2e: Running 38 tests using 3 workers',
          '@althar/desktop test:e2e:   ✓  e2e/board.spec.ts:12:3 › a planned task starts on its countdown (6.1s)',
          '@althar/desktop test:e2e:   ✗  e2e/evidence.spec.ts:41:3 › evidence opens in the side panel (30.0s)',
          '@althar/desktop test:e2e:   1 failed, 37 passed (2.4m)',
        ]
      default:
        return [`${runnable.command}`, '✓ done']
    }
  })()
  const lines = [setup, `$ ${command}`, ...tail]
  switch (run.state) {
    case 'starting':
      return { lines: [setup], live: '' }
    case 'running':
      return { lines, live: '' }
    case 'ended':
      return { lines, exit: 0 }
    case 'failed':
      return { lines, exit: run.code ?? 1, failure: `It exited ${run.code ?? 1}.` }
    case 'stopped':
      return { lines: [...lines, '^C'], failure: 'Stopped.' }
  }
}

/* ——— Adding one ——— */

export type AddWay = 'type' | 'scripts' | 'ask'

const goesOf = (script: Script): Goes => {
  if (/storybook/.test(script.name)) return { kind: 'serves', port: 6006 }
  if (script.name === 'dev' && script.pkg === '@althar/desktop') return { kind: 'window' }
  if (script.name === 'dev' || script.name === 'site') return { kind: 'serves', port: script.name === 'site' ? 5320 : 5290 }
  if (script.name === 'preview') return { kind: 'serves', port: 4290 }
  return { kind: 'finishes' }
}

const wayOf = (opening: Opening): AddWay => (opening === 'scripts' ? 'scripts' : opening === 'ask' || opening === 'asked' ? 'ask' : 'type')

/**
 * Adding something to run, three ways: typing its command, picking from the
 * repository's package.json scripts, or asking the coordinator to work it
 * out. It brings its own buttons, so it sits in a dialog or a panel alike.
 */
export function AddForm({ way: first, onDone, compact = false }: { way: AddWay; onDone: () => void; compact?: boolean }) {
  const p = useProto()
  const ids = useId()
  const [way, setWay] = useState<AddWay>(first)
  const opening = p.opening
  const [command, setCommand] = useState(opening === 'add' ? 'bun --filter @althar/pitch preview' : '')
  const [name, setName] = useState(opening === 'add' ? 'Pitch site, as built' : '')
  const [where, setWhere] = useState<'here' | 'main'>('here')
  const kept = new Set(p.runnables.map((one) => one.command))
  const [picked, setPicked] = useState<readonly string[]>(opening === 'scripts' ? ['althar:check', '@althar/pitch:preview'] : [])
  const [find, setFind] = useState('')
  const [asked, setAsked] = useState(opening === 'asked' || opening === 'ask')
  useEffect(() => {
    if (opening === 'ask') proto.ask()
  }, [opening])
  const fresh = FOUND.filter((one) => !kept.has(one.command))
  const [taking, setTaking] = useState<readonly string[]>(fresh.map((one) => one.id))
  const scripts = SCRIPTS.filter((one) => !kept.has(one.command)).filter(
    (one) => find === '' || `${one.command} ${one.body}`.toLowerCase().includes(find.toLowerCase()),
  )
  const add = () => {
    if (way === 'type' && command.trim() !== '')
      proto.add({
        ...(name.trim() === '' ? {} : { name: name.trim() }),
        command: command.trim(),
        where,
        source: 'person',
        goes: { kind: 'finishes' },
      })
    if (way === 'scripts')
      for (const id of picked) {
        const script = SCRIPTS.find((one) => one.id === id)
        if (script !== undefined)
          proto.add({
            name: nameOf(script),
            command: script.command,
            where: 'here',
            source: 'person',
            script: `${script.pkg} · ${script.name}`,
            goes: goesOf(script),
          })
      }
    if (way === 'ask') for (const one of FOUND.filter((found) => taking.includes(found.id))) proto.add(one, one.id)
    onDone()
  }
  const count = way === 'scripts' ? picked.length : way === 'ask' ? taking.length : 1
  const ready = way === 'type' ? command.trim() !== '' : way === 'scripts' ? picked.length > 0 : asked && !p.asking && taking.length > 0
  return (
    <form
      className={s.stack}
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) add()
      }}
    >
      <Segmented<AddWay>
        label="How to add it"
        value={way}
        onChange={setWay}
        options={[
          { value: 'type', label: 'Type a command' },
          { value: 'scripts', label: compact ? 'package.json' : 'From package.json' },
          { value: 'ask', label: compact ? 'Ask' : 'Ask the coordinator' },
        ]}
      />
      {way === 'type' && (
        <>
          <FormRow label="Command" htmlFor={`${ids}-command`} note="Run from the repository’s root, after it installs what it needs.">
            <Field
              id={`${ids}-command`}
              style={{ width: '100%' }}
              value={command}
              placeholder="bun run dev"
              onChange={(event) => setCommand(event.target.value)}
            />
          </FormRow>
          <FormRow label="Name" htmlFor={`${ids}-name`} note="Optional. Without one, the command names it.">
            <Field
              id={`${ids}-name`}
              style={{ width: '100%' }}
              value={name}
              placeholder="Pitch site"
              onChange={(event) => setName(event.target.value)}
            />
          </FormRow>
          <FormRow label="Where it runs">
            <Segmented<'here' | 'main'>
              value={where}
              onChange={setWhere}
              options={[
                { value: 'here', label: 'Where you are' },
                { value: 'main', label: 'Always on main' },
              ]}
            />
          </FormRow>
        </>
      )}
      {way === 'scripts' && (
        <>
          <Field
            aria-label="Find a script"
            placeholder={`Find among ${SCRIPTS.length} scripts in this repository`}
            value={find}
            onChange={(event) => setFind(event.target.value)}
          />
          <div className={s.scroll}>
            <CheckList
              label="Scripts in package.json"
              items={scripts.map((one) => ({ id: one.id, label: `${one.command}  ·  ${one.body}` }))}
              value={picked}
              onChange={setPicked}
            />
          </div>
        </>
      )}
      {way === 'ask' &&
        (!asked ? (
          <>
            <p className={s.meta} style={{ whiteSpace: 'normal' }}>
              The coordinator reads package.json, the READMEs and DEVELOPMENT.md, and says what it would keep. Nothing is kept until you add
              it.
            </p>
            <div className={s.row}>
              <Button
                icon="agents"
                onClick={() => {
                  setAsked(true)
                  proto.ask()
                }}
              >
                Ask the coordinator
              </Button>
            </div>
          </>
        ) : p.asking ? (
          <div className={s.row}>
            <Spinner size="small" />
            <span className={s.meta}>The coordinator is reading package.json and DEVELOPMENT.md…</span>
          </div>
        ) : fresh.length === 0 ? (
          <p className={s.meta}>The coordinator found nothing that isn’t kept already.</p>
        ) : (
          <>
            <p className={s.meta} style={{ whiteSpace: 'normal' }}>
              It found {fresh.length === 1 ? 'one thing' : `${fresh.length} things`} the repository runs that{' '}
              {fresh.length === 1 ? 'isn’t' : 'aren’t'} kept yet. Add the ones you want.
            </p>
            <CheckList
              label="What the coordinator found"
              items={fresh.map((one) => ({ id: one.id, label: `${label(one)}  ·  ${one.command}` }))}
              value={taking}
              onChange={setTaking}
            />
          </>
        ))}
      <div className={s.row}>
        <span className={s.grow} />
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="ink" disabled={!ready}>
          {count > 1 ? `Add ${count}` : 'Add'}
        </Button>
      </div>
    </form>
  )
}

export function AddDialog({ way, onClose }: { way: AddWay; onClose: () => void }) {
  return (
    <Dialog title="Add something to run" description="It joins althar’s list, for every task in it too." onClose={onClose} width={640}>
      <AddForm way={way} onDone={onClose} />
    </Dialog>
  )
}

/* ——— Editing one ——— */

export function EditForm({ id, onDone }: { id: string; onDone: () => void }) {
  const p = useProto()
  const ids = useId()
  const runnable = p.runnables.find((one) => one.id === id)
  const [name, setName] = useState(runnable?.name ?? '')
  const [command, setCommand] = useState(runnable?.command ?? '')
  const [where, setWhere] = useState<'here' | 'main'>(runnable?.where ?? 'here')
  const [isDefault, setDefault] = useState(p.defaultId === id)
  if (runnable === undefined) return null
  return (
    <form
      className={s.stack}
      onSubmit={(event) => {
        event.preventDefault()
        proto.edit(id, { name: name.trim() === '' ? undefined : name.trim(), command, where })
        if (isDefault) proto.makeDefault(id)
        onDone()
      }}
    >
      <FormRow label="Name" htmlFor={`${ids}-name`}>
        <Field
          id={`${ids}-name`}
          style={{ width: '100%' }}
          value={name}
          placeholder={runnable.command}
          onChange={(event) => setName(event.target.value)}
        />
      </FormRow>
      <FormRow
        label="Command"
        htmlFor={`${ids}-command`}
        note={
          runnable.source === 'repository' ? 'Worked out from package.json. Changing it keeps it as yours.' : sourceText[runnable.source]
        }
      >
        <Field id={`${ids}-command`} style={{ width: '100%' }} value={command} onChange={(event) => setCommand(event.target.value)} />
      </FormRow>
      <FormRow label="Where it runs" note="Where you are: on a task, in its worktree; on the project, on main.">
        <Segmented<'here' | 'main'>
          value={where}
          onChange={setWhere}
          options={[
            { value: 'here', label: 'Where you are' },
            { value: 'main', label: 'Always on main' },
          ]}
        />
      </FormRow>
      <FormRow label="Run it by default" note="The one a single press of Run runs.">
        <Switch checked={isDefault} onChange={setDefault} disabled={p.defaultId === id} />
      </FormRow>
      <div className={s.row}>
        <Button
          type="button"
          variant="danger"
          icon="close"
          onClick={() => {
            proto.remove(id)
            onDone()
          }}
        >
          Remove
        </Button>
        <span className={s.grow} />
        <Button type="button" variant="quiet" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="ink">
          Save
        </Button>
      </div>
    </form>
  )
}

export function EditDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const p = useProto()
  const runnable = p.runnables.find((one) => one.id === id)
  return (
    <Dialog title={`Edit ${runnable === undefined ? '' : label(runnable)}`} onClose={onClose} width={640}>
      <EditForm id={id} onDone={onClose} />
    </Dialog>
  )
}

/* ——— The whole list: reordering, choosing the default, editing and removing ——— */

export function ManageList({ onEdit, onAdd }: { onEdit: (id: string) => void; onAdd?: () => void }) {
  const r = useRuns()
  return (
    <div className={s.stack}>
      <ol className={s.list}>
        {r.runnables.map((runnable, at) => {
          const name = label(runnable)
          const isDefault = r.defaultId === runnable.id
          return (
            <li key={runnable.id} className={s.item}>
              <span className={s.words}>
                <span className={s.name}>{name}</span>
                {runnable.name !== undefined && <span className={s.mono}>{runnable.command}</span>}
                <span className={s.meta}>
                  {runnable.where === 'main' ? 'Always on main' : 'Where you are'} · {sourceText[runnable.source]}
                </span>
              </span>
              {isDefault ? (
                <span className={s.meta}>Default</span>
              ) : (
                <LinkButton reveal onClick={() => proto.makeDefault(runnable.id)}>
                  Make default
                </LinkButton>
              )}
              <IconButton
                icon="up"
                size="small"
                label={`Move ${name} up`}
                disabled={at === 0}
                onClick={() => proto.move(runnable.id, -1)}
              />
              <IconButton
                icon="down"
                size="small"
                label={`Move ${name} down`}
                disabled={at === r.runnables.length - 1}
                onClick={() => proto.move(runnable.id, 1)}
              />
              <IconButton icon="pencil" size="small" label={`Edit ${name}`} onClick={() => onEdit(runnable.id)} />
              <IconButton icon="close" size="small" tone="danger" label={`Remove ${name}`} onClick={() => proto.remove(runnable.id)} />
            </li>
          )
        })}
      </ol>
      {onAdd !== undefined && (
        <div className={s.row}>
          <Button size="small" icon="plus" onClick={onAdd}>
            Add something to run
          </Button>
        </div>
      )}
    </div>
  )
}

export function ManageDialog({ onClose, onEdit, onAdd }: { onClose: () => void; onEdit: (id: string) => void; onAdd: () => void }) {
  return (
    <Dialog
      title="What althar runs"
      description="In the order they show. The default is the one a single press of Run runs."
      onClose={onClose}
      width={620}
      actions={
        <Button variant="ink" onClick={onClose}>
          Done
        </Button>
      }
    >
      <ManageList onEdit={onEdit} onAdd={onAdd} />
    </Dialog>
  )
}

/* ——— The dialogs a direction opens, one at a time ——— */

type Showing = { kind: 'add'; way: AddWay } | { kind: 'edit'; id: string } | { kind: 'manage' } | null

const showingOf = (opening: Opening): Showing =>
  opening === 'add' || opening === 'scripts' || opening === 'ask' || opening === 'asked'
    ? { kind: 'add', way: wayOf(opening) }
    : opening === 'edit'
      ? { kind: 'edit', id: 'storybook' }
      : opening === 'manage'
        ? { kind: 'manage' }
        : null

/** The add, edit and manage dialogs, opened from the direction's own control; the page's opening opens one at first. */
export function useDialogs(own = true): { node: ReactNode; add: (way?: AddWay) => void; edit: (id: string) => void; manage: () => void } {
  const { opening } = useProto()
  const [showing, setShowing] = useState<Showing>(() => (own ? showingOf(opening) : null))
  const close = () => setShowing(null)
  const node =
    showing === null ? null : showing.kind === 'add' ? (
      <AddDialog way={showing.way} onClose={close} />
    ) : showing.kind === 'edit' ? (
      <EditDialog id={showing.id} onClose={close} />
    ) : (
      <ManageDialog
        onClose={close}
        onEdit={(id) => setShowing({ kind: 'edit', id })}
        onAdd={() => setShowing({ kind: 'add', way: 'type' })}
      />
    )
  return {
    node,
    add: (way = 'type') => setShowing({ kind: 'add', way }),
    edit: (id) => setShowing({ kind: 'edit', id }),
    manage: () => setShowing({ kind: 'manage' }),
  }
}
