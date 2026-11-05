import skyUrl from '../../home/hero/plate/sky.webp'
import t from '../../home/bodies/kit/type.module.css'
import { cx } from '../../lib/cx'
import { Get, OtherMac } from '../../shared/Close'
import { Footer } from '../../shared/footer/Footer'
import { CHAPTERS, END } from '../chapters'
import s from './Plan.module.css'

/*
 * PROTOTYPE. B: Flight plan. The first screen breaks through the cloud
 * right under it, and from there the page is paper, laid out as a flight
 * plan: each claim a numbered stage on a hairline, its headline at the left
 * and why at the right, and its picture under it. A picture drawn for the
 * dark stands in a window lit as the first screen's cabin is, so the page
 * keeps one ground and the dark is something you look into. It ends on the
 * download, in the same rows.
 */

export function Plan() {
  return (
    <main id="main" tabIndex={-1} className={s.plan}>
      <div
        className={s.below}
        style={{ backgroundImage: `linear-gradient(#050302, rgba(5, 3, 2, 0) 46%), url(${skyUrl})` }}
        aria-hidden="true"
      />
      <div className={s.stages}>
        {CHAPTERS.map((c, i) => (
          <section key={c.id} id={c.id} className={s.stage} aria-labelledby={`${c.id}-h`}>
            <p className={s.row}>
              <span className={s.no}>{String(i + 1).padStart(2, '0')}</span>
              <span>{c.name}</span>
            </p>
            <div className={s.head}>
              <h2 id={`${c.id}-h`} className={cx(t.title, s.title)}>
                {c.title}
              </h2>
              <p className={cx(t.lead, s.lead)}>{c.lead}</p>
            </div>
            <div className={cx(s.picture, c.ground === 'dark' && s.window, s[c.id])}>
              <c.Picture />
            </div>
          </section>
        ))}
        <section className={cx(s.stage, s.end)} aria-label="Download Althar">
          <p className={s.row}>
            <span className={s.no}>06</span>
            <span>Get Althar</span>
          </p>
          <div className={s.head}>
            <h2 className={cx(t.title, s.title)}>
              {END.line} <b>{END.bold}</b>
            </h2>
            <div className={s.get}>
              <Get tone="paper" />
              <OtherMac tone="paper" />
            </div>
          </div>
        </section>
      </div>
      <Footer />
    </main>
  )
}
