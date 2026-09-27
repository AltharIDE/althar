import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
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
 */

export interface RunningProcess {
  id: string
  /** What was run: bun dev. */
  command: string
  /** Where it answers, when it serves: localhost:5173. */
  url?: string
  /** How long it has run, or when it stopped: 12m. */
  since?: string
  /** It exited on its own, with this code. */
  exited?: number
}

export interface RunningText {
  /** The pill's lead-in, and the list's name. */
  title: string
  /** The pill's lead-in when nothing is left running. */
  ran: string
  /** The pill, with more than one. */
  count: (n: number) => string
  exited: (code: number) => string
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
  exited: (code) => `exited ${code}`,
  stop: 'Stop',
  stopLabel: (command) => `Stop ${command}`,
  dismiss: 'Clear',
  dismissLabel: (command) => `Clear ${command}`,
  output: 'Output',
  outputLabel: (command) => `Show the output of ${command}`,
  openLabel: (url) => `Open ${url}`,
}

export interface RunningProps {
  processes: RunningProcess[]
  /** Stop one. Without it, the list has no Stop buttons. */
  onStop?: (id: string) => void
  /** Clear one that exited. */
  onDismiss?: (id: string) => void
  /** Show one's output, in the consumer's panel. */
  onOutput?: (id: string) => void
  /** Open where one answers. Without it, the address is plain text. */
  onOpenUrl?: (id: string) => void
  defaultOpen?: boolean
  text?: Partial<RunningText>
}

export function Running({ processes, onStop, onDismiss, onOutput, onOpenUrl, defaultOpen, text }: RunningProps) {
  const t = { ...runningText, ...text }
  if (!processes.length) return null
  const one = processes.length === 1 ? processes[0] : undefined
  const live = processes.some((p) => p.exited === undefined)

  return (
    <Popover
      label={t.title}
      placement="above"
      width={420}
      padded={false}
      initialFocus="panel"
      defaultOpen={defaultOpen}
      className={s.pop}
      trigger={
        <button type="button" className={s.pill}>
          {live ? <LiveDot /> : <Icon name="terminal" size={11} className={s.still} />}
          <span className={s.text}>
            <span className={s.k}>{live ? t.title : t.ran}</span>
            {one ? <code className={cx(s.name, s.mono)}>{one.command}</code> : <span className={s.name}>{t.count(processes.length)}</span>}
            {one?.url && <span className={s.what}>· {one.url}</span>}
            {one?.exited !== undefined && <span className={cx(s.what, one.exited !== 0 && s.bad)}>· {t.exited(one.exited)}</span>}
          </span>
          <Icon name="chevronD" size={9} className={s.chev} />
        </button>
      }
    >
      <div className={s.head} aria-hidden="true">
        {t.title}
      </div>
      <ul className={s.list}>
        {processes.map((p) => (
          <li className={s.row} key={p.id}>
            <span className={s.rowGlyph}>{p.exited === undefined ? <LiveDot /> : <Icon name="terminal" size={12} />}</span>
            <span className={s.rowMain}>
              <span className={s.rowTitle}>
                <code className={s.command}>{p.command}</code>
                {p.url &&
                  (onOpenUrl ? (
                    <LinkButton className={s.url} aria-label={t.openLabel(p.url)} onClick={() => onOpenUrl(p.id)}>
                      {p.url}
                    </LinkButton>
                  ) : (
                    <span className={s.url}>{p.url}</span>
                  ))}
              </span>
              <span className={s.rowMeta}>
                {p.exited !== undefined && <span className={cx(p.exited !== 0 && s.bad)}>{t.exited(p.exited)}</span>}
                {p.exited !== undefined && p.since && ' · '}
                {p.since}
              </span>
            </span>
            {onOutput && (
              <button type="button" className={s.act} aria-label={t.outputLabel(p.command)} onClick={() => onOutput(p.id)}>
                {t.output}
              </button>
            )}
            {onStop && p.exited === undefined && (
              <button type="button" className={s.act} aria-label={t.stopLabel(p.command)} onClick={() => onStop(p.id)}>
                {t.stop}
              </button>
            )}
            {onDismiss && p.exited !== undefined && (
              <button type="button" className={s.act} aria-label={t.dismissLabel(p.command)} onClick={() => onDismiss(p.id)}>
                {t.dismiss}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Popover>
  )
}
