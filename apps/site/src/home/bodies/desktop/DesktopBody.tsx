import type { ReactNode } from 'react'

import { cx } from '../../../lib/cx'
import { Get } from '../../../shared/Close'
import { HomeWindow, IslandOpen } from '../kit/app'
import { EdgeTour } from '../kit/EdgeTour'
import { Desktop, MacWindow } from '../kit/Mac'
import { NarrowWindow, useNarrow } from '../kit/Narrow'
import { Shot } from '../kit/Shot'
import t from '../kit/type.module.css'
import s from './DesktopBody.module.css'
import { Flow } from './Flow'
import { Lift } from './Lift'
import { Trio } from './Trio'

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
function Screen({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className={s.screenWrap}>
      <div className={s.bezel}>
        <Shot w={1440} h={900} label={label} frame={s.screen}>
          {children}
        </Shot>
      </div>
    </div>
  )
}

/** The home on a Mac's screen; on a phone, the home's own narrow window, the stream alone. */
function HomeScreen() {
  const phone = useNarrow()
  const label = "Althar's home: three things that need you in the middle, and beside them every project with its work in progress"
  if (phone)
    return (
      <div className={s.narrowWrap}>
        <NarrowWindow label={label} h={520}>
          <HomeWindow narrow />
        </NarrowWindow>
      </div>
    )
  return (
    <Screen label={label}>
      <Desktop island={<IslandOpen open={false} waiting={3} />}>
        <MacWindow style={{ left: 70, top: 26, width: 1300, height: 820 }}>
          <HomeWindow />
        </MacWindow>
      </Desktop>
    </Screen>
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
        lead="What needs you, across every project, in the middle, answered where it is. Beside it, your projects, with a quiet tick for each task in progress. Under it, what happened since you looked."
      >
        <HomeScreen />
      </Scene>

      <Lift />

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
