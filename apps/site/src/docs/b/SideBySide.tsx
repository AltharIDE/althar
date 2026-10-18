import { Light } from '@althar/ui'
import type { ReactNode } from 'react'

import { Handoff } from '../../home/bodies/desktop/Handoff'
import { Plans } from '../../home/bodies/desktop/Plans'
import { Launch } from '../../home/bodies/kit/app'
import { useNarrow } from '../../home/bodies/kit/Narrow'
import { Shot } from '../../home/bodies/kit/Shot'
import { cx } from '../../lib/cx'
import { useCurrent } from '../../lib/useCurrent'
import { GROUPS, HERE } from '../content'
import { CALL, CHOOSE, FOLDS, GIST, GOES, HAPPENS, HEADS, KICKER, LEAD, NOTE, OWN, PLANS, SECTIONS, TITLE } from '../copy'
import { Callout, Carried, Folds, Path, RuleDemo, Search, ThreadLines } from '../parts'
import { useDocs } from '../view'
import s from './SideBySide.module.css'

/*
 * B · Side by side. Words on the left, the app on the right: the homepage's
 * stage in Althar's light stays beside the page as it scrolls, and shows
 * the piece of the app each section is about, the last one to try. The
 * docs' pages stand down the left edge. Narrower, each piece follows its
 * section instead.
 */

type Id = (typeof SECTIONS)[number]['id']
const IDS = SECTIONS.map((x) => x.id)

function piece(id: Id, on: boolean): ReactNode {
  switch (id) {
    case 'happens':
      return (
        <Shot w={900} phoneW={380} label="Task 431 on one morning: Claude Code runs out at 11:31 and Codex carries it on" maxScale={1}>
          <div className={s.bare}>
            <Handoff play={on} />
          </div>
        </Shot>
      )
    case 'goes':
      return (
        <Shot w={640} label="The task’s thread: the lead moved to Codex, and picks up from the task’s record" maxScale={1}>
          <ThreadLines />
        </Shot>
      )
    case 'plans':
      return (
        <Shot
          w={1060}
          phoneW={380}
          label="Your plans: two for Claude Code, three for Codex, two for OpenCode, in the order work goes in"
          maxScale={1}
        >
          <Plans play={on} />
        </Shot>
      )
    case 'choose':
    case 'behind':
      return <RuleDemo />
  }
}

