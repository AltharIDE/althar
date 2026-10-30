import { useEffect, useState } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { LinkButton } from '../../primitives/LinkButton/LinkButton'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { Popover } from '../../primitives/Popover/Popover'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import { type RunningProcess, RunningList, type RunningText, runningText } from '../Running/Running'
import s from './Behind.module.css'

/*
 * What goes on behind a task, outside its conversation, as one chip on the
 * composer's top edge: why it waits, what it left running, and what it
 * listens to. One chip, so nothing stacks over the field or the thread; each
 * part says only its name, and the rest opens in one popover: who holds the
 * places it waits for, each thing running with where it answers, and each
 * source with when it last heard from it.
 *
 * What finished well isn't counted on the chip, and folds away in the list;
 * a failure is named. Where nothing else is left to say, the chip stays as a
 * quiet count of what finished, so its output can still be read and cleared. As the composer narrows, the parts drop what they add
 * (where it stands, where it answers), then their names, down to glyphs; what
 * runs gives way first, so the wait and the sources keep theirs. When
 * something arrives, the source's part says it for a few seconds, and it is
 * announced politely.
 */

export interface ListenSource {
  id: string
  /** The service's mark. Without one, a generic glyph. */
  mark?: Brand
  /** What it is: PR 1206, MER-431. */
  label: string
  /** Where it lives: the repository, the team. */
  where?: string
  /** What it is listening for. */
  what?: string
  /** When it last heard something. */
  last?: string
}

export interface Heard {
  /** Changes with each arrival, so the same words can arrive twice. */
  key: string | number
  text: string
}

/** A task that holds a place the waiting one waits for. */
export interface BehindHolder {
  id: string
  /** The task, by its title. */
  title: string
  /** What it left running, by name, where only that keeps the place; without it, its agent is at work. */
  keptBy?: readonly string[]
  /** Its servers can be stopped from here, to free the place. */
  stoppable?: boolean
}

export interface BehindWait {
  /** Where it stands in its line: 2nd in Up next. */
  place?: string
  holders: readonly BehindHolder[]
}

export interface BehindText {
  /** The popover's name. */
  title: string
  waiting: string
  /** Under a task that holds a place only by what it left running: what that is, by name, or how many. */
  keptBy: (names: readonly string[]) => string
  stopKept: string
  stopKeptLabel: (title: string) => string
  front: string
  /** The running part, with more than one. */
  running: (n: number) => string
  /** The running part, with nothing running and more than one failed. */
  failed: (n: number) => string
  /** The running part, with nothing running and one failed: Site tests exited 1. */
  exitedOne: (name: string, code: number | null) => string
  /** What finished well, folded. */
  finished: (n: number) => string
  show: string
  hide: string
  clearFinished: string
  listening: string
  /** The sources' part, with more than one. */
  sources: (n: number) => string
  stopListening: string
  stopListeningLabel: (source: string) => string
}

export const behindText: BehindText = {
  title: 'Behind this task',
  waiting: 'Waiting for a place',
  keptBy: (names) => `${names.length === 1 ? names[0] : names.length} left running`,
  stopKept: 'Stop',
  stopKeptLabel: (title) => `Stop what ${title} left running`,
  front: 'Move to the front of the line',
  running: (n) => `${n} running`,
  failed: (n) => `${n} failed`,
  exitedOne: (name, code) => `${name} ${runningText.exited(code)}`,
  finished: (n) => `${n} finished`,
  show: 'Show',
  hide: 'Hide what finished',
  clearFinished: 'Clear them',
  listening: 'Listening to',
  sources: (n) => `${n} sources`,
  stopListening: 'Stop',
  stopListeningLabel: (source) => `Stop listening to ${source}`,
}

export interface BehindProps {
  /** Why it waits, where it waits for a place. */
  wait?: BehindWait | null
  /** Stop what a holder left running, freeing its place. */
  onStopHeld?: (id: string) => void
  /** Put the task at the front of its line; absent where it is first, or not in one. */
  onFront?: () => void
  /** What it left running, and what ran and ended. */
  processes?: readonly RunningProcess[]
  onStop?: (id: string) => void
  onDismiss?: (id: string) => void
  onOutput?: (id: string) => void
  onOpenUrl?: (id: string) => void
  /** What it listens to. */
  sources?: readonly ListenSource[]
  /** Something just arrived from one. */
  heard?: Heard | null
  onStopListening?: (id: string) => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** How long an arrival shows on the chip, in ms. Infinity keeps it. */
  arrivalFor?: number
  text?: Partial<BehindText>
  runningText?: Partial<RunningText>
}

