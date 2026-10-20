import { Terminal } from '../Terminal/Terminal'
import s from './FailedLogs.module.css'

export interface FailedLogsText {
  /** Why a check's log couldn't be read: its host's refusal, in plain words. */
  missing: (why: string) => string
  /** The way to the check's own page, where its log can't be read here. */
  open: string
}

export const failedLogsText: FailedLogsText = {
  missing: (why) => `Couldn’t read its log: ${why}.`,
  open: 'Open its page',
}

export interface FailedLog {
  /** The check's name, as its host gives it. */
  name: string
  /** Its page, on its host or its CI service's. */
  url: string | null
  /** The end of its log, line by line; null where it couldn't be read. */
  lines: string[] | null
  /** Why it couldn't be read: "GitHub refused (401)". */
  missing: string | null
}

/** How many of a log's last lines show at first: where a run says how it failed. The rest are one click away. */
const SHOWN = 12

export interface FailedLogsProps {
  logs: FailedLog[]
  text?: Partial<FailedLogsText>
}

/**
 * Failed checks' logs, under the note that says they failed: the end of
 * each, with what came before one click away, or why it couldn't be read,
 * with the way to the check's own page. Never a check's name alone.
 */
export function FailedLogs({ logs, text }: FailedLogsProps) {
  const t = { ...failedLogsText, ...text }
  // One check's name is in the line above; several are told apart.
  const named = logs.length > 1
  return (
    <div className={s.logs}>
      {logs.map((log) => (
        <section key={log.name} className={s.log} aria-label={log.name}>
          {named && <div className={s.name}>{log.name}</div>}
          {log.lines !== null ? (
            <Terminal lines={log.lines.slice(-SHOWN)} earlier={log.lines.slice(0, -SHOWN)} />
          ) : (
            <p className={s.missing}>
              <span>{t.missing(log.missing ?? '')}</span>
              {log.url !== null && (
                <a href={log.url} target="_blank" rel="noreferrer">
                  {t.open}
                </a>
              )}
            </p>
          )}
        </section>
      ))}
    </div>
  )
}
