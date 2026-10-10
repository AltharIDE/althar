import type { ReactNode } from 'react'

/** A heading's rank. Components that title themselves take one as `headingLevel`, since only the page knows where they sit in its outline. */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

export interface HeadingProps {
  level: HeadingLevel
  children: ReactNode
  id?: string
  className?: string
}

/** A heading at the rank it is given. Its look comes from its class, not its rank. */
export function Heading({ level, children, id, className }: HeadingProps) {
  const Tag = `h${level}` as const
  return (
    <Tag id={id} className={className}>
      {children}
    </Tag>
  )
}

/** One rank down, for a component's inner headings, stopping at 6. */
export function below(level: HeadingLevel): HeadingLevel {
  switch (level) {
    case 1:
      return 2
    case 2:
      return 3
    case 3:
      return 4
    case 4:
      return 5
    case 5:
    case 6:
      return 6
  }
}
