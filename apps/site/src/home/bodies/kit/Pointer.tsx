import { useEffect, useLayoutEffect, useRef } from 'react'

import s from './pointer.module.css'

/*
 * A person's pointer on a screen of the app at work (the home page's
 * carousel), going to what is done on it and pressing it: a button answered,
 * a message sent, a version shown. It glides from where it was to what it is
 * aimed at (`aim`: a selector within the screen it is laid over, or a way to
 * find it), and while it presses (`press`) it gives a little and rings out.
 * Aimed at nothing it rests at `rest` (a share of the screen across and
 * down); aimed at what isn't there yet (a button that shows once something
 * is typed) it waits where it is, looking each frame for a while, and sets
 * out as soon as it shows; aimed at what has gone (a button that went as it
 * was pressed), it stays where it is. As its story starts over (`ms` going back), it goes
 * back at once, unseen as the screen fades; and coming into sight, it is where it is aimed already.
 *
 * It sits over the screen in the screen's own px, which a page draws scaled.
 */

export type Aim = string | ((within: HTMLElement) => Element | null | undefined) | null

/** Finds a button by what it says, or by its label. */
export const button = (words: string) => (within: HTMLElement) =>
  [...within.querySelectorAll('button')].find((one) => one.textContent?.trim() === words || one.getAttribute('aria-label') === words)

export function Pointer({ aim, press = false, rest, ms }: { aim: Aim; press?: boolean; rest: readonly [number, number]; ms: number }) {
  const me = useRef<HTMLDivElement>(null)
  const was = useRef(ms)
  // Not yet anywhere: it is first put where it is aimed, not glided there from the corner.
  const placed = useRef(false)
  // Puts it where it is aimed now, at once.
  const place = useRef<() => void>(() => {})
  // What it went to last: there, it stays put, as a hand on a mouse does, whatever moves under it (a composer growing as words go into it).
  const went = useRef<Aim | undefined>(undefined)
  useLayoutEffect(() => {
    const el = me.current
    const within = el?.parentElement
    if (!el || !within || !within.offsetWidth) return
    const back = ms < was.current
    was.current = ms
    const jump = back || !placed.current
    if (!jump && went.current === aim) return
    /** Goes to what it is aimed at, or rests (there at once, with `snap`); false while what it is aimed at isn't there. */
    const go = (snap = jump) => {
      // Not drawn yet (its picture not yet scaled to its place): nowhere to go.
      if (!within.getBoundingClientRect().width) return false
      const target = aim === null ? null : typeof aim === 'string' ? within.querySelector(aim) : aim(within)
      if (aim !== null && !target && !snap) return false
      let x = rest[0] * within.offsetWidth
      let y = rest[1] * within.offsetHeight
      if (target) {
        const box = within.getBoundingClientRect()
        const k = box.width / within.offsetWidth || 1
        const r = target.getBoundingClientRect()
        x = (r.left + r.width / 2 - box.left) / k
        y = (r.top + r.height / 2 - box.top) / k
      }
      el.style.transition = snap ? 'none' : ''
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
      if (snap) void el.offsetWidth
      placed.current = true
      went.current = aim
      return true
    }
    place.current = () => void go(true)
    if (go()) return
    // Not there yet: it looks again each frame, for a second and a half at most.
    let frame = 0
    let tries = 0
    const again = () => {
      if (go() || ++tries > 90) return
      frame = requestAnimationFrame(again)
    }
    frame = requestAnimationFrame(again)
    return () => cancelAnimationFrame(frame)
  })
  // Coming into sight, it is put where it is aimed at once: what that is may have been laid out anew while it was out of sight, as the page settled.
  useEffect(() => {
    const within = me.current?.parentElement
    if (!within) return
    const seen = new IntersectionObserver((entries) => {
      if (entries.some((one) => one.isIntersecting)) place.current()
    })
    seen.observe(within)
    return () => seen.disconnect()
  }, [])
  return (
    <div ref={me} className={s.pointer} data-press={press || undefined} aria-hidden="true">
      <i className={s.ring} />
      <svg className={s.arrow} viewBox="0 0 22 22">
        <path d="M2 1.5v16.2l4.3-4.1 3.1 6.9 2.9-1.3-3-6.7h6.1z" />
      </svg>
    </div>
  )
}
