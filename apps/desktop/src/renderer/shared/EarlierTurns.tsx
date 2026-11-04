import { useLayoutEffect, useRef, useState } from 'react'
import { ThreadDivider } from '@althar/ui'

/** Fetch near the top; preserve a visible item rather than the total height,
 * which can also grow below the reader while an answer streams. */
export function useEarlierTurns(load: () => Promise<void>, version: unknown, earlier: boolean) {
  const sentinel = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ element: HTMLElement; top: number; box: HTMLElement } | null>(null)
  const [failed, setFailed] = useState(false)
  const active = useRef(false)
  const current = useRef(load)
  useLayoutEffect(() => {
    current.current = load
  }, [load])
  const request = async () => {
    if (active.current) return
    active.current = true
    setFailed(false)
    try {
      await current.current()
    } catch {
      setFailed(true)
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
    const check = () => {
      remember()
      if (
        earlier &&
        !failed &&
        scroller.clientHeight > 0 &&
        scroller.getBoundingClientRect().top - marker.getBoundingClientRect().top < scroller.clientHeight
      )
        void request()
    }
    const resize =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            const saved = anchor.current
            if (saved?.element.isConnected) saved.box.scrollTop += saved.element.getBoundingClientRect().top - saved.top
          })
    if (marker.parentElement) resize?.observe(marker.parentElement)
    scroller.addEventListener('scroll', check, { passive: true })
    // The initial page starts at the latest turn. Only scrolling back requests history.
    return () => {
      scroller.removeEventListener('scroll', check)
      resize?.disconnect()
    }
  }, [failed, earlier])

  return { sentinel, failed, request }
}

export function EarlierTurns({
  load,
  version,
  loading,
  earlier,
}: {
  load: () => Promise<void>
  version: unknown
  loading: boolean
  earlier: boolean
}) {
  const { sentinel, failed, request } = useEarlierTurns(load, version, earlier)
  return (
    <div ref={sentinel}>
      {failed ? (
        <ThreadDivider icon="up" action="Retry" onAction={() => void request()}>
          Earlier turns couldn't load
        </ThreadDivider>
      ) : loading ? (
        <ThreadDivider icon="up">Loading…</ThreadDivider>
      ) : null}
    </div>
  )
}
