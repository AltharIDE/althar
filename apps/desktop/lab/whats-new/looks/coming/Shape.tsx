import { type ReactNode, useState } from 'react'

import { Brand, BrandMark, Heading, Icon, LiveDot } from '@althar/ui'

import { LINKS } from '../../../../../site/src/content/facts'
import { COMMUNITY } from '../../../../src/renderer/shared/links'
import { ComingPicture } from './Pictures'
import { COMING, type Coming, STAGE_WORD } from './roadmap'
import x from './shape.module.css'

/*
 * Coming next, 6: shape it. Each coming thing as a card with the thing drawn
 * working, the most wanted first and largest, and a Want this on each that
 * counts the person in at once: the count turns over, a +1 rises from it.
 * Pressed again, it takes it back. Then where to say what's missing. The
 * counts are the lab's, and kept only while the page is open.
 */

const count = new Intl.NumberFormat('en-GB')

/** The most wanted first, as the page opens; a press never moves a card from under the pointer. */
const BY_WANTS = [...COMING].sort((a, b) => b.wants - a.wants)

function Want({ title, wants, wanted, onPress }: { title: string; wants: number; wanted: boolean; onPress: () => void }) {
  const [presses, setPresses] = useState(0)
  return (
    <button
      type="button"
      className={x.want}
      aria-pressed={wanted}
      aria-label={`Want ${title}, ${count.format(wants)} want it`}
      onClick={() => {
        onPress()
        setPresses((n) => n + 1)
      }}
    >
      <Icon name={wanted ? 'check' : 'up'} size={13} />
      <span>{wanted ? 'Wanted' : 'Want this'}</span>
      <span className={x.count}>
        <span key={wants} className={x.number} data-moved={presses > 0 || undefined}>
          {count.format(wants)}
        </span>
      </span>
      {wanted && presses > 0 && (
        <span key={presses} className={x.plus} aria-hidden="true">
          +1
        </span>
      )}
    </button>
  )
}

function Stage({ one }: { one: Coming }) {
  return (
    <span className={x.stage} data-stage={one.stage}>
      {one.stage === 'now' && <LiveDot pulse />}
      {STAGE_WORD[one.stage]}
    </span>
  )
}

export function Shape({ back }: { back?: ReactNode }) {
  const [wanted, setWanted] = useState<ReadonlySet<string>>(new Set())
  const wantsOf = (one: Coming) => one.wants + (wanted.has(one.title) ? 1 : 0)
  const all = COMING.reduce((sum, one) => sum + wantsOf(one), 0)
  const toggle = (title: string) =>
    setWanted((now) => {
      const next = new Set(now)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  return (
    <div className={x.page}>
      {back !== undefined && <div className={x.back}>{back}</div>}
      <header className={x.head}>
        <p className={x.kicker}>Coming next</p>
        <Heading level={1} className={x.title}>
          Shape what’s next
        </Heading>
        <p className={x.why}>
          Press <b>Want this</b> on what you’d use first. The most wanted is on top.
        </p>
        <p className={x.tally}>
          <b>{count.format(all)}</b> wants so far
          {wanted.size > 0 && <span className={x.yours}> · {wanted.size} of them yours</span>}
        </p>
      </header>
      <ol className={x.cards}>
        {BY_WANTS.map((one, i) => (
          <li key={one.title} className={i === 0 ? `${x.card} ${x.top}` : x.card}>
            <ComingPicture picture={one.picture} className={x.picture} />
            <div className={x.body}>
              <p className={x.meta}>
                <span className={x.rank}>{i + 1}</span>
                <Stage one={one} />
              </p>
              <Heading level={2} className={x.name}>
                {one.title}
              </Heading>
              <p className={x.detail}>{one.detail}</p>
              <Want title={one.title} wants={wantsOf(one)} wanted={wanted.has(one.title)} onPress={() => toggle(one.title)} />
            </div>
          </li>
        ))}
      </ol>
      <section className={x.missing} aria-labelledby="missing">
        <span className={x.missingIcon}>
          <Icon name="plus" size={18} />
        </span>
        <span className={x.missingWords}>
          <Heading level={2} id="missing" className={x.missingTitle}>
            What’s missing?
          </Heading>
          <span>Something you’d want that isn’t here: say what it would do for you.</span>
        </span>
        <a className={x.way} href={LINKS.issues} target="_blank" rel="noreferrer">
          <BrandMark brand={Brand.GitHub} size={14} />
          Suggest it on GitHub
        </a>
        <a className={x.way} href={COMMUNITY} target="_blank" rel="noreferrer">
          <Icon name="comment" size={14} />
          Talk it over on Discord
        </a>
      </section>
    </div>
  )
}
