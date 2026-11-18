import type { ComponentProps } from 'react'

import { RulesSection as Real } from '../../../src/renderer/features/rules/RulesSection'
import { People } from './team'

export * from '../../../src/renderer/features/rules/RulesSection'

/* The project's rules, with who is on its team and what each may change on their own, first (D). */
export function RulesSection(props: ComponentProps<typeof Real>) {
  return (
    <>
      <People />
      <Real {...props} />
    </>
  )
}
