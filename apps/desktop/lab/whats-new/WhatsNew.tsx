import { type ReactNode, useEffect } from 'react'

import { BackCrumb, Button, Heading, LinkButton, Logo, TaskHeader, TaskStatus, TitleBar } from '@althar/ui'

import { go } from './go'
import { Launch } from './looks/Launch'
import { Live } from './looks/Live'
import { Log } from './looks/Log'
import { NOW, ROADMAP, STAGE_TITLE } from './notes'
import { lab, useLab, type View } from './state'
import s from './whatsNew.module.css'

/*
 * What's new, where each direction puts it, in the look the bar picks
 * (looks/): A's and B's tab, C's page in the home's place, D's page of
 * Althar's own, a tab like a project's with its bar and its views What's
 * new and Coming next (the roadmap, in lanes as the board has them). And
 * the small things that say there's an update: C's line on the home, B's
 * in the window's bar.
 */

/** The page in the look the bar picks, with the way back where it opens in the home's place. */
export function Page({ back }: { back?: ReactNode }) {
  const { look } = useLab()
  if (look === 'live') return <Live back={back} />
  if (look === 'log') return <Log back={back} />
  return <Launch back={back} />
}

/** D: Althar's own page, a tab like a project's: its bar, and its two views. */
export function AltharPage() {
  const { view } = useLab()
  return (
    <div className={s.project}>
      <TitleBar
        lights="none"
        className={s.bar}
        end={
          <TaskHeader<View>
            title="Althar"
            status={TaskStatus.Done}
            state="Up to date"
            faces={[
              { value: 'new', label: 'What’s new' },
              { value: 'coming', label: 'Coming next' },
            ]}
            face={view}
            onFace={(next) => lab.set({ view: next })}
            text={{ faces: 'View' }}
          />
        }
      >
        <Heading level={1} className={s.crumb}>
          <span className={s.crumbName}>
            <Logo size={18} />
            Althar
          </span>
        </Heading>
      </TitleBar>
      {view === 'new' ? (
        <div className={s.pageIn}>
          <Page />
        </div>
      ) : (
        <div className={s.lanes}>
          {(['now', 'next', 'later'] as const).map((stage) => (
            <section key={stage} className={s.lane} aria-labelledby={`stage-${stage}`}>
              <header className={s.laneHead}>
                <Heading level={2} id={`stage-${stage}`} className={s.laneTitle}>
                  {STAGE_TITLE[stage]}
                </Heading>
              </header>
              <ul className={s.laneCards}>
                {ROADMAP.filter((one) => one.stage === stage).map((one) => (
                  <li key={one.title} className={s.card}>
                    <span className={s.cardTitle}>{one.title}</span>
                    <span className={s.cardDetail}>{one.detail}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

/** The lab's route: what What's new's tab shows in each direction. */
export function WhatsNewScreen() {
  const { d } = useLab()
  // Opening it is looking at it: B's line and D's dot go.
  useEffect(() => {
    if (lab.get().unseen) lab.set({ unseen: false })
  }, [])
  if (d === 'd') return <AltharPage />
  return <Page />
}

/** C: the page in the home's place, with the way back to it. */
export function HomeNotes() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') lab.set({ homeNotes: false })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const back = (
    <div className={s.back}>
      <BackCrumb to="Home" onBack={() => lab.set({ homeNotes: false })} kbd="Esc" title="What’s new" />
    </div>
  )
  return (
    <div className={s.inHome}>
      <Page back={back} />
    </div>
  )
}

/** C: what the home at rest says of the update, under what it says already. */
export function HomeUpdate() {
  return (
    <div className={s.homeUpdate}>
      <p className={s.homeEyebrow}>Althar {NOW.version}</p>
      <p className={s.homeTitle}>{NOW.title}</p>
      <p className={s.homeLine}>Your own host and workers, computer use, artifacts you talk to, goals, and more.</p>
      <Button size="small" onClick={go.whatsNew}>
        What’s new
      </Button>
    </div>
  )
}

/** B: in the window's bar, where "Althar 0.10.0 is ready" stood before the restart. */
export function UpdatedLine() {
  return (
    <output className={s.updated}>
      <span className={s.updatedWords}>Updated to {NOW.version}</span>
      <LinkButton onClick={go.whatsNew}>What’s new</LinkButton>
    </output>
  )
}
