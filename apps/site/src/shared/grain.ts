import { drawGrain } from '@althar/ui/opening'
import { type RefObject, useLayoutEffect } from 'react'

import { seeded } from './footer/random'

/** A dark window's grain: a 128px tile of noise, drawn once per seed, laid as `ref`'s background. */
const tiles = new Map<number, string>()

export function useGrain(ref: RefObject<HTMLElement | null>, seed: number) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let url = tiles.get(seed)
    if (!url) {
      const tile = document.createElement('canvas')
      tile.width = tile.height = 128
      const context = tile.getContext('2d')
      if (!context) return
      drawGrain(context, 128, seeded(seed))
      url = tile.toDataURL()
      tiles.set(seed, url)
    }
    el.style.backgroundImage = `url(${url})`
  }, [ref, seed])
}
