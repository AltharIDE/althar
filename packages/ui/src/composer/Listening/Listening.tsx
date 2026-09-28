import { useEffect, useState, type ReactNode } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import { ActionButton } from '../../primitives/ActionButton/ActionButton'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import { Popover } from '../../primitives/Popover/Popover'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './Listening.module.css'

/*
 * What the agent is listening to: a pull request it opened, the issue it
 * came from. Things outside the conversation whose events come back into it.
 * The pill floats just above the composer, because what it hears arrives at
 * the end of the thread, where the composer is. Open it to see each source,
 * when it last heard from it, and to stop one.
 *
 * When something arrives the pill says so for a few seconds, then goes back
 * to saying what it listens to. The arrival is also announced politely.
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

export interface ListeningText {
  /** The pill's lead-in, and the list's name. */
  title: string
  /** The pill, listening to more than one source. */
  count: (n: number) => string
  stop: string
  stopLabel: (source: string) => string
}

export const listeningText: ListeningText = {
  title: 'Listening to',
  count: (n) => `${n} sources`,
  stop: 'Stop',
  stopLabel: (source) => `Stop listening to ${source}`,
}

export interface ListeningProps {
  sources: readonly ListenSource[]
  /** Something just arrived. */
  heard?: Heard | null
  /** Stop listening to one source. Without it, the list has no Stop buttons. */
  onStop?: (id: string) => void
  /** A line under the list: what happens to what it hears. */
  note?: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** How long an arrival shows on the pill, in ms, before it goes back to what it listens to. Infinity keeps it. */
  arrivalFor?: number
  text?: Partial<ListeningText>
}

export function Listening({ sources, heard, onStop, note, open, defaultOpen, onOpenChange, arrivalFor = 4200, text }: ListeningProps) {
  const t = { ...listeningText, ...text }
  const [showing, setShowing] = useState<Heard | null>(null)
  const [last, setLast] = useState<Heard['key'] | undefined>(undefined)
  if (heard && heard.key !== last) {
    setLast(heard.key)
    setShowing(heard)
  }
  useEffect(() => {
    if (!showing || !Number.isFinite(arrivalFor)) return
    const timer = window.setTimeout(() => setShowing(null), arrivalFor)
    return () => window.clearTimeout(timer)
  }, [showing, arrivalFor])

  if (!sources.length) return null
  const one = sources.length === 1 ? sources[0] : undefined
  const marks = [...new Set(sources.map((x) => x.mark))]

  return (
    <>
      <Popover
        label={t.title}
        placement="above"
        width={340}
        padded={false}
        initialFocus="panel"
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        className={s.pop}
        trigger={
          <button type="button" className={cx(s.pill, showing && s.heard)}>
            <LiveDot ping urgent={!!showing} />
            {showing ? (
              <span key={showing.key} className={cx(s.text, s.heardText)}>
                {showing.text}
              </span>
            ) : (
              <span key="idle" className={s.text}>
                <span className={s.k}>{t.title}</span>
                <span className={s.glyphs}>
                  {marks.map((m) => (
                    <SourceGlyph key={m ?? 'none'} mark={m} size={11} />
                  ))}
                </span>
                <span className={s.name}>{one ? one.label : t.count(sources.length)}</span>
                {one?.what && <span className={s.what}>· {one.what}</span>}
              </span>
            )}
            <Icon name="chevronD" size={9} className={s.chev} />
          </button>
        }
      >
        <div className={s.head} aria-hidden="true">
          {t.title}
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
                  {x.last && <> · {x.last}</>}
                </span>
              </span>
              {onStop && (
                <ActionButton size="small" className={s.stop} aria-label={t.stopLabel(x.label)} onClick={() => onStop(x.id)}>
                  {t.stop}
                </ActionButton>
              )}
            </li>
          ))}
        </ul>
        {note && <div className={s.note}>{note}</div>}
      </Popover>
      <span aria-live="polite">{showing && <VisuallyHidden>{showing.text}</VisuallyHidden>}</span>
    </>
  )
}

const SourceGlyph = ({ mark, size }: { mark?: Brand; size: number }) =>
  mark ? <BrandMark brand={mark} size={size} /> : <Icon name="globe" size={size} />
