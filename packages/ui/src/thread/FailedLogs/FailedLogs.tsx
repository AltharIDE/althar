import { Problem } from '../../primitives/Problem/Problem'
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

/** A GitHub Actions log line's time, which every line starts with: noise on a card. */
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z /

/**
 * A failed check's log as its card shows it: by its lines, without their
 * times, ending where GitHub Actions marked it failed (`##[error]`), not in
 * the job's cleanup after.
 */
export const logLines = (log: string) => {
  const lines = log
    .trimEnd()
    .split('\n')
    .map((line) => line.replace(STAMP, ''))
  const failed = lines.findLastIndex((line) => line.startsWith('##[error]'))
  return failed === -1 ? lines : lines.slice(0, failed + 1)
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
            <Problem
              size="small"
              {...(log.url === null
                ? {}
                : {
                    action: (
                      <a className={s.open} href={log.url} target="_blank" rel="noreferrer">
                        {t.open}
                      </a>
                    ),
                  })}
            >
              {t.missing(log.missing ?? '')}
            </Problem>
          )}
        </section>
      ))}
    </div>
  )
}
