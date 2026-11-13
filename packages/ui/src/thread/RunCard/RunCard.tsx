import { Fragment, useRef } from 'react'

import { Icon } from '../../foundations/Icon/Icon'
import { useControlled } from '../../lib/controlled'
import { cx } from '../../lib/cx'
import { commandAtGlance, type CommandOption, readCommand } from '../../lib/runCommand'
import { useStickToBottom } from '../../lib/stick'
import { Button } from '../../primitives/Button/Button'
import { CopyButton } from '../../primitives/CopyButton/CopyButton'
import { IconButton } from '../../primitives/IconButton/IconButton'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { Popover } from '../../primitives/Popover/Popover'
import { Spinner } from '../../primitives/Spinner/Spinner'
import { JumpToLatest } from '../Furniture/Furniture'
import { Terminal } from '../Terminal/Terminal'
import s from './RunCard.module.css'

/*
 * A run of the project Althar started itself, in the thread it was asked for
 * in. At a glance, only what the person acts on: what runs, where it answers,
 * to open, and Stop; how it ended, once it has, with the line that says why,
 * and Run again. Its dot stays still. The command and what it printed are a
 * press away, in a console over the card: the command at its head, read for
 * a person, and its output under it, following the end until the person
 * scrolls up. It stays in the thread once the run is over.
 */

export interface RunCardText {
  starting: string
  failed: string
  finished: string
  stopped: string
  stop: string
  stopLabel: (called: string) => string
  again: string
  againLabel: (called: string) => string
  openLabel: (url: string) => string
  output: string
  outputOf: (called: string) => string
  copy: string
  label: (where: string) => string
}

export const runCardText: RunCardText = {
  starting: 'Starting',
  failed: 'Failed',
  finished: 'Finished',
  stopped: 'Stopped',
  stop: 'Stop',
  stopLabel: (called) => `Stop ${called}`,
  again: 'Run again',
  againLabel: (called) => `Run ${called} again`,
  openLabel: (url) => `Open ${url}`,
  output: 'Output',
  outputOf: (called) => `Output of ${called}`,
  copy: 'Copy command',
  label: (where) => `Run of ${where}`,
}

/** What it printed, for its console: read while the console is open. */
export interface RunOutput {
  /** What it printed so far, the end of it; absent while it is read. */
  readonly text?: string
  /** It couldn't be read, in words. */
  readonly error?: string
}

export interface RunCardProps {
  /** Where it runs, in words: the task's title, the default branch, a branch. It names the card, and shows unless `ownThread`. */
  where: string
  /** It is in its own task's thread, whose header says where it runs already. */
  ownThread?: boolean
  /** What the project keeps it as, in its Run list: Storybook. Without it, what the command runs, at a glance. */
  name?: string
  command: string
  /** Where it answers, as the card says it: localhost:5173. Without it, it is starting. */
  url?: string
  /** It ended: by itself, with its exit code where known and the line that says why; or stopped. */
  ended?: { readonly code: number | null; readonly stopped: boolean; readonly last?: string }
  /** Open where it answers. Without it, the address is plain text. */
  onOpen?: () => void
  /** Stop it. Without it, no Stop. */
  onStop?: () => void
  /** Run it again, once it ended. Without it, no Run again. */
  onRunAgain?: () => void
  /** What it printed. Without it, no console. */
  output?: RunOutput
  /** Its console is open: to read what it printed only while it is. */
  outputOpen?: boolean
  defaultOutputOpen?: boolean
  onOutputOpenChange?: (open: boolean) => void
  className?: string
  text?: Partial<RunCardText>
}

type Phase = 'starting' | 'up' | 'failed' | 'finished' | 'stopped'

const phaseOf = (url: string | undefined, ended: RunCardProps['ended']): Phase =>
  ended === undefined ? (url === undefined ? 'starting' : 'up') : ended.stopped ? 'stopped' : ended.code === 0 ? 'finished' : 'failed'

