import { DIRECTIONS, type Direction, DirectionContext } from './directions'
import { Live } from './live'
import { CASES } from './scenario'
import { CaseCard, Shot } from './stage'

/* The live page, where a bar at the foot switches direction in place; and a page that sets every direction side by side. */

/** A direction on the live page, on the screen asked for. */
const liveOf = (direction: Direction, screen = 'board') => `index.html?d=${direction.letter}&s=${screen}`

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

function Compare() {
  return (
    <main className="page">
      <nav className="nav">
        <a href="index.html">← The live page</a>
      </nav>
      <header className="head">
        <p className="kicker">Prototype · What blocks a ready card, at a glance</p>
        <h1>Every direction, side by side</h1>
        <p className="gist">
          Today first, then A to E. Each row is one state of a ready change; each column, how a direction draws its card on the board. The
          live page has each on the whole board and the home.
        </p>
      </header>
      <ol className="list">
        {DIRECTIONS.map((one) => (
          <li key={one.key}>
            <a href={liveOf(one)}>{one.name}</a>
            <p>{one.gist}</p>
            {one.key !== 'today' && <About direction={one} />}
          </li>
        ))}
      </ol>
      <Shot label="X1" title="Every state, across every direction" wide>
        <div className="grid" style={{ gridTemplateColumns: `116px repeat(${DIRECTIONS.length}, 246px)` }}>
          <div />
          {DIRECTIONS.map((one) => (
            <a key={one.key} className="col" href={liveOf(one, 'states')}>
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
  return page === 'compare' ? <Compare /> : <Live />
}
