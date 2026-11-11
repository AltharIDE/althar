import type { ReactNode } from 'react'

import { Console, type Scene } from '../home/bodies/desktop/DesktopBody'
import { cx } from '../lib/cx'
import type { Direction } from './direction'
import s from './flow.module.css'
import { ALSO_EIGHT, ALSO_NINE, EIGHT, NINE, type Piece } from './pieces'

/*
 * What keeps you in flow: the console as it is, then the small things under
 * it, smaller than its modules so they read as their own part (the canvas
 * and the browser among them), and what isn't drawn as a row of words.
 * Each direction lays the small things out another way.
 */

export interface Flow {
  scene?: Scene
  body: ReactNode
  /** A station of its own after the flow, where a direction gives one. */
  after?: ReactNode
}

type Layout = 'three' | 'four' | 'cards' | 'rows'

/** The small things: a smaller head, then each feature, its words and its drawing, as `layout` lays them out. */
function Small({ items, layout }: { items: Piece[]; layout: Layout }) {
  return (
    <div className={s.sub}>
      <h3 className={s.subhead}>
        And the small things, <b>done right.</b>
      </h3>
      <ol className={cx(s.grid, s[layout])} data-light="">
        {items.map((p, i) => (
          <li key={p.id} className={s.item}>
            <div className={s.words}>
              <span className={s.plate}>
                <b>{String(i + 1).padStart(2, '0')}</b>
                <i className={s.led} />
              </span>
              <h4 className={s.title}>{p.title}</h4>
              <p className={s.lead}>{p.lead}</p>
            </div>
            <div className={s.pic}>{p.draw()}</div>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** Features as words alone, in a row between hairlines. */
function Also({ words }: { words: readonly string[] }) {
  return (
    <div className={s.also}>
      <span className={s.alsoLabel}>And also</span>
      <ul className={s.alsoList}>
        {words.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </div>
  )
}

const flow = (items: Piece[], layout: Layout, also: readonly string[]): Flow => ({
  body: (
    <>
      <Console />
      <Small items={items} layout={layout} />
      <Also words={also} />
    </>
  ),
})

export const FLOW: Direction<Flow>[] = [
  { key: 'a', name: 'Three across, three rows (with Drop in anything drawn)', value: flow(NINE, 'three', ALSO_NINE) },
  { key: 'b', name: 'Four across, two rows', value: flow(EIGHT, 'four', ALSO_EIGHT) },
  { key: 'c', name: 'Four across, as cards: the picture, then its words', value: flow(EIGHT, 'cards', ALSO_EIGHT) },
  { key: 'd', name: 'Two columns of rows: the picture beside its words', value: flow(EIGHT, 'rows', ALSO_EIGHT) },
]
