import { type KeyboardEvent, memo, useCallback, useEffect, useRef, type RefObject } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { virtualThreadIn } from '../../lib/virtual'
import { HoverCard, HoverCardProvider } from '../../primitives/HoverCard/HoverCard'
import { type ThreadStop, useThreadNavigation } from './navigation'
import s from './ThreadNavigator.module.css'

export interface ThreadNavigatorText {
  label: string
  jump: (position: number, prompt: string) => string
}

export const threadNavigatorText: ThreadNavigatorText = {
  label: 'Conversation navigation',
  jump: (position, prompt) => `Go to message ${position}: ${prompt}`,
}

export type ThreadNavigatorProps = RootProps<
  'nav',
  {
    scroll: RefObject<HTMLElement | null>
    text?: Partial<ThreadNavigatorText>
  }
>

/** Takes the view to a stop's message, 30px under its top. */
const goTo = (el: HTMLElement | null, stop: ThreadStop) => {
  if (!el) return
  // A thread drawn only near the view draws the message first, and puts it there.
  if (stop.key !== undefined) virtualThreadIn(el)?.bring(stop.key, 30)
  else if (stop.target) el.scrollTop += stop.target.getBoundingClientRect().top - el.getBoundingClientRect().top - 30
}

/** A quiet tick per message: point or focus to preview, press to return to it. */
export function ThreadNavigator({ scroll, text, className, ref, ...rest }: ThreadNavigatorProps) {
  const t = { ...threadNavigatorText, ...text }
  const { stops, active, overflow } = useThreadNavigation(scroll)
  const activeIndex = stops.findIndex((stop) => stop.id === active)
  const own = useRef<HTMLElement | null>(null)
  const both = useCallback(
    (el: HTMLElement | null) => {
      own.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    },
    [ref],
  )
  // Stable, so a stop redraws only where it changes: in a long thread, the few by the one in view.
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.defaultPrevented) return
    const buttons = Array.from(own.current?.querySelectorAll('button') ?? [])
    const at = buttons.findIndex((button) => button === event.target)
    if (at < 0) return
    let next = at
    switch (event.key) {
      case 'ArrowUp':
        next = Math.max(0, at - 1)
        break
      case 'ArrowDown':
        next = Math.min(buttons.length - 1, at + 1)
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = buttons.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    buttons[next]?.focus()
  }, [])
  const go = useCallback((stop: ThreadStop) => goTo(scroll.current, stop), [scroll])
  useEffect(() => {
    const nav = own.current
    const current = nav?.querySelector<HTMLElement>('[aria-current]')
    if (!nav || !current) return
    if (current.offsetTop < nav.scrollTop) nav.scrollTop = current.offsetTop
    else if (current.offsetTop + current.offsetHeight > nav.scrollTop + nav.clientHeight)
      nav.scrollTop = current.offsetTop + current.offsetHeight - nav.clientHeight
  }, [active, overflow, stops.length])
  if (!overflow || stops.length < 2) return null
  return (
    <nav
      ref={both}
      aria-label={t.label}
      className={cx(s.navigator, className)}

      {...rest}
    >
      <HoverCardProvider delay={100}>
        {stops.map((stop, i) => (
          <Stop
            key={stop.id}
            stop={stop}
            label={t.jump(i + 1, stop.prompt)}
            distance={activeIndex < 0 ? 3 : Math.min(Math.abs(i - activeIndex), 3)}
            current={stop.id === active}
            onKeyDown={onKeyDown}
            onGo={go}
          />
        ))}
      </HoverCardProvider>
    </nav>
  )
}

/** A stop's tick, with its preview: drawn again only when it, or how near the one in view it is, changes. */
const Stop = memo(function Stop({
  stop,
  label,
  distance,
  current,
  onKeyDown,
  onGo,
}: {
  stop: ThreadStop
  label: string
  distance: number
  current: boolean
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
  onGo: (stop: ThreadStop) => void
}) {
  return (
    <HoverCard
      placement="left"
      align="center"
      className={s.preview}
      card={
        <>
          <span className={s.prompt}>{stop.prompt}</span>
          {stop.reply && <span className={s.reply}>{stop.reply}</span>}
        </>
      }
    >
      <button
        type="button"
        className={s.stop}
        aria-label={label}
        data-distance={distance}
        aria-current={current ? 'location' : undefined}
        onKeyDown={onKeyDown}
        onClick={() => onGo(stop)}
      >
        <span className={s.tick} aria-hidden="true" />
      </button>
    </HoverCard>
  )
})
