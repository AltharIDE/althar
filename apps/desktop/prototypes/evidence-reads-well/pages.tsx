import { type Direction, directions } from './direction'
import { scenarios } from './scenario'

/*
 * The pages round the windows: one per direction, each window a frame of
 * screen.html, in order and captioned as the screenshots are named; today's,
 * for reference; and every direction side by side.
 */

const W = 1180
const H = 900

type Window = { readonly label: string; readonly caption: string; readonly query: string }

/** A direction's windows, in the order its screenshots are named: each task's thread, then its Outputs. */
export const windowsOf = (d: Direction): Window[] => {
  const L = d === 'today' ? 'T' : d.toUpperCase()
  const out: Window[] = scenarios.flatMap((scenario) => [
    {
      label: `${L}${scenario.n * 2 - 1}`,
      caption: `${scenario.name}: in the thread, under the step`,
      query: `d=${d}&s=${scenario.key}&f=thread`,
    },
    {
      label: `${L}${scenario.n * 2}`,
      caption: `${scenario.name}: on Outputs, under what it built`,
      query: `d=${d}&s=${scenario.key}&f=out`,
    },
  ])
  if (d === 'd')
    out.push({ label: 'D9', caption: 'A UI task with 8 screenshots: the line opened in place', query: 'd=d&s=ui&f=thread&open' })
  return out
}

function Frame({ query, title }: { query: string; title: string }) {
  return (
    <div className="frame">
      <iframe src={`screen.html?${query}`} title={title} loading="lazy" width={W} height={H} />
    </div>
  )
}

function Nav({ page }: { page: string }) {
  const links = [['index', 'All side by side'], ['today', 'Today'], ...directions.map((d) => [d.key, d.name])]
  return (
    <nav className="nav">
      {links.map(([key, name]) => (
        <a key={key} href={`${key}.html`} aria-current={key === page ? 'page' : undefined}>
          {name}
        </a>
      ))}
    </nav>
  )
}

function Windows({ d }: { d: Direction }) {
  return (
    <>
      {windowsOf(d).map((one) => {
        const scenario = scenarios.find((s) => one.query.includes(`s=${s.key}&`))
        return (
          <figure key={one.label} className="shot">
            <figcaption className="caption">
              <b>{one.label}</b>
              {one.caption}
              {scenario?.note !== undefined && one.query.endsWith('f=thread') && <span className="aside"> {scenario.note}</span>}
            </figcaption>
            <Frame query={one.query} title={`${one.label} ${one.caption}`} />
          </figure>
        )
      })}
    </>
  )
}

const TASKS = (
  <p className="lede">
    Four real tasks from Althar’s own store: the unpushed-commits prototype (8 screenshots, 2 commands, 3 unverified), the Push button fix
    (only test runs), DEV-58’s agent cap (4 unverified) and the evidence task itself (nothing shown). Each window is the app’s own task
    view; press a picture for the lightbox, a run to open what it printed. “What it built” is mocked as the summary task draws it.
  </p>
)

function DirectionPage({ d }: { d: Exclude<Direction, 'today'> }) {
  const it = directions.find((one) => one.key === d)
  return (
    <main className="page">
      <header>
        <h1>{it?.name}</h1>
        <p className="lede">{it?.gist}</p>
        {TASKS}
        <Nav page={d} />
      </header>
      <Windows d={d} />
    </main>
  )
}

function TodayPage() {
  return (
    <main className="page">
      <header>
        <h1>Today</h1>
        <p className="lede">
          The app as it is (PR #127), with the summary of what was built mocked above the evidence on Outputs. T1, T3, T5, T7 are the
          thread; T2, T4, T6, T8 Outputs.
        </p>
        {TASKS}
        <Nav page="today" />
      </header>
      <Windows d="today" />
    </main>
  )
}

function Comparison() {
  const columns: ReadonlyArray<{ key: Direction; name: string }> = [{ key: 'today', name: 'Today (for reference)' }, ...directions]
  const rows = scenarios.flatMap((scenario) => [
    { n: scenario.n * 2 - 1, name: `${scenario.name} · thread` },
    { n: scenario.n * 2, name: `${scenario.name} · Outputs` },
  ])
  return (
    <main className="page">
      <header>
        <h1>Evidence that reads well: every direction, side by side</h1>
        <p className="lede">
          Each column a direction, A to E, after today’s; each row a task in one place. Screenshots of the live windows (rerun shoot.mjs
          after changing a direction); open a direction for them full size and working.
        </p>
        {TASKS}
        <Nav page="index" />
      </header>
      <div className="compare" style={{ gridTemplateColumns: `120px repeat(${columns.length}, 300px)` }}>
        <span />
        {columns.map((c) => (
          <a key={c.key} className="head" href={`${c.key}.html`}>
            {c.name}
          </a>
        ))}
        {rows.map((row) => [
          <span key={`r${row.n}`} className="state">
            {row.name}
          </span>,
          ...columns.map((c) => {
            const label = `${c.key === 'today' ? 'T' : c.key.toUpperCase()}${row.n}`
            return (
              <a key={`${c.key}${row.n}`} href={`${c.key}.html`} className="cell">
                <img src={`${label}.png`} alt={`${c.name}, ${row.name}`} width={300} />
                <span className="label">{label}</span>
              </a>
            )
          }),
        ])}
      </div>
    </main>
  )
}

export function Pages({ page }: { page: string }) {
  if (page === 'today') return <TodayPage />
  if (page === 'a' || page === 'b' || page === 'c' || page === 'd' || page === 'e') return <DirectionPage d={page} />
  return <Comparison />
}
