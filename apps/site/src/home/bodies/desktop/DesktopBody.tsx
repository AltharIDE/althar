import { Light, Turn, WorkedFor, You } from '@althar/ui'
import { type ReactNode, useRef } from 'react'

import { LINKS } from '../../../content/facts'
import { cx } from '../../../lib/cx'
import { Get } from '../../../shared/Close'
import { DOCS_PLAN, HomeWindow, IslandOpen, Launch, ProjectWindow, TwoLabReview, useAssembling } from '../kit/app'
import { EdgeTour } from '../kit/EdgeTour'
import { Desktop, MacWindow } from '../kit/Mac'
import { useSeen } from '../kit/seen'
import { Shot } from '../kit/Shot'
import t from '../kit/type.module.css'
import s from './DesktopBody.module.css'
import { Flow } from './Flow'
import { Handoff } from './Handoff'
import { Plans } from './Plans'

/*
 * Desktop: the product, shown. One claim a screen, in the first screen's
 * type, each over a large picture of the app drawn by its own components:
 * whole windows on a Mac's screen for the big things, single pieces up
 * close in Althar's light for the rest. Pictures of the app on a screen,
 * framed as one, so nothing looks like it is part of this page.
 */

function Scene({
  id,
  kicker,
  title,
  lead,
  children,
  tone,
}: {
  id: string
  kicker: string
  title: ReactNode
  lead: ReactNode
  children: ReactNode
  tone?: 'ink'
}) {
  return (
    <section id={id} className={cx(s.scene, tone === 'ink' && s.ink)} aria-labelledby={`${id}-h`}>
      <div className={s.head}>
        <p className={t.kicker}>
          <i aria-hidden="true" />
          {kicker}
        </p>
        <h2 id={`${id}-h`} className={t.title}>
          {title}
        </h2>
        <p className={t.lead}>{lead}</p>
      </div>
      {children}
    </section>
  )
}

/** A Mac's screen: the picture of a desktop, in a thin black bezel. */
function Screen({
  children,
  label,
  phone,
}: {
  children: ReactNode
  label: string
  phone?: { x: number; y: number; w: number; h: number }
}) {
  return (
    <div className={s.screenWrap}>
      <div className={s.bezel}>
        <Shot w={1440} h={900} phone={phone} label={label} frame={s.screen}>
          {children}
        </Shot>
      </div>
    </div>
  )
}

/** A piece of the app up close, floating in Althar's light. */
function Close({
  children,
  label,
  w = 720,
  phoneW = 400,
  wide,
}: {
  children: ReactNode
  label: string
  w?: number
  phoneW?: number
  wide?: boolean
}) {
  return (
    <div className={cx(s.closeUp, wide && s.wide)}>
      <div className={s.lit} aria-hidden="true">
        <Light height={0.5} />
      </div>
      <Shot w={w} phoneW={phoneW} label={label} maxScale={1.35} frame={s.card}>
        <div className={s.pad}>{children}</div>
      </Shot>
    </div>
  )
}

/*
 * The coordinator: the project's one conversation, alone, down the middle
 * of the window. You ask for two things; it reads the repositories and your
 * rules, says what it makes of it, and puts a team on each task, a step at a
 * time. The first plan lifts out of the window toward you.
 */
function CoordinatorScene() {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useSeen(ref)
  const steps = useAssembling(seen)
  const docs = useAssembling(seen && steps.length >= 4, DOCS_PLAN)
  const thread = (
    <>
      <You at="10:58">
        Backfill idempotency keys on the refunds made before PR 1184 (it’s MER-231), and fix the refunds docs while you’re there.
      </You>
      <Turn voice="Meridian’s coordinator" at="10:59">
        <WorkedFor took="14s" summary="Read meridian-api, meridian-web and Meridian’s rules">
          <p className={s.said}>Read 3 repositories, MER-231 and the project’s rules.</p>
        </WorkedFor>
        <p className={s.said}>
          Two tasks. The backfill writes to money records, so your security review applies and a second lab reviews it. The docs are small:
          Codex writes them, Sonnet reads them over. Change anyone before they start.
        </p>
      </Turn>
      <Launch steps={steps} />
      {docs.length > 0 && <Launch task="433" title="Fix the refunds docs" steps={docs} from={false} estimate="About 10 min" />}
    </>
  )
  return (
    <div ref={ref} className={s.team}>
      <Screen
        label="Meridian's coordinator: you ask for two things, it reads the project and puts a team on each task"
        phone={{ x: 330, y: 150, w: 780, h: 720 }}
      >
        <Desktop>
          <MacWindow style={{ left: 40, top: 24, width: 1360, height: 826 }}>
            <ProjectWindow centered meta="The coordinator · 3 repositories, your rules" thread={thread} />
          </MacWindow>
        </Desktop>
      </Screen>
      <div className={s.slab} aria-hidden="true">
        <Shot w={700} label="" maxScale={1.08} frame={s.slabCard}>
          <Launch steps={steps} />
        </Shot>
      </div>
    </div>
  )
}

