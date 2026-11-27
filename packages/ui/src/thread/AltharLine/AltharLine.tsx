import type { ReactNode } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Problem } from '../../primitives/Problem/Problem'
import { type FailedLog, FailedLogs } from '../FailedLogs/FailedLogs'
import { NoteDetails } from '../NoteDetails/NoteDetails'
import s from './AltharLine.module.css'

export interface AltharLineText {
  /** Who says it. */
  name: string
  /** The fold that holds the logs of the failed checks it names. */
  logs: string
}

export const altharLineText: AltharLineText = { name: 'Althar', logs: 'Logs' }

export type AltharLineProps = RootProps<
  'p',
  {
    children: ReactNode
    /** Something that failed and is now the person's: a turn that couldn't go on, a conflict its lead couldn't settle. Said as a Problem. */
    tone?: 'info' | 'warning'
    text?: Partial<AltharLineText>
    /** What the line is built on, such as a host's raw answer: folded under it as Details. */
    details?: string
    /** The failed checks it names, such as the merge queue's: each log's end, or why it couldn't be read, folded under it as Logs. */
    logs?: FailedLog[]
  }
>

/**
 * Althar saying something the person should know, in a task's thread: a
 * conflict with the default branch, checks that failed, a pull request
 * opened. One plain line with its name, so it reads as someone speaking;
 * what failed is said as a problem, in the danger colour with its mark.
 */
export function AltharLine({ children, tone = 'info', text, details, logs, className, ...rest }: AltharLineProps) {
  const t = { ...altharLineText, ...text }
  const line = (
    <p className={cx(s.line, className)} {...rest}>
      <span className={s.name}>{t.name}</span>
      {tone === 'warning' ? (
        <Problem as="span" className={s.problem}>
          {children}
        </Problem>
      ) : (
        <span className={s.words}>{children}</span>
      )}
    </p>
  )
  const folded = logs !== undefined && logs.length > 0
  if (details === undefined && !folded) return line
  return (
    <div className={s.with}>
      {line}
      {folded && (
        <NoteDetails text={{ label: t.logs }} drawn>
          <FailedLogs logs={logs} />
        </NoteDetails>
      )}
      {details !== undefined && <NoteDetails>{details}</NoteDetails>}
    </div>
  )
}
