import { cx } from '../lib/cx'
import s from './Switcher.module.css'
import { DIRECTIONS, useDocs } from './view'

/*
 * The prototype's own control, not the docs': which direction, and which
 * screen. Graphite, at the foot of the window, so it never reads as part of
 * a design.
 */

export function Switcher() {
  const { v, p, go } = useDocs()
  const here = DIRECTIONS.find((d) => d.id === v)
  return (
    <section className={s.switcher} aria-label="Docs prototype">
      <span className={s.label}>Prototype</span>
      <fieldset className={s.group}>
        <legend className={s.hidden}>Direction</legend>
        {DIRECTIONS.map((d) => (
          <button
            key={d.id}
            type="button"
            className={cx(s.option, d.id === v && s.on)}
            aria-pressed={d.id === v}
            title={d.note}
            onClick={() => go({ v: d.id })}
          >
            <span className={s.letter}>{d.id.toUpperCase()}</span>
            <span className={s.name}>{d.name}</span>
          </button>
        ))}
      </fieldset>
      <fieldset className={s.group}>
        <legend className={s.hidden}>Screen</legend>
        <button type="button" className={cx(s.option, p === 'home' && s.on)} aria-pressed={p === 'home'} onClick={() => go({ p: 'home' })}>
          Home
        </button>
        <button type="button" className={cx(s.option, p === 'page' && s.on)} aria-pressed={p === 'page'} onClick={() => go({ p: 'page' })}>
          Page
        </button>
      </fieldset>
      {here && <span className={s.note}>{here.note}</span>}
    </section>
  )
}
