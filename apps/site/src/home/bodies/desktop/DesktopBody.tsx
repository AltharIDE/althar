import { Brand, BrandMark, Light } from '@althar/ui'
import { type ReactNode, useRef } from 'react'

import { LINKS } from '../../../content/facts'
import { cx } from '../../../lib/cx'
import { Get } from '../../../shared/Close'
import {
  ConnectionsList,
  Handover,
  HomeWindow,
  IslandOpen,
  Launch,
  Limit,
  ProjectWindow,
  Rules,
  SettingsWindow,
  TwoLabReview,
  useAssembling,
} from '../kit/app'
import { Desktop, EditorWindow, MacWindow } from '../kit/Mac'
import { useSeen } from '../kit/seen'
import { Shot } from '../kit/Shot'
import t from '../kit/type.module.css'
import s from './DesktopBody.module.css'

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

const MARKS = [
  { brand: Brand.GitHub, name: 'GitHub' },
  { brand: Brand.GitLab, name: 'GitLab' },
  { brand: Brand.Bitbucket, name: 'Bitbucket' },
  { brand: Brand.Linear, name: 'Linear' },
  { brand: Brand.Jira, name: 'Jira' },
  { brand: Brand.Trello, name: 'Trello' },
]

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
          label="Settings: Claude Code with two accounts, Codex with three, OpenCode with a key and a coding plan"
          phone={{ x: 380, y: 24, w: 680, h: 700 }}
        >
          <Desktop>
            <MacWindow style={{ left: 300, top: 24, width: 840, height: 900 }}>
              <SettingsWindow />
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
        lead="When Claude hits its limit mid-task, Codex picks up the same thread, the same plan and the same branch. It moves back after the reset, if it is still running."
      >
        <Close
          label="Claude Code's usage limit reached: the lead and the security review are paused, and continue with Codex"
          w={820}
          phoneW={420}
        >
          <div className={s.handover}>
            <Limit />
            <div className={s.cards}>
              <div>
                <p className={s.when}>11:31 · Claude Code out</p>
                <Handover after={false} />
              </div>
              <div>
                <p className={s.when}>11:31 · Codex carries on</p>
                <Handover after />
              </div>
            </div>
          </div>
        </Close>
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
            In your editor, <b>still in reach.</b>
          </>
        }
        lead="Althar sits round the notch, or in the menu bar. Point at it to answer a permission or open a pull request without leaving what you’re doing."
      >
        <Screen
          label="The island round the notch, dropped open over a code editor: two things that need you and four running"
          phone={{ x: 450, y: 0, w: 540, h: 600 }}
        >
          <Desktop wallpaper="dark" app="Code" island={<IslandOpen />}>
            <EditorWindow style={{ left: 120, top: 50, width: 1200, height: 780 }} />
          </Desktop>
        </Screen>
      </Scene>

      <Scene
        id="connections"
        kicker="Connections"
        title={
          <>
            Your tracker. Your host. <b>Already connected.</b>
          </>
        }
        lead="Start a task from a Linear, Jira or Trello issue. It ends as a pull request on GitHub, GitLab or Bitbucket, self-hosted ones included."
      >
        <ul className={s.marks} aria-label="Code hosts and trackers">
          {MARKS.map((m) => (
            <li key={m.name}>
              <BrandMark brand={m.brand} size={40} />
              <span>{m.name}</span>
            </li>
          ))}
        </ul>
        <Close label="Settings: GitHub, GitLab, Bitbucket, Linear, Jira and Trello connected" w={560} phoneW={380}>
          <ConnectionsList />
        </Close>
      </Scene>

      <Scene
        id="rules"
        kicker="Rules"
        title={
          <>
            Set it once. <b>It holds for every task.</b>
          </>
        }
        lead="What always waits for you, what never happens, how review findings are settled, and what to do when a plan runs out."
      >
        <div className={s.fade}>
          <Close label="Meridian's rules: when agents need a yes" w={760} phoneW={420} wide>
            <Rules />
          </Close>
        </div>
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