/** The docs' pages, down the left edge. */
function Side() {
  const { link, unwritten, p: screen } = useDocs()
  return (
    <nav className={s.side} aria-label="Docs">
      <a {...link('home')} className={cx(s.sideHome, screen === 'home' && s.sideOn)}>
        Overview
      </a>
      {GROUPS.map((g) => (
        <div key={g.id} className={s.sideGroup}>
          <p>{g.name}</p>
          <ul>
            {g.pages.map((p) => (
              <li key={p.slug}>
                {p.slug === HERE ? (
                  <a {...link('page')} className={cx(screen === 'page' && s.sideOn)} aria-current={screen === 'page' ? 'page' : undefined}>
                    {p.name}
                  </a>
                ) : (
                  <a {...unwritten}>{p.name}</a>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function Section({ id, narrow, children }: { id: Id; narrow: boolean; children: ReactNode }) {
  const x = SECTIONS.find((y) => y.id === id)
  if (!x) return null
  return (
    <section id={id} className={s.part} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className={s.h2}>
        <span>{x.no}</span>
        {x.title}
      </h2>
      {children}
      {narrow && id !== 'behind' && <div className={s.inline}>{piece(id, true)}</div>}
    </section>
  )
}

export function Page() {
  const current = useCurrent(IDS) as Id
  const narrow = useNarrow(1100)
  return (
    <div className={s.frame}>
      <Side />
      <article className={s.article}>
        <header className={s.head}>
          <Path parts={['Docs', KICKER, 'When an account runs out']} />
          <h1 className={s.title}>{TITLE}</h1>
          <p className={s.lead}>{LEAD}</p>
          <p className={s.gist}>{GIST}</p>
        </header>
        <Section id="happens" narrow={narrow}>
          {HAPPENS}
          <Callout tone="own">{OWN}</Callout>
        </Section>
        <Section id="goes" narrow={narrow}>
          {GOES}
          <Carried />
        </Section>
        <Section id="plans" narrow={narrow}>
          {PLANS}
          <Callout tone="heads">{HEADS}</Callout>
        </Section>
        <Section id="choose" narrow={narrow}>
          {CHOOSE}
          <Callout tone="call">{CALL}</Callout>
          <Callout tone="note">{NOTE}</Callout>
          <Path parts={['Your project', 'Rules', 'Limits']} />
        </Section>
        <Section id="behind" narrow={narrow}>
          <Folds items={FOLDS} title="For the curious" />
        </Section>
        <p className={s.end}>Checked against Althar 0.4.0 · Edit this page on GitHub</p>
      </article>
      {!narrow && (
        <aside className={s.stage} aria-label="What it looks like in Althar">
          <div className={s.panel}>
            <div className={s.light} aria-hidden="true">
              <Light height={0.6} />
            </div>
            <p className={s.stageLabel}>
              <i aria-hidden="true" />
              {current === 'choose' || current === 'behind' ? 'Try it' : 'In Althar'}
            </p>
            {SECTIONS.filter((x) => x.id !== 'behind').map((x) => {
              const on = x.id === current || (x.id === 'choose' && current === 'behind')
              return (
                <div key={x.id} className={cx(s.piece, on && s.on)} aria-hidden={!on || undefined} inert={!on || undefined}>
                  {piece(x.id, on)}
                </div>
              )
            })}
          </div>
        </aside>
      )}
    </div>
  )
}

const START = [
  {
    name: 'Install and sign in',
    note: 'Your agents sign in with their own tools. Add as many plans as you have.',
    here: false,
    picture: (
      <Shot w={1060} label="Your agents and their plans" maxScale={1}>
        <Plans play />
      </Shot>
    ),
  },
  {
    name: 'Your first task',
    note: 'Say what you want. The coordinator plans it and picks who does each step.',
    here: false,
    picture: (
      <Shot w={760} label="The coordinator’s plan for a task, a model for each step" maxScale={1}>
        <Launch />
      </Shot>
    ),
  },
  {
    name: 'When an account runs out',
    note: 'The work moves on, waits for the reset, or asks you. The project decides.',
    here: true,
    picture: (
      <Shot w={900} label="A task moving from Claude Code to Codex at its limit" maxScale={1}>
        <div className={s.bare}>
          <Handoff play />
        </div>
      </Shot>
    ),
  },
]

export function Home() {
  const { link, unwritten } = useDocs()
  return (
    <div className={s.frame}>
      <Side />
      <div className={s.homeMain}>
        <header className={s.homeHead}>
          <p className={s.kicker}>
            <i aria-hidden="true" />
            Docs
          </p>
          <h1 className={s.title}>
            How Althar works, <b>shown as it works.</b>
          </h1>
          <p className={s.lead}>Every page puts the words beside the app itself, so you know what you’ll see before you see it.</p>
          <Search className={s.homeSearch} />
        </header>

        <section className={s.start} aria-labelledby="start-h">
          <h2 id="start-h" className={s.rowHead}>
            Start here
          </h2>
          <ul className={s.cards}>
            {START.map((c) => (
              <li key={c.name}>
                <a className={s.card} {...(c.here ? link('page') : unwritten)}>
                  <div className={s.cardPicture} aria-hidden="true">
                    <div className={s.cardLight}>
                      <Light height={0.6} motion="still" />
                    </div>
                    <div className={s.cardShot}>{c.picture}</div>
                  </div>
                  <b>{c.name}</b>
                  <span>{c.note}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className={s.all} aria-labelledby="all-h">
          <h2 id="all-h" className={s.rowHead}>
            Everything
          </h2>
          <div className={s.groups}>
            {GROUPS.map((g) => (
              <div key={g.id} className={s.allGroup}>
                <b>{g.name}</b>
                <p>{g.note}</p>
                <ul>
                  {g.pages.map((p) => (
                    <li key={p.slug}>
                      <a {...(p.slug === HERE ? link('page') : unwritten)}>{p.name}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
