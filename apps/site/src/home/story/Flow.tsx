import { type CSSProperties, useRef, useState } from 'react'

import { useMedia } from '../../lib/browser'
import { cx } from '../../lib/cx'
import { type Tile, TILES } from '../bodies/desktop/Bento'
import { KM } from './Altitude'
import s from './Flow.module.css'
import { FLOW_ACTS, FLOW_REST, SCENE } from './scenes'
import { useScrolled } from './scroll'
import st from './Story.module.css'

/*
 * The flow, told as the lead puts it: many agents at once, one shared
 * context, and work that keeps going while you're away, one after another,
 * each made by two features. Pinned, the scroll is
 * its clock, as it is for the board and the review: down the left the three
 * acts, the one being told open, its two features under it with a bar each
 * that fills as its turn goes, the board's own bars; on the right each
 * feature drawn large in its light tone (Bento.tsx's drawings, whole and
 * playing), one taking over from the last as the scroll reaches it. The
 * scene's heading and lead hold over them while it's pinned, so what is
 * being answered stays in sight. Under them the rest of the
 * features, each drawn small.
 *
 * On a tablet or a phone, and with motion reduced, nothing is pinned: each
 * act in turn, each feature's drawing under its words.
 */

const tile = (id: string) => TILES.find((t) => t.id === id)!
/** The features told large, in the acts' order, each with its act. */
const FEATURES = FLOW_ACTS.flatMap((act, a) => act.tiles.map((id) => ({ act: a, tile: tile(id) })))
const REST = FLOW_REST.map(tile)

/** How long, in features, a drawing takes to go at the end of its turn, and the next to come in at the start of its own: one goes, then the other comes, never the two over each other. */
const FADE = 0.12

const clamp = (v: number) => Math.min(1, Math.max(0, v))
/** The features told large, drawn on the paper's light ground; the rest in the console's dark, as they are drawn. */
const large = (t: Tile) => t.piece('light')
const small = (t: Tile) => t.piece('dark')
/** How much of feature `i` shows with the story at `f` (0 to its count, in features). */
const shown = (i: number, f: number) =>
  Math.min(i === 0 ? 1 : clamp((f - i) / FADE), i === FEATURES.length - 1 ? 1 : clamp((i + 1 - f) / FADE))

function Words({ t, on }: { t: Tile; on?: boolean }) {
  return (
    <>
      <h3 className={s.ft}>{t.title}</h3>
      <div className={s.lw}>
        <p className={s.fl} inert={on === false || undefined}>
          {t.lead}
        </p>
      </div>
    </>
  )
}

function ActName({ n, children }: { n: number; children: string }) {
  return (
    <p className={s.actName}>
      <span className={s.n}>{String(n).padStart(2, '0')}</span>
      {children}
    </p>
  )
}

export function Flow() {
  const box = useRef<HTMLDivElement>(null)
  const narrow = useMedia('(max-width: 900px)')
  const [f, setF] = useState(0)
  const still = useScrolled(box, { pin: narrow ? 0 : 4.4, bare: true }, (p) => setF(p * FEATURES.length), 0)
  const stacked = narrow || still
  const on = Math.min(FEATURES.length - 1, Math.floor(f))
  const act = FEATURES[on]!.act
  const head = (
    <div className={cx(st.head, s.head)}>
      <h2 id="flow-h" className={st.title}>
        {SCENE.flow.title}
      </h2>
      <p className={st.lead}>{SCENE.flow.lead}</p>
    </div>
  )

  return (
    <section id="flow" className={cx(st.scene, s.flow)} aria-labelledby="flow-h" data-km={KM.flow}>
      {stacked ? (
        <div className={st.wrap}>
          {head}
          <div className={s.stack}>
            {FLOW_ACTS.map((a, ai) => (
              <div key={a.name} className={s.stackAct}>
                <ActName n={ai + 1}>{a.name}</ActName>
                {a.tiles.map((id) => {
                  const t = tile(id)
                  return (
                    <article key={id} className={s.stackFeature} data-on="">
                      <Words t={t} />
                      <div className={s.pic}>{large(t)}</div>
                    </article>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div ref={box} className={s.tour}>
          <div className={cx(st.stick, s.stick)} data-stick="">
            <div className={st.wrap}>{head}</div>
            <div className={cx(st.wrap, s.grid)}>
              <ol className={s.acts}>
                {FLOW_ACTS.map((a, ai) => (
                  <li key={a.name} className={s.act} data-on={ai === act || undefined} data-done={ai < act || undefined}>
                    <ActName n={ai + 1}>{a.name}</ActName>
                    <div className={s.bars} aria-hidden="true">
                      {a.tiles.map((id, k) => {
                        const i = ai * 2 + k
                        return <i key={id} data-on={i === on || undefined} style={{ '--fill': clamp(f - i).toFixed(3) } as CSSProperties} />
                      })}
                    </div>
                    <div className={s.more} inert={ai !== act || undefined}>
                      <div>
                        {a.tiles.map((id, k) => (
                          <div key={id} className={s.feature} data-on={ai * 2 + k === on || undefined}>
                            <Words t={tile(id)} on={ai * 2 + k === on} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              <div className={s.stage} aria-hidden="true">
                {FEATURES.map(({ tile: t }, i) => {
                  const o = shown(i, f)
                  return (
                    <div
                      key={t.id}
                      className={s.slide}
                      data-off={o === 0 || undefined}
                      style={{ opacity: o, '--o': o.toFixed(3) } as CSSProperties}
                    >
                      {large(t)}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className={st.wrap}>
        <ul className={s.rest}>
          {REST.map((t) => (
            <li key={t.id}>
              <div className={s.thumb}>{small(t)}</div>
              <h3 className={s.rt}>{t.title}</h3>
              <p className={s.rl}>{t.lead}</p>
            </li>
          ))}
        </ul>
        <p className={cx(st.title, s.end)}>
          And so, <b>so much more.</b>
        </p>
      </div>
    </section>
  )
}
