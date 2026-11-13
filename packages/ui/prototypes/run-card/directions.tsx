import { useState, type ComponentType } from 'react'

import { Button, CopyButton, HoverCard, Icon, IconButton, KeyValues, LinkButton, LiveDot, Spinner } from '@althar/ui'

import { isEnded, type RunState } from './states'
import d from './directions.module.css'

/*
 * Four calmer cards for a run of the project, each a different idea:
 *   A  One row: the card kept, cut to the name, where it answers, and Stop.
 *   B  A line: no box while all is well, like a canvas in the thread; a card only when it fails.
 *   C  A tile: drawn as an output, the whole card opens the page.
 *   D  A fold: the name and the address at rest; the command, when, and its output open in place.
 * In every one the task's title shows only where the place doesn't say it (the
 * project's conversation), the command sits behind the name, and how long it
 * has run is gone.
 */

export interface CardProps {
  state: RunState
  onOpen?: () => void
  onStop?: () => void
  onRunAgain?: () => void
}

export interface Direction {
  key: string
  letter: string
  name: string
  idea: string
  Card: ComponentType<CardProps>
}

export const cx = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ')

/* For screenshots, with the thread alone: &peek opens the hover card on its name, &fold opens D's fold. */
const PARAMS = new URLSearchParams(location.search)
export const PEEK = PARAMS.has('peek') ? { defaultOpen: true } : {}
export const FOLD = PARAMS.has('fold')

export const t = {
  running: 'Running',
  starting: 'Starting',
  failed: 'Failed',
  finished: 'Finished',
  stopped: 'Stopped',
  stop: 'Stop',
  again: 'Run again',
  open: (url: string) => `Open ${url}`,
  started: (at: string) => `Started ${at}`,
  exited: (code: number | null | undefined, since: string) => (code == null ? `Ended ${since}` : `Exited with code ${code}, ${since}`),
  stoppedAt: (since: string) => `Stopped ${since}`,
  details: 'Details',
  hide: 'Hide details',
}

/** Its state, in a word. */
export const wordOf = (s: RunState) => t[s.phase === 'up' ? 'running' : s.phase]

/** What it's called: its name, or its command where it has none. */
export const calledOf = (s: RunState) => s.name ?? s.command

/** When, in a few words: started, or how and when it ended. */
const whenOf = (s: RunState) =>
  s.phase === 'stopped' ? t.stoppedAt(s.since) : isEnded(s) ? t.exited(s.code, s.since) : t.started(s.started)

export const labelOf = (s: RunState) => `${calledOf(s)}, ${wordOf(s).toLowerCase()}`

/** The mark before its name: a still dot while it runs, a spinner while it starts, how it ended after. */
export function Mark({ s, className }: { s: RunState; className?: string }) {
  return (
    <span className={cx(d.mark, className)} aria-hidden="true">
      {s.phase === 'starting' && <Spinner size="small" />}
      {s.phase === 'up' && <LiveDot />}
      {s.phase === 'failed' && <Icon name="close" size={11} className={d.bad} />}
      {s.phase === 'finished' && <Icon name="check" size={11} />}
      {s.phase === 'stopped' && <Icon name="square" size={10} className={d.faint} />}
    </span>
  )
}

/** On pointing at its name: the command whole, and when. */
function Behind({ s }: { s: RunState }) {
  return (
    <span className={d.behind}>
      <code>{s.command}</code>
      <span>
        {whenOf(s)}
        {s.place === 'project' && <> · {s.where}</>}
      </span>
    </span>
  )
}

/** Its name, the command and when on hover or focus. */
function Called({ s, className }: { s: RunState; className?: string }) {
  return (
    <HoverCard card={<Behind s={s} />} width={380} {...PEEK}>
      <span tabIndex={0} className={cx(d.called, s.name === undefined && d.mono, className)}>
        {calledOf(s)}
      </span>
    </HoverCard>
  )
}

/** The last lines it printed, the one that says why brighter. */
function Lines({ s, className }: { s: RunState; className?: string }) {
  if (s.lines === undefined || s.lines.length === 0) return null
  return (
    <span className={cx(d.lines, className)}>
      {s.lines.map((line, i) => (
        <span key={i} className={i === s.why ? d.why : undefined} title={line}>
          {line}
        </span>
      ))}
    </span>
  )
}

