import type { ReactNode } from 'react'

import { Brand } from '../../foundations/brands/brands'
import { Icon } from '../../foundations/Icon/Icon'
import { BrandMark } from '../../foundations/Marks/Marks'
import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { safeHref } from '../../lib/safeHref'
import { Heading } from '../../primitives/Heading/Heading'
import { LiveDot } from '../../primitives/LiveDot/LiveDot'
import x from './ComingNext.module.css'
import { RoadmapPicture, type RoadmapPictureKey } from './RoadmapPicture'

/*
 * Coming next: what's on the roadmap, for the person to shape. Each thing as
 * a card with the thing drawn working, where the kit draws it: the first, what
 * is being built, largest, then what's next and later. On each, where to say
 * what you'd need from it; then where to say what's missing. No dates, and
 * no votes: a vote needs somewhere to be kept.
 */

export type RoadmapStage = 'now' | 'next' | 'later'

export interface RoadmapItem {
  title: string
  detail: string
  stage: RoadmapStage
  picture?: RoadmapPictureKey
  /** Where to say what you'd need from it. */
  say: string
}

export interface ComingNextText {
  title: string
  why: string
  stages: Record<RoadmapStage, string>
  say: string
  missing: string
  missingLine: string
  suggest: string
  talk: string
}

export const comingNextText: ComingNextText = {
  title: 'Shape what’s next',
  why: 'What we’re building, and what comes after. Tell us what you’d need from one before it’s built.',
  stages: { now: 'Being built', next: 'Next', later: 'Later' },
  say: 'Say what you’d need',
  missing: 'What’s missing?',
  missingLine: 'Something you’d want that isn’t here: say what it would do for you.',
  suggest: 'Suggest it on GitHub',
  talk: 'Talk it over on Discord',
}

export type ComingNextProps = RootProps<
  'div',
  {
    /** The first drawn largest: what's being built. */
    items: readonly RoadmapItem[]
    /** Where to suggest something that isn't here, and where to talk it over. */
    suggest: string
    talk: string
    text?: Partial<ComingNextText>
  }
>

function Out({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  const safe = safeHref(href)
  if (safe === undefined) return null
  return (
    <a className={className} href={safe} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

export function ComingNext({ items, suggest, talk, text, className, ...rest }: ComingNextProps) {
  const t = { ...comingNextText, ...text }
  return (
    <div className={cx(x.page, className)} {...rest}>
      <header className={x.head}>
        <Heading level={1} className={x.title}>
          {t.title}
        </Heading>
        <p className={x.why}>{t.why}</p>
      </header>
      <ol className={x.cards}>
        {items.map((one, i) => (
          <li key={one.title} className={cx(x.card, i === 0 && x.top)}>
            {one.picture !== undefined && <RoadmapPicture picture={one.picture} className={x.picture} />}
            <div className={x.body}>
              <p className={x.meta}>
                <span className={x.stage} data-stage={one.stage}>
                  {one.stage === 'now' && <LiveDot pulse />}
                  {t.stages[one.stage]}
                </span>
              </p>
              <Heading level={2} className={x.name}>
                {one.title}
              </Heading>
              <p className={x.detail}>{one.detail}</p>
              <Out href={one.say} className={x.say}>
                <Icon name="comment" size={13} />
                {t.say}
                <Icon name="external" size={11} className={x.out} />
              </Out>
            </div>
          </li>
        ))}
      </ol>
      <section className={x.missing} aria-labelledby="coming-next-missing">
        <span className={x.missingIcon}>
          <Icon name="plus" size={18} />
        </span>
        <span className={x.missingWords}>
          <Heading level={2} id="coming-next-missing" className={x.missingTitle}>
            {t.missing}
          </Heading>
          <span>{t.missingLine}</span>
        </span>
        <Out href={suggest} className={x.way}>
          <BrandMark brand={Brand.GitHub} size={14} />
          {t.suggest}
        </Out>
        <Out href={talk} className={x.way}>
          <Icon name="comment" size={14} />
          {t.talk}
        </Out>
      </section>
    </div>
  )
}
