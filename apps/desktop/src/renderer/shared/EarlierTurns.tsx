import { useLayoutEffect, useRef, useState } from 'react'
import { ThreadDivider } from '@althar/ui'
import { messageOf } from '../data/client'
import s from './EarlierTurns.module.css'

/** Fetch near the top; preserve a visible item rather than the total height,
 * which can also grow below the reader while an answer streams. */
export function useEarlierTurns(load: (quiet?: boolean) => Promise<void>, version: unknown, earlier: boolean) {
  const sentinel = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ element: HTMLElement; top: number; box: HTMLElement } | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const active = useRef(false)
  const current = useRef(load)
  useLayoutEffect(() => {
    current.current = load
  }, [load])
  const request = async () => {
    if (active.current) return
    active.current = true
    setFailed(null)
    try {
      await current.current(true)
    } catch (error) {
      setFailed(messageOf(error))
    } finally {
      active.current = false
    }
  }
  useLayoutEffect(() => {
    const saved = anchor.current
    if (saved?.element.isConnected) {
      saved.box.scrollTop += saved.element.getBoundingClientRect().top - saved.top
    }
  }, [version])
  useLayoutEffect(() => {
    const marker = sentinel.current
    if (!marker) return
    let box = marker.parentElement
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement
    if (!box) return
    const scroller = box
    const remember = () => {
      // Let the existing bottom follower own streaming while the reader is there.
      if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 90) {
        anchor.current = null
        return
      }
      const top = scroller.getBoundingClientRect().top
      const element = Array.from(marker.parentElement!.querySelectorAll<HTMLElement>('[data-item]')).find(
        (item) => item.getBoundingClientRect().bottom > top,
      )
      anchor.current = element ? { element, top: element.getBoundingClientRect().top, box: scroller } : null
    }
    const near = () => scroller.getBoundingClientRect().top - marker.parentElement!.getBoundingClientRect().top < scroller.clientHeight
    // Checks of its own, not the reader's scroll, load only while the thread is too short to scroll back through:
    // otherwise a check on opening, before the thread settles at its latest turn, would read it as at the top.
    const short = () => scroller.scrollHeight - scroller.clientHeight < scroller.clientHeight
    const check = (scrolled: boolean) => {
      if (!near()) {
        anchor.current = null
        return
      }
      remember()
      if ((scrolled || short()) && earlier && !failed && scroller.clientHeight > 0) void request()
    }
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            const saved = anchor.current
            if (saved?.element.isConnected) saved.box.scrollTop += saved.element.getBoundingClientRect().top - saved.top
            // A taller window or collapsed content can bring the top back into reach without a scroll.
            check(false)
          })
    if (marker.parentElement) resize?.observe(marker.parentElement)
    resize?.observe(scroller)
    const onScroll = () => check(true)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    // Recheck after every committed page too: short pages may leave no scrollbar to move.
    const initial = requestAnimationFrame(() => {
      initialFrame = requestAnimationFrame(() => check(false))
    })
    let initialFrame = 0
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      resize?.disconnect()
      cancelAnimationFrame(initial)
      cancelAnimationFrame(initialFrame)
    }
  }, [failed, earlier, version])

  return { sentinel, failed, request }
}

export function EarlierTurns({
  load,
  version,
  loading,
  earlier,
}: {
  load: (quiet?: boolean) => Promise<void>
  version: unknown
  loading: boolean
  earlier: boolean
}) {
  const { sentinel, failed, request } = useEarlierTurns(load, version, earlier)
  return (
    <div ref={sentinel} className={s.sentinel}>
      {failed ? (
        <ThreadDivider icon="up" action="Retry" onAction={() => void request()}>
          {failed}
        </ThreadDivider>
      ) : loading ? (
        <ThreadDivider icon="up">Loading…</ThreadDivider>
      ) : null}
    </div>
  )
}
