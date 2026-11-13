import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import {
  Button,
  CopyButton,
  Icon,
  IconButton,
  LinkButton,
  PageEmpty,
  PageFrame,
  PagePanel,
  Popover,
  SidePanel,
  Terminal,
  Workbench,
} from '@althar/ui'

import { FactsCommand, glanceOf, PromptCommand, readCommand, shortCommand } from './command'
import { Address, calledOf, type CardProps, cx, type Direction, FOLD, labelOf, Mark, t, Word } from './directions'
import { isEnded, type RunState } from './states'
import d from './directions.module.css'
import f from './follow.module.css'

/*
 * The fold, again, three ways to follow what a run prints, none of them in
 * the thread:
 *   D1  Beside: "Output" on the card opens its console beside the conversation, following.
 *   D2  With the page: its console lives under its page, beside the conversation; the address opens both.
 *   D3  A popover: the fold becomes a console that opens from the card, the command its first line.
 * And three ways to read its command: as a prompt (D1), as facts (D2), as the
 * console's first line (D3).
 */

/* ---- what it printed, and where it shows ---------------------------------- */

export type BesideWhat = 'console' | 'page'

export interface RunOutput {
  /** What it printed so far. */
  lines: readonly string[]
  /** What shows beside the conversation, of this run. */
  beside: BesideWhat | null
  open: (what: BesideWhat) => void
}

export const OutputContext = createContext<RunOutput>({ lines: [], beside: null, open: () => {} })

const PARAMS = new URLSearchParams(location.search)
/** For screenshots: &pop opens D3's console. */
const POP = PARAMS.has('pop')
/** For screenshots: &drawer opens D2's console under its page. */
const DRAWER = PARAMS.has('drawer')

const still = (s: RunState) => s.phase === 'starting' || s.phase === 'up'

/**
 * What it printed, in the kit's Terminal, the command its first line. It
 * follows the end as lines come; scrolled up, it stays where it was read, and
 * Follow takes it back to the end.
 */
export function Console({ s, className, typed = true }: { s: RunState; className?: string; typed?: boolean }) {
  const { lines } = useContext(OutputContext)
  const box = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  useLayoutEffect(() => {
    if (following && box.current !== null) box.current.scrollTop = box.current.scrollHeight
  }, [lines.length, following])
  const r = readCommand(s.command)
  return (
    <div className={cx(f.console, className)}>
      <div
        ref={box}
        className={f.scroll}
        onScroll={(e) => {
          const el = e.currentTarget
          setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 12)
        }}
      >
        <Terminal
          {...(typed ? { command: shortCommand(s.command) } : {})}
          text={{ prompt: r.dir === undefined ? '$' : `${r.dir} $` }}
          lines={[...lines]}
          {...(still(s) ? { live: '' } : {})}
          {...(s.phase === 'failed' && s.code != null ? { exit: s.code } : {})}
        />
      </div>
      {!following && (
        <Button size="small" icon="down" className={f.follow} onClick={() => setFollowing(true)}>
          Follow
        </Button>
      )}
    </div>
  )
}

/** The run, in a panel's head: its mark and its name. */
function RunHead({ s }: { s: RunState }) {
  return (
    <span className={f.panelHead}>
      <Mark s={s} />
      <span className={f.panelName}>{calledOf(s)}</span>
    </span>
  )
}

/** D1, and D2's for a run with no page: its console, beside the conversation. */
function ConsolePanel({ s, onClose }: { s: RunState; onClose: () => void }) {
  return (
    <SidePanel label={`Output of ${calledOf(s)}`} head={<RunHead s={s} />} onClose={onClose}>
      <Console s={s} className={f.panelConsole} />
    </SidePanel>
  )
}

const VIEWPORTS = [{ value: 'fit', label: 'Fit the panel' }] as const

