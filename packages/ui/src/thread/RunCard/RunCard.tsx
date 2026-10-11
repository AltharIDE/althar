import { Icon } from '../../foundations/Icon/Icon'
import { cx } from '../../lib/cx'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { Spinner } from '../../primitives/Spinner/Spinner'
import s from './RunCard.module.css'

/*
 * A run of the project Althar started itself, in the thread it was asked for
 * in: where it runs, the command, and where it answers, to open, with Stop.
 * It follows the run: starting until it says where it answers, then up, then
 * how it ended, by itself with its last line, or stopped, with Run again. It
 * stays in the thread once the run is over. Calm: its dot stays still.
 */

export interface RunCardText {
  running: string
  ran: string
  /** Before it says where it answers. */
  starting: string
  up: (since: string) => string
  exited: (code: number | null) => string
  stopped: (since: string) => string
  stop: string
  stopLabel: (command: string) => string
  again: string
  againLabel: (command: string) => string
  openLabel: (url: string) => string
  label: (where: string) => string
}

export const runCardText: RunCardText = {
  running: 'Running',
  ran: 'Ran',
  starting: 'Starting',
  up: (since) => `up for ${since}`,
  exited: (code) => (code === null ? 'ended' : `exited ${code}`),
  stopped: (since) => `stopped ${since}`,
  stop: 'Stop',
  stopLabel: (command) => `Stop ${command}`,
  again: 'Run again',
  againLabel: (command) => `Run ${command} again`,
  openLabel: (url) => `Open ${url}`,
  label: (where) => `Run of ${where}`,
}

export interface RunCardProps {
  /** Where it runs, in words: the task's title, or the default branch. */
  where: string
  command: string
  /** Where it answers, as the card says it: localhost:5173. Without it, it is starting. */
  url?: string
  /** How long it has run, or when it ended: 2m, 4m ago. */
  since: string
  /** It ended: by itself, with its exit code where known and its last line; or stopped. */
  ended?: { readonly code: number | null; readonly stopped: boolean; readonly last?: string }
  /** Open where it answers, in the person's browser. Without it, the address is plain text. */
  onOpen?: () => void
  /** Stop it. Without it, no Stop. */
  onStop?: () => void
  /** Run it again, once it ended. Without it, no Run again. */
  onRunAgain?: () => void
  className?: string
  text?: Partial<RunCardText>
}

export function RunCard({ where, command, url, since, ended, onOpen, onStop, onRunAgain, className, text }: RunCardProps) {
  const t = { ...runCardText, ...text }
  const bad = ended !== undefined && !ended.stopped && ended.code !== 0
  return (
    <article className={cx(s.card, ended !== undefined && s.ended, className)} aria-label={t.label(where)}>
      <div className={s.head}>
        <span className={s.kicker}>
          {ended === undefined ? <LiveDot /> : <Icon name="terminal" size={11} className={s.still} />}
          <span>
            {ended === undefined ? t.running : t.ran} · <span className={s.where}>{where}</span>
          </span>
        </span>
        <code className={s.command}>{command}</code>
      </div>
      <div className={s.foot}>
        {ended === undefined && url === undefined && (
          <span className={s.status}>
            <Spinner size="small" /> {t.starting}
          </span>
        )}
        {ended === undefined && url !== undefined && (
          <>
            {onOpen ? (
              <LinkButton className={s.open} aria-label={t.openLabel(url)} onClick={onOpen}>
                {url} <Icon name="external" size={11} />
              </LinkButton>
            ) : (
              <span className={s.open}>{url}</span>
            )}
            <span className={s.quiet}>{t.up(since)}</span>
          </>
        )}
        {ended?.stopped === true && <span className={s.quiet}>{t.stopped(since)}</span>}
        {ended !== undefined && !ended.stopped && (
          <span className={s.status}>
            <span className={cx(bad && s.bad)}>{t.exited(ended.code)}</span>
            {ended.last !== undefined && <code className={s.last}>{ended.last}</code>}
          </span>
        )}
        <span className={s.gap} />
        {ended === undefined && onStop && (
          <LinkButton className={s.act} aria-label={t.stopLabel(command)} onClick={onStop}>
            {t.stop}
          </LinkButton>
        )}
        {ended !== undefined && onRunAgain && (
          <LinkButton className={s.act} aria-label={t.againLabel(command)} onClick={onRunAgain}>
            {t.again}
          </LinkButton>
        )}
      </div>
    </article>
  )
}
