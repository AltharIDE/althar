import type { ReactNode } from 'react'

import { Hero } from '../../Hero'

/* Prototype: a new first screen, being drawn; today's until it is. */
export function ChartHero({ nav }: { nav?: ReactNode }) {
  return <Hero nav={nav} />
}
