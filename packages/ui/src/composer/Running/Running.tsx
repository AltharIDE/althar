import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { Popover } from '../../primitives/Popover/Popover'
import s from './Running.module.css'

/*
 * What the agent left running: a dev server it started, a watcher, a test
 * run in the background. They outlive the tool call that started them, so
 * they are not in the thread; the pill floats above the composer, beside
 * what it listens to. Open it to see each one, where it answers, and to
 * stop it. One that exited on its own stays, to say how.
 *
 * A row leads with what it is called and where it answers, the way the
 * person would say it: "Site dev server · localhost:5173". The command, at a
 * glance, is its quiet second line with how long it has run, and the whole of
 * it is on hover. Without a name, the command at a glance leads. Nothing is
 * cut off at the popover's width without a way to read it: a long
 * name wraps to two lines, the address and the command each keep to one, and
 * the whole is on hover.
 */

export interface RunningProcess {
  id: string
  /** What was run, whole: cd /work/tree && bun dev 2>&1 | tail -20. Shown in full on hover. */
  command: string
  /** What the agent says it does, where that says more than the command: Site dev server. Leads the row and the pill. */
  name?: string
  /** The same at a glance, where it can be said shorter: bun dev. Without it, the command is shown. */
  label?: string
  /** Where it answers, when it serves: localhost:5173. */
  url?: string
  /** How long it has run, or when it stopped: 12m. */
  since?: string
  /** Where it runs, where several places run things: a task, the default branch. */
  where?: string
  /** It exited on its own, with this code; null where the code isn't known. */
  exited?: number | null
  /** Its output can be shown (`onOutput`); false for one whose output isn't kept anywhere to read. */
  output?: boolean
}

/** What a process is called: its name, else its command at a glance, else the command. */
const calledOf = (p: RunningProcess) => p.name ?? p.label ?? p.command

export interface RunningText {
  /** The pill's lead-in, and the list's name. */
  title: string
  /** The pill's lead-in when nothing is left running. */
  ran: string
  /** The pill, with more than one. */
  count: (n: number) => string
  exited: (code: number | null) => string
  /** The pill, after what still runs: how many of the rest exited. */
  someExited: (n: number) => string
  stop: string
  stopLabel: (command: string) => string
  /** Clear one that exited from the list. */
  dismiss: string
  dismissLabel: (command: string) => string
  output: string
  outputLabel: (command: string) => string
  openLabel: (url: string) => string
}

export const runningText: RunningText = {
  title: 'Running',
  ran: 'Ran',
  count: (n) => `${n} processes`,
  exited: (code) => (code === null ? 'ended' : `exited ${code}`),
  someExited: (n) => `${n} exited`,
  stop: 'Stop',
  stopLabel: (command) => `Stop ${command}`,
  dismiss: 'Clear',
  dismissLabel: (command) => `Clear ${command}`,
  output: 'Output',
  outputLabel: (command) => `Show the output of ${command}`,
  openLabel: (url) => `Open ${url}`,
}

export interface RunningProps {
  processes: readonly RunningProcess[]
  /** Stop one. Without it, the list has no Stop buttons. */
  onStop?: (id: string) => void
  /** Clear one that exited. */
  onDismiss?: (id: string) => void
  /** Show one's output, in the consumer's panel. */
  onOutput?: (id: string) => void
  /** Open where one answers. Without it, the address is plain text. */
  onOpenUrl?: (id: string) => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  text?: Partial<RunningText>
}

/** An exit that went wrong, as far as it is known. */
const bad = (code: number | null) => code !== null && code !== 0

