import type { ReactNode } from 'react'

import { cx } from '../../../lib/cx'
import { Get } from '../../../shared/Close'
import { LightUnder } from '../../../shared/lightUnder'
import { EdgeTour } from '../kit/EdgeTour'
import t from '../kit/type.module.css'
import { AskOnce } from './AskOnce'
import { CrewAtWork } from './CrewAtWork'
import s from './DesktopBody.module.css'
import { Flow } from './Flow'
import { Trio } from './Trio'

/*
 * Desktop: the product, shown. One claim a screen, in the first screen's
 * type, each over a large picture of the app drawn by its own components:
 * first the crew at work on a panel as dark and warm as the first screen's
 * cabin, then whole windows on a Mac's screen and single pieces up close
 * in Althar's light. Pictures of the app framed as pictures, so nothing
 * looks like it is part of this page.
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
  /** A dark panel: ink, or warm as the first screen's cabin. */
  tone?: 'ink' | 'cabin'
}) {
  return (
    <section id={id} className={cx(s.scene, tone && s.ink, tone === 'cabin' && s.cabin)} aria-labelledby={`${id}-h`}>
      {/* Dark under the nav: it turns to smoked glass with white words over it. */}
      {tone && <LightUnder tone="ink" className={s.under} />}
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

export function DesktopBody() {
  return (
    <main id="main" tabIndex={-1} className={s.body}>
      <Scene
        id="crew"
        tone="cabin"
        kicker="Right now"
        title={
          <>
            The whole crew. <b>All at once.</b>
          </>
        }
        lead="Each task gets its own crew and its own branch, and they all run side by side. You step in only where you’re needed."
      >
        <CrewAtWork />
      </Scene>

      <Scene
        id="coordinator"
        kicker="The coordinator"
        title={
          <>
            Say it once.
            <br />
            <b>It plans the rest.</b>
          </>
        }
        lead="Every project has a coordinator that knows its repositories and your rules. Ask it in a sentence: it drafts the issue, splits the work into tasks and gives each step the model that suits it."
      >
        <AskOnce />
      </Scene>

      <Trio />

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

      <section className={s.end} aria-label="Download Althar">
        <div className={s.endRow}>
          <p className={s.endLine}>
            Bring the agents <b>you already pay for.</b>
          </p>
          <Get tone="paper" />
        </div>
      </section>
    </main>
  )
}
