import { Logo } from '@althar/ui'

import source from '../../../../THESIS.md?raw'
import { LINKS } from '../content/facts'
import { DATE } from '../content/sheet'
import { Stamp } from '../shared/sheet'
import { useCurrent } from '../lib/useCurrent'
import { Masthead } from '../shared/Masthead'
import { block, compile, plain } from './prose'
import s from './Thesis.module.css'

/*
 * The thesis, compiled from THESIS.md at build time and set for reading on
 * the site: the same bar as the landing page, the title with its status
 * stamped as a draft, then the numbered sections in one column with their
 * contents pinned beside it, the one you're in picked out.
 */

const THESIS = compile(source)
const IDS = THESIS.parts.map((p) => p.id)

/*
 * The hypothesis, drawn as the shift it describes: the sentence up to
 * "shifts", then what the shift is from and what it is toward, side by
 * side with an arrow between. Every word stays, in order. If the sentence
 * changes shape, it falls back to a plain paragraph.
 */
function Hypothesis({ text }: { text: string }) {
  const m = /^(.*?\bshifts)\s+from\s+(.*?)\s+toward\s+(.*)$/i.exec(text)
  if (!m) return <p className={s.hypLead}>{text}</p>
  const [, lead, from, to] = m
  return (
    <figure className={s.hypothesis}>
      <p className={s.hypLead}>{lead}</p>
      <div className={s.shift}>
        <p className={s.from}>
          <span>from </span>
          {from}
        </p>
        <svg className={s.arrow} viewBox="0 0 64 12" aria-hidden="true">
          <line x1="0" x2="54" y1="6" y2="6" />
          <path d="M52 1.5 L64 6 L52 10.5 Z" />
        </svg>
        <p className={s.to}>
          <span>toward </span>
          {to}
        </p>
      </div>
    </figure>
  )
}

export function Thesis() {
  const current = useCurrent(IDS)
  const [lede, claim, ...rest] = THESIS.intro
  return (
    <div className={s.page}>
      <Masthead current="thesis" base="/" />

      <main id="main" tabIndex={-1}>
        <header className={s.head}>
          <p className={s.strip}>
            <span className={s.stripNo}>Thesis</span>
            <span>Working research thesis</span>
            <span className={s.stripNote}>Rev C · {DATE}</span>
          </p>
          <div className={s.headGrid}>
            <div>
              <h1 className={s.h1}>{THESIS.title}</h1>
              {lede && <div className={s.lede}>{block(lede, 'lede')}</div>}
              {claim && <Hypothesis text={plain(claim).trim()} />}
            </div>
            <div className={s.stampSide}>
              <Stamp lines={['Draft', 'Working thesis', 'Expected to change']} />
              <p className={s.status}>{THESIS.status.replace(/^Status:\s*Draft\s*[—-]\s*working research thesis,\s*/i, '')}</p>
            </div>
          </div>
        </header>

        <div className={s.body}>
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
            <section className={s.intro} aria-label="The hypothesis">
              {rest.map((t, i) => block(t, `i${i}`))}
            </section>
            {THESIS.parts.map((p) => (
              <section key={p.id} id={p.id} className={s.part} aria-labelledby={`${p.id}-h`}>
                <p className={s.partStrip}>
                  <span className={s.stripNo}>{p.no}</span>
                  <span>Thesis</span>
                </p>
                <h2 id={`${p.id}-h`} className={s.h2}>
                  {p.title}
                </h2>
                {p.body.map((t, i) => block(t, `${p.id}-${i}`))}
              </section>
            ))}
            <p className={s.end}>
              <a href={LINKS.thesis}>THESIS.md on GitHub</a> · <a href={LINKS.discussions}>Argue with it in Discussions</a>
            </p>
          </article>
        </div>
      </main>

      <footer className={s.foot}>
        <span className={s.footBrand}>
          <Logo size={20} /> Althar
        </span>
        <span>Issued for comment · {DATE}</span>
        <a href="/">Back to the site</a>
      </footer>
    </div>
  )
}