/** D2: its page beside the conversation, its console along the page's foot: a line of the latest, or opened, the console. */
function PageWithConsole({ s, onClose, console: opened }: { s: RunState; onClose: () => void; console: boolean }) {
  const [open, setOpen] = useState(opened || DRAWER)
  const { lines } = useContext(OutputContext)
  const latest = [...lines].reverse().find((l) => l.trim() !== '')
  const url = s.url ?? 'localhost:6143'
  return (
    <PagePanel
      address={url}
      full={`http://${url}/`}
      canBack={false}
      canForward={false}
      onBack={() => {}}
      onForward={() => {}}
      onReload={() => {}}
      onNavigate={() => {}}
      keep="until the task is done"
      onClear={() => {}}
      viewport="fit"
      viewports={VIEWPORTS}
      onViewport={() => {}}
      docked="beside"
      onDock={() => {}}
      onClose={onClose}
    >
      <div className={f.pageStack}>
        <div className={f.pagePlace}>
          <PageFrame {...(s.phase === 'up' ? {} : { empty: <PageEmpty>{t.starting}</PageEmpty> })}>
            {s.phase === 'up' && <iframe className={f.frame} src={`http://${url}/`} title={url} />}
          </PageFrame>
        </div>
        {open ? (
          <section className={f.drawer} aria-label="Console">
            <header className={f.drawerHead}>
              <Icon name="terminal" size={12} />
              <span>Console</span>
              <span className={d.gap} />
              <IconButton icon="chevronD" label="Hide the console" size="small" tooltipAlign="end" onClick={() => setOpen(false)} />
            </header>
            <Console s={s} className={f.drawerConsole} />
          </section>
        ) : (
          <button type="button" className={f.strip} aria-label="Show the console" onClick={() => setOpen(true)}>
            <Icon name="terminal" size={12} />
            <code>{latest}</code>
            <Icon name="chevronU" size={11} />
          </button>
        )}
      </div>
    </PagePanel>
  )
}

/** What opens beside the thread for this run, in the Workbench, as the app's right side holds one thing at a time. */
export function BesideRun({ s, what, onClose }: { s: RunState; what: BesideWhat; onClose: () => void }) {
  const [width, setWidth] = useState(520)
  return (
    <Workbench width={width} min={380} max={760} onWidth={setWidth} className={f.bench} style={{ width }}>
      {what === 'page' && s.url !== undefined ? (
        <PageWithConsole s={s} onClose={onClose} console={false} />
      ) : what === 'page' ? (
        <PageWithConsole s={s} onClose={onClose} console />
      ) : (
        <ConsolePanel s={s} onClose={onClose} />
      )}
    </Workbench>
  )
}

/* ---- the card's parts ------------------------------------------------------ */

const whyOfFailed = (s: RunState) => (s.phase === 'failed' && s.why !== undefined ? s.lines?.[s.why] : undefined)

/** Stop while it runs, Run again once it ended. */
function Act({ s, onStop, onRunAgain }: { s: RunState; onStop?: (() => void) | undefined; onRunAgain?: (() => void) | undefined }) {
  return isEnded(s) ? (
    <Button size="small" onClick={onRunAgain}>
      {t.again}
    </Button>
  ) : (
    <Button size="small" variant="quiet" onClick={onStop}>
      {t.stop}
    </Button>
  )
}

function Chevron({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <IconButton
      icon={open ? 'chevronU' : 'chevronD'}
      label={open ? t.hide : t.details}
      size="small"
      tooltipAlign="end"
      aria-expanded={open}
      onClick={onToggle}
    />
  )
}

function Shell({
  s,
  children,
  sub,
  actions,
  fold,
}: {
  s: RunState
  children?: ReactNode
  sub: ReactNode
  actions: ReactNode
  fold?: ReactNode
}) {
  return (
    <article className={cx(d.dCard, isEnded(s) && d.ended)} aria-label={labelOf(s)}>
      <div className={d.dHead}>
        <Mark s={s} className={d.dMark} />
        <span className={d.dMain}>
          <span className={cx(d.dName, s.name === undefined && d.mono)}>{s.name ?? glanceOf(s.command)}</span>
          <span className={d.dSub}>
            {sub}
            {s.place === 'project' && <span className={d.dWhere}>{s.where}</span>}
          </span>
        </span>
        {actions}
      </div>
      {fold}
      {children}
    </article>
  )
}

/** The line that says why it failed: pressed, its whole output. */
function Why({ s, onOpen, pressed }: { s: RunState; onOpen: () => void; pressed?: boolean }) {
  const why = whyOfFailed(s)
  if (why === undefined) return null
  return (
    <button type="button" className={f.why} aria-pressed={pressed} onClick={onOpen} title="Its output">
      {why}
    </button>
  )
}

/* ---- D1 · Beside -------------------------------------------------------------- */

