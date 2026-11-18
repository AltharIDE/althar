import { ListMotion } from '@althar/ui'
import { type ReactNode, useRef } from 'react'

/**
 * One motion scope across the conversation and composer: a corrected send travels between them. `version` is what its
 * messages' places stand on (ListMotion's): the screen drawn again with it as it was, for a word typed or streamed or a
 * second ticking, reads nothing of the page.
 */
export function MessageMotion({
  children,
  className,
  version,
}: {
  children: ReactNode
  className?: string | undefined
  version?: unknown
}) {
  const root = useRef<HTMLDivElement>(null)
  return (
    <div ref={root} className={className}>
      <ListMotion within={root} {...(version === undefined ? {} : { version })}>
        {children}
      </ListMotion>
    </div>
  )
}