/** Where it answers, to open beside the conversation. */
export function Address({ s, onOpen, className }: { s: RunState; onOpen?: (() => void) | undefined; className?: string }) {
  if (s.url === undefined) return null
  return (
    <LinkButton className={cx(d.address, className)} aria-label={t.open(s.url)} onClick={onOpen}>
      {s.url}
      <Icon name="external" size={11} />
    </LinkButton>
  )
}

/** Its state where there's no address to show. */
export function Word({ s, className }: { s: RunState; className?: string }) {
  return <span className={cx(d.word, s.phase === 'failed' && d.bad, className)}>{wordOf(s)}</span>
}

const failedOrDone = (s: RunState) => s.phase === 'failed' || s.phase === 'finished'

/* ---- A · One row ----------------------------------------------------- */

function OneRow({ state: s, onOpen, onStop, onRunAgain }: CardProps) {
  const ended = isEnded(s)
  return (
    <article className={cx(d.aCard, ended && d.ended)} aria-label={labelOf(s)}>
      {s.place === 'project' && <p className={d.aWhere}>{s.where}</p>}
      <div className={d.aRow}>
        <Mark s={s} />
        <Called s={s} className={d.aName} />
        {s.phase === 'up' ? <Address s={s} onOpen={onOpen} /> : <Word s={s} />}
        <span className={d.gap} />
        <LinkButton className={d.act} onClick={ended ? onRunAgain : onStop}>
          {ended ? t.again : t.stop}
        </LinkButton>
      </div>
      {failedOrDone(s) && <Lines s={s} className={d.aLines} />}
    </article>
  )
}

/* ---- B · A line ------------------------------------------------------ */

function TileB({ s }: { s: RunState }) {
  return (
    <span className={cx(d.bTile, s.phase === 'failed' && d.bTileBad)} aria-hidden="true">
      {s.phase === 'starting' ? (
        <Spinner size="small" />
      ) : s.phase === 'failed' ? (
        <Icon name="close" size={12} />
      ) : s.phase === 'finished' ? (
        <Icon name="check" size={12} />
      ) : s.phase === 'stopped' ? (
        <Icon name="square" size={11} />
      ) : (
        <Icon name="terminal" size={13} />
      )}
      {s.phase === 'up' && <LiveDot className={d.bDot} />}
    </span>
  )
}

function ALine({ state: s, onOpen, onStop, onRunAgain }: CardProps) {
  const ended = isEnded(s)
  const failed = s.phase === 'failed'
  const note =
    s.phase === 'finished' ? (
      <span className={cx(d.bNote, d.mono)}>{s.lines?.at(-1)}</span>
    ) : s.place === 'project' ? (
      <span className={d.bNote}>{s.where}</span>
    ) : null
  return (
    <article className={cx(d.bLine, failed && d.bBox, ended && d.ended)} aria-label={labelOf(s)}>
      <TileB s={s} />
      <span className={d.bMain}>
        <span className={d.bHead}>
          <span className={cx(d.bVerb, failed && d.bad)}>{wordOf(s)}</span>
          <Called s={s} className={d.bName} />
          <Address s={s} onOpen={onOpen} />
          <span className={d.gap} />
          <LinkButton className={cx(d.act, !failed && d.bReveal)} onClick={ended ? onRunAgain : onStop}>
            {ended ? t.again : t.stop}
          </LinkButton>
        </span>
        {note}
        {failed && <Lines s={s} className={d.bLines} />}
      </span>
    </article>
  )
}

/* ---- C · A tile ------------------------------------------------------ */

function TileC({ s }: { s: RunState }) {
  return (
    <span className={cx(d.cTile, s.phase === 'failed' && d.cTileBad, isEnded(s) && d.cTileEnded)} aria-hidden="true">
      {s.phase === 'starting' ? (
        <Spinner size="small" />
      ) : s.phase === 'failed' ? (
        <Icon name="close" size={15} />
      ) : s.phase === 'finished' ? (
        <Icon name="check" size={15} />
      ) : s.phase === 'stopped' ? (
        <Icon name="square" size={13} />
      ) : (
        <Icon name="globe" size={17} />
      )}
      {s.phase === 'up' && <LiveDot className={d.cDot} />}
    </span>
  )
}

