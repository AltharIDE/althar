import { ListMotion } from '@althar/ui'
import { type ReactNode, useRef } from 'react'

/** One motion scope across the conversation and composer: a corrected send travels between them. */
export function MessageMotion({ children, className }: { children: ReactNode; className?: string | undefined }) {
  const root = useRef<HTMLDivElement>(null)
  return (
    <div ref={root} className={className}>
      <ListMotion within={root}>{children}</ListMotion>
    </div>
  )
}
