import { useCallback, useEffect, useRef, useState } from 'react'

import { Icon } from '../../src/foundations/Icon/Icon'
import { Brand } from '../../src/foundations/brands/brands'
import { BrandMark } from '../../src/foundations/Marks/Marks'
import { Button } from '../../src/primitives/Button/Button'
import { Code } from '../../src/primitives/Code/Code'
import { CopyButton } from '../../src/primitives/CopyButton/CopyButton'
import { LinkButton } from '../../src/primitives/LinkButton/LinkButton'
import { Problem } from '../../src/primitives/Problem/Problem'
import { Spinner } from '../../src/primitives/Spinner/Spinner'
import s from '../../src/setup/Computers/Computers.module.css'
import l from './lab.module.css'

/*
 * The first check of a worker, as the doctor would run it: each thing a task needs there, in the order a task meets it,
 * the ones that fail turning into what to do about them, in place. What fails here is what failed on the person's own
 * first worker: no bubblewrap for the sandbox, no node-gyp for the setup, their MCP servers not there.
 */

/** A state to open at, for a picture of it: the first failures in, or all through. */
export type Snap = 'failing' | 'ready' | null

export type CheckId = 'reach' | 'setup' | 'sandbox' | 'claude' | 'codex' | 'mcp' | 'task'
type State = 'later' | 'now' | 'done' | 'failed' | 'fixing' | 'skipped' | 'signing'

export interface Check {
  id: CheckId
  label: string
  state: State
  detail?: string
}

const LABELS: Record<CheckId, string> = {
  reach: 'Clones Althar',
  setup: 'Runs Althar’s setup',
  sandbox: 'Sandbox for its agents',
  claude: 'Claude Code',
  codex: 'Codex',
  mcp: 'Your MCP servers',
  task: 'Runs a short task',
}

/** What each ends as, all being well, and what it fails with first. */
const DONE: Record<CheckId, string> = {
  reach: 'github.com/AltharIDE/althar · 9 s',
  setup: 'bun install --frozen-lockfile · 41 s',
  sandbox: 'bubblewrap 0.11',
  claude: 'Signed in',
  codex: 'Signed in, as on This Mac',
  mcp: 'playwright, site-browser, node_repl',
  task: 'Claude Code read the repository and answered · 14 s',
}
const FAILS: ReadonlySet<CheckId> = new Set(['setup', 'sandbox', 'claude', 'mcp'])
const FIXED: Partial<Record<CheckId, string>> = {
  setup: 'Installed node-gyp in ~/.bun and recorded it, for the next worker too',
  sandbox: 'bubblewrap 0.11 · installed over SSH',
  claude: 'Signed in',
  mcp: 'Installed there',
}

export const ALL: readonly CheckId[] = ['reach', 'setup', 'sandbox', 'claude', 'codex', 'mcp', 'task']

/** Runs the checks given, a little apart; one failing stops none of the others. The short task goes last, once nothing waits. */
export function useChecks(ids: readonly CheckId[], running: boolean, snap: Snap = null, smooth = false) {
  const make = (): Check[] =>
    ids.map((id) => {
      const label = LABELS[id]
      if (snap === 'ready') return { id, label, state: 'done', detail: FIXED[id] ?? DONE[id] }
      if (snap === 'failing')
        return id === 'task' ? { id, label, state: 'later' } : FAILS.has(id) ? { id, label, state: 'failed' } : { id, label, state: 'done', detail: DONE[id] }
      return { id, label, state: 'later' }
    })
  const [checks, setChecks] = useState<Check[]>(make)
  const timers = useRef<number[]>([])
  const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms))
  const set = useCallback((id: CheckId, state: State, detail?: string) => {
    setChecks((all) => all.map((one) => (one.id === id ? { ...one, state, ...(detail === undefined ? {} : { detail }) } : one)))
  }, [])

  useEffect(() => {
    if (!running || snap !== null) return
    const before = ids.filter((id) => id !== 'task')
    before.forEach((id, i) => {
      later(250 + i * 420, () => set(id, 'now'))
      later(900 + i * 520, () => (FAILS.has(id) && !smooth ? set(id, 'failed') : set(id, 'done', DONE[id])))
    })
    return () => {
      timers.current.forEach((one) => window.clearTimeout(one))
      timers.current = []
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs once as it starts
  }, [running])

  // The short task, once everything before it has settled and none is left failing.
  const settled = checks.filter((one) => one.id !== 'task').every((one) => one.state === 'done' || one.state === 'skipped')
  const task = checks.find((one) => one.id === 'task')
  useEffect(() => {
    if (!running || task === undefined || task.state !== 'later' || !settled) return
    set('task', 'now', 'Claude Code reads the repository and says what it is')
    later(2200, () => set('task', 'done', DONE.task))
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- on settling
  }, [running, settled, task?.state])

  /** A fix pressed: it shows at once, and lands a moment later. */
  const fix = (id: CheckId, how: 'fix' | 'skip' | 'sign') => {
    if (how === 'skip') return set(id, 'skipped', id === 'mcp' ? 'Its tasks go without them' : 'Skipped')
    if (how === 'sign') return set(id, 'signing')
    set(id, 'fixing')
    later(id === 'setup' ? 2600 : 1500, () => set(id, 'done', FIXED[id] ?? DONE[id]))
  }
  const signed = (id: CheckId) => {
    set(id, 'fixing')
    later(1200, () => set(id, 'done', FIXED[id]))
  }
  const ready = checks.every((one) => one.state === 'done' || one.state === 'skipped')
  const failing = checks.filter((one) => one.state === 'failed' || one.state === 'signing').length
  return { checks, fix, signed, ready, failing }
}

