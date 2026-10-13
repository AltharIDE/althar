import type { ReactNode } from 'react'

import type { BoardTask } from '@althar/contracts'

import { productBrand, productName } from '../../src/renderer/shared/products'
import { AcceptCard, type Direction, directions, GroupHeading } from './cards'
import { readinessOf } from './readiness'
import { states } from './scenario'
import { BoardOf, CardOf, HomeOf } from './stage'

/*
 * The pages: today's board and home; one page per direction, with each
 * state as one card, then the board and the home; and all four side by side.
 * Numbered as the screenshots are: A1 the states, A2 the board, A3 the home.
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

/** A ready task's card, with what the board gives it. */
function Card({ task }: { task: BoardTask }) {
  const change = task.change
  const brand = change === null ? undefined : productBrand(change.product)
  return (
    <AcceptCard
      task={task.slug}
      title={task.title}
      {...(change === null
        ? {}
        : {
            prs: [
              {
                repo: change.repository.slice(change.repository.lastIndexOf('/') + 1),
                number: change.number,
                ...(change.additions === null || change.deletions === null ? {} : { add: change.additions, del: change.deletions }),
              },
            ],
            host: { name: productName(change.product), ...(brand === undefined ? {} : { brand }) },
            checks: change.checks?.passed ?? 0,
          })}
      onOpen={() => {}}
      text={{ task: () => '', ...(change === null ? {} : { number: (n: number) => `${change.prefix}${n}` }) }}
    />
  )
}

/** Each state as one card, in the lane it sits in. */
function States({ direction, label }: { direction: Direction; label: string }) {
  return (
    <section className="shot" data-shot={`${label}1`}>
      <p className="caption">
        <b>{label}1</b>Each state, one card: the seven the brief asks for, then draft, changes requested and behind main.
      </p>
      <CardOf direction={direction}>
        <div className="states">
          {states.map((one, i) => (
            <figure key={one.key} className="state">
              <figcaption>
                {i + 1}. {one.name}
              </figcaption>
              <div className="lane">
                {direction === 'c' && <GroupHeading verdict={readinessOf(one.task).verdict} />}
                <Card task={one.task} />
              </div>
            </figure>
          ))}
        </div>
      </CardOf>
    </section>
  )
}

function Board({ direction, label }: { direction: Direction; label: string }) {
  return (
    <section className="shot" data-shot={`${label}2`}>
      <p className="caption">
        <b>{label}2</b>The board at scale: a plan held, work running, seven ready to accept, one settled.
      </p>
      <div className="frame board">
        <BoardOf direction={direction} />
      </div>
    </section>
  )
}

function Home({ direction, label }: { direction: Direction; label: string }) {
  return (
    <section className="shot" data-shot={`${label}3`}>
      <p className="caption">
        <b>{label}3</b>The home: the same seven, as lines of what needs you.
      </p>
      <div className="frame home">
        <HomeOf direction={direction} />
      </div>
    </section>
  )
}

function DirectionPage({ direction }: { direction: Exclude<Direction, 'today'> }) {
  const about = directions.find((one) => one.key === direction)
  const label = direction.toUpperCase()
  return (
    <main className="page">
      <header>
        <h1>{about?.name}</h1>
        <p className="lede">{about?.gist}</p>
        <Nav page={direction} />
      </header>
      <States direction={direction} label={label} />
      <Board direction={direction} label={label} />
      <Home direction={direction} label={label} />
    </main>
  )
}

function Today() {
  return (
    <main className="page">
      <header>
        <h1>Today: the baseline</h1>
        <p className="lede">
          The board and the home as the app has them now, with the same work. Every ready card says “Ready to accept” and how many checks
          passed; nothing says a check is running or failed, that it conflicts, or that commits aren’t on the PR. The home’s line says the
          checks in a word.
        </p>
        <Nav page="today" />
      </header>
      <States direction="today" label="T" />
      <Board direction="today" label="T" />
      <Home direction="today" label="T" />
    </main>
  )
}

const ORDER = ['a', 'b', 'c', 'd'] as const

function Compare() {
  return (
    <main className="page">
      <header>
        <h1>What blocks a ready card, at a glance: A, B, C and D side by side</h1>
        <p className="lede">
          Each state as one card in each direction, then each direction’s board and home, scaled. Each direction has its own page, with the
          board and home full size.
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
        {states.map((one, i) => (
          <Row key={one.key} name={`${i + 1}. ${one.name}`}>
            {ORDER.map((key) => (
              <CardOf key={key} direction={key}>
                <div className="lane">
                  {key === 'c' && <GroupHeading verdict={readinessOf(one.task).verdict} />}
                  <Card task={one.task} />
                </div>
              </CardOf>
            ))}
          </Row>
        ))}
        <Row name="The board">
          {ORDER.map((key) => (
            <div key={key} className="thumb">
              <div className="frame board">
                <BoardOf direction={key} />
              </div>
            </div>
          ))}
        </Row>
        <Row name="The home">
          {ORDER.map((key) => (
            <div key={key} className="thumb">
              <div className="frame home">
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
  if (page === 'a' || page === 'b' || page === 'c' || page === 'd') return <DirectionPage direction={page} />
  return <Compare />
}
