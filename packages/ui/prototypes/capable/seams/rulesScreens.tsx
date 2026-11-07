// Scrappy: the kit's screens as the project's Rules see them here: they lead with what asks (A, chosen), and keep today's charter from its sandbox on.
import type { ComponentProps } from 'react'

import { ProjectRules as RealProjectRules } from '../../../src/screens/ProjectRules/ProjectRules'
import { WhatAsks } from '../directions/rules/WhatAsks'
import { useProto } from '../state'
import s from '../directions/rules/rules.module.css'

export * from '../../../src/screens/index'

export function ProjectRules(props: ComponentProps<typeof RealProjectRules>) {
  const p = useProto()
  const tune = p.surface === 'tune' && p.direction !== 'Today'
  if (!tune && (p.surface !== 'rules' || p.direction === 'Today')) return <RealProjectRules {...props} />
  return (
    <>
      <WhatAsks />
      <RealProjectRules {...props} allowAll={false} className={s.trimA} />
    </>
  )
}
