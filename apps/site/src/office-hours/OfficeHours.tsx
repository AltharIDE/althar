import { useEffect, useState } from 'react'

import { LINKS } from '../content/facts'
import { Footer } from '../shared/footer/Footer'
import { Nav } from '../shared/Nav'
import { Night, night as n, Readout, Window } from '../shared/night/Night'
import { Out } from '../shared/Out'
import s from './OfficeHours.module.css'

/*
 * Office hours: twenty minutes on a call with Balazs, booked on Cal.com.
 * The night window the other pages open on, with the call's length, the
 * time where Balazs is and the price along its top, and the invitation and
 * the booking in it. Bugs go to the issues, by a quiet link beside the
 * booking, so a call doesn't become triage. Under it, on paper, examples
 * of things to bring, then the few things worth knowing.
 */

/** Where Balazs is: his clock in the window's readout. */
const ZONE = 'Europe/London'

/** Examples of what to bring, not a menu. */
const TOPICS = [
  'Getting Althar running on your repository',
  'A bug you’re running into',
  'Something you wish Althar did, or an idea you have',
  'A way you’d like to use Althar that it doesn’t support yet',
  'Anything else on your mind',
]

const GOOD_TO_KNOW = [
  'We meet on video.',
  'The booking page shows times in your own time zone.',
  'If you want help setting up, bring a repository you work on.',
  'It’s fine to just say hello.',
]

/** The time where Balazs is, to the minute; null in the prerender, so the page never shows the build's time. */
function useTimeThere() {
  const [time, setTime] = useState<string | null>(null)
  useEffect(() => {
    const format = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: ZONE })
    const tick = () => setTime(format.format(new Date()))
    tick()
    const every = window.setInterval(tick, 15_000)
    return () => window.clearInterval(every)
  }, [])
  return time
}

export function OfficeHours() {
  const time = useTimeThere()
  return (
    <div className={s.page}>
      <Nav />

      <main id="main" tabIndex={-1}>
        <Night head>
          <Window
            className={s.window}
            deck={
              <>
                <Readout label="Length" href="#topics">
                  <b>20 min</b>
                </Readout>
                <Readout label="For me, in London" href="#topics" at="mid">
                  <b>{time ?? 'London'}</b>
                </Readout>
                <Readout label="Price" href={LINKS.officeHours} at="end">
                  <b>Free</b>
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

        <div className={s.sheet}>
          <section id="topics" className={s.part} aria-labelledby="topics-h">
            <h2 id="topics-h" className={s.h2}>
              Examples of things to bring
            </h2>
            <ul className={s.topics}>
              {TOPICS.map((topic) => (
                <li key={topic}>{topic}</li>
              ))}
            </ul>
          </section>

          <section id="good-to-know" className={s.part} aria-labelledby="good-to-know-h">
            <h2 id="good-to-know-h" className={s.h2}>
              Good to know
            </h2>
            <ul className={s.list}>
              {GOOD_TO_KNOW.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  )
}
