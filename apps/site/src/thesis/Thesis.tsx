import { useEffect, useRef } from 'react'

import source from '../../../../THESIS.md?raw'
import { LINKS } from '../content/facts'
import { DATE } from '../content/sheet'
import { useCurrent } from '../lib/useCurrent'
import { Bar } from '../shared/Bar'
import { Close } from '../shared/Close'
import { block, compile } from './prose'
import s from './Thesis.module.css'

/*
 * The thesis, compiled from THESIS.md at build time. The title, the
 * hypothesis and the numbered sections share one reading column, with the
 * contents beside it. Figures in the sections are rails.
 */

export const THESIS_SOURCE = source
const THESIS = compile(THESIS_SOURCE)
const IDS = THESIS.parts.map((p) => p.id)

export function Thesis() {
  const current = useCurrent(IDS)
  const pin = useRef<HTMLDivElement>(null)
  const [lede, claim, ...rest] = THESIS.intro

  useEffect(() => {
    const el = pin.current
    if (!el) return
    const onScroll = () => {
      if (window.scrollY > 8) el.dataset.scrolled = ''
      else delete el.dataset.scrolled
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className={s.page}>
      <div className={s.pin} ref={pin}>
        <Bar tone="paper" base="/" />
      </div>

      <main id="main" tabIndex={-1}>
        <div className={s.sheet}>
          <p className={s.meta}>
            <span className={s.kicker}>
              <i aria-hidden="true" />
              Research / Thesis
            </span>
            <span>Rev C · {DATE}</span>
            <span className={s.draft}>Draft · Working thesis · Expected to change</span>
          </p>

          <nav className={s.contents} aria-label="Contents">
            <p className={s.contentsHead}>Contents</p>
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

          <article className={s.article}>
            <header className={s.head}>
              <h1 className={s.h1}>{THESIS.title}</h1>
              {lede && <div className={s.lede}>{block(lede, 'lede')}</div>}
              {claim && <div className={s.openClaim}>{block(claim, 'claim')}</div>}
            </header>
            <section className={s.intro} aria-label="The hypothesis">
              {rest.map((t, i) => block(t, `i${i}`))}
            </section>
            {THESIS.parts.map((p) => (
              <section key={p.id} id={p.id} className={s.part} aria-labelledby={`${p.id}-h`}>
                <p className={s.partNo}>
                  <b>{p.no}</b>
                  Section
                </p>
                <h2 id={`${p.id}-h`} className={s.h2}>
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

      <Close />
    </div>
  )
}
