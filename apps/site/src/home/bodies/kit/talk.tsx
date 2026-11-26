import { Composer } from '@althar/ui'
import { type RefObject, useLayoutEffect, useRef, useState } from 'react'

/*
 * A conversation at work in the carousel's views (the board's, the
 * canvas's): what you ask typed into the composer on the views' clock, what
 * is said back streamed in, and the conversation gliding up to make room for
 * whatever it gains, never jumping. The view is drawn again only at its
 * story's moments; the typing between them writes its own text, every frame.
 */

const none = () => {}

/** What of `text` is written `ms` into the story, typed from `from` at `rate` characters a second. */
export const typed = (text: string, ms: number, from: number, rate = 70) =>
  ms < from ? '' : text.slice(0, Math.min(text.length, Math.floor(((ms - from) / 1000) * rate)))

/** How long `text` takes to type at `rate` characters a second. */
export const typing = (text: string, rate = 70) => Math.ceil((text.length / rate) * 1000)

/** Text streamed on the clock: written straight into its own span every frame while `active`. */
export function Typed({
  text,
  from,
  rate,
  read,
  active,
}: {
  text: string
  from: number
  rate?: number
  read: () => number
  active: boolean
}) {
  const words = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = words.current
    if (!el) return
    let length = -1
    const draw = () => {
      const now = typed(text, read(), from, rate)
      if (now.length === length) return
      length = now.length
      el.textContent = now
    }
    draw()
    if (!active) return
    let frame = 0
    const tick = () => {
      draw()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [text, from, rate, read, active])
  return <span ref={words} />
}

/** The composer, what is `composing` at the clock's moment typed in it (drawn again only as a letter lands), empty once it is sent. */
export function Typing({
  composing,
  read,
  active,
  placeholder,
}: {
  composing: (ms: number) => string
  read: () => number
  active: boolean
  placeholder: string
}) {
  const [value, setValue] = useState(() => composing(read()))
  useLayoutEffect(() => {
    const draw = () => {
      const next = composing(read())
      setValue((was) => (was === next ? was : next))
    }
    draw()
    if (!active) return
    let frame = 0
    const tick = () => {
      draw()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [composing, read, active])
  return <Composer value={value} onChange={none} onSubmit={none} placeholder={placeholder} />
}

/**
 * Whatever moves the conversation, it glides rather than jumps: the list
 * gaining or losing at its foot (a message, a line streamed, a card grown),
 * and the room it has changing (the composer growing as words go into it,
 * shrinking as they are sent). Either way the list is played from where it
 * was to where it is, from wherever a glide already has it.
 */
export function useGlide(list: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = list.current
    const room = el?.parentElement
    if (!el || !room) return
    let height = el.offsetHeight
    let space = room.clientHeight
    const ro = new ResizeObserver(() => {
      // Held to the foot of its room, the list moves up by what it gains, and by what its room loses.
      const by = el.offsetHeight - height - (room.clientHeight - space)
      height = el.offsetHeight
      space = room.clientHeight
      if (!by) return
      const at = new DOMMatrixReadOnly(getComputedStyle(el).transform).m42
      el.style.transition = 'none'
      el.style.transform = `translateY(${(at + by).toFixed(1)}px)`
      void el.offsetHeight
      el.style.transition = 'transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1)'
      el.style.transform = ''
    })
    ro.observe(el)
    ro.observe(room)
    return () => ro.disconnect()
  }, [list])
}
