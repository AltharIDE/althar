import type { ReactNode } from 'react'

import { Hero } from '../../Hero'

/* Prototype: a new first screen, being drawn; today's until it is. */
export function DitherHero({ nav }: { nav?: ReactNode }) {
  return <Hero nav={nav} />
}