export function DesktopBody() {
  return (
    <main id="main" tabIndex={-1} className={s.body}>
      <Scene
        id="window"
        kicker="The home"
        title={
          <>
            Every project, every agent. <b>One window.</b>
          </>
        }
        lead="What needs you, across every project, on top. Under it, everything running: which agent, which step, how long. Under that, what happened since you looked."
      >
        <Screen
          label="Althar's home: three things that need you, five tasks running, and what happened since you looked"
          phone={{ x: 330, y: 120, w: 620, h: 560 }}
        >
          <Desktop island={<IslandOpen open={false} />}>
            <MacWindow style={{ left: 70, top: 26, width: 1300, height: 820 }}>
              <HomeWindow />
            </MacWindow>
          </Desktop>
        </Screen>
      </Scene>

      <Scene
        id="team"
        kicker="The coordinator"
        title={
          <>
            Say what you want. <b>It puts the team together.</b>
          </>
        }
        lead="Each project has a coordinator that knows its repositories and your rules. Tell it what you want; it splits it into tasks and gives each step the model that suits it, from whichever lab. Change anyone, or let it start."
      >
        <CoordinatorScene />
      </Scene>

      <Scene
        id="plans"
        kicker="Your plans"
        title={
          <>
            Every plan you pay for. <b>All at once.</b>
          </>
        }
        lead="Sign in to each agent as many times as you have plans: work and personal, Max and Pro, a key for OpenCode. Althar uses them all, in the order you set."
      >
        <div className={s.lifted}>
          <div className={s.liftedLight} aria-hidden="true">
            <Light height={0.6} />
          </div>
          <Plans />
        </div>
      </Scene>

      <Scene
        id="limits"
        kicker="Limits"
        title={
          <>
            Out of usage? <b>It carries on.</b>
          </>
        }
        lead="A plan runs out halfway through a task. The task doesn’t stop: the next agent you’re signed in to picks it up where it was, and you only hear about it if you look."
      >
        <div className={s.lanes}>
          <Handoff />
        </div>
      </Scene>

      <Scene
        id="review"
        kicker="Review"
        title={
          <>
            Written by one lab. <b>Reviewed by another.</b>
          </>
        }
        lead="Sonnet and Gemini read what Opus wrote. The lead fixes what they find and sends it round again. Only what they can’t settle between them comes to you."
      >
        <Close label="A review by Sonnet 5 and Gemini 3 Pro: three findings, two fixed by the lead, one waiting for your call" phoneW={460}>
          <TwoLabReview />
        </Close>
      </Scene>

      <Scene
        id="edge"
        tone="ink"
        kicker="At the edge of your screen"
        title={
          <>
            Wherever you are, <b>still in reach.</b>
          </>
        }
        lead="Althar sits round your Mac’s notch, in whatever you’re doing: point at it to answer a permission or open a pull request, and carry on."
      >
        <EdgeTour />
      </Scene>

      <Scene
        id="connections"
        kicker="Connections"
        title={
          <>
            From your tracker. <b>To your host.</b>
          </>
        }
        lead="Hand Althar an issue from Linear, Jira or Trello. It comes back as a pull request on GitHub, GitLab or Bitbucket, self-hosted ones included, reviewed and with its checks run."
      >
        <Flow />
      </Scene>

      <section className={s.end} aria-labelledby="end-h">
        <div className={s.head}>
          <h2 id="end-h" className={cx(t.title, t.big)}>
            Bring the agents <b>you already pay for.</b>
          </h2>
          <Get tone="paper" />
          <p className={t.mono}>Free and open source · macOS, Windows and Linux</p>
        </div>
        <footer className={s.foot}>
          <a href={LINKS.repo}>GitHub</a>
          <a href="/thesis">Thesis</a>
          <a href="/shifts">Shifts</a>
          <span>Althar</span>
        </footer>
      </section>
    </main>
  )
}
