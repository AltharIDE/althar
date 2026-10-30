import source from '../../../../THESIS.md?raw'
import { LINKS } from '../content/facts'
import { DATE } from '../content/sheet'
import { useCurrent } from '../lib/useCurrent'
import { useNarrow } from '../home/bodies/kit/Narrow'
import { Footer } from '../shared/footer/Footer'
import { Nav } from '../shared/Nav'
import { Night, night as n, Readout, Window } from '../shared/night/Night'
import { block, compile } from './prose'
import s from './Thesis.module.css'

/*
 * The thesis, compiled from THESIS.md at build time. It opens on the night
 * window the other pages do, its revision, its date and its sections along
 * the top and its title in the middle; the document itself stays on cream
 * paper under it, as a document is. The hypothesis and the numbered sections share one
 * reading column under it, with the contents beside it; narrower, the
 * contents fold shut over the column. Each section opens with its number
 * and its title, the claims stand large, and figures in the sections are
 * rails.
 */

export const THESIS_SOURCE = source
const THESIS = compile(THESIS_SOURCE)
const IDS = THESIS.parts.map((p) => p.id)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
/** A day as the readouts write it: 28 Sep 2026. */
const dated = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`
}

export function Thesis() {
  const current = useCurrent(IDS)
  const narrow = useNarrow(1000)
  const [lede, claim, ...rest] = THESIS.intro

  return (
    <div className={s.page}>
      <Nav />

      <main id="main" tabIndex={-1}>
        <Night head>
          <Window
            className={s.window}
            deck={
              <>
                <Readout label="Revision" href={LINKS.thesis}>
                  <b>C</b>
                </Readout>
                <Readout label="Dated" href={LINKS.thesis} at="mid">
                  <b>{dated(DATE)}</b>
                </Readout>
                <Readout label="Sections" href={`#${IDS[0] ?? 'main'}`} at="end">
                  <b>{THESIS.parts.length}</b>
                </Readout>
              </>
            }
          >
            <div className={n.head}>
              <p className={n.over}>
                <span className={n.overLit}>Thesis</span>
                <span>A working draft, expected to change</span>
              </p>
              <h1 className={n.headline}>{THESIS.title}</h1>
            </div>
          </Window>
        </Night>
        <div className={s.sheet}>
          <details className={s.contents} open={!narrow || undefined} key={narrow ? 'folded' : 'open'}>
            <summary className={s.contentsHead}>
              Contents <span>· {THESIS.parts.length} sections</span>
            </summary>
            <nav aria-label="Contents">
              <ol>
                {THESIS.parts.map((p) => (
                  <li key={p.id}>
                    <a href={`#${p.id}`} aria-current={p.id === current ? 'location' : undefined}>
                      <span>{p.no}</span>
                      {p.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </details>

          <article className={s.article}>
            <header className={s.head}>
              {lede && <div className={s.lede}>{block(lede, 'lede')}</div>}
              {claim && <div className={s.openClaim}>{block(claim, 'claim')}</div>}
            </header>
            <section className={s.intro} aria-label="The hypothesis">
              {rest.map((t, i) => block(t, `i${i}`))}
            </section>
            {THESIS.parts.map((p) => (
              <section key={p.id} id={p.id} className={s.part} aria-labelledby={`${p.id}-h`}>
                <h2 id={`${p.id}-h`} className={s.h2}>
                  <span className={s.no}>{p.no}</span>
                  {p.title}
                </h2>
                {p.body.map((t, i) => block(t, `${p.id}-${i}`))}
              </section>
            ))}
            <p className={s.end}>
              <a href={LINKS.thesis}>THESIS.md on GitHub</a> · <a href={LINKS.issues}>Argue with it in an issue</a>
            </p>
          </article>
        </div>
      </main>

      <Footer />
    </div>
  )
}