export function RunCard({
  where,
  ownThread = false,
  name,
  command,
  url,
  ended,
  onOpen,
  onStop,
  onRunAgain,
  output,
  outputOpen,
  defaultOutputOpen = false,
  onOutputOpenChange,
  className,
  text,
}: RunCardProps) {
  const t = { ...runCardText, ...text }
  const [open, setOpen] = useControlled(outputOpen, defaultOutputOpen, onOutputOpenChange)
  const phase = phaseOf(url, ended)
  const called = name ?? commandAtGlance(command)
  const why = phase === 'failed' ? ended?.last : undefined
  return (
    <article className={cx(s.card, ended !== undefined && s.ended, className)} aria-label={t.label(where)}>
      <span className={s.mark} aria-hidden="true">
        {phase === 'starting' && <Spinner size="small" />}
        {phase === 'up' && <LiveDot />}
        {phase === 'failed' && <Icon name="close" size={11} className={s.bad} />}
        {phase === 'finished' && <Icon name="check" size={11} />}
        {phase === 'stopped' && <Icon name="square" size={10} className={s.faint} />}
      </span>
      <span className={s.main}>
        <span className={cx(s.name, name === undefined && s.mono)} title={called}>
          {called}
        </span>
        <span className={s.sub}>
          {phase === 'up' && url !== undefined ? (
            onOpen ? (
              <LinkButton className={s.address} aria-label={t.openLabel(url)} onClick={onOpen}>
                {url}
                <Icon name="external" size={11} />
              </LinkButton>
            ) : (
              <span className={s.address}>{url}</span>
            )
          ) : (
            <span className={cx(s.word, phase === 'failed' && s.bad)}>{t[phase === 'up' ? 'starting' : phase]}</span>
          )}
          {why !== undefined &&
            (output === undefined ? (
              <code className={s.why} title={why}>
                {why}
              </code>
            ) : (
              <button type="button" className={cx(s.why, s.press)} title={why} aria-haspopup="dialog" onClick={() => setOpen(true)}>
                {why}
              </button>
            ))}
          {!ownThread && (
            <span className={s.where} title={where}>
              {where}
            </span>
          )}
        </span>
      </span>
      {ended === undefined && onStop && (
        <Button size="small" variant="quiet" className={s.act} aria-label={t.stopLabel(called)} onClick={onStop}>
          {t.stop}
        </Button>
      )}
      {ended !== undefined && onRunAgain && (
        <Button size="small" className={s.act} aria-label={t.againLabel(called)} onClick={onRunAgain}>
          {t.again}
        </Button>
      )}
      {output !== undefined && (
        <Popover
          label={t.outputOf(called)}
          trigger={<IconButton icon="terminal" label={t.output} size="small" tooltipAlign="end" aria-pressed={open} />}
          placement="below"
          align="end"
          width={544}
          padded={false}
          open={open}
          onOpenChange={setOpen}
        >
          <div className={s.console}>
            <div className={s.head}>
              <ReadCommand command={command} />
              <CopyButton value={command} ghost text={{ copy: t.copy }} className={s.copy} />
            </div>
            <Printed output={output} running={ended === undefined} exit={phase === 'failed' ? (ended?.code ?? undefined) : undefined} />
          </div>
        </Popover>
      )}
    </article>
  )
}

/** An option with its value, kept to a line where it fits. */
function Option({ option }: { option: CommandOption }) {
  return (
    <span className={s.part}>
      <span className={s.flag}>{option.flag}</span>
      {option.value !== undefined && (
        <>
          {option.joined === true ? <span className={s.eq}>=</span> : ' '}
          <span className={s.value}>{option.value}</span>
        </>
      )}
    </span>
  )
}

/** The command as a prompt: the folder it runs in, quiet, then what it runs, in the syntax inks; long, it wraps under its own start. */
function ReadCommand({ command }: { command: string }) {
  const read = readCommand(command)
  return (
    <span className={s.prompt}>
      {read.dir !== undefined && (
        <span className={s.dir} title={read.dir}>
          {read.dir}
        </span>
      )}
      <code className={s.typed}>
        {read.env.map(([key, value]) => (
          <Fragment key={key}>
            <span className={s.part}>
              <span className={s.env}>{key}</span>
              <span className={s.eq}>=</span>
              <span className={s.value}>{value}</span>
            </span>{' '}
          </Fragment>
        ))}
        <span className={s.program}>{read.program}</span>
        {read.words.map((word, i) => (
          <Fragment key={i}> {word}</Fragment>
        ))}
        {read.options.map((option, i) => (
          <Fragment key={i}>
            {' '}
            <Option option={option} />
          </Fragment>
        ))}
      </code>
    </span>
  )
}

/** What it printed, following the end as more comes; scrolled up, it stays put, and Latest goes back down. */
function Printed({ output, running, exit }: { output: RunOutput; running: boolean; exit: number | undefined }) {
  const box = useRef<HTMLDivElement>(null)
  const { atBottom, toBottom } = useStickToBottom(box, 12)
  const lines = (output.text ?? '').split('\n')
  // What follows the last newline is the line still being written.
  const writing = lines.pop() ?? ''
  if (!running && writing !== '') lines.push(writing)
  const reading = output.text === undefined && output.error === undefined
  return (
    <div className={s.printed}>
      <div ref={box} className={s.scroll}>
        <Terminal
          lines={lines}
          {...(running && !reading ? { live: writing } : {})}
          {...(reading ? { loading: true } : {})}
          {...(output.error === undefined ? {} : { error: output.error })}
          {...(exit === undefined ? {} : { exit })}
        />
      </div>
      {!atBottom && <JumpToLatest onJump={toBottom} className={s.latest} />}
    </div>
  )
}
