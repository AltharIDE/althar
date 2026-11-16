import { useEffect, useState, type RefObject } from 'react'

import { virtualThreadIn, type VirtualThread } from '../../lib/virtual'

export interface ThreadStop {
  readonly id: string
  /** The message, where it is drawn: in a thread drawn whole. */
  readonly target: HTMLElement | null
  /** Its block's key, in a thread drawn only near the view (VirtualBlocks), which draws it to go there. */
  readonly key?: string
  readonly prompt: string
  readonly reply: string
}

const words = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 280)

/**
 * Index the messages in this scroller, including earlier turns once opened: those a thread drawn only near the view holds,
 * drawn or not, or else those rendered.
 */
export function useThreadNavigation(scroll: RefObject<HTMLElement | null>) {
  const [stops, setStops] = useState<readonly ThreadStop[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [overflow, setOverflow] = useState(false)
  useEffect(() => {
    const el = scroll.current
    if (!el) return
    let frame = 0
    let indexed: ThreadStop[] = []
    const ids = new WeakMap<HTMLElement, string>()
    let nextId = 0
    const position = () => {
      setOverflow(el.scrollHeight > el.clientHeight + 1)
      const virtual = virtualThreadIn(el)
      if (virtual !== undefined) {
        // The last stop above the edge, by where each is laid out or would be: they come in order.
        const edge = el.scrollTop + 40
        let low = 0
        let high = indexed.length - 1
        let found = -1
        while (low <= high) {
          const mid = (low + high) >> 1
          const top = virtual.topOf(indexed[mid]!.key ?? '')
          if (top !== null && top <= edge) {
            found = mid
            low = mid + 1
          } else high = mid - 1
        }
        setActive(indexed[Math.max(found, 0)]?.id ?? null)
        return
      }
      const edge = el.getBoundingClientRect().top + 40
      let current = indexed[0]?.id ?? null
      for (const stop of indexed) {
        if ((stop.target?.getBoundingClientRect().top ?? 0) > edge) break
        current = stop.id
      }
      setActive(current)
    }
    // A thread drawn only near the view changes what it holds with nothing drawn changing (a message below, a preview
    // far above), so it says so: heard for as long as it is the scroller's.
    let heard: VirtualThread | undefined
    let stopHearing: (() => void) | undefined
    const read = () => {
      frame = 0
      indexed = []
      const virtual = virtualThreadIn(el)
      if (virtual !== heard) {
        stopHearing?.()
        heard = virtual
        stopHearing = virtual?.subscribe(schedule)
      }
      if (virtual !== undefined)
        indexed = virtual
          .stops()
          .map((stop) => ({ id: `virtual-${stop.key}`, key: stop.key, target: null, prompt: stop.prompt, reply: stop.reply }))
      else
        for (const node of el.querySelectorAll<HTMLElement>('[data-thread-prompt], [data-thread-preview]')) {
          if (node.closest('[hidden], [aria-hidden="true"]')) continue
          if (node.hasAttribute('data-thread-prompt')) {
            const id = ids.get(node) ?? `drawn-${nextId++}`
            ids.set(node, id)
            indexed.push({ id, target: node, prompt: words(node.querySelector('[data-thread-preview]') ?? node), reply: '' })
          } else if (!node.closest('[data-thread-prompt]')) {
            const stop = indexed.at(-1)
            if (stop && stop.reply.length < 280)
              indexed[indexed.length - 1] = { ...stop, reply: `${stop.reply} ${words(node)}`.trim().slice(0, 280) }
          }
        }
      setStops((previous) =>
        previous.length === indexed.length &&
        previous.every((one, i) => {
          const next = indexed[i]
          return next?.id === one.id && next.target === one.target && next.prompt === one.prompt && next.reply === one.reply
        })
          ? previous
          : indexed,
      )
      position()
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }
    const resize = new ResizeObserver(position)
    const watch = () => {
      resize.disconnect()
      resize.observe(el)
      for (const child of el.children) resize.observe(child)
      schedule()
    }
    const mutation = new MutationObserver(watch)
    mutation.observe(el, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'data-thread-prompt'],
    })
    watch()
    el.addEventListener('scroll', position, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      stopHearing?.()
      mutation.disconnect()
      resize.disconnect()
      el.removeEventListener('scroll', position)
    }
  }, [scroll])
  return { stops, active, overflow }
}
