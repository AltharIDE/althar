import { DIRECTIONS, type Direction, DirectionContext, directionOf, type Key } from './directions'
import { CASES } from './scenario'
import { Board, Bug, CaseCard, Home, Shot, States } from './stage'

/* One page per direction, today's first, and a page that sets every direction side by side, in order. */

const pageOf = (key: Key) => `${key}.html`

function Nav({ on }: { on: Key | 'index' }) {
  return (
    <nav className="nav">
      <a href="index.html" aria-current={on === 'index' ? 'page' : undefined}>
        All, side by side
      </a>
      {DIRECTIONS.map((one) => (
        <a key={one.key} href={pageOf(one.key)} aria-current={on === one.key ? 'page' : undefined}>
          {one.letter === 'T' ? 'Today' : one.letter}
        </a>
      ))}
    </nav>
  )
}

function About({ direction }: { direction: Direction }) {
  return (
    <dl className="about">
      <dt>While checks run</dt>
      <dd>{direction.running}</dd>
      <dt>What it needs</dt>
      <dd>{direction.needs}</dd>
    </dl>
  )
}

function DirectionPage({ direction }: { direction: Direction }) {
  const L = direction.letter
  const today = direction.key === 'today'
  return (
    <main className="page">
      <Nav on={direction.key} />
      <header className="head">
        <p className="kicker">Prototype · What blocks a ready card, at a glance</p>
        <h1>{direction.name}</h1>
        <p className="gist">{direction.gist}</p>
        {!today && <About direction={direction} />}
      </header>
      <Shot
        label={`${L}1`}
        title={`${direction.name}: every state, on its card`}
        note={
          today
            ? 'Each card is the app’s, from readyCardOf (runningCardOf for the one back in Running), at the width of a lane.'
            : 'Each card is the app’s, from readyCardOf, at the width of a lane, changed as the direction says. The dashed outline marks where DEV-91’s “merge when checks pass” would go.'
        }
      >
        <States direction={direction} />
      </Shot>
      <Shot
        label={`${L}2`}
        title={`${direction.name}: the board`}
        note="The app’s BoardView: one held up next, seven ready, three settled of 41."
        wide
      >
        <Board direction={direction} />
      </Shot>
      <Shot
        label={`${L}3`}
        title={`${direction.name}: the home`}
        note="The app’s HomeView, its runtime the desktop tests’ fake client."
        wide
      >
        <Home direction={direction} />
      </Shot>
      {today && (
        <Shot
          label="T4"
          title="Today: the known checks bug"
          note="Until #159 merged this morning, the board gave AcceptCard only the passed count, so 3 of 5 still running read “All 2 checks passed”. Main’s board now says “2 of 5 checks passed”; AcceptCard, still in the kit and used by the site, keeps the bug."
        >
          <Bug />
        </Shot>
      )}
    </main>
  )
}

function Compare() {
  return (
    <main className="page">
      <Nav on="index" />
      <header className="head">
        <p className="kicker">Prototype · What blocks a ready card, at a glance</p>
        <h1>Every direction, in order</h1>
        <p className="gist">
          Today first, then A to E. Each row is one state of a ready change; each column, how a direction draws its card on the board. Each
          direction’s own page has the whole board and the home.
        </p>
      </header>
      <ol className="list">
        {DIRECTIONS.map((one) => (
          <li key={one.key}>
            <a href={pageOf(one.key)}>{one.name}</a>
            <p>{one.gist}</p>
            {one.key !== 'today' && <About direction={one} />}
          </li>
        ))}
      </ol>
      <Shot label="X1" title="Every state, across every direction" wide>
        <div className="grid" style={{ gridTemplateColumns: `150px repeat(${DIRECTIONS.length}, 252px)` }}>
          <div />
          {DIRECTIONS.map((one) => (
            <a key={one.key} className="col" href={pageOf(one.key)}>
              {one.letter === 'T' ? 'Today' : one.name}
            </a>
          ))}
          {CASES.map((each) => [
            <div key={`${each.key}-state`} className="row">
              {each.state}
            </div>,
            ...DIRECTIONS.map((one) => (
              <DirectionContext key={`${each.key}-${one.key}`} value={one}>
                <div className="lane you">
                  <CaseCard one={each} today={one.key === 'today'} />
                </div>
              </DirectionContext>
            )),
          ])}
        </div>
      </Shot>
    </main>
  )
}

export function Pages({ page }: { page: string }) {
  if (page === 'index') return <Compare />
  return <DirectionPage direction={directionOf(page as Key)} />
}
