import { RELEASES } from '../content/changelog'
import { LINKS } from '../content/facts'
import { Footer } from '../shared/footer/Footer'
import { Nav } from '../shared/Nav'
import { Night, night as n, Readout, Window } from '../shared/night/Night'
import { Out } from '../shared/Out'
import s from './Docs.module.css'

/*
 * The docs' place, until they are published: the night window the
 * changelog opens on, the current version, where Althar runs and its
 * licence along its top, and the ways to read in the meantime standing on
 * the planet's lit edge.
 */

const WAYS = [
  { href: LINKS.repo, name: 'The README', note: 'Installing, and signing in your agents', out: true },
  { href: '/thesis', name: 'The thesis', note: 'What Althar is for, and why', out: false },
  { href: LINKS.issues, name: 'Issues', note: 'Ask, or tell us what’s missing', out: true },
] as const

export function Docs() {
  const latest = RELEASES[0]
  return (
    <div className={s.page}>
      <Nav />
      <Night className={s.main}>
        <Window
          className={s.window}
          deck={
            <>
              {latest && (
                <Readout label="Current version" href="/changelog">
                  <b>{latest.version}</b>
                </Readout>
              )}
              <Readout label="Runs on" href={LINKS.releases} at="mid">
                <b>macOS · Windows · Linux</b>
              </Readout>
              <Readout label="Licence" href={`${LINKS.repo}/blob/main/LICENSE`} at="end">
                <b>Apache 2.0</b>
              </Readout>
            </>
          }
        >
          <div className={n.head}>
            <h1 className={n.headline}>The docs are being written.</h1>
            <p className={n.why}>How to install Althar, sign in your agents and run a project, step by step. Until they’re here:</p>
          </div>
          <ul className={s.ways}>
            {WAYS.map((way) => (
              <li key={way.href}>
                <a href={way.href}>
                  <b>
                    {way.name}
                    {way.out && <Out size={10} />}
                  </b>
                  <span>{way.note}</span>
                </a>
              </li>
            ))}
          </ul>
        </Window>
      </Night>
      <Footer />
    </div>
  )
}
