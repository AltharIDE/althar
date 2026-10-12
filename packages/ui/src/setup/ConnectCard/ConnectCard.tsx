import { type ReactNode, useEffect, useRef } from 'react'

import type { Brand } from '../../foundations/brands/brands'
import { Icon, type IconName } from '../../foundations/Icon/Icon'
import { BrandChip, BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import { VisuallyHidden } from '../../primitives/VisuallyHidden/VisuallyHidden'
import s from './ConnectCard.module.css'

/*
 * Connecting a code host or tracker, as a sign-in card: the service's mark,
 * one heading, and one thing to do. First the ways in, stacked, each saying
 * what it needs from you; then each step of the way chosen on its own, with
 * a short pager saying how far along it is; and at the end what the
 * connection can do, with a tick on the mark once it is connected. What a
 * step asks is the consumer's, made of the card's parts (ConnectParts). As
 * a step replaces the one before, the heading takes the focus that went
 * with it, so a screen reader says where the walk is.
 */

export interface ConnectCardText {
  /** The pager, read out: Step 2 of 3. */
  step: (at: number, of: number) => string
  /** The tick on the mark, read out. */
  connected: string
}

export const connectCardText: ConnectCardText = {
  step: (at, of) => `Step ${at} of ${of}`,
  connected: 'Connected',
}

export type ConnectCardProps = RootProps<
  'div',
  {
    brand?: Brand
    /** One heading: Connect GitHub, Type this code on GitHub. */
    title: string
    headingLevel?: HeadingLevel
    /** A line under it: what it is for, or why it stopped working. */
    line?: ReactNode
    /** How far along the way chosen: its steps, and the one it is on, from 0. None on the ways in. */
    pager?: { readonly steps: number; readonly at: number }
    /** Connected: a tick on the mark, and the pager filled. */
    done?: boolean
    /** A quiet note at its foot, under a hairline: where what is given is kept. */
    foot?: ReactNode
    /** What the step asks. */
    children?: ReactNode
    text?: Partial<ConnectCardText>
  }
>

/* Focus went with what was replaced, onto the page's body. */
const focusLost = () => document.activeElement === null || document.activeElement === document.body

/** A walk in to a service, one step at a time, as a sign-in card. */
export function ConnectCard({
  brand,
  title,
  headingLevel = 3,
  line,
  pager,
  done = false,
  foot,
  children,
  text,
  className,
  ...rest
}: ConnectCardProps) {
  const t = { ...connectCardText, ...text }
  const heading = useRef<HTMLHeadingElement>(null)
  const at = pager?.at
  // A step replaced the one that had focus: the heading takes it, and says where the walk is.
  useEffect(() => {
    if (focusLost()) heading.current?.focus()
  }, [title, at])
  return (
    <div className={cx(s.card, className)} {...rest}>
      <div className={cx(s.top, pager !== undefined && s.stepped)}>
        <span className={s.chipWrap}>
          <BrandChip brand={brand} size={pager === undefined ? 52 : 40} className={s.chip} />
          {done && (
            <span className={s.tick}>
              <Icon name="check" size={10} />
              <VisuallyHidden>{t.connected}</VisuallyHidden>
            </span>
          )}
        </span>
        {pager !== undefined && (
          <span className={s.pager}>
            <VisuallyHidden>{t.step(Math.min(pager.at, pager.steps - 1) + 1, pager.steps)}</VisuallyHidden>
            {Array.from({ length: pager.steps }, (_, i) => (
              <span key={i} aria-hidden="true" className={cx(s.page, (done || i < pager.at) && s.past, !done && i === pager.at && s.now)} />
            ))}
          </span>
        )}
        <Heading ref={heading} level={headingLevel} tabIndex={-1} className={s.title}>
          {title}
        </Heading>
        {line !== undefined && <p className={s.line}>{line}</p>}
      </div>
      {children !== undefined && <div className={s.body}>{children}</div>}
      {foot !== undefined && <p className={s.foot}>{foot}</p>}
    </div>
  )
}

export interface ConnectWayOption {
  id: string
  /** What it is: Continue with GitHub, Use gh's sign-in. */
  title: string
  /** What it needs from you, or what it found: Signed in as balazs on this Mac. */
  line: string
  /** Its glyph: the service's own mark, for its own sign-in, else an icon. */
  brand?: Brand
  icon?: IconName
}

export interface ConnectWaysProps {
  /** What the ways are, for a screen reader: Ways to connect GitHub. */
  label: string
  ways: readonly ConnectWayOption[]
  onChoose: (way: string) => void
  className?: string
}

/** The ways in, as wide buttons, stacked: each its glyph, what it is, and what it needs from you. */
export function ConnectWays({ label, ways, onChoose, className }: ConnectWaysProps) {
  return (
    <div role="group" aria-label={label} className={cx(s.ways, className)}>
      {ways.map((way) => (
        <button key={way.id} type="button" className={s.way} onClick={() => onChoose(way.id)}>
          <span className={s.wayGlyph}>
            {way.brand !== undefined ? <BrandMark brand={way.brand} size={17} /> : <Icon name={way.icon ?? 'plug'} size={15} />}
          </span>
          <span className={s.wayWords}>
            <span className={s.wayTitle}>{way.title}</span>
            <span className={s.wayLine}>{way.line}</span>
          </span>
          <Icon name="chevron" size={11} className={s.wayChevron} />
        </button>
      ))}
    </div>
  )
}
