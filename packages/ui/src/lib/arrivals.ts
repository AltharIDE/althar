import { type RefObject, useEffect } from 'react'

import { MOTION, reducedMotion } from './motion'

/*
 * What lands in a thread comes in (DESIGN.md, Motion): a reply, a round, a
 * card, the person's own message. Each element added straight into a place
 * marked `data-arrivals` (the thread, a turn, a round) rises a little into
 * its place as it fades in. Not what the thread is drawn with: nothing
 * arrives in its first moments on screen, while it is hidden, when many
 * come at once (another thread, earlier messages), where one thing takes
 * another's place (a placeholder, by what it held), or where the element
 * comes in by an animation of its own. With reduced motion it only fades.
 * Words streaming into a message aren't added there, so they stay still.
 */

/** What is drawn as it opens is the thread, not an arrival. */
const OPENING = 400
/** More than this many at once is the thread drawn afresh. */
const FRESH = 6

/** Brings in what lands in `ref`'s places for arrivals, from its first moments on. */
export function useArrivals(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current
    if (root === null || typeof root.animate !== 'function') return
    const opened = performance.now()
    const observer = new MutationObserver((records) => {
      if (performance.now() - opened < OPENING || !(root.checkVisibility?.() ?? true)) return
      const replaced = new Set<Node>()
      const added: HTMLElement[] = []
      for (const record of records) {
        if (record.removedNodes.length > 0) replaced.add(record.target)
        for (const node of record.addedNodes) if (node instanceof HTMLElement && arrivesIn(record.target)) added.push(node)
      }
      if (added.length > FRESH) return
      const reduced = reducedMotion()
      for (const el of added) {
        if (!el.isConnected || replaced.has(el.parentElement!) || ownEntrance(el)) continue
        el.animate(
          reduced
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [
                { opacity: 0, translate: '0px 6px' },
                { opacity: 1, translate: '0px 0px' },
              ],
          reduced ? { duration: MOTION.exit.duration, easing: 'linear' } : MOTION.enter,
        )
      }
    })
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [ref])
}

const arrivesIn = (target: Node) => target instanceof Element && target.hasAttribute('data-arrivals')

/** It, or what it holds, comes in by a CSS animation of its own (a permission's card does). */
const ownEntrance = (el: Element) =>
  el
    .getAnimations({ subtree: true })
    .some(
      (one) =>
        typeof CSSAnimation !== 'undefined' && one instanceof CSSAnimation && one.effect?.getComputedTiming().iterations !== Infinity,
    )
