import { Light } from '@althar/ui'
import { type ReactNode, useRef } from 'react'

import { LINKS } from '../../../content/facts'
import { cx } from '../../../lib/cx'
import { Get } from '../../../shared/Close'
import { HomeWindow, IslandOpen, Launch, ProjectWindow, SettingsWindow, TwoLabReview, useAssembling } from '../kit/app'
import { EdgeTour } from '../kit/EdgeTour'
import { Desktop, MacWindow } from '../kit/Mac'
import { useSeen } from '../kit/seen'
import { Shot } from '../kit/Shot'
import t from '../kit/type.module.css'
import s from './DesktopBody.module.css'
import { Flow } from './Flow'
import { Handoff } from './Handoff'

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

function TeamScene() {
  const ref = useRef<HTMLDivElement>(null)
  const seen = useSeen(ref)
  const steps = useAssembling(seen)
  return (
    <div ref={ref} className={s.team}>
      <Screen
        label="A project in Althar: the conversation, where the lead's plan for task 432 counts down, beside the project's board"
        phone={{ x: 40, y: 380, w: 560, h: 470 }}
      >
        <Desktop>
          <MacWindow style={{ left: 40, top: 24, width: 1360, height: 826 }}>
            <ProjectWindow conversation={<Launch steps={steps} />} />
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
        kicker="The lead"
        title={
          <>
            Say what you want. <b>It picks the team.</b>
          </>
        }
        lead="The lead splits the work into steps and gives each one the model that suits it: Opus to write, Codex to dry-run, Sonnet and Gemini to review, the security review your rule asks for. Change anyone, or let it start."
      >
        <TeamScene />
      </Scene>

      <Scene
        id="plans"
        kicker="Your plans"
        title={
          <>
            Two Claude plans, three Codex. <b>All at once.</b>
          </>
        }
        lead="Althar runs on the sign-ins already on your Mac, as many as you have: work and personal, Max and Pro, any key for OpenCode. Work goes to whichever has room."
      >
        <Screen
          label="Settings open over the home: Codex with three accounts, Claude Code with two, OpenCode with a key and a coding plan"
          phone={{ x: 420, y: 70, w: 960, h: 620 }}
        >
          <Desktop>
            <MacWindow style={{ left: 70, top: 26, width: 1300, height: 820 }}>
              <SettingsWindow open="agents" agent="codex" />
            </MacWindow>
          </Desktop>
        </Screen>
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
        lead="Sonnet and Gemini read what Opus wrote. The lead fixes what they find and sends it round again. Only what they can’t settle comes to you."
      >
        <Close label="A review by Sonnet 5 and Gemini 3 Pro: three findings, two of them waiting for your call" phoneW={460}>
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
        lead="In your editor, in the browser, in a terminal: Althar sits round the notch, or in the menu bar. Point at it to answer a permission or open a pull request without leaving what you’re doing."
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
          <p className={t.mono}>Free and open source · macOS first</p>
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
