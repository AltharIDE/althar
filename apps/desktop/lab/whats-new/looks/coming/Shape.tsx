import { Brand, BrandMark, Heading, Icon, LiveDot } from '@althar/ui'

import { LINKS } from '../../../../../site/src/content/facts'
import { COMMUNITY } from '../../../../src/renderer/shared/links'
import { ComingPicture } from './Pictures'
import { COMING, type Coming, STAGE_WORD } from './roadmap'
import x from './shape.module.css'

/*
 * Coming next: shape it. Each coming thing as a card with the thing drawn
 * working: what's being built first and largest, the mobile app, then
 * what's next and later. On each, a way to say what you'd need from it, which opens
 * an issue on GitHub with its name filled in: no votes yet, since a vote
 * needs somewhere to be kept. Then where to say what's missing.
 */

/** The one drawn largest: what's being built, 0.11.0's flagship. */
const LEAD = 'Mobile app'

/** Being built, then next, then later, the lead first. */
const ORDER = [...COMING].sort((a, b) => Number(b.title === LEAD) - Number(a.title === LEAD))

/** Where to say what you'd need from one: a new issue, its name filled in. */
const sayFor = (one: Coming) => `${LINKS.issues}/new?title=${encodeURIComponent(`${one.title}: `)}`

function Stage({ one }: { one: Coming }) {
  return (
    <span className={x.stage} data-stage={one.stage}>
      {one.stage === 'now' && <LiveDot pulse />}
      {STAGE_WORD[one.stage]}
    </span>
  )
}

export function Shape() {
  return (
    <div className={x.page}>
      <header className={x.head}>
        <Heading level={1} className={x.title}>
          Shape what’s next
        </Heading>
        <p className={x.why}>What we’re building, and what comes after. Tell us what you’d need from one before it’s built.</p>
      </header>
      <ol className={x.cards}>
        {ORDER.map((one, i) => (
          <li key={one.title} className={i === 0 ? `${x.card} ${x.top}` : x.card}>
            <ComingPicture picture={one.picture} className={x.picture} />
            <div className={x.body}>
              <p className={x.meta}>
                <Stage one={one} />
              </p>
              <Heading level={2} className={x.name}>
                {one.title}
              </Heading>
              <p className={x.detail}>{one.detail}</p>
              <a className={x.say} href={sayFor(one)} target="_blank" rel="noreferrer">
                <Icon name="comment" size={13} />
                Say what you’d need
                <Icon name="external" size={11} className={x.out} />
              </a>
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