/** An exit that went wrong, as far as it is known. */
const bad = (p: RunningProcess) => p.exited !== undefined && p.exited !== null && p.exited !== 0
const calledOf = (p: RunningProcess) => p.name ?? p.label ?? p.command

export function Behind({
  wait = null,
  onStopHeld,
  onFront,
  processes = [],
  onStop,
  onDismiss,
  onOutput,
  onOpenUrl,
  sources = [],
  heard,
  onStopListening,
  open,
  defaultOpen,
  onOpenChange,
  arrivalFor = 4200,
  text,
  runningText: ranText,
}: BehindProps) {
  const t = { ...behindText, ...text }
  const r = { ...runningText, ...ranText }
  const [showing, setShowing] = useState<Heard | null>(null)
  const [last, setLast] = useState<Heard['key'] | undefined>(undefined)
  const [unfolded, setUnfolded] = useState(false)
  if (heard && heard.key !== last) {
    setLast(heard.key)
    setShowing(heard)
  }
  useEffect(() => {
    if (!showing || !Number.isFinite(arrivalFor)) return
    const timer = window.setTimeout(() => setShowing(null), arrivalFor)
    return () => window.clearTimeout(timer)
  }, [showing, arrivalFor])

  const live = processes.filter((p) => p.exited === undefined)
  const failed = processes.filter(bad)
  const fine = processes.filter((p) => p.exited !== undefined && !bad(p))
  const ran = live.length > 0 || failed.length > 0
  // Only what finished well, and nothing else to say: a quiet count, the way to its output.
  const quiet = !ran && fine.length > 0 && wait === null && sources.length === 0
  const folded = !unfolded && (live.length > 0 || failed.length > 0)
  const heardNow = sources.length > 0 ? showing : null
  if (wait === null && !ran && !quiet && sources.length === 0) return null

  const one = live.length === 1 ? live[0] : undefined
  const marks = [...new Set(sources.map((x) => x.mark))]
  const ranWords = quiet
    ? t.finished(fine.length)
    : live.length > 0
      ? one
        ? calledOf(one)
        : t.running(live.length)
      : failed.length === 1
        ? t.exitedOne(calledOf(failed[0]!), failed[0]!.exited ?? null)
        : t.failed(failed.length)
  const sourceWords = sources.length === 1 ? sources[0]!.label : t.sources(sources.length)
  // The chip says it whole to a screen reader, however much of it the width shows.
  const said = [
    wait !== null && [t.waiting, wait.place].filter(Boolean).join(', '),
    ran && [ranWords, one?.url, live.length > 0 && failed.length > 0 && t.failed(failed.length)].filter(Boolean).join(', '),
    quiet && ranWords,
    sources.length > 0 && `${t.listening} ${sourceWords}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className={s.behind}>
      <Popover
        label={t.title}
        placement="above"
        align="start"
        width={420}
        padded={false}
        initialFocus="panel"
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        className={s.pop}
        trigger={
          <button type="button" className={cx(s.chip, heardNow && s.heard)} aria-label={said}>
            {wait !== null && (
              <span className={s.part}>
                <Icon name="clock" size={12} className={s.glyph} />
                <span className={s.waiting}>{t.waiting}</span>
                {wait.place !== undefined && <span className={cx(s.aside, s.extra)}>{wait.place}</span>}
              </span>
            )}
            {ran && (
              <span className={cx(s.part, s.ran)}>
                {live.length > 0 ? <LiveDot /> : <Icon name="terminal" size={11} className={s.glyph} />}
                <span className={cx(s.name, live.length === 0 && s.bad)} title={one?.command}>
                  {ranWords}
                </span>
                {one?.url !== undefined && <span className={cx(s.aside, s.extra)}>· {one.url}</span>}
                {live.length > 0 && failed.length > 0 && <span className={s.badDot} />}
              </span>
            )}
            {quiet && (
              <span className={s.part}>
                <Icon name="terminal" size={11} className={s.glyph} />
                <span className={s.aside}>{ranWords}</span>
              </span>
            )}
            {sources.length > 0 && (
              <span className={cx(s.part, heardNow && s.said)}>
                {heardNow ? (
                  <>
                    <LiveDot ping urgent />
                    <span key={heardNow.key} className={cx(s.name, s.arrived)}>
                      {heardNow.text}
                    </span>
                  </>
                ) : (
                  <>
                    <span className={s.marks}>
                      {marks.map((mark) => (
                        <SourceGlyph key={mark ?? 'none'} mark={mark} size={11} />
                      ))}
                    </span>
                    <span className={s.name}>{sourceWords}</span>
                  </>
                )}
              </span>
            )}
            <Icon name="chevronD" size={9} className={s.chev} />
          </button>
        }
      >
        {wait !== null && (
          <section className={s.section} aria-label={t.waiting}>
            <div className={s.head} aria-hidden="true">
              {t.waiting}
              {wait.place !== undefined && <span className={s.headAside}>{wait.place}</span>}
            </div>
            {wait.holders.length > 0 && (
              <ul className={s.list}>
                {wait.holders.map((holder) => (
                  <li key={holder.id} className={s.holder}>
                    <span className={s.holderGlyph}>{holder.keptBy === undefined ? <LiveDot /> : <Icon name="terminal" size={11} />}</span>
                    <span className={s.holderMain}>
                      <span className={s.holderTitle} title={holder.title}>
                        {holder.title}
                      </span>
                      {holder.keptBy !== undefined && <span className={s.holderMeta}>{t.keptBy(holder.keptBy)}</span>}
                    </span>
                    {holder.keptBy !== undefined && holder.stoppable && onStopHeld && (
                      <ActionButton size="small" aria-label={t.stopKeptLabel(holder.title)} onClick={() => onStopHeld(holder.id)}>
                        {t.stopKept}
                      </ActionButton>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {onFront && (
              <div className={s.foot}>
                <LinkButton onClick={onFront}>{t.front}</LinkButton>
              </div>
            )}
          </section>
        )}
        {processes.length > 0 && (
          <section className={s.section} aria-label={live.length > 0 ? r.title : r.ran}>
            <div className={s.head} aria-hidden="true">
              {live.length > 0 ? r.title : r.ran}
            </div>
            <RunningList
              processes={folded ? [...live, ...failed] : [...live, ...failed, ...fine]}
              onStop={onStop}
              onDismiss={onDismiss}
              onOutput={onOutput}
              onOpenUrl={onOpenUrl}
              text={ranText}
            />
            {fine.length > 0 && (
              <div className={s.foot}>
                {(live.length > 0 || failed.length > 0) && (
                  <LinkButton onClick={() => setUnfolded(!unfolded)}>
                    {unfolded ? t.hide : `${t.finished(fine.length)} · ${t.show}`}
                  </LinkButton>
                )}
                {onDismiss && <LinkButton onClick={() => fine.forEach((p) => onDismiss(p.id))}>{t.clearFinished}</LinkButton>}
              </div>
            )}
          </section>
        )}
        {sources.length > 0 && (
          <section className={s.section} aria-label={t.listening}>
            <div className={s.head} aria-hidden="true">
              {t.listening}
            </div>
            <ul className={s.list}>
              {sources.map((x) => (
                <li className={s.row} key={x.id}>
                  <span className={s.rowGlyph}>
                    <SourceGlyph mark={x.mark} size={13} />
                  </span>
                  <span className={s.rowMain}>
                    <span className={s.rowTitle}>
                      {x.label}
                      {x.where && <span className={s.rowWhere}>{x.where}</span>}
                    </span>
                    <span className={s.rowMeta}>
                      {x.what}
                      {x.what && x.last && ' · '}
                      {x.last}
                    </span>
                  </span>
                  {onStopListening && (
                    <ActionButton size="small" aria-label={t.stopListeningLabel(x.label)} onClick={() => onStopListening(x.id)}>
                      {t.stopListening}
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </Popover>
      <span aria-live="polite">{heardNow && <VisuallyHidden>{heardNow.text}</VisuallyHidden>}</span>
    </div>
  )
}

const SourceGlyph = ({ mark, size }: { mark?: Brand | undefined; size: number }) =>
  mark ? <BrandMark brand={mark} size={size} /> : <Icon name="globe" size={size} />
