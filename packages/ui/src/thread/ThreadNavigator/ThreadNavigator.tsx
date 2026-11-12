import { useCallback, useEffect, useRef, type RefObject } from 'react'

import { cx } from '../../lib/cx'
import type { RootProps } from '../../lib/props'
import { HoverCard, HoverCardProvider } from '../../primitives/HoverCard/HoverCard'
import { useThreadNavigation } from './navigation'
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

/** A quiet tick per message: point or focus to preview, press to return to it. */
export function ThreadNavigator({ scroll, text, className, ref, ...rest }: ThreadNavigatorProps) {
  const t = { ...threadNavigatorText, ...text }
  const { stops, active, overflow } = useThreadNavigation(scroll)
  const own = useRef<HTMLElement | null>(null)
  const both = useCallback(
    (el: HTMLElement | null) => {
      own.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    },
    [ref],
  )
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
          <HoverCard
            key={i}
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
              aria-label={t.jump(i + 1, stop.prompt)}
              aria-current={stop.target === active ? 'location' : undefined}
              onKeyDown={(event) => {
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
              }}
              onClick={() => {
                const el = scroll.current
                if (el) el.scrollTop += stop.target.getBoundingClientRect().top - el.getBoundingClientRect().top - 30
              }}
            >
              <span className={s.tick} aria-hidden="true" />
            </button>
          </HoverCard>
        ))}
      </HoverCardProvider>
    </nav>
  )
}