const MARKS: Partial<Record<CheckId, Brand>> = { claude: Brand.ClaudeCode, codex: Brand.Codex }

/** What a failed check says, and the one or two ways out of it. */
function Failure({ check, fix }: { check: Check; fix: Fixes['fix'] }) {
  switch (check.id) {
    case 'setup':
      return (
        <span className={s.stopped}>
          <Problem as="span" size="small">
            node-pty couldn’t build: node-gyp isn’t on hermes-box.
          </Problem>
          <span className={l.ways}>
            <Button size="small" variant="signal" onClick={() => fix('setup', 'fix')}>
              Let a lead fix it
            </Button>
            <LinkButton onClick={() => fix('setup', 'skip')}>Leave Althar off it</LinkButton>
          </span>
        </span>
      )
    case 'sandbox':
      return (
        <span className={s.stopped}>
          <Problem as="span" size="small">
            bubblewrap isn’t installed, and installing it needs root.
          </Problem>
          <span className={s.lineToRun}>
            <Code className={s.lineToRunText}>sudo apt install bubblewrap socat</Code>
            <CopyButton value="sudo apt install bubblewrap socat" ghost />
          </span>
          <span className={l.ways}>
            <Button size="small" variant="signal" onClick={() => fix('sandbox', 'fix')}>
              Run it over SSH
            </Button>
            <LinkButton onClick={() => fix('sandbox', 'fix')}>I ran it</LinkButton>
          </span>
        </span>
      )
    case 'claude':
      return (
        <span className={s.stopped}>
          <Problem as="span" size="small">
            Not signed in on hermes-box.
          </Problem>
          <span className={l.ways}>
            <Button size="small" variant="signal" onClick={() => fix('claude', 'sign')}>
              Sign in
            </Button>
            <LinkButton onClick={() => fix('claude', 'skip')}>Not on this worker</LinkButton>
          </span>
        </span>
      )
    case 'mcp':
      return (
        <span className={s.stopped}>
          <Problem as="span" size="small">
            3 of yours aren’t on it: playwright, site-browser, node_repl.
          </Problem>
          <span className={l.ways}>
            <Button size="small" variant="signal" onClick={() => fix('mcp', 'fix')}>
              Install them there
            </Button>
            <LinkButton onClick={() => fix('mcp', 'skip')}>Go without them</LinkButton>
          </span>
        </span>
      )
    default:
      return null
  }
}

/** Claude Code's sign-in on the worker, as the sheet's own goes: a code to enter on a page. */
function Signing({ onDone }: { onDone: () => void }) {
  return (
    <span className={s.signInStep}>
      <span className={s.addressHint}>Enter this code at claude.ai/device</span>
      <span className={s.signInRow}>
        <span className={s.signInCode}>WXKR-4719</span>
        <CopyButton value="WXKR-4719" ghost />
        <LinkButton onClick={onDone}>Open the page</LinkButton>
      </span>
    </span>
  )
}

type Fixes = ReturnType<typeof useChecks>

/** The checks as the install's own steps draw: a tick, a name, what it found; what failed with its way out under it. */
export function CheckRows({ checks, fix, signed, label }: Pick<Fixes, 'checks' | 'fix' | 'signed'> & { label: string }) {
  return (
    <ol className={s.installSteps} aria-label={label} aria-live="polite">
      {checks.map((check) => {
        const drawn = check.state === 'fixing' || check.state === 'signing' ? 'now' : check.state === 'skipped' ? 'later' : check.state
        const mark = MARKS[check.id]
        return (
          <li key={check.id} data-state={drawn}>
            <span className={s.tick}>
              {check.state === 'done' ? (
                <Icon name="check" size={10} />
              ) : check.state === 'failed' ? (
                <Icon name="close" size={10} />
              ) : check.state === 'now' || check.state === 'fixing' ? (
                <Spinner size="small" />
              ) : check.state === 'signing' ? (
                <Icon name="lock" size={10} />
              ) : null}
            </span>
            <span className={s.installWords}>
              <span className={s.installLabel}>
                {mark !== undefined ? (
                  <span className={s.inline}>
                    <BrandMark brand={mark} size={13} />
                    {check.label}
                  </span>
                ) : (
                  check.label
                )}
              </span>
              {check.state === 'fixing' && (
                <span className={s.installDetail}>{check.id === 'setup' ? 'A lead is on it…' : 'Installing…'}</span>
              )}
              {check.detail !== undefined && check.state !== 'fixing' && <span className={s.installDetail}>{check.detail}</span>}
              {check.state === 'failed' && <Failure check={check} fix={fix} />}
              {check.state === 'signing' && <Signing onDone={() => signed(check.id)} />}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
