import type { ReactNode } from 'react'

import coordinatorSvg from '../../../../../brand/export/crew/coordinator.svg?url'
import leadSvg from '../../../../../brand/export/crew/lead.svg?url'
import projectSvg from '../../../../../brand/export/crew/project.svg?url'
import stepSvg from '../../../../../brand/export/crew/step.svg?url'
import taskSvg from '../../../../../brand/export/crew/task.svg?url'
import { Handoff } from '../../home/bodies/desktop/Handoff'
import { Plans } from '../../home/bodies/desktop/Plans'
import { Shot } from '../../home/bodies/kit/Shot'
import { Slab } from '../../home/bodies/kit/Slab'
import t from '../../home/bodies/kit/type.module.css'
import { cx } from '../../lib/cx'
import { useCurrent } from '../../lib/useCurrent'
import { LightUnder } from '../../shared/lightUnder'
import { Lit } from '../../shared/Lit'
import { GROUPS, HERE, NEXT } from '../content'
import { CALL, FOLDS, GOES, HAPPENS, HEADS, KICKER, LEAD, NOTE, OWN, PLANS, TITLE } from '../copy'
import { Callout, Carried, Folds, Path, Plate, RuleDemo, ThreadLines } from '../parts'
import { useDocs } from '../view'
import s from './Story.module.css'

/*
 * C · Story. The page told the way the homepage tells Althar: one idea a
 * screen, said large in the first screen's type over a large piece of the
 * app, and under each, a short column for whoever wants the detail. The
 * last idea, the one choice, is the one dark screen, with the thing to try.
 * The docs' home is the crew: five figures, five words.
 */

const SCENES = [
  { id: 'happens', no: '01', label: 'What happens' },
  { id: 'goes', no: '02', label: 'What goes with it' },
  { id: 'plans', no: '03', label: 'Your other plans' },
  { id: 'choose', no: '04', label: 'Your choice' },
] as const
const IDS = SCENES.map((x) => x.id)

