import { Children, type ReactNode, useId } from 'react'

import { HalftoneMark } from '../../foundations/HalftoneMark/HalftoneMark'
import { Light, type LightMotion } from '../../foundations/Light/Light'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { Heading, type HeadingLevel } from '../../primitives/Heading/Heading'
import s from './HomeRest.module.css'

/*
 * The home at rest: nothing waits on you and nothing is in progress, so in
 * place of three empty sections, Althar's light stands at the foot of the
 * stream and the mark, printed as the launch sets it, stands over it. Under
 * the mark, what is true in a line or two, and whatever the home puts there:
 * the way to a coordinator, or the last few things the loop did.
 *
 * When work comes, it leaves: the light lies down as it does at the launch,
 * the words go up and out, and then the stream can arrive in its place.
 */

export type HomeRestProps = RootProps<
  'section',
  {
    title: string
    /** A line or two under the title. */
    note?: string
    /** Under the words: the ways on from here, or what happened. */
    children?: ReactNode
    /** Work has come: it goes. */
    leaving?: boolean
    /** It has gone, and what replaces it can arrive. */
    onLeft?: () => void
    /** How the light moves while it stands. */
    motion?: LightMotion
    /** The title's rank in the page's outline. */
    headingLevel?: HeadingLevel
  }
>

export function HomeRest({ title, note, children, leaving = false, onLeft, motion, headingLevel = 2, className, ...rest }: HomeRestProps) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={cx(s.rest, leaving && s.leaving, className)} {...rest}>
      <Light {...(motion === undefined ? {} : { motion })} sink={leaving} {...(onLeft === undefined ? {} : { onSunk: onLeft })} />
      <div className={s.words}>
        <HalftoneMark size={136} className={s.mark} />
        {/* Each part arrives on its own as the window opens (screens/Launch). */}
        <Heading level={headingLevel} id={id} className={s.title}>
          <span data-arrive>{title}</span>
        </Heading>
        {note !== undefined && (
          <p className={s.note} data-arrive>
            {note}
          </p>
        )}
        {Children.toArray(children).length > 0 && (
          <div className={s.more} data-arrive>
            {children}
          </div>
        )}
      </div>
    </section>
  )
}
