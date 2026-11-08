import { Out } from '../shared/Out'
import { LINKS } from '../content/facts'
import { Footer } from '../shared/footer/Footer'
import { Nav } from '../shared/Nav'
import { Night, night as n, Readout, Window } from '../shared/night/Night'
import s from './OfficeHours.module.css'

/*
 * Office hours: twenty minutes on a call with Balazs, booked on Cal.com.
 * The night window the other pages open on, the call's length, price and
 * medium along its top, the invitation and the booking in it; under it, on
 * paper, the few things worth knowing before booking. Bugs go to the
 * issues, by a quiet link beside the booking, so a call doesn't become
 * triage.
 */

const GOOD_TO_KNOW = [
  'We meet on video.',
  'The booking page shows times in your own time zone.',
  'If you want help setting up, bring a repository you work on.',
  'It’s fine to just say hello.',
]

export function OfficeHours() {
  return (
    <div className={s.page}>
      <Nav />

      <main id="main" tabIndex={-1}>
        <Night head>
          <Window
            className={s.window}
            deck={
              <>
                <Readout label="Length" href={LINKS.officeHours}>
                  <b>20 min</b>
                </Readout>
                <Readout label="Price" href={LINKS.officeHours} at="mid">
                  <b>Free</b>
                </Readout>
                <Readout label="On" href="#good-to-know" at="end">
                  <b>Video</b>
                </Readout>
              </>
            }
          >
            <div className={n.head}>
              <p className={n.over}>
                <span className={n.overLit}>Office hours</span>
                <span>With Balazs, who makes Althar</span>
              </p>
              <h1 className={n.headline}>Twenty minutes with me.</h1>
              <p className={n.why}>
                Book a call and we’ll get Althar set up on your machine together, or talk through working with coding agents: your ideas,
                your thoughts, what frustrates you. It’s free, and I’m not selling anything.
              </p>
            </div>
            <div className={s.ways}>
              <a className={s.primary} href={LINKS.officeHours} target="_blank" rel="noopener noreferrer">
                Book 20 minutes
                <Out size={11} />
              </a>
              <a className={s.secondary} href={LINKS.issues}>
                Found a bug? Open an issue
              </a>
            </div>
          </Window>
        </Night>

        <section id="good-to-know" className={s.sheet} aria-labelledby="good-to-know-h">
          <h2 id="good-to-know-h" className={s.h2}>
            Good to know
          </h2>
          <ul className={s.list}>
            {GOOD_TO_KNOW.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      </main>

      <Footer />
    </div>
  )
}