function Index() {
  const current = useCurrent(IDS)
  return (
    <nav className={cx(s.index, current === 'choose' && s.indexInk)} aria-label="On this page">
      <ol>
        {SCENES.map((x) => (
          <li key={x.id}>
            <a href={`#${x.id}`} className={cx(x.id === current && s.indexOn)}>
              <span>{x.no}</span>
              {x.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}

function Scene({
  id,
  kicker,
  title,
  lead,
  tone,
  picture,
  children,
}: {
  id: (typeof IDS)[number]
  kicker: string
  title: ReactNode
  lead: ReactNode
  tone?: 'ink'
  picture: ReactNode
  children: ReactNode
}) {
  const x = SCENES.find((y) => y.id === id)
  return (
    <section id={id} className={cx(s.scene, tone === 'ink' && s.ink)} aria-labelledby={`${id}-h`}>
      {tone === 'ink' && <LightUnder tone="ink" className={s.under} />}
      <div className={s.head}>
        <p className={t.kicker}>
          <i aria-hidden="true" />
          <b>{x?.no}</b> {kicker}
        </p>
        <h2 id={`${id}-h`} className={cx(t.title, s.title)}>
          {title}
        </h2>
        <p className={cx(t.lead, s.lead)}>{lead}</p>
      </div>
      <div className={s.picture}>{picture}</div>
      <div className={s.more}>{children}</div>
    </section>
  )
}

export function Page() {
  const { unwritten } = useDocs()
  return (
    <>
      <Lit kicker={KICKER} title={TITLE} lead={LEAD} className={s.lit} />
      <div className={s.story}>
        <div className={s.rail}>
          <Index />
        </div>
        <Scene
          id="happens"
          kicker="What happens"
          title={
            <>
              The plan runs out. <b>The work doesn’t.</b>
            </>
          }
          lead="Halfway through a task, Claude Code’s plan reaches its limit. The next agent you’re signed in to picks it up where it was."
          picture={
            <div className={s.handoff}>
              <Handoff />
            </div>
          }
        >
          {HAPPENS}
          <Callout tone="own">{OWN}</Callout>
        </Scene>

        <Scene
          id="goes"
          kicker="What goes with it"
          title={
            <>
              Same thread, same plan, <b>same branch.</b>
            </>
          }
          lead="Everything Althar keeps for the task goes with it. Only the old agent’s memory stays behind, so the new one reads first."
          picture={
            <div className={s.slab}>
              <Slab
                w={640}
                phoneW={420}
                label="The task’s thread: the lead moved to Codex, and picks up from the task’s record"
                maxScale={1.2}
              >
                <ThreadLines />
              </Slab>
            </div>
          }
        >
          {GOES}
          <Carried />
        </Scene>

        <Scene
          id="plans"
          kicker="Your other plans"
          title={
            <>
              Your second plan <b>waits to be asked.</b>
            </>
          }
          lead="Sign in as many times as you have plans. Taking turns between them is yours to turn on, one project at a time."
          picture={
            <Plate className={s.plans} light={false}>
              <Shot
                w={1060}
                phoneW={380}
                label="Your plans: two for Claude Code, three for Codex, two for OpenCode, in the order work goes in"
                maxScale={1}
                frame={s.plansFrame}
              >
                <Plans />
              </Shot>
            </Plate>
          }
        >
          {PLANS}
          <Callout tone="heads">{HEADS}</Callout>
        </Scene>

        <Scene
          id="choose"
          tone="ink"
          kicker="Your choice"
          title={
            <>
              Move on, wait, <b>or ask you.</b>
            </>
          }
          lead="Each project decides for itself, in its rules under Limits. Try all three, then use the plan up."
          picture={
            <div className={s.demo}>
              <RuleDemo />
            </div>
          }
        >
          <Callout tone="call">{CALL}</Callout>
          <div className={s.onInk}>
            <Callout tone="note">{NOTE}</Callout>
            <Path parts={['Your project', 'Rules', 'Limits']} />
          </div>
        </Scene>
      </div>

      <section className={s.behind} aria-label="Behind the scenes">
        <Folds items={FOLDS} title="Behind the scenes" note="For the curious. You need none of it." />
      </section>

      {NEXT && (
        <a className={s.nextCard} {...unwritten}>
          <span>Next</span>
          <b>{NEXT.name}</b>
          <em>{NEXT.note}</em>
        </a>
      )}
    </>
  )
}

const CREW = [
  {
    name: 'Project',
    src: projectSvg,
    alt: 'The project: a paper cabinet of drawers',
    says: 'The thing that lasts: your repositories, your rules, and everything that happened.',
  },
  {
    name: 'Coordinator',
    src: coordinatorSvg,
    alt: 'The coordinator: a cobalt block with a screen for a face',
    says: 'Who you talk to. It reads the code, plans the work, and never writes it.',
  },
  {
    name: 'Task',
    src: taskSvg,
    alt: 'A task: a card on its own feet',
    says: 'One piece of work, in a worktree of its own, so tasks never trip on each other.',
  },
  {
    name: 'Lead',
    src: leadSvg,
    alt: 'The lead: an ink cylinder with a coffee and a pencil',
    says: 'The agent that owns a task. It builds, then settles what review finds.',
  },
  {
    name: 'Step',
    src: stepSvg,
    alt: 'A step, the reviewer: a paper cylinder with a monocle',
    says: 'Part of a task, like review, each on its own agent and model.',
  },
]

export function Home() {
  const { link, unwritten } = useDocs()
  const behaves = GROUPS.find((g) => g.id === 'behaves')
  const rest = GROUPS.filter((g) => g.id !== 'behaves' && g.id !== 'pieces')
  return (
    <>
      <Lit
        kicker="Docs"
        title={
          <>
            Meet the crew. <b>Then watch it work.</b>
          </>
        }
        lead="Five words explain most of Althar. Learn them first, then see what they do while you aren’t looking."
        className={s.lit}
      />
      <section className={s.crew} aria-labelledby="crew-h">
        <h2 id="crew-h" className={s.rowHead}>
          The pieces
        </h2>
        <ul>
          {CREW.map((c) => (
            <li key={c.name}>
              <a {...unwritten}>
                <img src={c.src} alt={c.alt} width={240} height={224} />
                <b>{c.name}</b>
                <span>{c.says}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      {behaves && (
        <section className={s.behaves} aria-labelledby="behaves-h">
          <div className={s.head}>
            <p className={t.kicker}>
              <i aria-hidden="true" />
              {behaves.name}
            </p>
            <h2 id="behaves-h" className={cx(t.title, s.title)}>
              What it does <b>while you aren’t looking.</b>
            </h2>
          </div>
          <ul className={s.cards}>
            {behaves.pages.map((p) => (
              <li key={p.slug}>
                <a {...(p.slug === HERE ? link('page') : unwritten)} className={cx(s.card, p.slug === HERE && s.cardHere)}>
                  <span className={s.cardQ}>{p.q}</span>
                  <b>{p.name}</b>
                  <em>{p.note}</em>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={s.restRow} aria-label="More">
        {rest.map((g) => (
          <div key={g.id}>
            <b>{g.name}</b>
            <ul>
              {g.pages.map((p) => (
                <li key={p.slug}>
                  <a {...unwritten}>{p.name}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </>
  )
}
