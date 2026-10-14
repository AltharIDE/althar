import { AcceptCard, BoardCard } from '@althar/ui'
import type { ReactNode } from 'react'
import { useLayoutEffect, useMemo } from 'react'

import type { HomeSnapshot } from '@althar/contracts'

import { follow } from '../../src/renderer/data/feed'
import { keys, makeQueryClient } from '../../src/renderer/data/reads'
import { type Services, ServicesProvider } from '../../src/renderer/data/services'
import { BoardView, readyCardOf, runningCardOf } from '../../src/renderer/features/board/BoardView'
import { lanesOf } from '../../src/renderer/features/board/lanes'
import { HomeView } from '../../src/renderer/features/home/HomeView'
import { useHome } from '../../src/renderer/features/home/useHome'
import { useStart } from '../../src/renderer/features/start/useStart'
import { productBrand } from '../../src/renderer/shared/products'
import { agents, fakeClient, fakeHost } from '../../tests/fixtures'
import { type Direction, DirectionContext } from './directions'
import { boardOf, type Case, CASES, homeOf, NOW, taskOf } from './scenario'

/*
 * What the pages show: the app's own board, home and cards, fed the
 * scenario, each under its direction. They fill what they're put in, so the
 * live page can be the window; the comparison captions them as shots.
 */

const noop = () => undefined
const name = (id: string | null) => agents.find((agent) => agent.id === id)?.name ?? id ?? ''

/** A shot on the comparison page: its label, what it shows, and the app inside. */
export function Shot({
  label,
  title,
  note,
  children,
  wide = false,
}: {
  label: string
  title: string
  note?: ReactNode
  children: ReactNode
  wide?: boolean
}) {
  return (
    <figure className={wide ? 'shot wide' : 'shot'} data-shot={label}>
      <figcaption>
        <span className="label">{label}</span>
        <span className="title">{title}</span>
        {note !== undefined && <span className="note">{note}</span>}
      </figcaption>
      <div className="stage">{children}</div>
    </figure>
  )
}

/** One case's card, as the board draws it: ready, or, today, back in Running while its lead resolves. */
export function CaseCard({ one, today }: { one: Case; today: boolean }) {
  const task = taskOf(one, today)
  const card = task.phase === 'running' ? runningCardOf(task, NOW, name) : readyCardOf(task)
  return <BoardCard {...card} onOpen={noop} />
}

/** Every state, a card each at a lane's width, on the Needs you lane's wash. */
export function States({ direction }: { direction: Direction }) {
  const today = direction.key === 'today'
  return (
    <DirectionContext value={direction}>
      <div className="states">
        {CASES.map((one) => {
          const back = today && taskOf(one, true).phase === 'running'
          return (
            <div key={one.key} className="cell">
              <div className="state">
                {one.state}
                {back && <em> · in Running, today</em>}
                {!one.onBoard && <em> · not on the board</em>}
              </div>
              <div className={back ? 'lane running' : 'lane you'}>
                <CaseCard one={one} today={today} />
              </div>
            </div>
          )
        })}
      </div>
    </DirectionContext>
  )
}

/** The app's board, as the project's screen shows it. */
export function Board({ direction }: { direction: Direction }) {
  const today = direction.key === 'today'
  const lanes = useMemo(() => lanesOf(boardOf(today, false)), [today])
  return (
    <DirectionContext value={direction}>
      <div className="board">
        <BoardView lanes={lanes} agents={agents} now={NOW} onOpen={noop} />
      </div>
    </DirectionContext>
  )
}

function HomeNow() {
  return <HomeView model={useHome()} start={useStart()} onProject={noop} onTalk={noop} onTask={noop} />
}

/**
 * The home's runtime, one for the page: the desktop tests' fake client,
 * which says whatever the home was last given. Switching direction gives it
 * the direction's home and puts that in its cache, so the home changes in
 * place, read already, rather than being read again and arriving again.
 */
let runtime: { readonly services: Services; given: HomeSnapshot } | undefined
const runtimeFor = (first: HomeSnapshot) => {
  if (runtime === undefined) {
    const { client } = fakeClient({ getHome: async () => runtime?.given ?? first })
    const cache = makeQueryClient()
    runtime = { services: { client, host: fakeHost(), cache, feed: follow(client, cache) }, given: first }
  }
  return runtime
}

/** The app's home, saying the scenario as the direction has it: today's runtime, or the directions' (a ready task stays ready while its lead resolves). */
export function Home({ direction }: { direction: Direction }) {
  const today = direction.key === 'today'
  const sorted = direction.sorted === true
  const given = useMemo(() => homeOf(today, sorted), [today, sorted])
  const { services } = runtimeFor(given)
  useLayoutEffect(() => {
    const now = runtimeFor(given)
    if (now.given === given) return
    now.given = given
    now.services.cache.setQueryData(keys.home, given)
  }, [given])
  return (
    <DirectionContext value={direction}>
      <div className="home">
        <ServicesProvider value={services}>
          <HomeNow />
        </ServicesProvider>
      </div>
    </DirectionContext>
  )
}

/**
 * The known bug, as the board had it until #159 this morning: AcceptCard
 * given only the passed count. Beside it, main's card for the same change.
 */
export function Bug() {
  const one = CASES.find((each) => each.key === 'running')
  const change = one?.task.change
  if (one === undefined || change == null) return null
  return (
    <div className="states two">
      <div className="cell">
        <div className="state">Before #159: the kit’s AcceptCard, given checks.passed</div>
        <div className="lane you">
          <AcceptCard
            task={one.task.slug}
            title={one.task.title}
            prs={[{ repo: 'althar', number: change.number, add: change.additions ?? 0, del: change.deletions ?? 0 }]}
            host={{ name: 'GitHub', brand: productBrand('github') }}
            checks={change.checks?.passed ?? 0}
            onOpen={noop}
            text={{ task: () => '' }}
          />
        </div>
      </div>
      <div className="cell">
        <div className="state">Main now: BoardCard, from readyCardOf</div>
        <div className="lane you">
          <CaseCard one={one} today />
        </div>
      </div>
    </div>
  )
}