export function Running({ processes, onStop, onDismiss, onOutput, onOpenUrl, open, defaultOpen, onOpenChange, text }: RunningProps) {
  const t = { ...runningText, ...text }
  if (!processes.length) return null
  const running = processes.filter((p) => p.exited === undefined)
  const live = running.length > 0
  // The pill names the one still running, or the only one; else it counts them.
  const one = running.length === 1 ? running[0] : processes.length === 1 ? processes[0] : undefined
  const ended = processes.length - running.length

  return (
    <Popover
      label={live ? t.title : t.ran}
      placement="above"
      width={420}
      padded={false}
      initialFocus="panel"
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      className={s.pop}
      trigger={
        <button type="button" className={s.pill}>
          {live ? <LiveDot /> : <Icon name="terminal" size={11} className={s.still} />}
          <span className={s.text}>
            <span className={s.k}>{live ? t.title : t.ran}</span>
            {one ? (
              <span className={cx(s.name, s.mono, one.name === undefined && s.code)} title={one.command}>
                {calledOf(one)}
              </span>
            ) : (
              <span className={s.name}>{t.count(live ? running.length : processes.length)}</span>
            )}
            {one?.url && <span className={s.what}>· {one.url}</span>}
            {one?.exited !== undefined && <span className={cx(s.what, bad(one.exited) && s.bad)}>· {t.exited(one.exited)}</span>}
            {live && ended > 0 && <span className={s.what}>· {t.someExited(ended)}</span>}
          </span>
          <Icon name="chevronD" size={9} className={s.chev} />
        </button>
      }
    >
      <div className={s.head} aria-hidden="true">
        {live ? t.title : t.ran}
      </div>
      <RunningList processes={processes} onStop={onStop} onDismiss={onDismiss} onOutput={onOutput} onOpenUrl={onOpenUrl} text={text} />
    </Popover>
  )
}

export interface RunningListProps {
  processes: readonly RunningProcess[]
  onStop?: ((id: string) => void) | undefined
  onDismiss?: ((id: string) => void) | undefined
  onOutput?: ((id: string) => void) | undefined
  onOpenUrl?: ((id: string) => void) | undefined
  text?: Partial<RunningText> | undefined
}

/** The pill's list, on its own, for what shows what runs elsewhere: each one, where it answers, and how to stop, clear or read it. */
export function RunningList({ processes, onStop, onDismiss, onOutput, onOpenUrl, text }: RunningListProps) {
  const t = { ...runningText, ...text }
  return (
    <ul className={s.list}>
      {processes.map((p) => (
        <li className={s.row} key={p.id}>
          <span className={s.rowGlyph}>{p.exited === undefined ? <LiveDot /> : <Icon name="terminal" size={12} />}</span>
          <span className={s.rowMain}>
            <span className={s.rowTitle}>
              {p.name === undefined ? (
                <code className={s.command} title={p.command}>
                  {p.label ?? p.command}
                </code>
              ) : (
                <span className={s.called} title={p.command}>
                  {p.name}
                </span>
              )}
              {p.url &&
                (onOpenUrl ? (
                  <LinkButton className={s.url} title={p.url} aria-label={t.openLabel(p.url)} onClick={() => onOpenUrl(p.id)}>
                    {p.url}
                  </LinkButton>
                ) : (
                  <span className={s.url} title={p.url}>
                    {p.url}
                  </span>
                ))}
            </span>
            <span className={s.rowMeta}>
              {[
                p.name !== undefined && (
                  <code key="command" className={s.line} title={p.command}>
                    {p.label ?? p.command}
                  </code>
                ),
                p.where !== undefined && (
                  <span key="where" className={s.where}>
                    {p.where}
                  </span>
                ),
                p.exited !== undefined && (
                  <span key="exited" className={cx(bad(p.exited) && s.bad)}>
                    {t.exited(p.exited)}
                  </span>
                ),
                p.since !== undefined && <span key="since">{p.since}</span>,
              ]
                .filter(Boolean)
                .flatMap((part, at) => (at === 0 ? [part] : [<span key={`and${at}`}> · </span>, part]))}
            </span>
          </span>
          {onOutput && p.output !== false && (
            <ActionButton size="small" aria-label={t.outputLabel(calledOf(p))} onClick={() => onOutput(p.id)}>
              {t.output}
            </ActionButton>
          )}
          {onStop && p.exited === undefined && (
            <ActionButton size="small" aria-label={t.stopLabel(calledOf(p))} onClick={() => onStop(p.id)}>
              {t.stop}
            </ActionButton>
          )}
          {onDismiss && p.exited !== undefined && (
            <ActionButton size="small" aria-label={t.dismissLabel(calledOf(p))} onClick={() => onDismiss(p.id)}>
              {t.dismiss}
            </ActionButton>
          )}
        </li>
      ))}
    </ul>
  )
}
