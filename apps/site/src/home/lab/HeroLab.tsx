import { type ReactNode, useSyncExternalStore } from 'react'

import { LightUnder } from '../../shared/lightUnder'
import { Fragment } from '../bodies/desktop/Fragment'
import ascii from './h-ascii.html?raw'
import comic from './h-comic.html?raw'
import paper from './h-paper.html?raw'
import pixel from './h-pixel.html?raw'
import vector from './h-vector.html?raw'
import s from './HeroLab.module.css'

/*
 * Experiments with the first screen in other styles: the same capsule coming
 * in from orbit, as pixel art, ASCII, a vector display, a comic and cut
 * paper. Each is a fragment with its own words and links. `?hero=` picks
 * one, and any `?hero=` shows the switch between them; nothing links here.
 */

export const STYLES = [
  { id: 'pixel', name: 'Pixel art', source: pixel },
  { id: 'ascii', name: 'ASCII', source: ascii },
  { id: 'vector', name: 'Vector CRT', source: vector },
  { id: 'comic', name: 'Comic', source: comic },
  { id: 'paper', name: 'Cut paper', source: paper },
] as const

const unchanging = () => () => {}
const askedFor = () => new URLSearchParams(window.location.search).get('hero')

/** The style asked for with `?hero=`, if any; none in the prerender. */
export const useHeroAsked = () => useSyncExternalStore(unchanging, askedFor, () => null)

export function HeroLab({ id, nav }: { id: string; nav: ReactNode }) {
  const style = STYLES.find((one) => one.id === id)
  return (
    <div className={s.hero}>
      <LightUnder tone="ink" className={s.under} />
      {style && <Fragment key={style.id} source={style.source} className={s.stage} decorative={false} />}
      {nav}
    </div>
  )
}

export function HeroSwitch({ current }: { current: string }) {
  return (
    <label className={s.switch}>
      Hero
      <select
        value={current}
        onChange={(event) => {
          window.location.search = `?hero=${event.target.value}`
        }}
      >
        <option value="photo">Photo</option>
        {STYLES.map((one) => (
          <option key={one.id} value={one.id}>
            {one.name}
          </option>
        ))}
      </select>
    </label>
  )
}
