import type { ReactNode } from 'react'

import { states } from './scenario'
import type { Direction } from './scene'
import { BoardOf, DockOf, HomeOf, TalkCardOf, TaskOf } from './stage'
import { directions } from './words'

/*
 * The pages: today's, as the baseline; one per direction, each state the
 * brief asks for on the board, then the dock, the task's own screen and its
 * card in the conversation, and the home; and all of them side by side.
 * Numbered as the screenshots are: A1 to A5 the board's states, A6 the
 * dock, A7 the task, A8 the home.
 */

const pages = [
  { key: 'today', name: 'Today' },
  ...directions.map((one) => ({ key: one.key, name: one.name.split(' · ')[0] ?? one.key })),
  { key: 'index', name: 'All, side by side' },
]

function Nav({ page }: { page: string }) {
  return (
    <nav className="nav">
      {pages.map((one) => (
        <a key={one.key} href={`./${one.key}.html`} aria-current={one.key === page ? 'page' : undefined}>
          {one.name}
        </a>
      ))}
    </nav>
  )
}

/** What each board state shows, as its caption says it. */
const ABOUT: Readonly<Record<string, string>> = {
  one: 'All four agents busy; one task waits to start.',
  three: 'Three wait, oldest first: that is the order they start in.',
  mixed: 'Two wait beside a plan on its countdown and one held until you say.',
  midway:
    'Cache exchange rates was under way; its lead asked, you answered, and the answer waits for an agent. It is 2nd in line, behind a task not started.',
  freed: 'Fix the flaky checkout test finished: its agent went to the first in line, which is running now (ringed), and the rest moved up.',
}

function Shot({ id, caption, children }: { id: string; caption: string; children: ReactNode }) {
  return (
    <section className="shot" data-shot={id}>
      <p className="caption">
        <b>{id}</b>
        {caption}
      </p>
      {children}
    </section>
  )
}

function Labelled({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <figure className="labelled">
      <figcaption>{label}</figcaption>
      <div className={className}>{children}</div>
    </figure>
  )
}

function Shots({ direction, label }: { direction: Direction; label: string }) {
  return (
    <>
      {states.map((state, i) => (
        <Shot key={state.key} id={`${label}${i + 1}`} caption={`${state.name}. ${ABOUT[state.key]}`}>
          <div className={direction === 'today' ? 'frame board tall' : 'frame board'}>
            <BoardOf state={state} direction={direction} {...(direction === 'b' && state.key === 'one' ? { tip: 'webhook-retry' } : {})} />
          </div>
        </Shot>
      ))}
      <Shot id={`${label}6`} caption="The dock, opened from the board: a task not started that waits, and one under way whose turn waits.">
        <div className="pair">
          <Labelled label="Not started" className="frame dock">
            <DockOf direction={direction} started={false} />
          </Labelled>
          <Labelled label="Under way, its next turn waiting" className="frame dock">
            <DockOf direction={direction} started />
          </Labelled>
        </div>
      </Shot>
      <Shot
        id={`${label}7`}
        caption="The task’s own screen, its header saying where it stands; and the card the coordinator posted for it, where the plan can still be changed."
      >
        <div className="stack">
          <Labelled label="Not started" className="frame task">
            <TaskOf direction={direction} started={false} />
          </Labelled>
          <Labelled label="Under way, its next turn waiting" className="frame task">
            <TaskOf direction={direction} started />
          </Labelled>
          <Labelled label="Its card in the conversation" className="talk">
            <TalkCardOf direction={direction} />
          </Labelled>
        </div>
      </Shot>
      <Shot
        id={`${label}8`}
        caption="The home: meridian has four running and three waiting (two not started, one under way); its line under the name says so."
      >
        <div className="frame home">
          <HomeOf direction={direction} />
        </div>
      </Shot>
    </>
  )
}

function DirectionPage({ direction }: { direction: Exclude<Direction, 'today'> }) {
  const about = directions.find((one) => one.key === direction)
  return (
    <main className="page">
      <header>
        <h1>{about?.name}</h1>
        <p className="lede">{about?.gist}</p>
        <Nav page={direction} />
      </header>
      <Shots direction={direction} label={direction.toUpperCase()} />
    </main>
  )
}

function Today() {
  return (
    <main className="page">
      <header>
        <h1>Today: the baseline</h1>
        <p className="lede">
          As the app has it now (DEV-58): work waiting for a free agent sits in Running, as a card that says “Waiting” and “Waiting: 4 of 4
          agents busy on this Mac”; the dock calls it Running; the home’s line says “3 waiting: 4 of 4 agents busy”.
        </p>
        <Nav page="today" />
      </header>
      <Shots direction="today" label="T" />
    </main>
  )
}

const ORDER = ['a', 'b', 'c', 'd', 'e'] as const

function Compare() {
  return (
    <main className="page">
      <header>
        <h1>Tasks waiting for a free agent: A, B, C, D and E side by side</h1>
        <p className="lede">
          Up next and Running from each board state, the docks, the task’s header and the home’s project line, for each direction. Each
          direction has its own page with everything full size.
        </p>
        <Nav page="index" />
      </header>
      <div className="grid" data-shot="compare">
        <div />
        {ORDER.map((key) => {
          const about = directions.find((one) => one.key === key)
          return (
            <div key={key} className="head">
              <a href={`./${key}.html`}>{about?.name.split(' · ')[0]}</a>
              <small>{about?.name.split(' · ')[1]}</small>
            </div>
          )
        })}
        {states.map((state, i) => (
          <Row key={state.key} name={`${i + 1}. ${state.name}`}>
            {ORDER.map((key) => (
              <div key={key} className="crop lanes">
                <BoardOf state={state} direction={key} />
              </div>
            ))}
          </Row>
        ))}
        <Row name="The dock, not started">
          {ORDER.map((key) => (
            <div key={key} className="crop dock">
              <DockOf direction={key} started={false} />
            </div>
          ))}
        </Row>
        <Row name="The dock, under way">
          {ORDER.map((key) => (
            <div key={key} className="crop dock">
              <DockOf direction={key} started />
            </div>
          ))}
        </Row>
        <Row name="The task’s header, not started, then under way">
          {ORDER.map((key) => (
            <div key={key} className="headers">
              <div className="crop header">
                <TaskOf direction={key} started={false} />
              </div>
              <div className="crop header">
                <TaskOf direction={key} started />
              </div>
            </div>
          ))}
        </Row>
        <Row name="The home’s project line">
          {ORDER.map((key) => (
            <div key={key} className="crop homeLine">
              <div className="homeInner">
                <HomeOf direction={key} />
              </div>
            </div>
          ))}
        </Row>
      </div>
    </main>
  )
}

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <>
      <div className="state-name">{name}</div>
      {children}
    </>
  )
}

export function Pages({ page }: { page: string }) {
  if (page === 'today') return <Today />
  if (page === 'a' || page === 'b' || page === 'c' || page === 'd' || page === 'e') return <DirectionPage direction={page} />
  return <Compare />
}