function ATile({ state: s, onOpen, onStop, onRunAgain }: CardProps) {
  const ended = isEnded(s)
  const opens = s.phase === 'up' && s.url !== undefined
  const title = (
    <span className={cx(d.cTitle, s.name === undefined && d.mono)} title={s.name === undefined ? s.command : undefined}>
      {calledOf(s)}
    </span>
  )
  return (
    <article className={cx(d.cCard, opens && d.cOpens, ended && d.ended)} aria-label={labelOf(s)}>
      <TileC s={s} />
      <span className={d.cMain}>
        {s.place === 'project' && <span className={d.cWhere}>{s.where}</span>}
        {opens ? (
          <HoverCard card={<Behind s={s} />} width={380} {...PEEK}>
            <button type="button" className={d.cOpen} aria-label={t.open(s.url ?? '')} onClick={onOpen}>
              {title}
            </button>
          </HoverCard>
        ) : (
          <HoverCard card={<Behind s={s} />} width={380} {...PEEK}>
            <span tabIndex={0} className={d.cStill}>
              {title}
            </span>
          </HoverCard>
        )}
        <span className={d.cMeta}>
          {opens ? (
            <>
              {s.url}
              <Icon name="external" size={11} />
            </>
          ) : (
            <Word s={s} />
          )}
        </span>
      </span>
      {ended ? (
        <IconButton icon="reload" label={t.again} size="small" tooltip="above" tooltipAlign="end" className={d.cAct} onClick={onRunAgain} />
      ) : (
        <IconButton icon="square" label={t.stop} size="small" tooltip="above" tooltipAlign="end" className={d.cAct} onClick={onStop} />
      )}
      {failedOrDone(s) && <Lines s={s} className={d.cLines} />}
    </article>
  )
}

/* ---- D · A fold ------------------------------------------------------ */

function AFold({ state: s, onOpen, onStop, onRunAgain }: CardProps) {
  const ended = isEnded(s)
  const [open, setOpen] = useState(FOLD)
  const why = s.phase === 'failed' && s.why !== undefined ? s.lines?.[s.why] : undefined
  return (
    <article className={cx(d.dCard, ended && d.ended)} aria-label={labelOf(s)}>
      <div className={d.dHead}>
        <Mark s={s} className={d.dMark} />
        <span className={d.dMain}>
          <span className={cx(d.dName, s.name === undefined && d.mono)} title={s.name === undefined ? s.command : undefined}>
            {calledOf(s)}
          </span>
          <span className={d.dSub}>
            {s.phase === 'up' ? <Address s={s} onOpen={onOpen} /> : <Word s={s} />}
            {why !== undefined && <span className={d.dWhy}>{why}</span>}
            {s.place === 'project' && <span className={d.dWhere}>{s.where}</span>}
          </span>
        </span>
        {ended ? (
          <Button size="small" onClick={onRunAgain}>
            {t.again}
          </Button>
        ) : (
          <Button size="small" variant="quiet" onClick={onStop}>
            {t.stop}
          </Button>
        )}
        <IconButton
          icon={open ? 'chevronU' : 'chevronD'}
          label={open ? t.hide : t.details}
          size="small"
          tooltipAlign="end"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        />
      </div>
      {open && (
        <div className={d.dBody}>
          <KeyValues
            keyWidth={64}
            items={[
              [
                'Command',
                <span key="command" className={d.dCommand}>
                  <code>{s.command}</code>
                  <CopyButton value={s.command} ghost />
                </span>,
              ],
              ...(s.place === 'project' ? [['For', s.where] as const] : []),
              [ended ? 'Ended' : 'Started', ended ? s.since : s.started],
              ...(s.lines === undefined || s.lines.length === 0
                ? []
                : [['Output', <Lines key="output" s={s} className={d.dLines} />] as const]),
            ]}
          />
        </div>
      )}
    </article>
  )
}

export const DIRECTIONS: readonly Direction[] = [
  {
    key: 'a',
    letter: 'A',
    name: 'One row',
    idea: 'The card kept, cut to a row: its name, where it answers, Stop. The command and when are on its name, on hover.',
    Card: OneRow,
  },
  {
    key: 'b',
    letter: 'B',
    name: 'A line',
    idea: 'No box while all is well: a line in the thread, like a canvas or a started task. A card only when it fails.',
    Card: ALine,
  },
  {
    key: 'c',
    letter: 'C',
    name: 'A tile',
    idea: 'Drawn as an output: a tile, its name, its address under it. The whole card opens the page.',
    Card: ATile,
  },
  {
    key: 'd',
    letter: 'D',
    name: 'A fold',
    idea: 'Its name and address at rest; the command, when, and its last lines open in place under the chevron.',
    Card: AFold,
  },
]
