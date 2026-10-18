import { type ReactNode, useMemo, useState } from 'react'

import { Handoff } from '../../home/bodies/desktop/Handoff'
import { cx } from '../../lib/cx'
import { useCurrent } from '../../lib/useCurrent'
import { Lit } from '../../shared/Lit'
import { GROUPS, HERE, PAGES } from '../content'
import { CALL, FOLDS, HAPPENS, HAPPENS_CAPTION, HEADS, NOTE, OWN, PLANS } from '../copy'
import { Callout, Carried, Folds, Path, Plate, RuleDemo, Search } from '../parts'
import { useDocs } from '../view'
import s from './Questions.module.css'

/*
 * D · Questions. The docs asked the way someone new would ask them, and
 * answered first: each page is the question you came with, its answer in a
 * line, then the questions that follow from it, each answered large before
 * it's explained. The docs' home is a search, and the questions people
 * bring, by the moment they bring them.
 */

const ASKED = [
  {
    id: 'stop',
    q: 'Did my task stop?',
    a: (
      <>
        No. It moved to the next agent with room, and <b>carried on from where it stood.</b>
      </>
    ),
  },
  {
    id: 'know',
    q: 'Does the new agent know what was going on?',
    a: (
      <>
        Yes. <b>It reads the task’s record first:</b> the thread, the plan and the branch.
      </>
    ),
  },
  {
    id: 'plans',
    q: 'Will it use my other Claude plan?',
    a: (
      <>
        Not unless you say so. <b>Taking turns between your own plans is off</b> until you turn it on.
      </>
    ),
  },
  {
    id: 'decide',
    q: 'Can I decide each time instead?',
    a: (
      <>
        Yes. Set the project to <b>Ask me</b>, and it waits for you.
      </>
    ),
  },
  {
    id: 'curious',
    q: 'Anything else worth knowing?',
    a: (
      <>
        Only if you’re curious. <b>Open what you like.</b>
      </>
    ),
  },
] as const
const IDS = ASKED.map((x) => x.id)

function Asked({ id, children }: { id: (typeof IDS)[number]; children?: ReactNode }) {
  const x = ASKED.find((y) => y.id === id)
  if (!x) return null
  return (
    <section id={id} className={s.asked} aria-labelledby={`${id}-q`}>
      <h2 id={`${id}-q`} className={s.q}>
        {x.q}
      </h2>
      <p className={s.a}>{x.a}</p>
      {children && <div className={s.why}>{children}</div>}
    </section>
  )
}

export function Page() {
  const current = useCurrent(IDS)
  const { link, unwritten } = useDocs()
  const near = PAGES.filter((p) => p.slug !== HERE && p.implicit).slice(0, 4)
  return (
    <>
      <Lit
        kicker="How it behaves · When an account runs out"
        title={
          <>
            My plan ran out. <b>What now?</b>
          </>
        }
        lead="Usually, nothing. The work moves to the next agent with room and carries on from where it stood. Here’s what that means for you."
        className={s.lit}
      />
      <div className={s.sheet}>
        <nav className={s.qs} aria-label="Questions on this page">
          <p>On this page</p>
          <ol>
            {ASKED.map((x) => (
              <li key={x.id}>
                <a href={`#${x.id}`} aria-current={x.id === current ? 'location' : undefined}>
                  {x.q}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className={s.article}>
          <Asked id="stop">
            {HAPPENS}
            <Plate className={s.wide} caption={HAPPENS_CAPTION}>
              <Handoff />
            </Plate>
            <Callout tone="own">{OWN}</Callout>
          </Asked>

          <Asked id="know">
            <p>
              Everything Althar keeps for the task goes over. The one thing that stays behind is the old agent’s own memory: the new one
              starts a fresh session and reads its way in.
            </p>
            <Carried />
          </Asked>

          <Asked id="plans">
            {PLANS}
            <Callout tone="heads">{HEADS}</Callout>
          </Asked>

          <Asked id="decide">
            <p>
              Each project decides for itself, in its rules under <b>Limits</b>. Here are all three. Pick one, then use the plan up and
              watch what the task does.
            </p>
            <RuleDemo className={s.wideDemo} />
            <Callout tone="call">{CALL}</Callout>
            <Callout tone="note">{NOTE}</Callout>
            <Path parts={['Your project', 'Rules', 'Limits']} />
          </Asked>

          <Asked id="curious">
            <Folds items={FOLDS} title="Behind the scenes" />
          </Asked>

          <section className={s.still} aria-labelledby="still-h">
            <h2 id="still-h">Still wondering about something?</h2>
            <ul>
              {near.map((p) => (
                <li key={p.slug}>
                  <a {...unwritten}>{p.q}</a>
                </li>
              ))}
            </ul>
            <p>
              Or <a href="https://github.com/AltharIDE/althar/issues">ask in an issue</a>: a question we couldn’t answer here is a page we
              should write. · <a {...link('home')}>Every question</a>
            </p>
          </section>
        </article>
      </div>
    </>
  )
}

const MOMENTS: Record<string, string> = {
  start: 'Before you start',
  pieces: 'Getting to know it',
  behaves: 'When something surprised you',
  lookup: 'Looking something up',
}

export function Home() {
  const { link, unwritten } = useDocs()
  const [find, setFind] = useState('')
  const shown = useMemo(() => {
    const words = find.trim().toLowerCase()
    return GROUPS.map((g) => ({
      ...g,
      pages: words ? g.pages.filter((p) => `${p.q} ${p.name} ${p.note}`.toLowerCase().includes(words)) : g.pages,
    })).filter((g) => g.pages.length > 0)
  }, [find])
  return (
    <>
      <Lit
        kicker="Docs"
        title={
          <>
            What would you <b>like to know?</b>
          </>
        }
        lead="Ask it the way you’d ask a friend who already uses Althar. Every page here starts with someone’s question."
        className={s.homeLit}
      >
        <Search tone="glass" placeholder="My plan ran out, what now?" value={find} onChange={setFind} className={s.homeSearch} />
      </Lit>
      <div className={s.moments}>
        {shown.map((g) => (
          <section key={g.id} className={s.moment} aria-labelledby={`m-${g.id}`}>
            <h2 id={`m-${g.id}`}>{MOMENTS[g.id] ?? g.name}</h2>
            <ul>
              {g.pages.map((p) => (
                <li key={p.slug}>
                  <a {...(p.slug === HERE ? link('page') : unwritten)} className={cx(p.slug === HERE && s.momentHere)}>
                    <b>{p.q}</b>
                    <span>{p.name}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {shown.length === 0 && (
          <p className={s.none}>
            Nothing asks that yet. <a href="https://github.com/AltharIDE/althar/issues">Ask us in an issue</a>, and it becomes a page.
          </p>
        )}
      </div>
    </>
  )
}
