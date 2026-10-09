import { type ReactNode, useRef } from 'react'

import { LINKS } from '../../../content/facts'
import { cx } from '../../../lib/cx'
import { Get } from '../../../shared/Close'
import { Flow } from '../desktop/Flow'
import { Handoff } from '../desktop/Handoff'
import { HomeWindow, IslandOpen, Launch, SettingsPanel, TwoLabReview, useAssembling } from '../kit/app'
import { useSeen } from '../kit/seen'
import { Shot } from '../kit/Shot'
import t from '../kit/type.module.css'
import { Slab } from './Slab'
import s from './Slabs.module.css'

/*
 * Slabs: the pieces of the app held up at an angle, each beside its claim,
 * the sides alternating down the page, Althar's light under each. Slim and
 * three-dimensional, they float and lean toward the pointer. Halfway down,
 * the page goes dark and the island hangs from the top edge of it, open, as
 * it hangs from the notch. Fewer windows than Desktop, more of the pieces,
 * and closer.
 */

function Row({
  id,
  kicker,
  title,
  lead,
  side = 'right',
  children,
}: {
  id: string
  kicker: string
  title: ReactNode
  lead: ReactNode
  side?: 'left' | 'right'
  children: ReactNode
}) {
  return (
    <section id={id} className={cx(s.row, side === 'left' && s.flip)} aria-labelledby={`${id}-h`}>
      <div className={s.words}>
        <p className={t.kicker}>
          <i aria-hidden="true" />
          {kicker}
        </p>
        <h2 id={`${id}-h`} className={cx(t.title, s.h2)}>
          {title}
        </h2>
        <p className={t.lead}>{lead}</p>
      </div>
      <div className={s.piece}>{children}</div>
    </section>
  )
}

function Team() {
  const ref = useRef<HTMLDivElement>(null)
  const steps = useAssembling(useSeen(ref))
  return (
    <div ref={ref}>
      <Slab w={700} phoneW={430} label="The lead's plan for task 432: a model for each step, counting down to start" maxScale={1.1}>
        <Launch steps={steps} />
      </Slab>
    </div>
  )
}

export function Slabs() {
  return (
    <main id="main" tabIndex={-1} className={s.body}>
      <section id="window" className={s.window} aria-labelledby="window-h">
        <div className={s.windowHead}>
          <p className={t.kicker}>
            <i aria-hidden="true" />
            The home
          </p>
          <h2 id="window-h" className={cx(t.title, t.big)}>
            Every project. <b>One window.</b>
          </h2>
        </div>
        <div className={s.screenSlab}>
          <Slab
            w={1280}
            h={780}
            phone={{ x: 260, y: 40, w: 640, h: 620 }}
            label="Althar's home: what needs you, what runs, what happened since you looked"
            maxScale={1}
            light={false}
          >
            <HomeWindow />
          </Slab>
        </div>
      </section>

      <Row
        id="team"
        kicker="The lead"
        title={
          <>
            Say what you want. <b>It picks the team.</b>
          </>
        }
        lead="A model for each step, from whichever lab suits it: Opus to write, Codex to dry-run, Sonnet and Gemini to review, and the security review your rule asks for."
      >
        <Team />
      </Row>

      <Row
        id="plans"
        side="left"
        kicker="Your plans"
        title={
          <>
            Every plan you pay for. <b>At once.</b>
          </>
        }
        lead="Two Claude plans, three Codex accounts, a key in OpenCode: Althar signs in as each, and the work goes to whichever has room."
      >
        <Slab
          w={900}
          phoneW={440}
          label="Settings, the agents opened out: Codex with three accounts, and its models"
          maxScale={0.9}
          side="left"
        >
          <SettingsPanel open="agents" agent="codex" />
        </Slab>
      </Row>

      <section id="limits" className={s.wide} aria-labelledby="limits-h">
        <div className={s.wideHead}>
          <p className={t.kicker}>
            <i aria-hidden="true" />
            Limits
          </p>
          <h2 id="limits-h" className={cx(t.title, s.h2)}>
            Out of usage? <b>It carries on.</b>
          </h2>
        </div>
        <Handoff />
      </section>

      <Row
        id="review"
        kicker="Review"
        title={
          <>
            Written by one lab. <b>Reviewed by another.</b>
          </>
        }
        lead="The lead fixes what the reviewers find and sends it round again. Only what they can’t settle comes to you."
      >
        <Slab w={720} phoneW={460} label="A review by Sonnet 5 and Gemini 3 Pro with three findings, two of them yours" maxScale={1}>
          <TwoLabReview />
        </Slab>
      </Row>

      <section id="edge" className={s.night} aria-labelledby="edge-h">
        {/* The section's top edge is the screen's: the island hangs from it, open. */}
        <div className={s.hanging}>
          <Shot w={520} h={600} label="The island, open: two things that need you and four running" maxScale={1.25}>
            <div className={s.notchStage}>
              <IslandOpen />
            </div>
          </Shot>
        </div>
        <div className={s.nightWords}>
          <p className={t.kicker}>
            <i aria-hidden="true" />
            At the edge of your screen
          </p>
          <h2 id="edge-h" className={cx(t.title, s.h2)}>
            Wherever you are, <b>still in reach.</b>
          </h2>
          <p className={t.lead}>
            Round the notch, or in the menu bar. Answer a permission or open a pull request without leaving your editor.
          </p>
        </div>
      </section>

      <section id="connections" className={s.wide} aria-labelledby="connections-h">
        <div className={s.wideHead}>
          <p className={t.kicker}>
            <i aria-hidden="true" />
            Connections
          </p>
          <h2 id="connections-h" className={cx(t.title, s.h2)}>
            From your tracker. <b>To your host.</b>
          </h2>
        </div>
        <Flow />
      </section>

      <section className={s.end} aria-labelledby="end-h">
        <h2 id="end-h" className={cx(t.title, t.big)}>
          Bring the agents <b>you already pay for.</b>
        </h2>
        <Get tone="paper" />
        <footer className={s.foot}>
          <a href={LINKS.repo}>GitHub</a>
          <a href="/thesis">Thesis</a>
          <a href="/shifts">Shifts</a>
          <span>Free and open source · macOS first</span>
        </footer>
      </section>
    </main>
  )
}
