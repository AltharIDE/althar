import { createContext, useContext, useState, type ReactNode } from 'react'

import { cx } from '../../lib/cx'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import s from './Terminal.module.css'

/** Set by a host that already shows the exit code, like a failed Tool's row, so the output does not say it twice. */
export const ExitShown = createContext(false)

export interface TerminalText {
  /** The sign before the command. */
  prompt: string
  showEarlier: (n: number) => string
  hideEarlier: string
  exit: (code: number) => string
}

export const terminalText: TerminalText = {
  prompt: '$',
  showEarlier: (n) => `${n} earlier lines`,
  hideEarlier: 'Hide earlier lines',
  exit: (code) => `exit ${code}`,
}

/** Lines starting ✗ or containing "error" read as errors. */
/* test runners indent their results, so a cross counts wherever the line's text starts */
export const looksLikeError = (line: string) => line.trimStart().startsWith('✗') || line.includes('error')

export interface TerminalProps {
  /** The command that ran, as its first line. Leave it out where something above already shows it, like a Tool's row. */
  command?: string
  /** What it printed, line by line: the end of the output, which is where a run says how it went. */
  lines: string[]
  /** What it printed before those, held back until asked for. */
  earlier?: string[]
  exit?: number
  /** A line still being written. */
  live?: string
  /** Which lines read as errors. By default, looksLikeError. */
  isError?: (line: string) => boolean
  text?: Partial<TerminalText>
}

/** What a command printed: its end first, with what came before one click away. */
export function Terminal({ command, lines, earlier = [], exit, live, isError = looksLikeError, text }: TerminalProps) {
  const t = { ...terminalText, ...text }
  const [open, setOpen] = useState(false)
  const said = useContext(ExitShown)
  const code = said ? undefined : exit
  const tone = (l: string) => (isError(l) ? s.err : undefined)
  const line = (l: string, key: string) => (
    <Line key={key} className={tone(l)}>
      {l}
    </Line>
  )
  return (
    <div className={s.term}>
      <pre className={s.out}>
        {command && (
          <Line className={s.command}>
            <span className={s.prompt} aria-hidden="true">
              {t.prompt}{' '}
            </span>
            {command}
          </Line>
        )}
        {earlier.length > 0 && (
          <Line className={s.earlier}>
            <LinkButton aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? t.hideEarlier : t.showEarlier(earlier.length)}
            </LinkButton>
          </Line>
        )}
        {open && earlier.map((l, i) => line(l, `e${i}`))}
        {lines.map((l, i) => line(l, `l${i}`))}
        {live && (
          <span className={s.live}>
            {live}
            <i className={s.cursor} aria-hidden="true" />
          </span>
        )}
      </pre>
      {code !== undefined && (
        <div className={s.foot}>
          <span className={cx(s.exit, code !== 0 && s.bad)}>{t.exit(code)}</span>
        </div>
      )}
    </div>
  )
}

const Line = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={className}>
    {children}
    {'\n'}
  </span>
)
