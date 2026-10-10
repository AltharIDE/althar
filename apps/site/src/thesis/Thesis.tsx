import source from '../../../../THESIS.md?raw'
import { LINKS } from '../content/facts'
import { DATE } from '../content/sheet'
import { useCurrent } from '../lib/useCurrent'
import { useNarrow } from '../home/bodies/kit/Narrow'
import { Footer } from '../shared/footer/Footer'
import { Lit } from '../shared/Lit'
import { Nav } from '../shared/Nav'
import { block, compile } from './prose'
import s from './Thesis.module.css'

/*
 * The thesis, compiled from THESIS.md at build time. Its title stands in
 * the site's light; the hypothesis and the numbered sections share one
 * reading column under it, with the contents beside it; narrower, the
 * contents fold shut over the column. Each section opens with its number
 * and its title, the claims stand large, and figures in the sections are
 * rails.
 */

export const THESIS_SOURCE = source
const THESIS = compile(THESIS_SOURCE)
const IDS = THESIS.parts.map((p) => p.id)

export function Thesis() {
  const current = useCurrent(IDS)
  const narrow = useNarrow(1000)
  const [lede, claim, ...rest] = THESIS.intro

  return (
    <div className={s.page}>
      <Nav />

      <main id="main" tabIndex={-1}>
        <Lit kicker={<>Thesis · Rev C · {DATE}</>} title={THESIS.title} lead="A working thesis. A draft, and expected to change." />
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
