import type { ReactNode } from 'react'

import { Handoff } from '../../home/bodies/desktop/Handoff'
import { useNarrow } from '../../home/bodies/kit/Narrow'
import { useCurrent } from '../../lib/useCurrent'
import { cx } from '../../lib/cx'
import { Lit } from '../../shared/Lit'
import { GROUPS, HERE, NEXT, PREV } from '../content'
import { CALL, CHOOSE, FOLDS, GIST, GOES, HAPPENS, HAPPENS_CAPTION, HEADS, KICKER, LEAD, NOTE, OWN, PLANS, SECTIONS, TITLE } from '../copy'
import { Callout, Carried, Folds, Path, Plate, RuleDemo, Search } from '../parts'
import { useDocs } from '../view'
import s from './Reading.module.css'

/*
 * A · Reading. The docs as the thesis's sibling: the title in the site's
 * light, then one sheet, the docs' contents down the side with this page's
 * sections opened under it, and a single reading column. Figures sit in the
 * column on the homepage's panel; the voices stand in the flow.
 */

const IDS = SECTIONS.map((x) => x.id)

function Contents() {
  const { link, unwritten } = useDocs()
  const current = useCurrent(IDS)
  const narrow = useNarrow(1000)
  return (
    <details className={s.contents} open={!narrow || undefined} key={narrow ? 'folded' : 'open'}>
      <summary className={s.contentsHead}>
        Docs <span>· {GROUPS.reduce((n, g) => n + g.pages.length, 0)} pages</span>
      </summary>
      <nav aria-label="Docs">
        {GROUPS.map((g) => (
          <div key={g.id} className={s.group}>
            <p className={s.groupName}>{g.name}</p>
            <ol>
              {g.pages.map((p) =>
                p.slug === HERE ? (
                  <li key={p.slug} className={s.here}>
                    <a {...link('page')} aria-current="page">
                      {p.name}
                    </a>
                    <ol className={s.sections}>
                      {SECTIONS.map((x) => (
                        <li key={x.id}>
                          <a href={`#${x.id}`} aria-current={x.id === current ? 'location' : undefined}>
                            <span>{x.no}</span>
                            {x.title}
                          </a>
                        </li>
                      ))}
                    </ol>
                  </li>
                ) : (
                  <li key={p.slug}>
                    <a {...unwritten}>{p.name}</a>
                  </li>
                ),
              )}
            </ol>
          </div>
        ))}
      </nav>
    </details>
  )
}

function Section({ id, children }: { id: (typeof SECTIONS)[number]['id']; children: ReactNode }) {
  const x = SECTIONS.find((y) => y.id === id)
  if (!x) return null
  return (
    <section id={id} className={s.part} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className={s.h2}>
        <span className={s.no}>{x.no}</span>
        {x.title}
      </h2>
      {children}
    </section>
  )
}

export function Page() {
  const { link, unwritten } = useDocs()
  return (
    <>
      <Lit kicker={KICKER} title={TITLE} lead={LEAD} className={s.lit} />
      <div className={s.sheet}>
        <Contents />
        <article className={s.article}>
          <header className={s.head}>
            <p className={s.lede}>In short</p>
            <p className={s.claim}>{GIST}</p>
            <Path parts={['Your project', 'Rules', 'Limits']} />
          </header>

          <Section id="happens">
            {HAPPENS}
            <Plate className={s.wide} caption={HAPPENS_CAPTION}>
              <Handoff />
            </Plate>
            <Callout tone="own">{OWN}</Callout>
          </Section>

          <Section id="goes">
            {GOES}
            <Carried />
          </Section>

          <Section id="plans">
            {PLANS}
            <Callout tone="heads">{HEADS}</Callout>
          </Section>

          <Section id="choose">
            {CHOOSE}
            <RuleDemo className={s.wideDemo} />
            <Callout tone="call">{CALL}</Callout>
            <Callout tone="note">{NOTE}</Callout>
          </Section>

          <Section id="behind">
            <Folds items={FOLDS} title="Open one, or skip them all" note="For the curious. You need none of it." />
          </Section>

          <nav className={s.turn} aria-label="Next and previous">
            {PREV && (
              <a {...unwritten}>
                <span>Previous</span>
                <b>{PREV.name}</b>
              </a>
            )}
            {NEXT && (
              <a {...unwritten} className={s.next}>
                <span>Next</span>
                <b>{NEXT.name}</b>
              </a>
            )}
          </nav>
          <p className={s.end}>
            Checked against Althar 0.4.0 · <a href="https://github.com/AltharIDE/althar">Edit this page on GitHub</a> ·{' '}
            <a {...link('home')}>All the docs</a>
          </p>
        </article>
      </div>
    </>
  )
}

export function Home() {
  const { link, unwritten } = useDocs()
  return (
    <>
      <Lit
        kicker="Docs"
        title={
          <>
            How Althar works, <b>and what it does on its own.</b>
          </>
        }
        lead="Written for your first day with it. Start at the top, or go straight to whatever just surprised you."
        className={s.homeLit}
      >
        <Search tone="glass" className={s.homeSearch} />
      </Lit>
      <div className={s.map}>
        {GROUPS.map((g, i) => (
          <section key={g.id} className={s.mapGroup} aria-labelledby={`g-${g.id}`}>
            <p className={s.no}>0{i + 1}</p>
            <h2 id={`g-${g.id}`} className={s.mapName}>
              {g.name}
            </h2>
            <p className={s.mapNote}>{g.note}</p>
            <ul>
              {g.pages.map((p) => (
                <li key={p.slug}>
                  <a {...(p.slug === HERE ? link('page') : unwritten)} className={cx(p.slug === HERE && s.mapHere)}>
                    <b>{p.name}</b>
                    <span>{p.note}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}