function D1({ state: s, onOpen, onStop, onRunAgain }: CardProps) {
  const out = useContext(OutputContext)
  const [open, setOpen] = useState(FOLD)
  const shown = out.beside === 'console'
  return (
    <Shell
      s={s}
      sub={
        <>
          {s.phase === 'up' ? <Address s={s} onOpen={onOpen} /> : <Word s={s} />}
          {s.phase === 'failed' ? (
            <Why s={s} onOpen={() => out.open('console')} pressed={shown} />
          ) : (
            <LinkButton className={cx(f.outLink, shown && f.shown)} aria-pressed={shown} onClick={() => out.open('console')}>
              Output
            </LinkButton>
          )}
        </>
      }
      actions={
        <>
          <Act s={s} onStop={onStop} onRunAgain={onRunAgain} />
          <Chevron open={open} onToggle={() => setOpen((o) => !o)} />
        </>
      }
      fold={
        open && (
          <div className={f.fold}>
            <div className={f.commandRow}>
              <PromptCommand command={s.command} />
              <CopyButton value={s.command} ghost className={f.copy} />
            </div>
            <p className={f.when}>
              {s.phase === 'stopped' ? t.stoppedAt(s.since) : isEnded(s) ? `Ended ${s.since}` : t.started(s.started)}
            </p>
          </div>
        )
      }
    />
  )
}

/* ---- D2 · With the page ------------------------------------------------------- */

function D2({ state: s, onStop, onRunAgain }: CardProps) {
  const out = useContext(OutputContext)
  const [open, setOpen] = useState(FOLD)
  const where: 'page' | 'console' = s.url !== undefined || s.phase === 'starting' ? 'page' : 'console'
  return (
    <Shell
      s={s}
      sub={
        <>
          {s.phase === 'up' ? <Address s={s} onOpen={() => out.open('page')} /> : <Word s={s} />}
          {s.phase === 'failed' ? (
            <Why s={s} onOpen={() => out.open('console')} pressed={out.beside === 'console'} />
          ) : s.phase === 'up' ? null : (
            <LinkButton
              className={cx(f.outLink, out.beside !== null && f.shown)}
              aria-pressed={out.beside !== null}
              onClick={() => out.open(where)}
            >
              Output
            </LinkButton>
          )}
        </>
      }
      actions={
        <>
          <Act s={s} onStop={onStop} onRunAgain={onRunAgain} />
          <Chevron open={open} onToggle={() => setOpen((o) => !o)} />
        </>
      }
      fold={
        open && (
          <div className={f.fold}>
            <div className={f.commandRow}>
              <FactsCommand command={s.command} />
              <CopyButton value={s.command} ghost className={f.copy} />
            </div>
          </div>
        )
      }
    />
  )
}

/* ---- D3 · A popover ------------------------------------------------------------ */

function D3({ state: s, onOpen, onStop, onRunAgain }: CardProps) {
  const [open, setOpen] = useState(POP)
  return (
    <Shell
      s={s}
      sub={
        <>
          {s.phase === 'up' ? <Address s={s} onOpen={onOpen} /> : <Word s={s} />}
          <Why s={s} onOpen={() => setOpen(true)} pressed={open} />
        </>
      }
      actions={
        <>
          <Act s={s} onStop={onStop} onRunAgain={onRunAgain} />
          <Popover
            label={`Output of ${calledOf(s)}`}
            trigger={<IconButton icon="terminal" label="Output" size="small" tooltipAlign="end" aria-pressed={open} />}
            placement="below"
            align="end"
            width={544}
            padded={false}
            open={open}
            onOpenChange={setOpen}
          >
            <div className={f.pop}>
              <div className={f.popHead}>
                <PromptCommand command={s.command} />
                <CopyButton value={s.command} ghost text={{ copy: 'Copy command' }} className={f.popCopy} />
              </div>
              <Console s={s} typed={false} className={f.popConsole} />
            </div>
          </Popover>
        </>
      }
    />
  )
}

export const FOLDS: readonly Direction[] = [
  {
    key: 'd1',
    letter: 'E',
    name: 'D1 · Beside',
    idea: '“Output” on the card opens its console beside the conversation, following the end. The fold reads the command as a prompt.',
    Card: D1,
  },
  {
    key: 'd2',
    letter: 'F',
    name: 'D2 · With the page',
    idea: 'Its console lives under its page, beside the conversation: the address opens both. The fold reads the command as facts.',
    Card: D2,
  },
  {
    key: 'd3',
    letter: 'G',
    name: 'D3 · A popover',
    idea: 'No fold: a console opens from the card, the command its first line, and follows the end until you scroll up.',
    Card: D3,
  },
]
