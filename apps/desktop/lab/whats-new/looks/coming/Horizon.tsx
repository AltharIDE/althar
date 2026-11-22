import type { ReactNode } from 'react'

import { Brand, BrandMark, Code, HalftoneMark, Heading, Icon, Light, LiveDot } from '@althar/ui'

import { LINKS } from '../../../../../site/src/content/facts'
import { COMMUNITY } from '../../../../src/renderer/shared/links'
import { ComingPicture } from './Pictures'
import { type Coming, inStage } from './roadmap'
import h from './horizon.module.css'

/*
 * Coming next, 4: on the horizon. It opens as What's new's light does: the
 * mark in halftone over Althar's light, and what's next large. Then what's
 * being built now, each as a wide card with the thing drawn working; what
 * comes next, side by side; and what's further out, dimmer, standing on the
 * light again at the foot, where the person can say what they'd want.
 */

/** What's being built now: its words on one side and the thing working on the other, turn about. */
function NowCard({ one, flip }: { one: Coming; flip: boolean }) {
  return (
    <article className={h.now} data-flip={flip || undefined}>
      <div className={h.nowWords}>
        <p className={h.state}>
          <span className={h.live}>
            <LiveDot pulse />
            Being built
          </span>
          <Code className={h.branch}>{one.branch}</Code>
        </p>
        <Heading level={3} className={h.nowTitle}>
          {one.title}
        </Heading>
        <p className={h.nowDetail}>{one.detail}</p>
      </div>
      <ComingPicture picture={one.picture} className={h.nowPicture} />
    </article>
  )
}

/** What comes next, or later: the thing drawn, then its words. */
function Card({ one, later = false }: { one: Coming; later?: boolean }) {
  return (
    <article className={later ? `${h.card} ${h.later}` : h.card}>
      <ComingPicture picture={one.picture} className={h.cardPicture} />
      <Heading level={3} className={h.cardTitle}>
        {one.title}
      </Heading>
      <p className={h.cardDetail}>{one.detail}</p>
    </article>
  )
}

export function Horizon({ back }: { back?: ReactNode }) {
  const now = inStage('now')
  return (
    <div className={h.page}>
      <header className={h.hero}>
        <div className={h.glow}>
          <Light height={0.56} motion="drift" />
        </div>
        {back !== undefined && <div className={h.back}>{back}</div>}
        <div className={h.heroIn}>
          <HalftoneMark size={52} />
          <p className={h.eyebrow}>
            <span className={h.chip}>
              <LiveDot pulse />
              {now.length === 1 ? `${now[0]?.title ?? ''}, being built now` : `${now.length} being built now`}
            </span>
          </p>
          <Heading level={1} className={h.title}>
            What’s next <span className={h.titleLit}>for Althar</span>
          </Heading>
          <p className={h.why}>What’s being built now, what comes after it, and what’s further out. Nothing here has a date yet.</p>
        </div>
      </header>

      <section className={h.band} aria-labelledby="now">
        <Heading level={2} id="now" className={h.kicker}>
          Being built now
        </Heading>
        <div className={h.nows}>
          {now.map((one, i) => (
            <NowCard key={one.title} one={one} flip={i % 2 === 1} />
          ))}
        </div>
      </section>

      <section className={h.band} aria-labelledby="next">
        <Heading level={2} id="next" className={h.sectionTitle}>
          Next
        </Heading>
        <div className={h.cards}>
          {inStage('next').map((one) => (
            <Card key={one.title} one={one} />
          ))}
        </div>
      </section>

      <section className={h.horizon} aria-labelledby="later">
        <div className={h.horizonGlow}>
          <Light height={0.5} motion="drift" />
        </div>
        <div className={h.horizonIn}>
          <Heading level={2} id="later" className={h.sectionTitle}>
            Later, on the horizon
          </Heading>
          <div className={h.cards}>
            {inStage('later').map((one) => (
              <Card key={one.title} one={one} later />
            ))}
          </div>
          <div className={h.say}>
            <span className={h.sayWords}>
              <b>Something you’d want first?</b>
              <span>Say so where the work is talked over.</span>
            </span>
            <a className={h.sayWay} href={LINKS.issues} target="_blank" rel="noreferrer">
              <BrandMark brand={Brand.GitHub} size={14} />
              Suggest it on GitHub
            </a>
            <a className={h.sayWay} href={COMMUNITY} target="_blank" rel="noreferrer">
              <Icon name="comment" size={14} />
              Talk it over on Discord
            </a>
          </div>
        </div>
      </section>
    </div>
  )
}
