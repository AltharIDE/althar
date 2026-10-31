import { RELEASES } from '../content/changelog'
import { Footer } from '../shared/footer/Footer'
import { Nav } from '../shared/Nav'
import { Night, night as n, Panes, Readout, Window } from '../shared/night/Night'
import s from './NotFound.module.css'

/*
 * Any address that isn't a page: built as 404.html, which Cloudflare serves
 * for it with a 404. The night window the other pages open on, the status
 * and the current version along its top, and the ways on standing on the
 * planet's lit edge.
 */

export function NotFound() {
  const latest = RELEASES[0]
  return (
    <div className={s.page}>
      <Nav />
      <Night className={s.main}>
        <Window
          deck={
            <>
              <Readout label="Status" href="/">
                <b>404</b>
              </Readout>
              <Readout label="Signal" href="/" at="mid">
                <b>Lost</b>
              </Readout>
              {latest && (
                <Readout label="Current version" href="/changelog" at="end">
                  <b>{latest.version}</b>
                </Readout>
              )}
            </>
          }
        >
          <div className={n.head}>
            <h1 className={n.headline}>There’s no page at this address.</h1>
            <p className={n.why}>It may have moved, or the link may be wrong. From here:</p>
          </div>
          <Panes
            ways={[
              { href: '/', name: 'Althar', note: 'What it is, and how it runs your agents' },
              { href: '/changelog', name: 'Changelog', note: 'What each release brought, and what’s next' },
              { href: '/shifts', name: 'Shifts', note: 'What changed for people who code with agents' },
            ]}
          />
        </Window>
      </Night>
      <Footer />
    </div>
  )
}
