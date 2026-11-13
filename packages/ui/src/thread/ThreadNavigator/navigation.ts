import { useEffect, useState, type RefObject } from 'react'

export interface ThreadStop {
  readonly id: number
  readonly target: HTMLElement
  readonly prompt: string
  readonly reply: string
}

const words = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 280)

/** Index only the messages rendered in this scroller, including earlier turns once opened. */
export function useThreadNavigation(scroll: RefObject<HTMLElement | null>) {
  const [stops, setStops] = useState<readonly ThreadStop[]>([])
  const [active, setActive] = useState<HTMLElement | null>(null)
  const [overflow, setOverflow] = useState(false)
  useEffect(() => {
    const el = scroll.current
    if (!el) return
    let frame = 0
    let indexed: ThreadStop[] = []
    const ids = new WeakMap<HTMLElement, number>()
    let nextId = 0
    const position = () => {
      setOverflow(el.scrollHeight > el.clientHeight + 1)
      const edge = el.getBoundingClientRect().top + 40
      let current = indexed[0]?.target ?? null
      for (const stop of indexed) {
        if (stop.target.getBoundingClientRect().top > edge) break
        current = stop.target
      }
      setActive(current)
    }
    const read = () => {
      frame = 0
      indexed = []
      for (const node of el.querySelectorAll<HTMLElement>('[data-thread-prompt], [data-thread-preview]')) {
        if (node.closest('[hidden], [aria-hidden="true"]')) continue
        if (node.hasAttribute('data-thread-prompt')) {
          const id = ids.get(node) ?? nextId++
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
          return next?.target === one.target && next.prompt === one.prompt && next.reply === one.reply
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
      mutation.disconnect()
      resize.disconnect()
      el.removeEventListener('scroll', position)
    }
  }, [scroll])
  return { stops, active, overflow }
}
