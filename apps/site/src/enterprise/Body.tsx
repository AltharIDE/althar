import { Brand, BrandMark, Logo } from '@althar/ui'
import type { ReactNode } from 'react'

import { EARLY, JOIN, LINKS, STATUS, WHAT } from '../content/facts'
import { cx } from '../lib/cx'
import { DATE } from '../content/sheet'
import { Define, Revisions, Stamp, StoryKeys } from '../shared/sheet'
import s from './Body.module.css'
import { Crew, Roster } from './Crew'
import { Knowledge } from './Knowledge'
import { PARTS, THESIS, type Part } from '../shared/Masthead'
import { TaskGraph } from './TaskGraph'

/*
 * The page under the site. Each part opens with a strip like a sheet's, its
 * number the one in the bar at the top. What it is, in a few big sentences;
 * the agents, on the crane's plates, changing hands; task 418 as its graph,
 * with the review loop; and where it stands, Set's revisions and stamp, with
 * the ways in as buttons.
 */

function Strip({ part, note }: { part: Part | undefined; note?: string }) {
  return (
    <p className={s.strip}>
      <span className={s.stripNo}>{part?.no}</span>
      <span>{part?.name}</span>
      {note && <span className={s.stripNote}>{note}</span>}
    </p>
  )
}

function Section({ part, note, children, className }: { part: Part | undefined; note?: string; children: ReactNode; className?: string }) {
  return (
    <section id={part?.id} className={cx(s.section, className)} aria-labelledby={`${part?.id}-h`}>
      <Strip part={part} note={note} />
      {children}
    </section>
  )
}

export function Follow({ className }: { className?: string }) {
  return (
    <div className={cx(s.ctas, className)}>
      <a className={s.primary} href={LINKS.repo}>
        <BrandMark brand={Brand.GitHub} size={16} />
        Follow on GitHub
      </a>
      <a className={s.secondary} href={THESIS}>
        Read the thesis <span aria-hidden="true">→</span>
      </a>
    </div>
  )
}

const arch = STATUS.find((m) => m.id === 'arch')

export function Body() {
  const [what, agents, task, knows, stands] = ['what', 'agents', 'task', 'knows', 'stands'].map((id) => PARTS.find((p) => p.id === id))
  const sentences = WHAT.split(/(?<=\.)\s+/)
  return (
    <>
      <Section part={what}>
        <div className={s.whatGrid}>
          <div>
            <h2 id="what-h" className={s.what}>
              {sentences.map((x, i) => (
                <span key={x} className={i === 1 ? s.keeps : i > 1 ? s.soft : undefined}>
                  {x}{' '}
                </span>
              ))}
            </h2>
            <Follow className={s.wideOnly} />
          </div>
          <dl className={cx(s.facts, s.wideOnly)}>
            <div>
              <dt>Open source</dt>
              <dd>From the coordinator to every adapter, under the Apache License 2.0.</dd>
            </div>
            <div>
              <dt>On your machine</dt>
              <dd>{arch?.detail}</dd>
            </div>
            <div>
              <dt>Very early</dt>
              <dd>There is no runnable Althar yet. Now is the time to have a say.</dd>
            </div>
          </dl>
        </div>
      </Section>

      <Section part={agents}>
        <h2 id="agents-h" className={s.h2}>
          It runs the subscriptions you already use.
        </h2>
        <div className={s.agentsGrid}>
          <Crew />
          <div className={s.agentsCopy}>
            <p className={s.lede}>
              Signed in as you, on your own subscriptions. Each agent keeps its own sign-in, so Althar never holds a password or a key.
            </p>
            <p className={cx(s.lede, s.wideOnly)}>
              One task can use several labs, so one checks another, and you can switch agents in the middle of it. The project keeps what
              each one learned.
            </p>
            <Roster />
            <p className={cx(s.fine, s.wideOnly)}>Adapters are planned. None ship yet.</p>
          </div>
        </div>
      </Section>

      <Section part={task} note="Not to scale">
        <div className={s.head}>
          <h2 id="task-h" className={s.h2}>
            One lab writes it. Another checks it, until it passes.
          </h2>
          <p className={cx(s.lede, s.wideOnly)}>
            Task 418, a stale-permissions bug in Meridian, from ticket to note. The lead runs each step and settles what it finds. Review
            and repair go round until the review passes, and only the one call that needs a person comes to you.
          </p>
        </div>
        <figure className={s.sheet}>
          <TaskGraph />
        </figure>
        <StoryKeys className={s.wideOnly} />
      </Section>

      <Section part={knows} note="Graph">
        <div className={s.head}>
          <h2 id="knows-h" className={s.h2}>
            Every task leaves the project knowing more.
          </h2>
          <p className={s.lede}>
            Every note keeps where it came from and what it applies to. A new task starts with the ones that apply, whichever agent takes
            it.
          </p>
        </div>
        <Knowledge />
      </Section>

      <div className={s.band}>
        <Section part={stands}>
          <div className={s.head}>
            <h2 id="stands-h" className={s.h2}>
              {EARLY.title}
            </h2>
            <p className={s.lede}>{EARLY.body}</p>
          </div>
          <ul className={s.ways}>
            {JOIN.map((j, i) => (
              <li key={j.k}>
                <a className={i === 0 ? s.wayMain : s.way} href={j.href === LINKS.thesis ? THESIS : j.href}>
                  {j.k}
                  <span aria-hidden="true">→</span>
                </a>
                <p className={s.wideOnly}>{j.t}</p>
              </li>
            ))}
          </ul>
          <div className={s.issue}>
            <Revisions />
            <div className={s.side}>
              <Stamp />
              <Define className={s.wideOnly} />
            </div>
          </div>
          <p className={s.fine}>{EARLY.licence}</p>
        </Section>
      </div>

      <footer className={s.foot}>
        <span className={s.footBrand}>
          <Logo size={20} /> Althar
        </span>
        <span>Issued for comment · {DATE}</span>
        <span className={s.footLinks}>
          <a href={LINKS.repo}>GitHub</a>
          <a href={THESIS}>Thesis</a>
          <a href={LINKS.issues}>Issues</a>
        </span>
      </footer>
    </>
  )
}
