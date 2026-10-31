import type { ReactNode } from 'react'

import { cx } from '../../../lib/cx'
import { Get, OtherMac } from '../../../shared/Close'
import { LightUnder } from '../../../shared/lightUnder'
import { EdgeTour } from '../kit/EdgeTour'
import t from '../kit/type.module.css'
import { AskOnce } from './AskOnce'
import { AtWork } from './AtWork'
import { Bento } from './Bento'
import s from './DesktopBody.module.css'
import { Review } from './Review'

/*
 * Desktop: the product, shown, after the first screen's "fast": first that
 * it is independent of the labs, then how it keeps you in flow, and at the
 * end the craft and the freedom of open source, by the download. One claim
 * a screen, in the first screen's type, each over a large picture of the
 * app drawn by its own components: the board at work on a panel as dark and
 * warm as the first screen's cabin, then the coordinator, the work reviewing
 * itself, a bento of what keeps you in flow, and the notch. Pictures of the app framed as pictures,
 * so nothing looks like it is part of this page.
 */

function Scene({
  id,
  title,
  lead,
  children,
  tone,
}: {
  id: string
  title: ReactNode
  lead: ReactNode
  children: ReactNode
  /** A dark panel: ink, warm as the first screen's cabin, or the warm near-black a lit drawing stands on. */
  tone?: 'ink' | 'cabin' | 'lit'
}) {
  return (
    <section
      id={id}
      className={cx(s.scene, tone && s.ink, tone === 'cabin' && s.cabin, tone === 'lit' && s.lit)}
      aria-labelledby={`${id}-h`}
    >
      {/* Dark under the nav: it turns to smoked glass with white words over it. */}
      {tone && <LightUnder tone="ink" className={s.under} />}
      <div className={s.head}>
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
        id="independent"
        tone="cabin"
        title={
          <>
            Usage gets cut.
            <br />
            Models get pulled.
            <br />
            <b>Althar stays.</b>
          </>
        }
        lead="Open source, local-first, your data on your computer, any agent you have. None of the industry’s bullshit touches it."
      >
        <AtWork />
      </Scene>

      <Scene
        id="coordinator"
        title={
          <>
            Every project
            <br />
            <b>has a manager.</b>
          </>
        }
        lead="It’s called the coordinator. It knows your whole project, and puts a team of agents on every ask."
      >
        <AskOnce />
      </Scene>

      <Scene
        id="review"
        tone="lit"
        title={
          <>
            No more <b>meat proxying.</b>
          </>
        }
        lead="Every change is reviewed by a model from another lab, fixed by its lead, and reviewed again until it’s clean. Better work, and you never paste one agent’s answer into another again."
      >
        <Review />
      </Scene>

      <Scene
        id="flow"
        title={
          <>
            Fall in love
            <br />
            <b>with building again.</b>
          </>
        }
        lead="Tired of juggling terminals, re-explaining your project and babysitting agents? So were we."
      >
        <Bento />
      </Scene>

      <Scene
        id="edge"
        tone="ink"
        title={
          <>
            Wherever you are, <b>still in reach.</b>
          </>
        }
        lead="Althar sits round your Mac’s notch, in whatever you’re doing: point at it to answer a permission or open a pull request, and carry on."
      >
        <EdgeTour />
      </Scene>

      <section className={s.end} aria-label="Download Althar">
        <div className={s.endRow}>
          <p className={s.endLine}>
            The craft of a paid app. <br className={s.phoneBreak} />
            <b>The freedom of open source.</b>
          </p>
          <div className={s.endGet}>
            <Get tone="paper" />
            <OtherMac tone="paper" />
          </div>
        </div>
      </section>
    </main>
  )
}
